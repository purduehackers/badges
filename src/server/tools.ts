import { z } from "zod";
import { badgeTools, badgeToolNameSchema, type BadgeToolName } from "../workflow/tools.ts";
import {
  badgeSize,
  remainingCriteria,
  staticPassed,
  reviewMaterials,
} from "../workflow/contracts.ts";
import type { StoredReview } from "../workflow/contracts.ts";
import { assertScope, assertControl, type Action, type Actor } from "../workflow/service.ts";
import {
  failureGuidance,
  reviewPrompt,
  reviewStep,
  verificationChecks,
} from "../workflow/presentation.ts";
import { previewPacking } from "../workflow/packing-proposal.ts";
import { materialDescription } from "../lib/materials.ts";
import { cms, attendance } from "./cms.ts";
import { runtime } from "./runtime.ts";
import { messagePayloadSchema, DISCORD_GUILD_ID } from "./platform.ts";
import { viewerUrl } from "./viewer.ts";
import { env } from "./env.ts";

export const contextSchema = z.strictObject({
  threadId: z.string(),
  messageId: z.string(),
  userId: z.string(),
});
type Context = z.output<typeof contextSchema>;
export async function contextFor(input: Context) {
  const { store } = runtime();
  const record = await store.inbox(input.messageId, input.threadId);
  if (!record) throw new Error("Mention me in the badge thread to continue.");
  const payload = messagePayloadSchema.parse(JSON.parse(record));
  if (payload.principal.userId !== input.userId || payload.thread?.id !== input.threadId)
    throw new Error("This message belongs to a different review.");
  assertScope(payload);
  const actor: Actor = {
    person: { id: input.userId, username: payload.principal.username },
    canManufacture: payload.principal.canManufacture,
    threadId: input.threadId,
    guildId: DISCORD_GUILD_ID,
  };
  return { actor, stored: await store.forThread(input.threadId) };
}

/** Use controller validation for both tool discovery and execution. */
export function availableTools(stored: StoredReview | undefined, actor: Actor): BadgeToolName[] {
  const names: BadgeToolName[] = ["get_review"];
  if (actor.canManufacture) names.push("inventory");
  if (!stored) return names;
  const { review } = stored;
  const step = reviewStep(review);
  const candidates: [BadgeToolName, Action][] = [];
  if (step === "files")
    candidates.push([
      "identify_files",
      review.uploads.length === 2
        ? { kind: "roles", badge: 0 }
        : { kind: "replace", role: "badge" },
    ]);
  if (step === "event") candidates.push(["select_event", { kind: "event", id: "candidate" }]);
  if (["material", "qa", "fix"].includes(step))
    candidates.push(["select_material", { kind: "material" }]);
  if (step === "qa") candidates.push(["confirm_design", { kind: "confirm" }]);
  if (["files", "missing", "upload", "fix", "qa", "quantity", "layout", "done"].includes(step))
    candidates.push(["request_replacement", { kind: "upload", role: "badge" }]);
  if (review.pendingRole) candidates.push(["keep_design", { kind: "keep-design" }]);
  if (["quantity", "layout"].includes(step))
    candidates.push(
      ["set_target_quantity", { kind: "quantity", count: 80 }],
      ["select_packing", { kind: "layout", id: "candidate" }],
    );
  if (["quantity", "layout", "error"].includes(step))
    candidates.push(["set_sheets", { kind: "sheets" }]);
  if (step === "layout") candidates.push(["publish_batch", { kind: "publish" }]);
  if (step === "error")
    candidates.push(["retry_failed_step", { kind: review.contextChanged ? "refresh" : "retry" }]);
  if (step === "event" || step === "material")
    candidates.push(["retry_failed_step", { kind: "refresh" }]);
  for (const [name, action] of candidates) {
    try {
      assertControl(review, actor, action);
      names.push(name);
    } catch {
      /* Unavailable actions stay out of the model's tool list. */
    }
  }
  if (names.includes("set_target_quantity")) names.push("estimate_attendance", "preview_packing");
  return names;
}

export async function reviewStatus(context: Context) {
  const { actor, stored } = await contextFor(context);
  const tools = availableTools(stored, actor);
  if (!stored) return { tools, next: "Attach your badge and stamp SVGs." };
  const { review, version } = stored;
  const step = reviewStep(review);
  const stock = tools.includes("select_material")
    ? await runtime().inventory.acrylic()
    : tools.includes("set_sheets")
      ? await runtime().inventory.sheets(reviewMaterials(review))
      : undefined;
  return {
    tools,
    version,
    step,
    next: reviewPrompt(review),
    isDesigner: actor.person.id === review.author.id,
    event: review.event,
    selectedMaterials: reviewMaterials(review).map((material) => ({
      ...material,
      label: materialDescription(material),
    })),
    previewMaterial: reviewMaterials(review)[0],
    files: review.uploads.map((asset, index) => ({
      label: index === 0 ? "A" : "B",
      filename: asset.name,
    })),
    events: step === "event" ? await cms.events() : undefined,
    checks: {
      passed: staticPassed(review),
      badge: verificationChecks(review, "badge"),
      stamp: verificationChecks(review, "stamp"),
    },
    remainingConfirmations: remainingCriteria(review),
    quantity: review.targetCount,
    sheets: review.sheetBatch,
    availableSheets: stock?.map((item) => ({
      itemId: item.id,
      material: { materialId: item.materialId, thicknessMm: item.thicknessMm },
      label: materialDescription(item),
      widthIn: item.widthIn,
      heightIn: item.heightIn,
      quantity: Math.max(0, item.quantity - item.reserved),
    })),
    sizeIn: badgeSize(review),
    quantityShortfall: review.quantityShortfall,
    failure: review.failure ? failureGuidance(review.failure) : undefined,
    viewer: env.BADGES_PUBLIC_URL ? viewerUrl(review, env.BADGES_PUBLIC_URL) : undefined,
    published: review.publication?.shortlink,
  };
}

export const toolRequestSchema = contextSchema.extend({
  name: badgeToolNameSchema,
  input: z.unknown(),
});
export async function executeTool(request: z.output<typeof toolRequestSchema>) {
  const { actor, stored } = await contextFor(request);
  if (!availableTools(stored, actor).includes(request.name))
    throw new Error("That action is not available at this step.");
  if (request.name === "get_review") return reviewStatus(request);
  const { store, service, inventory } = runtime();
  const input = badgeTools[request.name].schema.parse(request.input);
  const eventId = `chat:${request.messageId}`;
  if (request.name === "inventory" && "action" in input)
    return inventory.execute({
      guildId: actor.guildId,
      actor: actor.person,
      canManufacture: actor.canManufacture,
      interactionId: request.messageId,
      action: input.action,
    });
  if (!stored) throw new Error("Upload the badge and stamp first.");
  const { review } = stored;
  if (request.name === "estimate_attendance") return attendance(review.event?.id);
  if (request.name === "preview_packing" && "sizeIn" in input)
    return previewPacking(review, store, inventory, input.sizeIn, input.count, input.sheets);
  if (!("version" in input)) throw new Error("Read the current review before changing it.");
  if (await store.hasEvent(eventId)) throw new Error("This message already changed the review.");
  let action: Action;
  switch (request.name) {
    case "identify_files": {
      const { choice } = badgeTools.identify_files.schema.parse(input);
      action =
        choice === "A" || choice === "B"
          ? { kind: "roles", badge: Number(choice === "B") }
          : { kind: "replace", role: choice };
      break;
    }
    case "select_event":
      action = { kind: "event", id: badgeTools.select_event.schema.parse(input).id };
      break;
    case "select_material": {
      const { items } = badgeTools.select_material.schema.parse(input);
      action = items ? { kind: "material", items } : { kind: "choose-material" };
      break;
    }
    case "confirm_design":
      action = { kind: "confirm" };
      break;
    case "request_replacement":
      action = { kind: "upload", role: badgeTools.request_replacement.schema.parse(input).design };
      break;
    case "keep_design":
      action = { kind: "keep-design" };
      break;
    case "set_target_quantity":
      action = {
        kind: "quantity",
        count: badgeTools.set_target_quantity.schema.parse(input).count,
      };
      break;
    case "set_sheets":
      action = { kind: "sheets", sheets: badgeTools.set_sheets.schema.parse(input).sheets };
      break;
    case "select_packing":
      action = { kind: "layout", id: badgeTools.select_packing.schema.parse(input).id };
      break;
    case "publish_batch":
      action = { kind: "publish" };
      break;
    case "retry_failed_step":
      action = {
        kind: badgeTools.retry_failed_step.schema.parse(input).refresh ? "refresh" : "retry",
      };
      break;
    default:
      throw new Error("Unsupported badge action.");
  }
  const next = await service.action(review.id, input.version, actor, action, eventId);
  return { changed: true, next: next ? reviewPrompt(next.review) : undefined };
}
