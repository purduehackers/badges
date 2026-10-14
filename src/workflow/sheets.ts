import { sheetBatchSchema } from "./contracts.ts";
import type { SheetBatch, SheetSize } from "./contracts.ts";

export function sheetLabel(sheet: SheetSize): string {
  return `${Math.min(sheet.widthIn, sheet.heightIn)} × ${Math.max(sheet.widthIn, sheet.heightIn)}`;
}

export function groupSheets(sheets: SheetBatch): SheetBatch {
  const grouped = new Map<string, SheetBatch[number]>();
  for (const sheet of sheetBatchSchema.parse(sheets)) {
    const key = sheetLabel(sheet);
    const previous = grouped.get(key);
    if (previous) previous.quantity += sheet.quantity;
    else
      grouped.set(key, {
        widthIn: Math.min(sheet.widthIn, sheet.heightIn),
        heightIn: Math.max(sheet.widthIn, sheet.heightIn),
        quantity: sheet.quantity,
      });
  }
  return [...grouped.values()];
}

export function expandSheets(batch: SheetBatch): SheetSize[] {
  return groupSheets(batch).flatMap((sheet) =>
    Array.from({ length: sheet.quantity }, () => ({
      widthIn: sheet.heightIn,
      heightIn: sheet.widthIn,
    })),
  );
}

export function sheetFileNames(sheets: SheetSize[]): string[] {
  const names = sheets.map((sheet) => sheetLabel(sheet).replace(" × ", "x"));
  return names.map((name, index) =>
    names.filter((other) => other === name).length > 1
      ? `${name}-${names.slice(0, index + 1).filter((other) => other === name).length}.svg`
      : `${name}.svg`,
  );
}
