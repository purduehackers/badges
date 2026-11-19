import { readResponse } from "./lib/http.ts";
import {
  badgeEndpoints,
  type BadgeEndpoint,
  type BadgeRequest,
  type BadgeResponse,
} from "./workflow/api.ts";
export { BadgeApiError } from "./lib/http.ts";
export type { BadgeResponse } from "./workflow/api.ts";

export type BadgeClient = ReturnType<typeof createBadgeClient>;
export function createBadgeClient(baseUrl: string, secret: string) {
  return {
    async post<P extends BadgeEndpoint>(
      path: P,
      body: BadgeRequest<P>,
      timeout = 20_000,
    ): Promise<BadgeResponse<P>> {
      const response = await fetch(new URL(`/badges/${path}`, baseUrl), {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify(badgeEndpoints[path].request.parse(body)),
        signal: AbortSignal.timeout(timeout),
      });
      return readResponse(response, badgeEndpoints[path].response) as Promise<BadgeResponse<P>>;
    },
  };
}
