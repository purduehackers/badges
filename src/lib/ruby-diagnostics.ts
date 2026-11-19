import { rubyOrigin, rubyRequest, readRubyJson, redact } from "./ruby-transport";
const RUBY_SCHEMA_PATH = "/swagger/1.0-OpenApi/swagger.json";
const RUBY_CHECKS = [
  {
    name: "Device",
    path: "/api/OpenApi/GetDeviceStatus",
    targeted: true,
  },
  {
    name: "Import profiles",
    path: "/api/OpenApi/GetImportProfiles",
    targeted: true,
  },
  {
    name: "Designs",
    path: "/api/OpenApi/GetDesigns",
    targeted: false,
  },
  {
    name: "Workbenches",
    path: "/api/OpenApi/GetWorkbenches",
    targeted: false,
  },
  {
    name: "Queue",
    path: "/api/OpenApi/GetQueueElements",
    targeted: true,
  },
] as const;

type RubyCheck = {
  name: string;
  path: string;
  state: "collected" | "blocked" | "needs-input" | "error";
  detail: string;
  status?: number;
  durationMs?: number;
  data?: unknown;
};

export type RubyReport = {
  version: 1;
  collectedAt: string;
  source: "browser";
  baseUrl: string;
  targetDevice?: string;
  pageOrigin: string;
  userAgent: string;
  secureContext: boolean;
  auth: { supplied: boolean; format: "personal-access-token" };
  checks: RubyCheck[];
};

function responseDetail(status: number, path: string, data: unknown, hasToken: boolean): string {
  if (status === 401 || status === 403) {
    return hasToken
      ? "Ruby rejected the authorization header. Check the token, header format, and permissions."
      : "Ruby is reachable. Enter a Personal Access Token to read this data.";
  }
  const code =
    data && typeof data === "object" && "code" in data && typeof data.code === "string"
      ? data.code.slice(0, 100)
      : undefined;
  if (status < 200 || status >= 300) {
    if (code === "ERR_QUEUE_000") {
      return "Ruby returned ‘No device’ (ERR_QUEUE_000). Check the laser’s serial number and connection in Ruby.";
    }
    return `Ruby returned ${code ? `${code} (HTTP ${status})` : `HTTP ${status}`}. See the response in the report.`;
  }
  if (status === 204) return "Ruby returned no content. This does not confirm a connected laser.";
  if (Array.isArray(data)) {
    if (path === "/api/OpenApi/GetImportProfiles" && data.length === 0) {
      return "No import profiles are visible to this API user. Check Ruby’s Profiles menu; saved materials alone are not import profiles.";
    }
    return `${data.length.toLocaleString("en-US")} ${data.length === 1 ? "entry" : "entries"} returned.`;
  }
  return "JSON response collected.";
}

export async function collectRuby(
  options: {
    baseUrl: string;
    token: string;
    targetDevice?: string;
    signal: AbortSignal;
  },
  onCheck: (check: RubyCheck) => void,
): Promise<void> {
  const baseUrl = rubyOrigin(options.baseUrl);
  const token = options.token.trim().replace(/^PersonalAccessToken\s+/i, "");
  if (/[\r\n]/.test(token)) throw new Error("The token must be a single line.");
  const targetDevice = options.targetDevice?.trim();
  if (targetDevice && !/^[\x21-\x7e]+$/.test(targetDevice)) {
    throw new Error("Enter the laser’s serial number without spaces or line breaks.");
  }

  async function probe(
    name: string,
    path: string,
    authenticated: boolean,
    targeted = false,
  ): Promise<RubyCheck> {
    const start = performance.now();
    let status: number | undefined;
    try {
      const response = await rubyRequest(
        {
          baseUrl,
          token: authenticated ? token : undefined,
          targetDevice: targeted ? targetDevice : undefined,
        },
        path,
        undefined,
        options.signal,
      );
      status = response.status;
      const data = redact(await readRubyJson(response), token);
      let state: RubyCheck["state"] = "collected";
      if (!response.ok) {
        state = [400, 401, 403].includes(status) ? "needs-input" : "error";
      }
      return {
        name,
        path,
        state,
        status,
        detail: responseDetail(status, path, data, Boolean(token)),
        data,
        durationMs: Math.round(performance.now() - start),
      };
    } catch (error) {
      let detail = "Could not read this response.";
      if (options.signal.aborted) {
        detail = "Stopped.";
      } else if (error instanceof Error && error.name === "TimeoutError") {
        detail = "No readable response within 15 seconds.";
      } else if (error instanceof TypeError) {
        detail =
          "The browser could not read Ruby’s response. Check the certificate, local-network permission, and CORS; this result alone cannot identify which failed.";
      } else if (error instanceof Error) {
        detail = error.message;
      }
      return {
        name,
        path,
        state: status ? "error" : "blocked",
        status,
        detail: String(redact(detail, token)),
        durationMs: Math.round(performance.now() - start),
      };
    }
  }

  let schema = await probe("API schema", RUBY_SCHEMA_PATH, false);
  if ((schema.status === 401 || schema.status === 403) && token && !options.signal.aborted) {
    schema = await probe("API schema", RUBY_SCHEMA_PATH, true);
  }
  if (
    schema.state === "collected" &&
    !(schema.data && typeof schema.data === "object" && "paths" in schema.data)
  ) {
    schema.state = "error";
    schema.detail =
      "This JSON is not an OpenAPI document. Check the schema URL in Ruby’s Swagger page.";
  }
  onCheck(schema);

  for (const check of RUBY_CHECKS) {
    if (options.signal.aborted) break;
    onCheck(await probe(check.name, check.path, true, check.targeted));
  }
}

export function downloadReport(report: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, undefined, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "ruby-diagnostics.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
