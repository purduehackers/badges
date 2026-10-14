import { z } from "zod";
import {
  badgeSize,
  contextHash,
  layoutSchema,
  remainingCriteria,
  reviewable,
  reviewMaterials,
  sheetBatchSchema,
} from "./contracts.ts";
import type { Review, SheetBatch } from "./contracts.ts";
import { pack } from "./packing.ts";
import { expandSheets, resolveSheets, sheetLabel } from "./sheets.ts";
import type { createBadgeInventory } from "./inventory.ts";
import type { BadgeStore } from "./store.ts";
import { inspectSvg } from "./svg.ts";

export const packingProposalSchema = z.strictObject({
  reviewId: z.string(),
  context: z.string(),
  layout: layoutSchema,
  sheets: sheetBatchSchema,
});
export async function previewPacking(
  review: Review,
  store: BadgeStore,
  inventory: Pick<ReturnType<typeof createBadgeInventory>, "defaultBatch" | "plan">,
  sizeIn: number,
  count?: number,
  batch?: SheetBatch,
) {
  if (
    !reviewable(review) ||
    remainingCriteria(review).length ||
    !review.badge ||
    !review.settings ||
    !reviewMaterials(review).length
  )
    throw new Error("Confirm the designs before planning production.");
  const selected =
    batch ?? review.sheetBatch ?? (await inventory.defaultBatch(reviewMaterials(review)));
  if (!selected)
    throw new Error(
      "The selected sheets are no longer available. Add stock or choose other sheets.",
    );
  const sheets = resolveSheets(selected, reviewMaterials(review));
  const sizes = expandSheets(sheets);
  await inventory.plan(reviewMaterials(review), sizes);
  const source = (await store.asset(review.badge.hash)).bytes.toString("utf8");
  const result = await pack(
    source,
    inspectSvg(source, "badge").cut,
    { ...review.settings, badgeSizeIn: sizeIn },
    store,
    sizes,
    { target: count, fixedSize: true },
  );
  const layout = result.layouts.at(-1);
  if (!layout) throw new Error("No layout was found at that size.");
  const id = await store.putAsset(
    Buffer.from(
      JSON.stringify({ reviewId: review.id, context: contextHash(review), layout, sheets }),
    ),
    "application/vnd.badge-packing+json",
  );
  return {
    id,
    count: layout.count,
    sizeIn: layout.sizeIn,
    widthIn: layout.widthIn,
    heightIn: layout.heightIn,
    sheets: layout.sheetSizes.map((size, sheet) => ({
      size: `${sheetLabel(size)} in`,
      material: size.material,
      count: layout.placements.filter((p) => p.sheet === sheet).length,
    })),
    requestedCount: count,
    shortfall: result.shortfall,
    currentSizeIn: badgeSize(review),
    changed: false,
    note: "Uses the selected sheets in stock. Availability is checked again before publishing. The search does not prove maximum capacity.",
  };
}
