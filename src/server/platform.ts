import { timingSafeEqual } from "node:crypto";

export const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID ?? "772576325897945119";
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
export function bearerMatches(header: string | undefined, secret: string): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7)),
    expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
