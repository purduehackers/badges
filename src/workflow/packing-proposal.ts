import { z } from "zod";
import {
  badgeSize,
  contextHash,
  layoutSchema,
  remainingCriteria,
  reviewable,
} from "./contracts.ts";
import type { Review } from "./contracts.ts";
import { pack } from "./packing.ts";
import type { BadgeStore } from "./store.ts";
import { inspectSvg } from "./svg.ts";

export const packingProposalSchema = z.strictObject({
  reviewId: z.string(),
  context: z.string(),
  layout: layoutSchema,
});
export async function previewPacking(
  review: Review,
  store: BadgeStore,
  sizeIn: number,
  count?: number,
) {
  if (!reviewable(review) || remainingCriteria(review).length || !review.badge || !review.settings)
    throw new Error("Confirm the designs before planning production.");
  const source = (await store.asset(review.badge.hash)).bytes.toString("utf8");
  const result = await pack(
    source,
    inspectSvg(source, "badge").cut,
    { ...review.settings, badgeSizeIn: sizeIn },
    store,
    { target: count, fixedSize: true },
  );
  const layout = result.layouts.at(-1);
  if (!layout) throw new Error("No layout was found at that size.");
  const id = await store.putAsset(
    Buffer.from(JSON.stringify({ reviewId: review.id, context: contextHash(review), layout })),
    "application/vnd.badge-packing+json",
  );
  return {
    id,
    count: layout.count,
    sizeIn: layout.sizeIn,
    widthIn: layout.widthIn,
    heightIn: layout.heightIn,
    sheets: [0, 1].map((sheet) => ({
      size: sheet === 0 ? "12 × 12 in" : "12 × 18 in",
      count: layout.placements.filter((p) => p.sheet === sheet).length,
    })),
    requestedCount: count,
    shortfall: result.shortfall,
    currentSizeIn: badgeSize(review),
    changed: false,
    note: "Uses one 12 × 12-inch and one 12 × 18-inch sheet. Stock is checked when you select the layout. The search does not prove maximum capacity.",
  };
}
