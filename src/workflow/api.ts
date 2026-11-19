import { z } from "zod";
import { reviewSchema } from "./contracts.ts";
import { actionRequest, workResponse } from "./wire.ts";
import {
  inventoryRequestSchema,
  inventoryResponseSchema,
  stockItemSchema,
} from "./inventory-contracts.ts";
import { badgeToolNameSchema } from "./tools.ts";

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

const contextSchema = z.strictObject({
  threadId: z.string(),
  messageId: z.string(),
  userId: z.string(),
});
const controlResponse = z.object({
  review: reviewSchema,
  version: z.int().nonnegative(),
  availableSheets: z.array(stockItemSchema).default([]),
});
const submission = { request: messagePayloadSchema, response: z.object({ handled: z.boolean() }) };
const control = { request: actionRequest, response: controlResponse };

/** The service, Discord adapter, and Eve agent use the same wire contracts. */
export const badgeEndpoints = {
  lookup: {
    request: z.object({ threadId: z.string() }),
    response: z.object({ exists: z.boolean() }),
  },
  submit: submission,
  continue: submission,
  status: {
    request: contextSchema,
    // Status includes stage-specific evidence. Preserve it for the conversational agent.
    response: z.looseObject({ tools: z.array(badgeToolNameSchema), next: z.string() }),
  },
  tool: {
    request: contextSchema.extend({ name: badgeToolNameSchema, input: z.unknown() }),
    response: z.unknown(),
  },
  control,
  action: control,
  inventory: { request: inventoryRequestSchema, response: inventoryResponseSchema },
  work: { request: z.strictObject({}), response: workResponse },
  ack: {
    request: z.strictObject({
      id: z.string(),
      lease: z.uuid(),
      reviewId: z.uuid(),
      messageId: z.string(),
      version: z.int().nonnegative(),
    }),
    response: z.object({ ok: z.literal(true) }),
  },
} as const;
export type BadgeEndpoint = keyof typeof badgeEndpoints;
export type BadgeRequest<P extends BadgeEndpoint> = z.input<(typeof badgeEndpoints)[P]["request"]>;
export type BadgeResponse<P extends BadgeEndpoint> = z.output<
  (typeof badgeEndpoints)[P]["response"]
>;
