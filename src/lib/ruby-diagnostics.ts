export const RUBY_SCHEMA_PATH = "/swagger/1.0-OpenApi/swagger.json";
export const RUBY_CHECKS = [
  {
    name: "Device",
    path: "/api/OpenApi/GetDeviceStatus",
    detail: "Connection, machine state, and device details",
    targeted: true,
  },
  {
    name: "Import profiles",
    path: "/api/OpenApi/GetImportProfiles",
    detail: "Available profile names, IDs, and materials",
    targeted: true,
  },
  {
    name: "Designs",
    path: "/api/OpenApi/GetDesigns",
    detail: "Saved design names and IDs",
    targeted: false,
  },
  {
    name: "Workbenches",
    path: "/api/OpenApi/GetWorkbenches",
    detail: "Saved job names and IDs",
    targeted: false,
  },
  {
    name: "Queue",
    path: "/api/OpenApi/GetQueueElements",
    detail: "Current queue entries and ordering",
    targeted: true,
  },
] as const;

export type RubyCheck = {
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
  auth: { supplied: boolean; format: "personal-access-token" | "bearer" | "raw" };
  checks: RubyCheck[];
  notes: string;
};

export function rubyOrigin(input: string): string {
  const url = new URL(input.trim());
  const host = url.hostname;
  const octets = host.split(".").map(Number);
  const privateIp =
    octets.length === 4 &&
    octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  const loopback = host === "localhost" || host === "[::1]" || (privateIp && octets[0] === 127);
  const knownHost = ["x-bidc229pc2", "x-bidc229pc2.boilerad.purdue.edu"].includes(host);
  if (
    (!loopback && !privateIp && !knownHost) ||
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
  ) {
    throw new Error(
      "Use Ruby’s HTTPS address on the local network, or localhost on this computer.",
    );
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Enter only the Ruby API origin, such as https://localhost:5001.");
  }
  return url.origin;
}

export function redact(value: unknown, token = ""): unknown {
  if (typeof value === "string") {
    let text = token ? value.split(token).join("[redacted]") : value;
    text = text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted JWT]");
    text = text.replace(
      /\b(Bearer|PersonalAccessToken)\s+[A-Za-z0-9._~+/-]{20,}={0,2}/gi,
      "$1 [redacted]",
    );
    return text;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, token));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /password|secret|token|authorization|cookie|credential|api[-_]?key/i.test(key) &&
        typeof item !== "object"
          ? "[redacted]"
          : redact(item, token),
      ]),
    );
  }
  return value;
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  if (!response.body) throw new Error("Ruby returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8 * 1024 * 1024)
        throw new Error("Response exceeded 8 MB. Collect a smaller sample in Swagger.");
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  body += decoder.decode();
  if (!body.trim()) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Ruby returned a non-JSON response. Check the API address and port.");
  }
}

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
    format: RubyReport["auth"]["format"];
    signal: AbortSignal;
  },
  onCheck: (check: RubyCheck) => void,
): Promise<void> {
  const baseUrl = rubyOrigin(options.baseUrl);
  const token = options.token.trim().replace(/^(?:PersonalAccessToken|Bearer)\s+/i, "");
  if (/[\r\n]/.test(token)) throw new Error("The token must be a single line.");
  const targetDevice = options.targetDevice?.trim();
  if (targetDevice && !/^[\x21-\x7e]+$/.test(targetDevice)) {
    throw new Error("Enter the laser’s serial number without spaces or line breaks.");
  }
  const authorization = token
    ? options.format === "raw"
      ? token
      : `${options.format === "bearer" ? "Bearer" : "PersonalAccessToken"} ${token}`
    : undefined;

  async function probe(
    name: string,
    path: string,
    authenticated: boolean,
    targeted = false,
  ): Promise<RubyCheck> {
    const start = performance.now();
    let status: number | undefined;
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(path !== RUBY_SCHEMA_PATH
            ? {
                "x-api-version": "1.0-OpenApi",
                ...(targeted && targetDevice ? { "x-target-device": targetDevice } : {}),
              }
            : {}),
          ...(authenticated && authorization ? { Authorization: authorization } : {}),
        },
        mode: "cors",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]),
      });
      status = response.status;
      const data = redact(await readJson(response), token);
      return {
        name,
        path,
        state: response.ok
          ? "collected"
          : status === 400 || status === 401 || status === 403
            ? "needs-input"
            : "error",
        status,
        detail: responseDetail(status, path, data, Boolean(token)),
        data,
        durationMs: Math.round(performance.now() - start),
      };
    } catch (error) {
      const detail = options.signal.aborted
        ? "Stopped."
        : error instanceof Error && error.name === "TimeoutError"
          ? "No readable response within 15 seconds."
          : error instanceof TypeError
            ? "The browser could not read Ruby’s response. Check the certificate, local-network permission, and CORS; this result alone cannot identify which failed."
            : error instanceof Error
              ? error.message
              : "Could not read this response.";
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
  downloadFile("ruby-diagnostics.json", JSON.stringify(report, undefined, 2), "application/json");
}

export function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
