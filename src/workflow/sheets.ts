import { includesMaterial, sheetBatchSchema } from "./contracts.ts";
import type { BadgeMaterial, CuttingSheet, SheetBatch, SheetSize } from "./contracts.ts";

export function sheetLabel(sheet: SheetSize): string {
  return `${Math.min(sheet.widthIn, sheet.heightIn)} × ${Math.max(sheet.widthIn, sheet.heightIn)}`;
}
export function sheetKey(sheet: CuttingSheet): string {
  return `${sheetLabel(sheet)}:${sheet.material?.materialId ?? ""}:${sheet.material?.thicknessMm ?? ""}`;
}

export function resolveSheets(batch: SheetBatch, materials: BadgeMaterial[]): SheetBatch {
  return groupSheets(
    batch.map((sheet) => {
      const material = sheet.material ?? (materials.length === 1 ? materials[0] : undefined);
      if (!material) throw new Error("Choose a color for each sheet.");
      if (!includesMaterial(materials, material))
        throw new Error("Choose sheets in the acrylic colors selected for this design.");
      return { ...sheet, material };
    }),
  );
}

export function groupSheets(sheets: SheetBatch): SheetBatch {
  const grouped = new Map<string, SheetBatch[number]>();
  for (const sheet of sheetBatchSchema.parse(sheets)) {
    const key = sheetKey(sheet);
    const previous = grouped.get(key);
    if (previous) previous.quantity += sheet.quantity;
    else
      grouped.set(key, {
        ...sheet,
        widthIn: Math.min(sheet.widthIn, sheet.heightIn),
        heightIn: Math.max(sheet.widthIn, sheet.heightIn),
        quantity: sheet.quantity,
      });
  }
  return [...grouped.values()];
}

export function expandSheets(batch: SheetBatch): CuttingSheet[] {
  return groupSheets(batch).flatMap((sheet) =>
    Array.from({ length: sheet.quantity }, () => ({
      widthIn: sheet.heightIn,
      heightIn: sheet.widthIn,
      ...(sheet.material ? { material: sheet.material } : {}),
    })),
  );
}

export function sheetFileNames(sheets: CuttingSheet[]): string[] {
  const names = sheets.map(
    (sheet) =>
      sheetLabel(sheet).replace(" × ", "x") +
      (sheet.material ? `-${sheet.material.materialId}-${sheet.material.thicknessMm}mm` : ""),
  );
  return names.map((name, index) =>
    names.filter((other) => other === name).length > 1
      ? `${name}-${names.slice(0, index + 1).filter((other) => other === name).length}.svg`
      : `${name}.svg`,
  );
}
