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

export async function readRubyJson(response: Response): Promise<unknown> {
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

/** Shared browser transport for production and diagnostics; credentials never reach our server. */
export function rubyRequest(
  connection: { baseUrl: string; token?: string; targetDevice?: string },
  path: string,
  body?: FormData | string,
  signal?: AbortSignal,
) {
  const timeout = AbortSignal.timeout(body ? 60_000 : 15_000);
  return fetch(`${connection.baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    body,
    headers: {
      Accept: "application/json",
      ...(connection.token ? { Authorization: `PersonalAccessToken ${connection.token}` } : {}),
      ...(path.startsWith("/api/") ? { "x-api-version": "1.0-OpenApi" } : {}),
      ...(connection.targetDevice ? { "x-target-device": connection.targetDevice } : {}),
      ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}),
    },
    mode: "cors",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}
