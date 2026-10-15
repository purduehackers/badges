import { createHash } from "node:crypto";

import { badgeStock, badgeStockChanges, badgeStockPublications } from "../server/db/index.ts";
import type { Db } from "../server/db/index.ts";
import { DISCORD_GUILD_ID } from "../server/platform.ts";
import { and, asc, count, desc, eq, gt } from "drizzle-orm";

import { includesMaterial, reviewMaterials, stockPlanSchema } from "./contracts.ts";
import type { BadgeMaterial, CuttingSheet, Review, SheetBatch, StockPlan } from "./contracts.ts";
import { resolveSheets, sheetKey, sheetLabel } from "./sheets.ts";
import {
  stockChangeSchema,
  stockItemSchema,
  stockLabel,
  stockSelectionSchema,
} from "./inventory-contracts.ts";
import type {
  InventoryRequest,
  InventoryResponse,
  StockItem,
  StockSpec,
  StockSelection,
} from "./inventory-contracts.ts";
import { ACRYLIC_MATERIALS, materialDescription } from "../lib/materials.ts";

const PAGE_SIZE = 10;
type Mutation = Extract<InventoryRequest["action"], { kind: "add" | "use" | "set" }>;

export class InventoryError extends Error {}

function canonicalSpec(spec: StockSpec): StockSpec {
  return {
    materialId: spec.materialId,
    widthIn: Math.min(spec.widthIn, spec.heightIn),
    heightIn: Math.max(spec.widthIn, spec.heightIn),
    thicknessMm: spec.thicknessMm,
  };
}

function itemId(spec: StockSpec): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalSpec(spec)))
    .digest("hex")
    .slice(0, 24);
}

async function reservedCounts(db: Pick<Db, "select">): Promise<Map<string, number>> {
  const pending = await db
    .select()
    .from(badgeStockPublications)
    .where(eq(badgeStockPublications.state, "reserved"));
  const counts = new Map<string, number>();
  for (const publication of pending)
    for (const sheet of stockPlanSchema.parse(JSON.parse(publication.plan)))
      counts.set(sheet.itemId, (counts.get(sheet.itemId) ?? 0) + sheet.quantity);
  return counts;
}

function publicationKey(review: Review): string {
  return `${review.id}:${review.generation}`;
}

class BadgeInventory {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  async available(): Promise<StockItem[]> {
    const records = await this.db
      .select()
      .from(badgeStock)
      .where(gt(badgeStock.quantity, 0))
      .orderBy(asc(badgeStock.materialId), asc(badgeStock.widthIn), asc(badgeStock.heightIn));
    return this.withReservations(records);
  }

  private async withReservations(records: StockItem[] | (typeof badgeStock.$inferSelect)[]) {
    const reserved = await reservedCounts(this.db);
    return records.map((entry) =>
      stockItemSchema.parse({ ...entry, reserved: reserved.get(entry.id) ?? 0 }),
    );
  }

  async acrylic(): Promise<StockItem[]> {
    return (await this.available()).filter(
      (item) =>
        item.quantity > item.reserved &&
        ACRYLIC_MATERIALS.some((material) => material.id === item.materialId),
    );
  }

  async selectSheets(
    selection: StockSelection,
  ): Promise<{ materials: BadgeMaterial[]; sheetBatch: SheetBatch }> {
    const stock = await this.acrylic();
    const materials: BadgeMaterial[] = [];
    const sheetBatch = stockSelectionSchema.parse(selection).map(({ itemId, quantity }) => {
      const item = stock.find((candidate) => candidate.id === itemId);
      if (!item || quantity > item.quantity - item.reserved)
        throw new InventoryError(
          "Those sheets are no longer available. Reopen Choose acrylic to see current stock.",
        );
      const material = { materialId: item.materialId, thicknessMm: item.thicknessMm };
      if (!includesMaterial(materials, material)) materials.push(material);
      return { material, widthIn: item.widthIn, heightIn: item.heightIn, quantity };
    });
    return { materials, sheetBatch };
  }

  async sheets(materials: BadgeMaterial[]): Promise<StockItem[]> {
    const records = await this.db
      .select()
      .from(badgeStock)
      .orderBy(asc(badgeStock.materialId), asc(badgeStock.widthIn), asc(badgeStock.heightIn));
    return (await this.withReservations(records)).filter(
      (item) => includesMaterial(materials, item) && item.materialId !== "stamp-rubber",
    );
  }

  async defaultBatch(materials: BadgeMaterial[]): Promise<SheetBatch | undefined> {
    const stock = (await this.sheets(materials)).filter((item) => item.quantity > item.reserved);
    // Include each selected color before adding a second size of a single color.
    const chosen = materials.flatMap((material) => {
      const item = stock.find((entry) => includesMaterial([material], entry));
      return item ? [item] : [];
    });
    if (chosen.length !== materials.length) return undefined;
    if (materials.length === 1 && stock[1]) chosen.push(stock[1]);
    const selected = chosen.map((item) => ({
      widthIn: item.widthIn,
      heightIn: item.heightIn,
      material: { materialId: item.materialId, thicknessMm: item.thicknessMm },
      quantity: 1,
    }));
    const first = selected[0];
    if (selected.length === 1 && first && stock[0] && stock[0].quantity - stock[0].reserved >= 2)
      first.quantity = 2;
    return selected.length ? selected : undefined;
  }

  async plan(materials: BadgeMaterial[], usedSheets: CuttingSheet[]): Promise<StockPlan> {
    const batch = resolveSheets(
      usedSheets.map((sheet) => ({ ...sheet, quantity: 1 })),
      materials,
    );
    const stock = await this.sheets(materials);
    return stockPlanSchema.parse(
      batch.map((sheet) => {
        const item = stock.find(
          (candidate) => sheetKey({ ...candidate, material: candidate }) === sheetKey(sheet),
        );
        if (!item || item.quantity - item.reserved < sheet.quantity)
          throw new InventoryError(
            `The selected sheets are no longer available: ${sheet.quantity} × ${sheetLabel(sheet)} in, ${sheet.material ? materialDescription(sheet.material) : "acrylic"}. Change the sheets, or ask an organizer to update inventory.`,
          );
        return {
          itemId: item.id,
          materialId: item.materialId,
          label: stockLabel(item),
          widthIn: item.widthIn,
          heightIn: item.heightIn,
          thicknessMm: item.thicknessMm,
          quantity: sheet.quantity,
        };
      }),
    );
  }

  async reserve(review: Review): Promise<void> {
    if (
      !reviewMaterials(review).length ||
      !review.stockPlan?.every((sheet) => includesMaterial(reviewMaterials(review), sheet))
    )
      throw new InventoryError("Check the material inventory and arrange the badges again.");
    const plan = stockPlanSchema.parse(review.stockPlan),
      id = publicationKey(review);
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(badgeStockPublications)
        .where(eq(badgeStockPublications.id, id));
      if (existing) {
        if (existing.plan !== JSON.stringify(plan))
          throw new InventoryError("This publication already has different sheets reserved.");
        return;
      }
      const held = await reservedCounts(tx);
      for (const sheet of plan) {
        const [item] = await tx.select().from(badgeStock).where(eq(badgeStock.id, sheet.itemId));
        if (!item || item.quantity - (held.get(item.id) ?? 0) < sheet.quantity)
          throw new InventoryError(
            "The selected sheets are no longer available. Ask an organizer to update inventory, then try again.",
          );
      }
      await tx
        .insert(badgeStockPublications)
        .values({ id, plan: JSON.stringify(plan), state: "reserved", createdAt: Date.now() });
    });
  }

  async consume(review: Review): Promise<void> {
    const publication = review.publication;
    if (!publication) throw new InventoryError("Save the badge files before deducting material.");
    const id = publicationKey(review);
    await this.db.transaction(async (tx) => {
      const [reservation] = await tx
        .select()
        .from(badgeStockPublications)
        .where(eq(badgeStockPublications.id, id));
      if (!reservation) throw new InventoryError("Reserve the cutting sheets before publishing.");
      if (reservation.state === "consumed") {
        if (reservation.commit !== publication.commit)
          throw new InventoryError("The saved files do not match this material receipt.");
        return;
      }
      const now = Date.now();
      for (const sheet of stockPlanSchema.parse(JSON.parse(reservation.plan))) {
        const [item] = await tx.select().from(badgeStock).where(eq(badgeStock.id, sheet.itemId));
        if (!item || item.quantity < sheet.quantity)
          throw new InventoryError("Check the reserved sheet count before continuing.");
        const after = item.quantity - sheet.quantity;
        await tx
          .update(badgeStock)
          .set({ quantity: after, updatedAt: now })
          .where(eq(badgeStock.id, item.id));
        await tx.insert(badgeStockChanges).values({
          id: `publish:${id}:${item.id}`,
          itemId: item.id,
          operation: "publish",
          before: item.quantity,
          after,
          actorId: review.author.id,
          username: review.author.username,
          note: `${review.event?.name ?? "Badge"}: published cutting sheets`,
          createdAt: now,
        });
      }
      await tx
        .update(badgeStockPublications)
        .set({ state: "consumed", commit: publication.commit })
        .where(eq(badgeStockPublications.id, id));
    });
  }

  /** Release only when the worker knows publication stopped before merging. */
  async release(review: Review): Promise<void> {
    await this.db
      .delete(badgeStockPublications)
      .where(
        and(
          eq(badgeStockPublications.id, publicationKey(review)),
          eq(badgeStockPublications.state, "reserved"),
        ),
      );
  }

  async execute(request: InventoryRequest): Promise<InventoryResponse> {
    if (request.guildId !== DISCORD_GUILD_ID)
      throw new InventoryError("Use this command in the Purdue Hackers server.");
    const { action } = request;
    if (action.kind === "list") return this.list(action.page);
    if (action.kind === "suggest") {
      const records = await this.db.select().from(badgeStock).orderBy(asc(badgeStock.materialId));
      return {
        items: (await this.withReservations(records))
          .filter((item) => stockLabel(item).toLowerCase().includes(action.query.toLowerCase()))
          .slice(0, 25),
      };
    }
    if (action.kind === "history") {
      const records = await this.db
        .select()
        .from(badgeStock)
        .where(eq(badgeStock.id, action.itemId));
      const changes = await this.db
        .select()
        .from(badgeStockChanges)
        .where(eq(badgeStockChanges.itemId, action.itemId))
        .orderBy(desc(badgeStockChanges.createdAt), desc(badgeStockChanges.id))
        .limit(10);
      return {
        items: await this.withReservations(records),
        changes: changes.map((row) => stockChangeSchema.parse(row)),
      };
    }
    if (!request.canManufacture)
      throw new InventoryError("Ask an organizer to update the material count.");
    return this.change(request, action);
  }

  private async list(requestedPage: number): Promise<InventoryResponse> {
    const [total] = await this.db.select({ value: count() }).from(badgeStock);
    const pageCount = Math.max(1, Math.ceil((total?.value ?? 0) / PAGE_SIZE));
    const currentPage = Math.min(requestedPage, pageCount);
    const records = await this.db
      .select()
      .from(badgeStock)
      .orderBy(
        asc(badgeStock.materialId),
        asc(badgeStock.widthIn),
        asc(badgeStock.heightIn),
        asc(badgeStock.id),
      )
      .limit(PAGE_SIZE)
      .offset((currentPage - 1) * PAGE_SIZE);
    return {
      items: await this.withReservations(records),
      page: currentPage,
      pages: pageCount,
    };
  }

  private async change(request: InventoryRequest, action: Mutation): Promise<InventoryResponse> {
    return this.db.transaction(async (tx) => {
      const [receipt] = await tx
        .select()
        .from(badgeStockChanges)
        .where(eq(badgeStockChanges.id, request.interactionId))
        .limit(1);
      if (receipt) {
        const [item] = await tx.select().from(badgeStock).where(eq(badgeStock.id, receipt.itemId));
        if (!item)
          throw new InventoryError(
            "This material is unavailable. Run the inventory command again.",
          );
        return {
          items: [stockItemSchema.parse({ ...item, quantity: receipt.after })],
          changes: [stockChangeSchema.parse(receipt)],
        };
      }
      const id = action.kind === "add" ? itemId(action) : action.itemId;
      const now = Date.now();
      if (action.kind === "add")
        await tx
          .insert(badgeStock)
          .values({ id, ...canonicalSpec(action), quantity: 0, updatedAt: now })
          .onConflictDoNothing();
      const [item] = await tx.select().from(badgeStock).where(eq(badgeStock.id, id));
      if (!item) throw new InventoryError("Choose a material from the inventory suggestions.");
      const after =
        action.kind === "set"
          ? action.quantity
          : item.quantity + (action.kind === "use" ? -action.quantity : action.quantity);
      if (after < 0)
        throw new InventoryError(
          `You have ${item.quantity} sheets of this material. Check the count before recording more use.`,
        );
      if (after > 10_000)
        throw new InventoryError("The count cannot exceed 10,000 sheets. Check the quantity.");
      const reserved = (await reservedCounts(tx)).get(id) ?? 0;
      if (after < reserved)
        throw new InventoryError(
          "These sheets are reserved for files being published. Retry that publication before changing this count.",
        );
      const [changed] = await tx
        .update(badgeStock)
        .set({ quantity: after, updatedAt: now })
        .where(and(eq(badgeStock.id, id), eq(badgeStock.quantity, item.quantity)))
        .returning();
      if (!changed)
        throw new InventoryError("Someone changed this count. Check inventory and try again.");
      const change = {
        id: request.interactionId,
        itemId: id,
        operation: action.kind,
        before: item.quantity,
        after,
        actorId: request.actor.id,
        username: request.actor.username,
        note: action.note,
        createdAt: now,
      };
      await tx.insert(badgeStockChanges).values(change);
      return {
        items: [stockItemSchema.parse({ ...changed, reserved })],
        changes: [stockChangeSchema.parse(change)],
      };
    });
  }
}

export function createBadgeInventory(db: Db) {
  return new BadgeInventory(db);
}
