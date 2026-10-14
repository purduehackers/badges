import { env } from "./env.ts";
import { eventSchema } from "../workflow/index.ts";
import type { BadgeEvent, Cms } from "../workflow/index.ts";
import { z } from "zod";

const rawEvent = z.object({
  id: z.union([z.string(), z.number()]),
  slug: z.string(),
  name: z.string(),
  start: z.iso.datetime({ offset: true }),
});
function parseEvent(value: unknown): BadgeEvent {
  const event = rawEvent.parse(value),
    version = /^Hack Night (\d+\.\d+)$/u.exec(event.name)?.[1];
  if (!version) throw new Error("Choose a CMS event named exactly Hack Night X.XX.");
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Indiana/Indianapolis",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(event.start));
  return eventSchema.parse({
    id: String(event.id),
    slug: event.slug,
    name: event.name,
    version,
    date,
  });
}
async function request(path: string, collection = "events"): Promise<unknown> {
  if (!env.PAYLOAD_CMS_API_KEY) throw new Error("CMS access is not configured.");
  const response = await fetch(`https://cms.purduehackers.com/api/${collection}${path}`, {
    headers: { Authorization: `service-accounts API-Key ${env.PAYLOAD_CMS_API_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`CMS read failed (${response.status}).`);
  return response.json();
}
export const cms: Cms = {
  event: async (id) => parseEvent(await request(`/${encodeURIComponent(id)}?depth=0`)),
  events: async () => {
    const query = new URLSearchParams({
      depth: "0",
      limit: "100",
      sort: "start",
      "where[start][greater_than_equal]": new Date(Date.now() - 7 * 86_400_000).toISOString(),
    });
    const result = z
      .object({ docs: z.array(rawEvent) })
      .parse(await request(`?${query.toString()}`));
    return result.docs
      .filter((event) => /^Hack Night \d+\.\d+$/u.test(event.name))
      .slice(0, 25)
      .map(parseEvent);
  },
};

export async function attendance(eventId?: string) {
  if (!eventId) throw new Error("Choose a Hack Night first.");
  const query = new URLSearchParams({
    limit: "1",
    depth: "0",
    "where[event][equals]": eventId,
    "select[id]": "true",
  });
  const result = z
    .object({ totalDocs: z.int().nonnegative() })
    .parse(await request(`?${query}`, "rsvps"));
  return {
    rsvps: result.totalDocs,
    note: "RSVP count only. Walk-ins and no-shows are unknown. The manufacturer chooses the target quantity.",
  };
}
