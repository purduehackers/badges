import { Resvg } from "@resvg/resvg-js";

import { STAMP_SIZE_IN } from "./policy.ts";
import { inspectSvg } from "./svg.ts";
import { svgGroup } from "../lib/svg-document.ts";

export function physicalDimensions(cuts: string[], role: "badge" | "stamp", sizeIn: number) {
  // Measure curves directly; export coordinates must not determine tessellation cost.
  const measured = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">${cuts.map((cut) => `<path d="${cut}"/>`).join("")}</svg>`,
    { font: { loadSystemFonts: false } },
  ).getBBox();
  if (!measured || measured.width <= 0 || measured.height <= 0)
    throw new Error("Invalid physical cut dimensions.");
  const { x, y, width, height } = measured;
  const box = { minX: x, minY: y, maxX: x + width, maxY: y + height };
  const scale =
    (sizeIn * 25.4) / (role === "stamp" ? Math.min(width, height) : Math.max(width, height));
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid physical cut dimensions.");
  return { box, scale, widthIn: (width * scale) / 25.4, heightIn: (height * scale) / 25.4 };
}

/** Measure all pieces together, never the export canvas or just the first contour. */
export function prepareDesign(source: string, role: "badge" | "stamp", sizeIn: number) {
  const { cuts } = inspectSvg(source, role);
  const { box, scale, widthIn, heightIn } = physicalDimensions(cuts, role, sizeIn);
  const artwork = svgGroup(source);
  // The 0.5 mm preview/export bleed keeps the cut stroke visible without changing cut size.
  const w = widthIn * 25.4,
    h = heightIn * 25.4;
  if (role === "stamp" && Math.abs(sizeIn - STAMP_SIZE_IN) > 1e-9)
    throw new Error("Stamp shortest side must be 1.5 inches.");
  function drawing(mirror: boolean) {
    const transform = `${mirror ? `translate(${w + 0.5} 0.5) scale(-1 1)` : "translate(0.5 0.5)"} scale(${scale}) translate(${-box.minX} ${-box.minY})`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 1}mm" height="${h + 1}mm" viewBox="0 0 ${w + 1} ${h + 1}"><g transform="${transform}">${artwork}</g></svg>`;
  }
  const previewSvg = drawing(false);
  return { svg: role === "stamp" ? drawing(true) : previewSvg, previewSvg, widthIn, heightIn };
}
