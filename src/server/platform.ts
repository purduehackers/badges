import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID ?? "772576325897945119";
export const messagePayloadSchema = z.object({
  kind: z.string(),
  messageId: z.string(),
  content: z.string(),
  principal: z.object({ userId: z.string(), username: z.string(), canManufacture: z.boolean() }),
  channel: z.object({ id: z.string() }),
  thread: z.object({ id: z.string(), parentId: z.string() }).optional(),
  attachments: z
    .array(z.object({ url: z.url(), filename: z.string(), size: z.number() }))
    .optional(),
});
export type MessagePayload = z.output<typeof messagePayloadSchema>;
export type Principal = MessagePayload["principal"];
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
export function bearerMatches(header: string | undefined, secret: string): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7)),
    expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
