import { z } from "zod";

export const roles = ["badge", "stamp"] as const;
export type DesignRole = (typeof roles)[number];
const upload = z.object({ name: z.string().min(1).max(256), svg: z.string().min(1) });
export const designInput = z.object({ badge: upload, stamp: upload });
export const sheetInput = z.object({
  widthIn: z.number().min(0.25).max(40),
  heightIn: z.number().min(0.25).max(40),
  quantity: z.int().min(1).max(10),
  material: z.object({ materialId: z.string(), thicknessMm: z.number().min(0.1).max(20) }),
});
export const packingInput = designInput
  .extend({
    confirmed: z.literal(true),
    target: z.int().min(1).max(500),
    minSizeIn: z.number().min(1.8).max(10),
    maxSizeIn: z.number().min(1.8).max(10),
    sheets: z.array(sheetInput).min(1).max(10),
  })
  .refine(
    (value) => value.minSizeIn <= value.maxSizeIn,
    "Minimum size must not exceed maximum size.",
  )
  .refine(
    (value) => value.sheets.reduce((sum, sheet) => sum + sheet.quantity, 0) <= 10,
    "Choose up to 10 sheets.",
  );
export type DesignUpload = z.infer<typeof upload>;
export type DesignPair = z.infer<typeof designInput>;
export type DesignSheet = z.infer<typeof sheetInput>;
export interface CheckedDesign {
  name: string;
  svg: string;
  preview: string;
  passed: boolean;
  checks: { id: string; label: string; status: "pass" | "fail" | "unknown"; guidance: string }[];
}
export interface DesignChecks {
  badge: CheckedDesign;
  stamp: CheckedDesign;
}
export interface DesignLayout {
  count: number;
  widthIn: number;
  heightIn: number;
  sizeIn: number;
  preview: string;
  shortfall?: { count: number; sizeIn: number };
  sheets: { widthIn: number; heightIn: number; count: number; materialId: string }[];
  files: {
    name: string;
    svg: string;
    kind: DesignRole;
    materialId?: string;
    thicknessMm: number;
    previewSvg: string;
  }[];
}
export interface DesignCatalog {
  events: { id: string; version: string; date: string; name: string }[];
  stock: {
    id: string;
    materialId: string;
    widthIn: number;
    heightIn: number;
    thicknessMm: number;
    quantity: number;
    reserved: number;
  }[];
  notices: string[];
}

export async function designRequest<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/designs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not prepare your designs. Try again.");
  return result;
}
