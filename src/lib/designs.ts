import { z } from "zod";
import {
  badgeMaterialSchema,
  badgeSizeSchema,
  checkSchema,
  criterionSchema,
  eventSchema,
  sheetBatchSchema,
  targetCountSchema,
} from "../workflow/contracts.ts";
import { stockItemSchema } from "../workflow/inventory-contracts.ts";
import { readResponse } from "./http.ts";

const upload = z.object({ name: z.string().min(1).max(256), svg: z.string().min(1) });
export const designInput = z.object({ badge: upload, stamp: upload });
export const sheetInput = sheetBatchSchema.element.required({ material: true });
export const packingInput = designInput
  .extend({
    confirmed: z.literal(true),
    target: targetCountSchema,
    minSizeIn: badgeSizeSchema,
    maxSizeIn: badgeSizeSchema,
    sheets: sheetBatchSchema.pipe(z.array(sheetInput)),
  })
  .refine(
    (value) => value.minSizeIn <= value.maxSizeIn,
    "Minimum size must not exceed maximum size.",
  );
export type DesignUpload = z.infer<typeof upload>;
export type DesignPair = z.infer<typeof designInput>;
export type DesignSheet = z.infer<typeof sheetInput>;
const checkedDesignSchema = z.object({
  name: upload.shape.name,
  svg: z.string(),
  preview: z.string(),
  passed: z.boolean(),
  checks: z.array(
    checkSchema
      .pick({ id: true, status: true })
      .extend({ label: z.string(), guidance: z.string() }),
  ),
});
export const designChecksSchema = z.object({
  badge: checkedDesignSchema,
  stamp: checkedDesignSchema,
});
export type CheckedDesign = z.infer<typeof checkedDesignSchema>;
export type DesignChecks = z.infer<typeof designChecksSchema>;
export const designLayoutSchema = z.object({
  count: targetCountSchema,
  widthIn: z.number().positive(),
  heightIn: z.number().positive(),
  sizeIn: badgeSizeSchema,
  preview: z.string(),
  shortfall: z.object({ count: targetCountSchema, sizeIn: badgeSizeSchema }).optional(),
  sheets: z.array(
    sheetInput
      .pick({ widthIn: true, heightIn: true })
      .extend({ count: targetCountSchema, materialId: z.string() }),
  ),
  files: z.array(
    upload.extend({
      kind: criterionSchema,
      materialId: z.string().optional(),
      thicknessMm: badgeMaterialSchema.shape.thicknessMm,
      previewSvg: z.string(),
    }),
  ),
});
export type DesignLayout = z.infer<typeof designLayoutSchema>;
export const designCatalogSchema = z.object({
  events: z.array(eventSchema),
  stock: z.array(stockItemSchema),
  notices: z.array(z.string()),
});
export type DesignCatalog = z.infer<typeof designCatalogSchema>;

export async function designRequest<T>(
  body: unknown,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  return readResponse(
    await fetch("/api/designs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
    schema,
  );
}
