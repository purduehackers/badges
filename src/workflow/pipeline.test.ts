import { expect, test } from "bun:test";
import { Resvg } from "@resvg/resvg-js";
import { parseSvg, mirrorSvg } from "../lib/svg-document.ts";
import { packingInput, designLayoutSchema } from "../lib/designs.ts";
import { productionFile } from "../lib/ruby-batch.ts";
import { inspectSvg, renderSvg } from "./svg.ts";
import { prepareDesign, physicalDimensions } from "./manufacturing.ts";
import { pack } from "./packing.ts";
import { productionSettings, STAMP_SIZE_IN, STAMP_THICKNESS_MM } from "./policy.ts";
import { hash } from "./review.ts";
import { matchesStock } from "./inventory-contracts.ts";
import { expandSheets, sheetFileNames } from "./sheets.ts";
import { sheetBatchSchema, targetCountSchema, badgeSizeSchema } from "./contracts.ts";
import { POST } from "../app/api/designs/route.ts";

// Offset canvas and asymmetric engraving catch cropping and accidental double mirroring.
const design = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 120 70" fill="black">
  <rect x="0" y="0" width="100" height="50" fill="none" stroke="red" stroke-width="0.01"/>
  <rect x="5" y="5" width="20" height="40"/>
</svg>`;

test("thin red outlines pass the same checks used by website and worker", () => {
  for (const role of ["badge", "stamp"] as const) {
    const result = inspectSvg(design, role);
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    expect(result.cuts).toHaveLength(1);
  }
});

test("badge engraving supports fill opacity while preserving stamp and cutting checks", () => {
  for (const alpha of ["0", "0.06", ".5", "99%", "1", "5e-1"]) {
    const source = design.replace(
      'width="20" height="40"',
      `width="20" height="40" fill-opacity="${alpha}"`,
    );
    const result = inspectSvg(source, "badge");
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    expect(result.source).toContain(`fill-opacity="${alpha}"`);
    expect(prepareDesign(source, "badge", 2.2).svg).toContain(`fill-opacity="${alpha}"`);
    if (alpha !== "1")
      expect(
        inspectSvg(source, "stamp").checks.find((check) => check.id === "supported")?.status,
      ).toBe("unknown");
  }
  for (const attributes of [
    'fill-opacity="invalid"',
    'fill-opacity="2"',
    'fill-opacity="-0.1"',
    'fill-opacity="0x1"',
    'opacity="0.5"',
    'stroke-opacity="0.5"',
  ]) {
    const source = design.replace('fill="black"', `fill="black" ${attributes}`);
    expect(inspectSvg(source, "badge").checks.some((check) => check.status !== "pass")).toBe(true);
  }
  const redFill = design.replace(
    'width="20" height="40"',
    'width="20" height="40" fill="red" fill-opacity=".5"',
  );
  expect(inspectSvg(redFill, "badge").checks.find((check) => check.id === "fills")?.status).toBe(
    "fail",
  );
});

test("standard SVG doctypes do not change inspection, rendering, or manufacturing exports", () => {
  const plain = inspectSvg(design, "badge");
  for (const declaration of [
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
    "<!DOCTYPE svg\nPUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'>",
    '<!DOCTYPE svg SYSTEM "https://example.invalid/svg.dtd">',
    "<!DOCTYPE svg>",
  ]) {
    const source = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>${declaration}${design}`;
    const result = inspectSvg(source, "badge");
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    expect(result.source).toBe(plain.source);
    expect(result.cuts).toEqual(plain.cuts);
    expect(renderSvg(source)).toEqual(renderSvg(design));
    for (const role of ["badge", "stamp"] as const) {
      const size = role === "stamp" ? STAMP_SIZE_IN : 2.5;
      expect(prepareDesign(source, role, size)).toEqual(prepareDesign(design, role, size));
    }
  }
});

test("SVG export headers cannot introduce entities or other XML directives", () => {
  for (const directive of [
    '<!DOCTYPE svg [<!ENTITY external SYSTEM "file:///etc/passwd">]>',
    '<!DOCTYPE svg [<!ENTITY local "artwork">]>',
    '<!DOCTYPE svg SYSTEM "https://example.invalid/svg.dtd" []>',
    '<!ENTITY external SYSTEM "https://example.invalid/artwork">',
    '<!DOCTYPE html SYSTEM "https://example.invalid/html.dtd">',
    '<!DOCTYPE svg PUBLIC "missing-system-identifier">',
    "<!DOCTYPE svg><!DOCTYPE svg>",
    '<?xml-stylesheet href="https://example.invalid/style.css"?>',
  ]) {
    const source = `${directive}${design}`;
    expect(() => parseSvg(source)).toThrow();
    expect(() => parseSvg(source, true)).toThrow();
    expect(() => renderSvg(source)).toThrow();
  }
});

test("exports use cut dimensions, preserve root paint, and mirror only the stamp", () => {
  const badge = prepareDesign(design, "badge", 2.5);
  const stamp = prepareDesign(design, "stamp", STAMP_SIZE_IN);
  expect([badge.widthIn, badge.heightIn]).toEqual([2.5, 1.25]);
  expect(stamp.widthIn).toBeCloseTo(3);
  expect(stamp.heightIn).toBeCloseTo(1.5);
  expect(badge.svg).toBe(badge.previewSvg);
  expect(stamp.svg).not.toBe(stamp.previewSvg);
  expect(badge.svg).toContain('fill="black"');
  const render = (svg: string) =>
    new Resvg(svg, { fitTo: { mode: "width", value: 400 } }).render().pixels;
  expect(render(mirrorSvg(stamp.svg))).toEqual(render(stamp.previewSvg));
  const measured = physicalDimensions(inspectSvg(stamp.svg, "stamp").cuts, "stamp", STAMP_SIZE_IN);
  expect(measured.widthIn).toBeCloseTo(stamp.widthIn);
  expect(measured.heightIn).toBeCloseTo(stamp.heightIn);
});

test("design, renderer, and production parsing reject external or executable artwork", () => {
  for (const content of [
    '<image href="https://example.com/art.png"/>',
    '<use href="https://example.com/art.svg#drawing"/>',
    "<script>alert(1)</script>",
    '<rect width="5" height="5" style="fill:url(https://example.com/paint)"/>',
    '<rect width="5" height="5" onclick="alert(1)"/>',
  ]) {
    const svg = design.replace("</svg>", `${content}</svg>`);
    expect(() => parseSvg(svg)).toThrow();
    expect(() => parseSvg(svg, true)).toThrow();
  }
});

test("browser sheet, size and quantity inputs share the workflow limits", () => {
  const input = {
    badge: { name: "badge.svg", svg: design },
    stamp: { name: "stamp.svg", svg: design },
    confirmed: true,
    target: 90,
    minSizeIn: 1.8,
    maxSizeIn: 6,
    sheets: [
      {
        widthIn: 12,
        heightIn: 18,
        quantity: 2,
        material: { materialId: "transparent-teal", thicknessMm: 3.175 },
      },
    ],
  };
  expect(packingInput.safeParse(input).success).toBe(true);
  for (const target of [0, 2.5, 90, 501])
    expect(packingInput.safeParse({ ...input, target }).success).toBe(
      targetCountSchema.safeParse(target).success,
    );
  for (const maxSizeIn of [1, 2.5, 6, 11])
    expect(packingInput.safeParse({ ...input, maxSizeIn }).success).toBe(
      badgeSizeSchema.safeParse(maxSizeIn).success,
    );
  const sheets = [{ ...input.sheets[0], quantity: 11 }];
  expect(packingInput.safeParse({ ...input, sheets }).success).toBe(
    sheetBatchSchema.safeParse(sheets).success,
  );
  expect(matchesStock("Transparent Teal · 12 × 18 in", "teal 18 by 12")).toBe(true);
  expect(matchesStock("Opaque Red · 12 × 12 in", "transparent red")).toBe(false);
});

test("packed exports are accepted by production without allowing reuse in uploaded designs", async () => {
  const material = { materialId: "transparent-teal", thicknessMm: 3.175 };
  const sheets = expandSheets([{ widthIn: 4, heightIn: 4, quantity: 2, material }]);
  const assets = new Map<string, Uint8Array>();
  const result = await pack(
    design,
    inspectSvg(design, "badge").cuts,
    productionSettings(),
    {
      putAsset: async (bytes: Uint8Array) => {
        const id = hash(bytes);
        assets.set(id, bytes);
        return id;
      },
    },
    sheets,
    { target: 2, minSizeIn: 2.2, maxSizeIn: 2.5 },
  );
  const layout = result.layouts[0]!;
  expect(layout.audited).toBe(true);
  expect(layout.count).toBeGreaterThanOrEqual(2);
  expect(layout.sizeIn).toBe(2.5);
  const names = sheetFileNames(layout.sheetSizes);
  for (const [index, id] of layout.sheets.entries()) {
    const svg = new TextDecoder().decode(assets.get(id));
    expect(svg).toContain('<use href="#badge-art"');
    expect(() => parseSvg(svg)).toThrow();
    expect(() => parseSvg(svg, true)).not.toThrow();
    const file = await productionFile(new File([svg], names[index]!, { type: "image/svg+xml" }));
    expect(file.kind).toBe("badge");
    expect(file.materialId).toBe(material.materialId);
    expect(file.dimensions).toBe("4 × 4 in");
  }
  expect(designLayoutSchema.shape.count.safeParse(layout.count).success).toBe(true);
  const stamp = await productionFile(
    new File([prepareDesign(design, "stamp", STAMP_SIZE_IN).svg], "stamp.svg"),
  );
  expect(stamp.mirrored).toBe(true);
  expect(stamp.thicknessMm).toBe(STAMP_THICKNESS_MM);
});

test("the website returns the shared layout contract including mixed-material sheets", async () => {
  const response = await POST(
    new Request("http://localhost/api/designs", {
      method: "POST",
      body: JSON.stringify({
        badge: { name: "badge.svg", svg: design },
        stamp: { name: "stamp.svg", svg: design },
        confirmed: true,
        target: 2,
        minSizeIn: 2.2,
        maxSizeIn: 2.5,
        sheets: ["transparent-teal", "opaque-red"].map((materialId) => ({
          widthIn: 4,
          heightIn: 4,
          quantity: 1,
          material: { materialId, thicknessMm: 3.175 },
        })),
      }),
    }),
  );
  expect(response.status).toBe(200);
  const layout = designLayoutSchema.parse(await response.json());
  expect(layout.sheets.map((sheet) => sheet.materialId)).toEqual([
    "transparent-teal",
    "opaque-red",
  ]);
  expect(layout.files).toHaveLength(3);
});
