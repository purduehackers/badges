import { z } from "zod";
import { digestSchema, targetCountSchema, sheetBatchSchema } from "./contracts.ts";
import { inventoryActionSchema, stockSelectionSchema } from "./inventory-contracts.ts";

const current = { version: z.int().nonnegative() };
export const badgeTools = {
  get_review: {
    description: "Read the current badge review, its evidence, and available actions.",
    schema: z.strictObject({}),
  },
  identify_files: {
    description: "Assign badge and stamp from the designer's explicit answer.",
    schema: z.strictObject({ ...current, choice: z.enum(["A", "B", "badge", "stamp"]) }),
  },
  select_event: {
    description:
      "Select the Hack Night the designer identified, using an event ID from get_review.",
    schema: z.strictObject({ ...current, id: z.string() }),
  },
  select_material: {
    description:
      "Select acrylic sheets by stock item ID and quantity from get_review's availableSheets, or omit items to show the picker. Saves the exact sizes, colors, and counts for packing. The preview uses the first selected material.",
    schema: z.strictObject({ ...current, items: stockSelectionSchema.optional() }),
  },
  confirm_design: {
    description:
      "Record the designer's explicit confirmation of both current designs after human QA. A question never confirms a design.",
    schema: z.strictObject(current),
  },
  request_replacement: {
    description: "Ask the designer to upload a replacement badge or stamp SVG.",
    schema: z.strictObject({ ...current, design: z.enum(["badge", "stamp"]) }),
  },
  keep_design: {
    description: "Cancel the designer's pending replacement upload.",
    schema: z.strictObject(current),
  },
  estimate_attendance: {
    description:
      "Read the event's RSVP count as a planning reference. RSVPs are not measured attendance. Does not choose a quantity.",
    schema: z.strictObject({}),
  },
  set_target_quantity: {
    description: "Set the manufacturer's requested quantity and calculate cutting sheets.",
    schema: z.strictObject({ ...current, count: targetCountSchema }),
  },
  set_sheets: {
    description:
      "Choose sheet sizes, colors, and quantities from get_review's available stock. Include material for every sheet when multiple colors are selected. Checks stock and recalculates an existing target without repeating design QA.",
    schema: z.strictObject({ ...current, sheets: sheetBatchSchema }),
  },
  preview_packing: {
    description:
      "Calculate capacity at a proposed size without changing the review. Use for what-if questions such as how many badges fit at 3 inches. Results are feasible layouts, not proven optima.",
    schema: z.strictObject({
      sizeIn: z.number().min(1.8).max(10),
      count: targetCountSchema.optional(),
      sheets: sheetBatchSchema.optional(),
    }),
  },
  select_packing: {
    description:
      "Apply a packing proposal the manufacturer explicitly selected. Use only a proposal ID returned by preview_packing.",
    schema: z.strictObject({ ...current, id: digestSchema }),
  },
  publish_batch: {
    description:
      "Publish the manufacturer's selected batch on their explicit request. Saves exports and the shortlink, then deducts used sheets once.",
    schema: z.strictObject(current),
  },
  retry_failed_step: {
    description: "Retry a failed step, or refresh event details and acrylic choices.",
    schema: z.strictObject({ ...current, refresh: z.boolean().default(false) }),
  },
  inventory: {
    description:
      "Read or update material stock on the manufacturer's explicit request. Use exact item IDs from list or suggest.",
    schema: z.strictObject({ action: inventoryActionSchema }),
  },
} as const;
export type BadgeToolName = keyof typeof badgeTools;
export const badgeToolNameSchema = z.enum(
  Object.keys(badgeTools) as [BadgeToolName, ...BadgeToolName[]],
);
