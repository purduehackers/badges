import { browserStore } from "./browser-store";
import { parseSvg } from "./svg-document";
import { physicalSize } from "./ruby-bed";
import { ACRYLIC_THICKNESS_MM, STAMP_THICKNESS_MM } from "../workflow/policy";
import type { Criterion } from "../workflow/contracts";
import { z } from "zod";
import { materialDescription, stockMaterial } from "./materials";
import {
  duplicateImport,
  rubyClient,
  RUBY_PROFILE_NAMES,
  type RubyReceipt,
} from "./ruby-production";

export const releaseSchema = z.array(
  z.object({
    version: z.string(),
    files: z.array(z.object({ name: z.string(), url: z.url() })),
    badge: z.url().optional(),
    badgeImage: z.url().optional(),
  }),
);
export type Release = z.infer<typeof releaseSchema>[number];
export interface ProductionFile {
  file: File;
  digest: string;
  svg: string;
  kind: Criterion;
  dimensions: string;
  batchId?: string;
  version?: string;
  previewSvg?: string;
  materialId?: string;
  thicknessMm: number;
  mirrored: boolean;
}

export function materialSummary(file: ProductionFile) {
  if (file.kind === "stamp") return `Stamp rubber · ${STAMP_THICKNESS_MM} mm`;
  return file.materialId
    ? materialDescription({ materialId: file.materialId, thicknessMm: file.thicknessMm })
    : "Choose acrylic";
}

export async function productionFile(file: File, version?: string): Promise<ProductionFile> {
  if (!/\.svg$/i.test(file.name)) throw new Error(`${file.name}: choose an SVG cutting file.`);
  const bytes = await file.arrayBuffer();
  const text = new TextDecoder().decode(bytes);
  const { root: svg } = parseSvg(text, true);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const size = physicalSize(svg.getAttribute("width"), svg.getAttribute("height"));
  const material =
    /\d+(?:\.\d+)?x\d+(?:\.\d+)?-([a-z][a-z-]+)-(\d+(?:\.\d+)?)mm(?:-\d+)?\.svg$/i.exec(file.name);
  const kind = /(?:^|-)stamp\.svg$/i.test(file.name) ? "stamp" : "badge";
  let thicknessMm = material ? Number(material[2]) : ACRYLIC_THICKNESS_MM;
  if (kind === "stamp") thicknessMm = STAMP_THICKNESS_MM;
  return {
    version,
    materialId: material && stockMaterial(material[1]) ? material[1] : undefined,
    thicknessMm,
    mirrored: kind === "stamp",
    file,
    digest,
    svg: text,
    kind,
    dimensions: size
      ? `${Number((size.width / 25.4).toFixed(2))} × ${Number((size.height / 25.4).toFixed(2))} in`
      : "Size not specified. Check in Ruby.",
  };
}

export async function loadRelease(release: Release) {
  const read = async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Could not load Hack Night ${release.version}. Try again.`);
    return response.text();
  };
  const [badge, files] = await Promise.all([
    release.badge ? read(release.badge) : undefined,
    Promise.all(
      release.files.map(async (file) =>
        productionFile(
          new File([await read(file.url)], `${release.version}-${file.name}`, {
            type: "image/svg+xml",
          }),
          release.version,
        ),
      ),
    ),
  ]);
  return files.map((file) => ({ ...file, previewSvg: file.kind === "badge" ? badge : undefined }));
}

const batchStore = browserStore("ruby-production", "batch");
export async function savedBatch(
  files?: ProductionFile[],
  key = "current",
): Promise<ProductionFile[]> {
  return (await batchStore(files, key)) ?? [];
}

type Client = ReturnType<typeof rubyClient>;
export async function reconcileJob(
  client: Client,
  receipt: RubyReceipt,
  save: (receipt: RubyReceipt) => void,
  active: () => boolean,
) {
  function queued(jobs: RubyReceipt["jobs"]) {
    const next = {
      ...receipt,
      state: "submitted" as const,
      jobs,
      jobIds: jobs?.map((job) => job.id),
      queuedAt: receipt.queuedAt ?? new Date().toISOString(),
      queueError: undefined,
      detail: "Queued in Ruby.",
    };
    save(next);
    return next;
  }
  const [tracked, queue] = await Promise.all([client.jobs(receipt.id), client.queue()]);
  const jobs = tracked.length
    ? tracked
    : queue.filter((job) => job.trackingNumber === receipt.id || receipt.jobIds?.includes(job.id));
  if (jobs.length) return queued(jobs);
  if (receipt.queueError) throw new Error(receipt.queueError);
  if (receipt.queueAttemptedAt) return receipt;
  // Give the import profile time to finish its own queue action first.
  if (Date.now() - Date.parse(receipt.startedAt) < 10_000) return receipt;
  const workbenches = await client.workbenches();
  const expectedName = receipt.rubyName?.replace(/\.svg$/i, "");
  const matching = workbenches.filter(
    (job) =>
      job.trackingNumber === receipt.id ||
      (expectedName && [expectedName, receipt.rubyName].includes(job.name ?? "")),
  );
  if (!matching.length) return receipt;
  // Recheck immediately before enqueueing, using only this upload's workbenches.
  const existing = (await client.queue()).filter(
    (job) =>
      matching.some((workbench) => workbench.id === job.id) || job.trackingNumber === receipt.id,
  );
  if (existing.length) return queued(existing);
  const next = {
    ...receipt,
    jobIds: matching.map((job) => job.id),
    queueAttemptedAt: new Date().toISOString(),
    detail: "Waiting for Ruby to confirm the queue.",
  };
  if (!active()) return receipt;
  save(next);
  try {
    await client.enqueue(next.jobIds);
  } catch (cause) {
    const detail =
      cause instanceof Error ? cause.message : "Ruby did not confirm the queue request.";
    const queueError = `${detail} Check this job in Ruby before queuing it again.`;
    save({ ...next, queueError, detail: queueError });
    throw new Error(queueError);
  }
  return next;
}

export async function queueBatch(
  client: Client,
  files: ProductionFile[],
  history: RubyReceipt[],
  save: (receipt: RubyReceipt) => void,
  active: () => boolean,
) {
  if (
    files.some(
      (file) => file.kind === "badge" && Math.abs(file.thicknessMm - ACRYLIC_THICKNESS_MM) > 0.001,
    )
  )
    throw new Error(
      "The Ruby badge profile uses ⅛-inch acrylic. Choose cutting files for that thickness.",
    );
  const profiles = await client.profiles();
  const planned = files.map((file) => {
    const name = RUBY_PROFILE_NAMES[file.kind];
    const matches = profiles.filter((profile) => profile.name === name);
    if (matches.length !== 1) throw new Error(`Ruby needs exactly one profile named “${name}”.`);
    return { file, profile: matches[0]! };
  });
  for (const { file, profile } of planned) {
    if (!active()) return;
    let receipt = duplicateImport(
      history,
      client.connection,
      file.digest,
      file.file.name,
      file.batchId,
    );
    if (!receipt) {
      const id = `ph-${crypto.randomUUID()}`;
      const rubyName = `${file.file.name.replace(/\.svg$/i, "")}--${id.slice(3, 11)}.svg`;
      receipt = {
        id,
        batchId: file.batchId,
        name: file.file.name,
        digest: file.digest,
        baseUrl: client.connection.baseUrl,
        targetDevice: client.connection.targetDevice,
        startedAt: new Date().toISOString(),
        profileId: profile.id,
        profileName: profile.name ?? "",
        rubyName,
        state: "sending",
        detail: "Sending to Ruby.",
      };
      save(receipt);
      const result = await client.upload(
        new File([file.file], rubyName, { type: "image/svg+xml" }),
        id,
        profile.id,
      );
      receipt = { ...receipt, ...result };
      save(receipt);
      if (receipt.state !== "submitted") throw new Error(receipt.detail);
    }
    if (receipt.state === "unknown" || receipt.state === "sending") {
      receipt = await reconcileJob(client, receipt, save, active);
      if (!receipt.queuedAt)
        throw new Error(
          "Ruby hasn’t confirmed this upload. Check its status before sending more files.",
        );
    }
    for (let attempt = 0; attempt < 16 && !receipt.queuedAt && active(); attempt++) {
      receipt = await reconcileJob(client, receipt, save, active);
      if (!receipt.queuedAt) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (!receipt.queuedAt)
      throw new Error(
        "The file is imported, but Ruby hasn’t confirmed a queued job yet. Check the queue again; the file won’t be resent.",
      );
    if (receipt.jobs?.some((job) => ["Erroneous", "Removed"].includes(job.status ?? "")))
      throw new Error(
        `${file.file.name} needs attention in Ruby. The remaining files haven’t been sent.`,
      );
  }
}
