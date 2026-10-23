import { z } from "zod";
import { readRubyJson, redact, rubyOrigin } from "./ruby-diagnostics";

export type RubyConnection = { baseUrl: string; token: string; targetDevice: string };
export const rubyJob = z.object({
  id: z.string(),
  name: z.string().nullish(),
  status: z.string().nullish(),
  trackingNumber: z.string().nullish(),
});
export type RubyJob = z.infer<typeof rubyJob>;
export const rubyDevice = z.object({
  serialNo: z.string(),
  model: z.string().nullish(),
  status: z.string().nullish(),
  jobName: z.string().nullish(),
  progress: z.number().optional(),
});
export type RubyDevice = z.infer<typeof rubyDevice>;
export const receiptSchema = z.object({
  id: z.string(),
  name: z.string(),
  digest: z.string(),
  baseUrl: z.string(),
  targetDevice: z.string(),
  startedAt: z.string(),
  state: z.enum(["sending", "submitted", "rejected", "unknown"]),
  detail: z.string(),
});
export type RubyReceipt = z.infer<typeof receiptSchema>;
export const RECEIPTS_KEY = "ruby-imports-v1";

export function rubyClient(input: RubyConnection) {
  const baseUrl = rubyOrigin(input.baseUrl);
  const token = input.token.trim().replace(/^PersonalAccessToken\s+/i, "");
  const targetDevice = input.targetDevice.trim();
  if (!token || /\s/.test(token)) throw new Error("Enter a Ruby Personal Access Token.");
  if (!/^[\x21-\x7e]+$/.test(targetDevice))
    throw new Error("Enter the laser’s serial number without spaces.");
  const connection = { baseUrl, token, targetDevice };

  function request(path: string, body?: FormData) {
    return fetch(`${baseUrl}/api/OpenApi/${path}`, {
      method: body ? "POST" : "GET",
      body,
      headers: {
        Accept: "application/json",
        Authorization: `PersonalAccessToken ${token}`,
        "x-api-version": "1.0-OpenApi",
        "x-target-device": targetDevice,
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
    async upload(
      file: File,
      trackingNumber: string,
    ): Promise<Pick<RubyReceipt, "state" | "detail">> {
      const form = new FormData();
      form.append("uploadedFiles", file, file.name);
      try {
        const response = await request(
          `UploadFromMany?trackingNumber=${encodeURIComponent(trackingNumber)}`,
          form,
        );
        if (response.ok)
          return {
            state: "submitted",
            detail:
              "Ruby accepted the upload. Open Ruby to check the import and configure the job.",
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
  return value.replace(/^\d*\.?\d+/, (number) => Number(Number(number).toFixed(2)).toString());
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
    dimensions:
      dimension(width) && dimension(height)
        ? `${formatDimension(width)} × ${formatDimension(height)}`
        : "Physical size not specified — check the size in Ruby",
  };
}

export function duplicateImport(
  receipts: RubyReceipt[],
  connection: RubyConnection,
  digest: string,
  name: string,
) {
  return receipts.find(
    (item) =>
      item.digest === digest &&
      item.name === name &&
      item.baseUrl === connection.baseUrl &&
      item.targetDevice.toLowerCase() === connection.targetDevice.toLowerCase() &&
      item.state !== "rejected",
  );
}
