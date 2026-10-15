import { createHash } from "node:crypto";

import { z } from "zod";

export const BADGES_CHANNEL_ID = z
  .string()
  .regex(/^\d{17,20}$/u)
  .parse(process.env.BADGES_CHANNEL_ID || "1418162647005790342");
export const RUBRIC_VERSION = "2026-10-12.1";
export const MAX_BADGE_COUNT = 500;
export const MAX_CUTTING_SHEETS = 10;
export const badgeMaterialSchema = z.strictObject({
  materialId: z.string().min(1).max(100),
  thicknessMm: z.number().positive(),
});
export type BadgeMaterial = z.output<typeof badgeMaterialSchema>;
export const sheetSizeSchema = z.strictObject({
  widthIn: z.number().min(0.25).max(120),
  heightIn: z.number().min(0.25).max(120),
});
export const cuttingSheetSchema = sheetSizeSchema.extend({
  // Older single-color reviews inherit their material when planning stock.
  material: badgeMaterialSchema.optional(),
});
export const sheetBatchSchema = z
  .array(cuttingSheetSchema.extend({ quantity: z.int().min(1).max(MAX_CUTTING_SHEETS) }))
  .min(1)
  .max(MAX_CUTTING_SHEETS)
  .refine(
    (sheets) => sheets.reduce((sum, sheet) => sum + sheet.quantity, 0) <= MAX_CUTTING_SHEETS,
    {
      message: `Choose up to ${MAX_CUTTING_SHEETS} sheets per batch.`,
    },
  );
export type SheetSize = z.output<typeof sheetSizeSchema>;
export type CuttingSheet = z.output<typeof cuttingSheetSchema>;
export type SheetBatch = z.output<typeof sheetBatchSchema>;
export const targetCountSchema = z.int().min(1).max(MAX_BADGE_COUNT);
const id = z.string().trim().min(1).max(128);
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const personSchema = z.strictObject({ id, username: z.string().trim().min(1).max(64) });
export const assetSchema = z.strictObject({ hash: digestSchema, name: z.string().max(256) });
export const eventSchema = z.strictObject({
  id,
  slug: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/u),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+$/u),
  date: z.iso.date(),
});
export const settingsSchema = z.strictObject({
  material: z.string().trim().min(1).max(100),
  badgeSizeIn: z.number().min(1.8).max(10),
  stampSizeIn: z.literal(1.5),
  gapMm: z.number().min(0).max(5),
});
export const criteria = ["badge", "stamp"] as const;
export const criterionSchema = z.enum(criteria);
export const checkIds = ["supported", "palette", "vectors", "text", "fills", "cut"] as const;
export const checkSchema = z.strictObject({
  id: z.enum(checkIds),
  role: z.enum(["badge", "stamp"]),
  status: z.enum(["pass", "fail", "unknown"]),
  detail: z.string().max(3000),
  evidenceId: digestSchema,
});
export const placementSchema = z.strictObject({
  sheet: z
    .int()
    .min(0)
    .max(MAX_CUTTING_SHEETS - 1),
  x: z.number(),
  y: z.number(),
  angle: z.number(),
});
export const layoutSchema = z
  .strictObject({
    id: digestSchema,
    count: targetCountSchema,
    sizeIn: z.number().positive(),
    widthIn: z.number().positive(),
    heightIn: z.number().positive(),
    placements: z.array(placementSchema).min(1).max(MAX_BADGE_COUNT),
    sheets: z.array(digestSchema).min(1).max(MAX_CUTTING_SHEETS),
    // Existing stored layouts used this fixed pair, in landscape orientation.
    sheetSizes: z
      .array(cuttingSheetSchema)
      .min(1)
      .max(MAX_CUTTING_SHEETS)
      .default([
        { widthIn: 12, heightIn: 12 },
        { widthIn: 18, heightIn: 12 },
      ]),
    preview: digestSchema,
    audited: z.literal(true),
  })
  .refine(
    (layout) =>
      layout.count === layout.placements.length &&
      layout.sheets.length === layout.sheetSizes.length &&
      layout.placements.every((placement) => placement.sheet < layout.sheetSizes.length),
    { message: "The layout does not match its cutting sheets." },
  );
export const decisionSchema = z.strictObject({
  criterion: criterionSchema,
  context: digestSchema,
  verdict: z.enum(["approve", "changes", "unclear"]),
  reviewer: personSchema,
  note: z.string().max(1500),
  at: z.iso.datetime(),
});
export const stockPlanSchema = z
  .array(
    z.strictObject({
      itemId: z.string().regex(/^[a-f0-9]{24}$/u),
      materialId: z.string(),
      label: z.string(),
      widthIn: z.number().positive(),
      heightIn: z.number().positive(),
      thicknessMm: z.number().positive(),
      quantity: z.int().min(1).max(MAX_CUTTING_SHEETS),
    }),
  )
  .min(1)
  .max(MAX_CUTTING_SHEETS)
  .refine((plan) => new Set(plan.map((sheet) => sheet.itemId)).size === plan.length);
export type StockPlan = z.output<typeof stockPlanSchema>;

export const reviewSchema = z.strictObject({
  id,
  threadId: id,
  sourceMessageId: id,
  author: personSchema,
  generation: z.int().nonnegative(),
  manufacturer: personSchema.optional(),
  rubric: z.literal(RUBRIC_VERSION),
  uploads: z.array(assetSchema).min(1).max(2),
  rolesConfirmed: z.boolean(),
  pendingRole: criterionSchema.optional(),
  badge: assetSchema.optional(),
  stamp: assetSchema.optional(),
  event: eventSchema.optional(),
  settings: settingsSchema.optional(),
  // Retained for stored reviews created before multiple colors were supported.
  material: badgeMaterialSchema.optional(),
  materials: z.array(badgeMaterialSchema).min(1).max(MAX_CUTTING_SHEETS).optional(),
  sheetBatch: sheetBatchSchema.optional(),
  checks: z.array(checkSchema),
  previews: z.array(digestSchema),
  layouts: z.array(layoutSchema).max(3),
  selectedLayout: digestSchema.optional(),
  stockPlan: stockPlanSchema.optional(),
  layoutAttempt: z.int().nonnegative().default(0),
  targetCount: targetCountSchema.optional(),
  fittedSizeIn: z.number().min(1.8).max(10).optional(),
  quantityShortfall: z
    .strictObject({ count: targetCountSchema, sizeIn: z.number().positive() })
    .optional(),
  manufacturing: z
    .strictObject({
      badge: digestSchema,
      stamp: digestSchema,
      badgePreview: digestSchema,
      badge3d: z
        .strictObject({
          preview: digestSchema,
          material: z.string().max(100),
          materialId: z.string().optional(),
          thicknessMm: z.number().positive().optional(),
        })
        .optional(),
      stampPreview: digestSchema,
      badgeWidthIn: z.number().positive(),
      badgeHeightIn: z.number().positive(),
      stampWidthIn: z.number().positive(),
      stampHeightIn: z.number().positive(),
    })
    .optional(),
  decisions: z.array(decisionSchema),
  repositoryHead: z.string().optional(),
  pr: z.strictObject({ number: z.int().positive(), head: z.string(), url: z.url() }).optional(),
  approval: z
    .strictObject({ context: digestSchema, head: z.string().optional(), reviewer: personSchema })
    .optional(),
  publication: z
    .strictObject({ commit: z.string(), url: z.url(), shortlink: z.url().optional() })
    .optional(),
  failure: z.string().max(1500).optional(),
  contextChanged: z.boolean().optional(),
  previousShortlink: z.url().optional(),
  cardId: id.optional(),
  cardVersion: z.int().nonnegative().optional(),
});
export type Review = z.output<typeof reviewSchema>;
export type Person = z.output<typeof personSchema>;
export type BadgeEvent = z.output<typeof eventSchema>;
export type Asset = z.output<typeof assetSchema>;
export type Settings = z.output<typeof settingsSchema>;
export type Check = z.output<typeof checkSchema>;
export type Layout = z.output<typeof layoutSchema>;
export type Criterion = z.output<typeof criterionSchema>;
export type Decision = z.output<typeof decisionSchema>;
export type StoredReview = { review: Review; version: number };
export function reviewMaterials(review: Review): BadgeMaterial[] {
  return review.materials ?? (review.material ? [review.material] : []);
}
export function includesMaterial(materials: BadgeMaterial[], material: BadgeMaterial): boolean {
  return materials.some(
    (selected) =>
      selected.materialId === material.materialId && selected.thicknessMm === material.thicknessMm,
  );
}
export const jobKindSchema = z.enum([
  "inspect",
  "pack",
  "prepare",
  "archive",
  "publish",
  "link",
  "render",
]);
export type JobKind = z.output<typeof jobKindSchema>;

export function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function contextHash(review: Review): string {
  return hash(
    JSON.stringify({
      badge: review.badge?.hash,
      stamp: review.stamp?.hash,
      event: review.event,
      settings: review.settings,
      fittedSizeIn: review.fittedSizeIn,
      targetCount: review.targetCount,
      material: reviewMaterials(review)[0],
      ...(reviewMaterials(review).length > 1 ? { materials: reviewMaterials(review) } : {}),
      sheetBatch: review.sheetBatch,
      layout: review.selectedLayout,
      stockPlan: review.stockPlan,
      manufacturing: review.manufacturing,
      rubric: review.rubric,
    }),
  );
}

/** Confirmations bind the design and configured size, independent of automatic layout fitting. */
export function designHash(review: Review, role: Criterion): string {
  return hash(
    JSON.stringify({
      asset: review[role]?.hash,
      rubric: review.rubric,
      ...(role === "badge"
        ? {
            event: review.event,
            size: review.settings?.badgeSizeIn,
            material: reviewMaterials(review)[0],
            ...(reviewMaterials(review).length > 1 ? { materials: reviewMaterials(review) } : {}),
          }
        : { shortSide: review.settings?.stampSizeIn, impression: "unmirrored" }),
    }),
  );
}

export function staticPassed(review: Review): boolean {
  return ["badge", "stamp"].every((role) =>
    checkIds.every((id) =>
      review.checks.some(
        (check) =>
          check.role === role &&
          check.id === id &&
          check.status === "pass" &&
          check.evidenceId === (role === "badge" ? review.badge?.hash : review.stamp?.hash),
      ),
    ),
  );
}

export function remainingCriteria(review: Review): Criterion[] {
  return criteria.filter(
    (criterion) =>
      !review.decisions.some(
        (decision) =>
          decision.context === designHash(review, criterion) &&
          decision.criterion === criterion &&
          decision.verdict === "approve",
      ),
  );
}

export function reviewable(review: Review): boolean {
  return (
    review.rolesConfirmed &&
    staticPassed(review) &&
    review.event !== undefined &&
    review.settings !== undefined &&
    reviewMaterials(review).length > 0 &&
    review.manufacturing !== undefined
  );
}

export function ready(review: Review): boolean {
  return (
    reviewable(review) &&
    remainingCriteria(review).length === 0 &&
    Boolean(review.stockPlan?.every((sheet) => includesMaterial(reviewMaterials(review), sheet))) &&
    review.layouts.some(
      (layout) =>
        layout.id === review.selectedLayout &&
        layout.audited &&
        layout.sizeIn === badgeSize(review) &&
        layout.count === review.targetCount,
    )
  );
}

export function badgeSize(review: Review): number | undefined {
  return review.fittedSizeIn ?? review.settings?.badgeSizeIn;
}

export function invalidate(review: Review, role?: Criterion): Review {
  const {
    approval: _approval,
    pr: _pr,
    publication: _publication,
    failure: _failure,
    selectedLayout: _selectedLayout,
    stockPlan: _stockPlan,
    manufacturing: _manufacturing,
    contextChanged: _contextChanged,
    pendingRole: _pendingRole,
    quantityShortfall: _quantityShortfall,
    ...rest
  } = review;
  return {
    ...rest,
    generation: review.generation + 1,
    checks: role ? review.checks.filter((check) => check.role !== role) : [],
    previews: [],
    layouts: [],
    layoutAttempt: 0,
    decisions: review.decisions,
    ...(review.publication?.shortlink ? { previousShortlink: review.publication.shortlink } : {}),
  };
}
