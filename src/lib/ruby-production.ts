import { z } from "zod";
import { readRubyJson, redact, rubyOrigin, rubyRequest } from "./ruby-transport";

export const connectionSchema = z.object({
  baseUrl: z.string(),
  token: z.string(),
  targetDevice: z.string(),
  displayName: z.string().optional(),
  simulated: z.boolean().optional(),
});
export type RubyConnection = z.infer<typeof connectionSchema>;
export const CONNECTION_KEY = "ruby-connection-v1";
export const RUBY_PROFILE_NAMES = {
  badge: "Purdue Hackers Badges",
  stamp: "Purdue Hackers Stamps",
} as const;
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
const informationalIssue = z.object({ severity: z.literal("Informational") });
const rubyDevice = z.object({
  serialNo: z.string(),
  model: z.string().nullish(),
  status: z.string().nullish(),
  jobName: z.string().nullish(),
  progress: z.number().optional(),
  remainingTime: z.number().optional(),
  issues: z.preprocess(
    // Informational entries do not affect readiness, even when Ruby sends different issue fields.
    (issues) =>
      Array.isArray(issues)
        ? issues.filter((issue) => !informationalIssue.safeParse(issue).success)
        : issues,
    z
      .array(
        z.object({
          code: z.string(),
          extraInfo: z.string().nullish(),
          active: z
            .union([z.boolean(), z.literal(0), z.literal(1)])
            .transform((active) => active === true || active === 1),
          severity: z.string().nullish(),
        }),
      )
      .nullish(),
  ),
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
  const baseUrl = input.simulated ? "https://ruby-simulator.invalid" : rubyOrigin(input.baseUrl);
  const token = input.token.trim().replace(/^PersonalAccessToken\s+/i, "");
  const targetDevice = input.targetDevice.trim();
  if (!token || /\s/.test(token)) throw new Error("Enter a Ruby Personal Access Token.");
  if (!/^[\x21-\x7e]+$/.test(targetDevice))
    throw new Error("Enter the laser’s serial number without spaces.");
  const connection = {
    baseUrl,
    token,
    targetDevice,
    displayName: input.displayName?.trim(),
    simulated: input.simulated,
  };

  function request(path: string, body?: FormData | string) {
    if (connection.simulated)
      return import("./ruby-simulator").then(({ simulationRequest }) =>
        simulationRequest(connection, path, body),
      );
    return rubyRequest(connection, `/api/OpenApi/${path}`, body);
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
        connection.simulated
          ? "The simulated laser has changed. Connect again."
          : "Could not reach Ruby. Check its certificate, local-network access, and API address.",
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
