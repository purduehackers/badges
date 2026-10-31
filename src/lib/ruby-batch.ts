import { z } from "zod";
import { materialDescription, stockMaterial } from "./materials";
import {
  duplicateImport,
  prepareSvg,
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
export type ProductionFile = Awaited<ReturnType<typeof prepareSvg>> & {
  batchId?: string;
  version?: string;
  previewSvg?: string;
  materialId?: string;
  thicknessMm: number;
  mirrored: boolean;
};

export function materialSummary(file: ProductionFile) {
  if (file.kind === "stamp") return "Stamp rubber · 2.3 mm";
  return file.materialId
    ? materialDescription({ materialId: file.materialId, thicknessMm: file.thicknessMm })
    : "Choose acrylic";
}

export async function productionFile(file: File, version?: string): Promise<ProductionFile> {
  const prepared = await prepareSvg(file);
  const material =
    /\d+(?:\.\d+)?x\d+(?:\.\d+)?-([a-z][a-z-]+)-(\d+(?:\.\d+)?)mm(?:-\d+)?\.svg$/i.exec(file.name);
  return {
    ...prepared,
    version,
    materialId: material && stockMaterial(material[1]) ? material[1] : undefined,
    thicknessMm: material ? Number(material[2]) : 3.175,
    mirrored: prepared.kind === "stamp",
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

// IndexedDB preserves uploaded SVGs across reloads without filling localStorage.
export async function savedBatch(
  files?: ProductionFile[],
  key = "current",
): Promise<ProductionFile[]> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("ruby-production", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("batch");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Allow browser storage to remember this batch."));
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("batch", files ? "readwrite" : "readonly");
      const store = transaction.objectStore("batch");
      const request = files ? store.put(files, key) : store.get(key);
      transaction.oncomplete = () =>
        resolve((request.result && !files ? request.result : files) ?? []);
      transaction.onerror = () => reject(new Error("Could not save this batch on this computer."));
      transaction.onabort = () => reject(new Error("Could not save this batch on this computer."));
    });
  } finally {
    database.close();
  }
}

type Client = ReturnType<typeof rubyClient>;
export async function reconcileJob(
  client: Client,
  receipt: RubyReceipt,
  save: (receipt: RubyReceipt) => void,
  active: () => boolean,
) {
  const [tracked, queue] = await Promise.all([client.jobs(receipt.id), client.queue()]);
  const jobs = tracked.length
    ? tracked
    : queue.filter((job) => job.trackingNumber === receipt.id || receipt.jobIds?.includes(job.id));
  if (jobs.length) {
    const next = {
      ...receipt,
      state: "submitted" as const,
      jobs,
      jobIds: jobs.map((job) => job.id),
      queuedAt: receipt.queuedAt ?? new Date().toISOString(),
      queueError: undefined,
      detail: "Queued in Ruby.",
    };
    save(next);
    return next;
  }
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
  if (existing.length) {
    const next = {
      ...receipt,
      state: "submitted" as const,
      jobs: existing,
      jobIds: existing.map((job) => job.id),
      queuedAt: new Date().toISOString(),
      detail: "Queued in Ruby.",
    };
    save(next);
    return next;
  }
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
  if (files.some((file) => file.kind === "badge" && Math.abs(file.thicknessMm - 3.175) > 0.001))
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
