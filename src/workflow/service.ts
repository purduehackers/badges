import { packingProposalSchema } from "./packing-proposal.ts";
import { randomUUID } from "node:crypto";

import { DISCORD_GUILD_ID } from "../server/platform.ts";
import { messagePayloadSchema } from "../server/platform.ts";
import type { MessagePayload, Principal } from "../server/platform.ts";

import {
  BADGES_CHANNEL_ID,
  contextHash,
  designHash,
  invalidate,
  MAX_SVG_BYTES,
  ready,
  remainingCriteria,
  reviewable,
  reviewMaterials,
  RUBRIC_VERSION,
} from "./contracts.ts";
import type { Asset, BadgeEvent, JobKind, Person, Review, StoredReview } from "./contracts.ts";
import { badgeIndex, inferEvent, singleRole } from "./intake.ts";
import type { createBadgeInventory } from "./inventory.ts";
import { productionSettings } from "./policy.ts";
import { expandSheets, resolveSheets } from "./sheets.ts";
import { reviewStep } from "./presentation.ts";
import { StaleReview } from "./store.ts";
import type { BadgeStore } from "./store.ts";
import { parseSvg } from "./svg.ts";
import type { Action } from "./wire.ts";
export type { Action } from "./wire.ts";

export interface Actor {
  person: Person;
  canManufacture: boolean;
  threadId: string;
  guildId: string;
}
export interface Cms {
  events(): Promise<BadgeEvent[]>;
  event(id: string): Promise<BadgeEvent>;
}

export function assertScope(payload: MessagePayload): string {
  if (
    payload.channel.id !== BADGES_CHANNEL_ID ||
    payload.thread?.parentId !== BADGES_CHANNEL_ID ||
    payload.kind === "scheduled"
  )
    throw new Error("Badge reviews must run in a #p-badges thread.");
  return payload.thread.id;
}
export function personOf(principal: Principal): Person {
  return { id: principal.userId, username: principal.username };
}

function assertAuthor(review: Review, actorId: string) {
  if (review.author.id !== actorId)
    throw new Error("Only the original author can change these designs.");
}
function assertUnlocked(review: Review) {
  if (review.approval && !review.publication?.shortlink)
    throw new Error("Publication is locked while these files are being saved.");
}

class BadgeService {
  private readonly repository: BadgeStore;
  private readonly cms: Cms;
  private readonly inventory: Pick<
    ReturnType<typeof createBadgeInventory>,
    "materials" | "defaultBatch" | "plan"
  >;
  constructor(
    repository: BadgeStore,
    cms: Cms,
    inventory: Pick<ReturnType<typeof createBadgeInventory>, "materials" | "defaultBatch" | "plan">,
  ) {
    this.repository = repository;
    this.cms = cms;
    this.inventory = inventory;
  }
  async read(threadId: string): Promise<StoredReview> {
    const stored = await this.repository.forThread(threadId);
    if (!stored) throw new Error("No badge review exists in this thread yet.");
    return stored;
  }
  async submit(messageId: string, threadId: string) {
    const encoded = await this.repository.inbox(messageId, threadId);
    if (!encoded) throw new Error("No bot-verified submission is attached to this message.");
    const decoded = messagePayloadSchema.safeParse(JSON.parse(encoded));
    if (!decoded.success) throw new Error("Invalid submission record.");
    const payload = decoded.data;
    assertScope(payload);
    const previous = await this.repository.forThread(threadId);
    if (previous?.review.sourceMessageId === messageId) return previous;
    if (previous) {
      assertAuthor(previous.review, payload.principal.userId);
      assertUnlocked(previous.review);
    }
    const attachments = payload.attachments ?? [];
    if (
      attachments.length < 1 ||
      attachments.length > 2 ||
      attachments.some((a) => a.size > MAX_SVG_BYTES)
    )
      throw new Error("Attach one or two SVG files, under 1 MB each.");
    const uploads: Asset[] = [];
    for (const file of attachments) uploads.push(await this.asset(file.url, file.filename));
    const event = inferEvent(payload, await this.cms.events(), previous?.review.event);
    const base: Review = previous
      ? invalidate(previous.review)
      : {
          id: randomUUID(),
          threadId,
          sourceMessageId: messageId,
          author: personOf(payload.principal),
          generation: 0,
          rubric: RUBRIC_VERSION,
          uploads,
          rolesConfirmed: false,
          checks: [],
          previews: [],
          layouts: [],
          layoutAttempt: 0,
          decisions: [],
        };
    const { event: _event, ...withoutEvent } = base;
    const next = assignUploads(
      {
        ...withoutEvent,
        uploads,
        sourceMessageId: messageId,
        ...(event ? { event } : {}),
        settings: productionSettings(event),
      },
      payload.content,
      previous?.review,
    );
    await this.repository.save({
      review: next,
      ...(previous ? { expected: previous.version } : {}),
      eventId: `submission:${messageId}`,
      actorId: payload.principal.userId,
      jobs: inspectionJobs(next),
    });
    return this.read(threadId);
  }
  async asset(url: string, name: string): Promise<Asset> {
    const source = await downloadSvg(url);
    parseSvg(source);
    return { hash: await this.repository.putAsset(Buffer.from(source), "image/svg+xml"), name };
  }
  async validate(id: string, version: number, actor: Actor, action: Action): Promise<StoredReview> {
    const stored = await this.repository.get(id);
    if (!stored || stored.version !== version) throw new StaleReview();
    assertControl(stored.review, actor, action);
    return stored;
  }
  async action(id: string, version: number, actor: Actor, action: Action, eventId: string) {
    const stored = await this.validate(id, version, actor, action);
    const { review } = stored;
    let transition: { next: Review; jobs: JobKind[] };
    try {
      transition = await this.advance(review, actor, action);
    } catch (cause) {
      if (!(cause instanceof CmsEventChanged)) throw cause;
      const { approval: _approval, ...rest } = review;
      transition = { next: { ...rest, contextChanged: true, failure: cause.message }, jobs: [] };
    }
    const { next, jobs } = transition;
    const saved = await this.repository.save({
      review: next,
      expected: version,
      eventId,
      actorId: actor.person.id,
      jobs,
    });
    if (!saved)
      throw new Error("This message already changed the workflow. Wait for the next step.");
    return this.read(review.threadId);
  }
  private async advance(
    review: Review,
    actor: Actor,
    action: Action,
  ): Promise<{ next: Review; jobs: JobKind[] }> {
    switch (action.kind) {
      case "keep-design": {
        const { pendingRole: _role, ...next } = review;
        return { next, jobs: [] };
      }
      case "material": {
        if (!action.ids?.length) throw new Error("Choose at least one acrylic color.");
        const available = await this.inventory.materials();
        const materials = action.ids.map((id) => {
          const material = available.find((option) => option.materialId === id);
          if (!material)
            throw new Error("That acrylic is no longer available. Choose another color.");
          return material;
        });
        const { material: _material, sheetBatch: _sheets, ...reset } = invalidate(review);
        const next = { ...reset, materials };
        return { next, jobs: inspectionJobs(next) };
      }
      case "choose-material": {
        const {
          material: _material,
          materials: _materials,
          sheetBatch: _sheets,
          ...next
        } = invalidate(review);
        return { next, jobs: [] };
      }
      case "retry": {
        await this.repository.retry(review.id, review.generation);
        const { failure: _failure, ...next } = review;
        return { next, jobs: [] };
      }
      case "confirm": {
        await assertCurrentEvent(review, this.cms);
        const confirmed = remainingCriteria(review).map((criterion) => ({
          criterion,
          context: designHash(review, criterion),
          verdict: "approve" as const,
          reviewer: actor.person,
          note: "",
          at: new Date().toISOString(),
        }));
        const sheetBatch =
          review.sheetBatch ?? (await this.inventory.defaultBatch(reviewMaterials(review)));
        return {
          next: { ...review, sheetBatch, decisions: [...review.decisions, ...confirmed] },
          jobs: [],
        };
      }
      case "sheets": {
        if (!action.sheets || !reviewMaterials(review).length)
          throw new Error("Choose the sheets to use for this batch.");
        const sheetBatch = resolveSheets(action.sheets, reviewMaterials(review));
        await this.inventory.plan(reviewMaterials(review), expandSheets(sheetBatch));
        const {
          layouts: _layouts,
          selectedLayout: _selected,
          stockPlan: _stock,
          quantityShortfall: _shortfall,
          failure: _failure,
          fittedSizeIn: _fitted,
          manufacturing: _manufacturing,
          ...rest
        } = review;
        return {
          next: {
            ...rest,
            sheetBatch,
            layouts: [],
            layoutAttempt: 0,
            manufacturer: actor.person,
            generation: review.generation + 1,
          },
          jobs: ["prepare"],
        };
      }
      case "layout": {
        const proposal = await this.repository.asset(action.id);
        if (proposal.mediaType !== "application/vnd.badge-packing+json")
          throw new Error("Choose a current packing preview.");
        const plan = packingProposalSchema.parse(JSON.parse(proposal.bytes.toString("utf8")));
        if (plan.reviewId !== review.id || plan.context !== contextHash(review))
          throw new StaleReview();
        const {
          manufacturing: _manufacturing,
          selectedLayout: _selected,
          stockPlan: _stock,
          quantityShortfall: _shortfall,
          ...rest
        } = review;
        return {
          next: {
            ...rest,
            manufacturer: actor.person,
            generation: review.generation + 1,
            targetCount: plan.layout.count,
            fittedSizeIn: plan.layout.sizeIn,
            sheetBatch: plan.sheets,
            layouts: [plan.layout],
          },
          jobs: ["prepare"],
        };
      }
      case "publish": {
        await assertCurrentEvent(review, this.cms);
        return {
          next: { ...review, approval: { context: contextHash(review), reviewer: actor.person } },
          jobs: ["archive"],
        };
      }
      case "quantity": {
        const {
          selectedLayout: _layout,
          stockPlan: _stock,
          failure: _failure,
          quantityShortfall: _shortfall,
          targetCount: _target,
          ...rest
        } = review;
        const next = {
          ...rest,
          generation: review.generation + 1,
          manufacturer: actor.person,
          ...(action.count === undefined ? {} : { targetCount: action.count }),
        };
        return {
          next,
          jobs: next.targetCount ? ["pack"] : [],
        };
      }
      case "upload": {
        if (!action.file) return { next: { ...review, pendingRole: action.role }, jobs: [] };
        const asset = await this.asset(action.file.url, action.file.filename);
        const next = {
          ...invalidate(review, action.role),
          [action.role]: asset,
          uploads: [asset],
          rolesConfirmed: true,
        };
        return { next, jobs: inspectionJobs(next) };
      }
      default: {
        const next = await configure(review, action, this.cms);
        return { next, jobs: inspectionJobs(next) };
      }
    }
  }
}
export function createBadgeService(
  repository: BadgeStore,
  cms: Cms,
  inventory: Pick<ReturnType<typeof createBadgeInventory>, "materials" | "defaultBatch" | "plan">,
) {
  return new BadgeService(repository, cms, inventory);
}

function inspectionJobs(review: Review): JobKind[] {
  return review.rolesConfirmed &&
    review.badge &&
    review.stamp &&
    review.event &&
    reviewMaterials(review).length
    ? ["inspect"]
    : [];
}

function assignUploads(review: Review, text: string, previous?: Review): Review {
  if (review.uploads.length === 1) {
    const role = singleRole(text, previous);
    const asset = review.uploads[0];
    return role && asset
      ? { ...review, [role]: asset, rolesConfirmed: true }
      : { ...review, rolesConfirmed: false };
  }
  const index = badgeIndex(text);
  const { badge: _badge, stamp: _stamp, ...rest } = review;
  return index === undefined
    ? { ...rest, rolesConfirmed: false }
    : {
        ...rest,
        badge: review.uploads[index],
        stamp: review.uploads[1 - index],
        rolesConfirmed: true,
      };
}

function assertActor(review: Review, actor: Actor, action: Action) {
  if (actor.guildId !== DISCORD_GUILD_ID || actor.threadId !== review.threadId)
    throw new Error("This control belongs to a different review thread.");
  if (
    action.kind === "upload" ||
    action.kind === "roles" ||
    action.kind === "replace" ||
    action.kind === "material" ||
    action.kind === "keep-design" ||
    action.kind === "choose-material" ||
    action.kind === "confirm"
  )
    assertAuthor(review, actor.person.id);
  else if (actor.person.id !== review.author.id && !actor.canManufacture)
    throw new Error("Only the author or an organizer can update this review.");
}

export function assertControl(review: Review, actor: Actor, action: Action) {
  assertActor(review, actor, action);
  if (action.kind === "retry") {
    if (!review.failure || review.contextChanged) throw new Error("Use the latest review card.");
    return;
  }
  assertUnlocked(review);
  if ((action.kind === "material" || action.kind === "choose-material") && !review.event)
    throw new Error("Choose a Hack Night before choosing acrylic.");
  const step = reviewStep(review);
  const recoveringSheets =
    action.kind === "sheets" &&
    step === "error" &&
    !review.contextChanged &&
    reviewable(review) &&
    remainingCriteria(review).length === 0;
  if (
    ["quantity", "layout", "publish", "sheets"].includes(action.kind) &&
    !["quantity", "layout"].includes(step) &&
    !recoveringSheets
  )
    throw new Error("Confirm the designs before planning production.");
  switch (action.kind) {
    case "material":
    case "choose-material":
      if (!["material", "qa", "fix"].includes(step)) throw new Error("Use the latest review card.");
      break;
    case "keep-design":
      if (!review.pendingRole) throw new Error("Use the latest review card.");
      break;
    case "confirm":
      if (!reviewable(review) || step !== "qa") throw new Error("Use the latest review card.");
      break;
    case "publish":
      if (!ready(review) || step !== "layout")
        throw new Error("Confirm both designs and arrange the badges first.");
      break;
    case "roles":
    case "replace":
      if (step !== "files") throw new Error("Use the latest review card.");
      break;
    case "event":
      if (step !== "event") throw new Error("Use the latest review card.");
      break;
    case "refresh":
      if (!["event", "material", "error"].includes(step))
        throw new Error("Use the latest review card.");
      break;
    case "layout":
    case "quantity":
    case "sheets":
      break;
    case "upload":
      break;
  }
}

async function configure(review: Review, action: Action, cms: Cms): Promise<Review> {
  const next = invalidate(review);
  if (action.kind === "roles") {
    const badge = review.uploads[action.badge],
      stamp = review.uploads[1 - action.badge];
    if (!badge || !stamp) throw new Error("Select which of the two previews is the badge.");
    return { ...next, badge, stamp, rolesConfirmed: true };
  }
  if (action.kind === "replace") {
    const asset = review.uploads[0];
    if (review.uploads.length !== 1 || !asset) throw new Error("Upload one SVG file.");
    return { ...next, [action.role]: asset, rolesConfirmed: true };
  }
  const id = action.kind === "event" ? action.id : review.event?.id;
  const event = id ? await cms.event(id) : undefined;
  const { fittedSizeIn: _fitted, ...reset } = next;
  return { ...reset, ...(event ? { event } : {}), settings: productionSettings(event) };
}
export class CmsEventChanged extends Error {
  constructor() {
    super("The event or production settings changed. Refresh the review.");
  }
}
export async function assertCurrentEvent(review: Review, cms: Cms): Promise<void> {
  if (
    !review.event ||
    JSON.stringify(await cms.event(review.event.id)) !== JSON.stringify(review.event) ||
    JSON.stringify(productionSettings(review.event)) !== JSON.stringify(review.settings)
  )
    throw new CmsEventChanged();
}

async function downloadSvg(value: string): Promise<string> {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) ||
    // Modal uploads use Discord's ephemeral attachment path.
    !/^\/(?:ephemeral-)?attachments\//u.test(url.pathname) ||
    url.username ||
    url.password
  )
    throw new Error("Only bot-observed Discord attachment URLs are accepted.");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body)
    throw new Error("Attachment is unavailable. Reattach the SVG.");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_SVG_BYTES) throw new Error("SVG exceeds 1 MB.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}
