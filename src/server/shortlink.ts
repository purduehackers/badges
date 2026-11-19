import { createClient } from "@purduehackers/phack-cli";
import { z } from "zod";

/** The phack API creates atomically and never overwrites another destination. */
export async function writeBadgeLink(slug: string, destination: string, token: string) {
  z.string()
    .regex(/^badge-\d+(?:-\d+)+$/u)
    .parse(slug);
  const api = createClient("https://phack.rs", token);
  const options = { fetch: { signal: AbortSignal.timeout(15_000) } };
  const created = await api.links.post({ slug, destination }, options).catch(() => undefined);
  if (created?.data?.d === destination) return;
  // A lost create response can still mean success. Read the same slug before retrying.
  const current = await api
    .links({ slug })
    .get(options)
    .catch(() => undefined);
  if (current?.data?.d === destination) return;
  if (current?.data) throw new Error("The badge shortlink already points somewhere else.");
  throw new Error(
    `Badge shortlink API could not confirm creation (HTTP ${created?.error?.status ?? current?.error?.status ?? "unavailable"}). Retry the same badge link.`,
  );
}
