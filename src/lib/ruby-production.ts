import { z } from "zod";
import { readRubyJson, redact, rubyOrigin } from "./ruby-diagnostics";

export const connectionSchema = z.object({
  baseUrl: z.string(),
  token: z.string(),
  targetDevice: z.string(),
  displayName: z.string().optional(),
});
export type RubyConnection = z.infer<typeof connectionSchema>;
export const CONNECTION_KEY = "ruby-connection-v1";
export const RUBY_PROFILE_NAMES = {
  badge: "Purdue Hackers Badges",
  stamp: "Purdue Hackers Stamps",
} as const;
export type RubyFileKind = keyof typeof RUBY_PROFILE_NAMES;
const rubyProfile = z.object({
  id: z.uuid(),
  name: z.string().nullish(),
});
const rubyJob = z.object({
  id: z.string(),
  name: z.string().nullish(),
  status: z.string().nullish(),
  trackingNumber: z.string().nullish(),
});
export type RubyJob = z.infer<typeof rubyJob>;
const rubyDevice = z.object({
  serialNo: z.string(),
  model: z.string().nullish(),
  status: z.string().nullish(),
  jobName: z.string().nullish(),
  progress: z.number().optional(),
  remainingTime: z.number().optional(),
  issues: z
    .array(z.object({ code: z.string(), extraInfo: z.string().nullish(), active: z.boolean() }))
    .nullish(),
  error: z.object({ code: z.string(), additionalInfo: z.string().nullish() }).nullish(),
});
export type RubyDevice = z.infer<typeof rubyDevice>;
export const receiptSchema = z.object({
  id: z.string(),
  name: z.string(),
  digest: z.string(),
  baseUrl: z.string(),
  targetDevice: z.string(),
  startedAt: z.string(),
  profileId: z.uuid().optional(),
  profileName: z.string().optional(),
  batchId: z.string().optional(),
  rubyName: z.string().optional(),
  jobIds: z.array(z.string()).optional(),
  queueAttemptedAt: z.string().optional(),
  queueError: z.string().optional(),
  queuedAt: z.string().optional(),
  jobs: z.array(rubyJob).optional(),
  state: z.enum(["sending", "submitted", "rejected", "unknown"]),
  detail: z.string(),
});
export type RubyReceipt = z.infer<typeof receiptSchema>;
export const RECEIPTS_KEY = "ruby-imports-v1";

export function rubyAccount(token: string) {
  try {
    const payload = token
      .trim()
      .replace(/^PersonalAccessToken\s+/i, "")
      .split(".")[1];
    const claims = z
      .record(z.string(), z.unknown())
      .parse(
        JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(atob(payload.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
              c.charCodeAt(0),
            ),
          ),
        ),
      );
    const text = (keys: string[]) =>
      keys
        .map((key) => claims[key])
        .find((value): value is string => typeof value === "string" && Boolean(value));
    return {
      id: text([
        "nameid",
        "sub",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier",
      ]),
      name: text([
        "name",
        "unique_name",
        "email",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
      ]),
    };
  } catch {
    return {};
  }
}

export function rubyClient(input: RubyConnection) {
  const baseUrl = rubyOrigin(input.baseUrl);
  const token = input.token.trim().replace(/^PersonalAccessToken\s+/i, "");
  const targetDevice = input.targetDevice.trim();
  if (!token || /\s/.test(token)) throw new Error("Enter a Ruby Personal Access Token.");
  if (!/^[\x21-\x7e]+$/.test(targetDevice))
    throw new Error("Enter the laser’s serial number without spaces.");
  const connection = { baseUrl, token, targetDevice, displayName: input.displayName?.trim() };

  function request(path: string, body?: FormData | string) {
    return fetch(`${baseUrl}/api/OpenApi/${path}`, {
      method: body ? "POST" : "GET",
      body,
      headers: {
        Accept: "application/json",
        Authorization: `PersonalAccessToken ${token}`,
        "x-api-version": "1.0-OpenApi",
        "x-target-device": targetDevice,
        ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}),
      },
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(body ? 60_000 : 15_000),
    });
  }

  async function failure(response: Response) {
    const data = await readRubyJson(response).catch(() => undefined);
    const code = z.object({ code: z.string() }).safeParse(data);
    if (code.success && code.data.code === "ERR_IMPORTPROFILE_002")
      return "Ruby rejected the import profile. Check that it still exists in Ruby, then try again.";
    return response.status === 401 || response.status === 403
      ? "Ruby rejected the token or its permissions."
      : `Ruby returned ${code.success ? `${String(redact(code.data.code, token))} · ` : ""}HTTP ${response.status}.`;
  }

  async function read(path: string) {
    let response: Response;
    try {
      response = await request(path);
    } catch {
      throw new Error(
        "Could not reach Ruby. Check its certificate, local-network access, and API address.",
      );
    }
    if (!response.ok) throw new Error(await failure(response));
    return redact(await readRubyJson(response), token);
  }

  return {
    connection,
    async device() {
      return rubyDevice.parse(await read("GetDeviceStatus"));
    },
    async queue() {
      const data = await read("GetQueueElements");
      if (data === undefined)
        throw new Error("Ruby returned no queue data. This does not confirm an empty queue.");
      return z.array(rubyJob).parse(data);
    },
    async jobs(trackingNumber: string) {
      return z
        .array(rubyJob)
        .parse(await read(`GetJobsStatus?trackingNumber=${encodeURIComponent(trackingNumber)}`));
    },
    async profiles() {
      return z.array(rubyProfile).parse(await read("GetImportProfiles"));
    },
    async workbenches() {
      return z.array(rubyJob).parse(await read("GetWorkbenches"));
    },
    async enqueue(ids: string[]) {
      const response = await request("EnqueueWorkbench", JSON.stringify(ids));
      if (!response.ok) throw new Error(await failure(response));
    },
    async upload(
      file: File,
      trackingNumber: string,
      importProfileId: string,
    ): Promise<Pick<RubyReceipt, "state" | "detail">> {
      const form = new FormData();
      form.append("uploadedFiles", file, file.name);
      const query = new URLSearchParams({ trackingNumber, importProfileId });
      try {
        const response = await request(`UploadFromMany?${query}`, form);
        if (response.ok)
          return {
            state: "submitted",
            detail: "Creating the job in Ruby.",
          };
        return {
          state: [400, 401, 403, 413, 415, 422].includes(response.status) ? "rejected" : "unknown",
          detail: await failure(response),
        };
      } catch {
        return {
          state: "unknown",
          detail: "No upload confirmation received. Check Ruby before sending this file again.",
        };
      }
    },
  };
}

function formatDimension(value: string) {
  const unit = value.trim().slice(-2).toLowerCase();
  const inches = Number.parseFloat(value) / (unit === "mm" ? 25.4 : unit === "cm" ? 2.54 : 1);
  return Number(inches.toFixed(2)).toString();
}

export async function prepareSvg(file: File) {
  if (!/\.svg$/i.test(file.name)) throw new Error(`${file.name}: choose an SVG cutting file.`);
  const bytes = await file.arrayBuffer();
  const text = new TextDecoder().decode(bytes);
  const document = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = document.documentElement;
  if (svg.localName !== "svg" || document.querySelector("parsererror"))
    throw new Error(`${file.name}: this is not a valid SVG.`);
  if (/<!DOCTYPE/i.test(text) || document.querySelector("script, foreignObject"))
    throw new Error(`${file.name}: remove scripts and embedded HTML before uploading.`);
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of element.attributes) {
      if (
        /^on/i.test(attribute.name) ||
        (/href$/i.test(attribute.name) && !attribute.value.startsWith("#"))
      )
        throw new Error(`${file.name}: remove linked content or scripts before uploading.`);
    }
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const width = svg.getAttribute("width"),
    height = svg.getAttribute("height");
  const dimension = (value: string | null): value is string =>
    Boolean(value && /^\d*\.?\d+(mm|cm|in)$/i.test(value.trim()));
  return {
    file,
    digest,
    svg: text,
    kind: (/(?:^|-)stamp\.svg$/i.test(file.name) ? "stamp" : "badge") as RubyFileKind,
    dimensions:
      dimension(width) && dimension(height)
        ? `${formatDimension(width)} × ${formatDimension(height)} in`
        : "Size not specified. Check in Ruby.",
  };
}

export function duplicateImport(
  receipts: RubyReceipt[],
  connection: RubyConnection,
  digest: string,
  name: string,
  batchId?: string,
  includeRejected = false,
) {
  return receipts.findLast(
    (item) =>
      item.digest === digest &&
      item.name === name &&
      item.baseUrl === connection.baseUrl &&
      item.targetDevice.toLowerCase() === connection.targetDevice.toLowerCase() &&
      (includeRejected || item.state !== "rejected") &&
      item.batchId === batchId,
  );
}
