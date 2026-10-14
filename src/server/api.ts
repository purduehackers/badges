import { z } from "zod";
import { reviewMaterials } from "../workflow/contracts.ts";
import { actionName, actionRequest, componentId } from "../workflow/wire.ts";
import { actionable, reviewStep } from "../workflow/presentation.ts";
import { inventoryRequestSchema } from "../workflow/inventory-contracts.ts";
import { assertScope } from "../workflow/service.ts";
import { runtime } from "./runtime.ts";
import { cms } from "./cms.ts";
import { env, ingressSecret } from "./env.ts";
import { bearerMatches, DISCORD_GUILD_ID, messageOf, messagePayloadSchema } from "./platform.ts";
import { identifiedPreview, previewFiles } from "./previews.ts";
import { viewerUrl, viewBadge } from "./viewer.ts";
import { contextSchema, executeTool, reviewStatus, toolRequestSchema } from "./tools.ts";

async function control(input: z.output<typeof actionRequest>, mutate: boolean) {
  const expected = componentId(input.id, input.version, actionName(input.action), ingressSecret());
  if (!bearerMatches(`Bearer ${input.control}`, expected))
    throw new Error("Invalid review control.");
  const { service, store, inventory } = runtime();
  try {
    const stored = mutate
      ? await service.action(
          input.id,
          input.version,
          input.actor,
          input.action,
          `discord:${input.eventId}`,
        )
      : await service.validate(input.id, input.version, input.actor, input.action);
    const availableSheets =
      !mutate && input.action.kind === "sheets"
        ? await inventory.sheets(reviewMaterials(stored.review))
        : undefined;
    const materials =
      !mutate && input.action.kind === "material" ? await inventory.materials() : undefined;
    return Response.json({ ...stored, availableSheets, materials });
  } catch (cause) {
    const current = await store.get(input.id);
    const url =
      current?.review.threadId === input.actor.threadId &&
      input.actor.guildId === DISCORD_GUILD_ID &&
      current.review.cardId
        ? `https://discord.com/channels/${DISCORD_GUILD_ID}/${input.actor.threadId}/${current.review.cardId}`
        : undefined;
    return Response.json({ error: messageOf(cause), url }, { status: 409 });
  }
}

async function work(origin: string) {
  const { store, worker, inventory } = runtime();
  const worked = await worker.process();
  for (let skipped = 0; skipped < 20; skipped++) {
    const job = await store.claim(true);
    if (!job) return { worked };
    const stored = await store.get(job.reviewId);
    if (stored && actionable(stored.review) && (stored.review.cardVersion ?? -1) < stored.version)
      return {
        worked,
        card: {
          ...stored,
          events: reviewStep(stored.review) === "event" ? await cms.events() : [],
          materials: reviewStep(stored.review) === "material" ? await inventory.materials() : [],
          files: await previewFiles(stored.review, store),
          identifiedFile: await identifiedPreview(stored.review, store),
          viewerUrl: viewerUrl(stored.review, origin),
          jobId: job.id,
          lease: job.lease,
        },
      };
    await store.finish(job.id, job.lease);
  }
  return { worked };
}

export async function handleBadgeRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/badges/view")
    return viewBadge(request, runtime().store);
  if (
    request.method !== "POST" ||
    !bearerMatches(request.headers.get("authorization") ?? undefined, ingressSecret())
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input: unknown = await request.json();
    const { store, service, inventory } = runtime();
    switch (path) {
      case "/badges/lookup": {
        const { threadId } = z.object({ threadId: z.string() }).parse(input);
        return Response.json({ exists: Boolean(await store.forThread(threadId)) });
      }
      case "/badges/submit":
      case "/badges/continue": {
        const payload = messagePayloadSchema.parse(input);
        const threadId = assertScope(payload);
        if (path.endsWith("continue")) {
          const saved = await store.forThread(threadId);
          if (
            !saved ||
            saved.review.author.id !== payload.principal.userId ||
            !payload.attachments?.length ||
            (!["missing", "fix", "files", "upload"].includes(reviewStep(saved.review)) &&
              !saved.review.pendingRole)
          )
            return Response.json({ handled: false });
        }
        await store.stage(payload.messageId, threadId, JSON.stringify(payload));
        const handled = Boolean(payload.attachments?.length);
        if (handled) await service.submit(payload.messageId, threadId);
        return Response.json({ handled });
      }
      case "/badges/status":
        return Response.json(await reviewStatus(contextSchema.parse(input)));
      case "/badges/tool":
        return Response.json(await executeTool(toolRequestSchema.parse(input)));
      case "/badges/control":
        return control(actionRequest.parse(input), false);
      case "/badges/action":
        return control(actionRequest.parse(input), true);
      case "/badges/inventory":
        return Response.json(await inventory.execute(inventoryRequestSchema.parse(input)));
      case "/badges/work":
        return Response.json(await work(env.BADGES_PUBLIC_URL ?? request.url));
      case "/badges/ack": {
        const data = z
          .object({
            id: z.string(),
            lease: z.uuid(),
            reviewId: z.uuid(),
            messageId: z.string(),
            version: z.int().nonnegative(),
          })
          .parse(input);
        if (!data.id.startsWith(`${data.reviewId}:render:`))
          throw new Error("Invalid delivery receipt.");
        await store.card(data.reviewId, data.messageId, data.version);
        await store.finish(data.id, data.lease);
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ error: "Not found" }, { status: 404 });
    }
  } catch (cause) {
    return Response.json({ error: messageOf(cause).slice(0, 1500) }, { status: 409 });
  }
}
