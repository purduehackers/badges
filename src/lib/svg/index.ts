/**
 * Trotec Ruby laser cutter SVG processing.
 *
 * 1. CUT paths (red stroke #FF0000) define the badge geometry.
 *    - The outermost red path is the badge silhouette.
 *    - Inner red paths cut holes through the badge.
 *
 * 2. Everything else (fills, text, shapes) is flattened/rasterized into
 *    a single grayscale image, exactly like the laser's raster pass.
 */

import type { Shape } from "three";
import { SVGLoader, type SVGResult } from "three/addons/loaders/SVGLoader.js";
import { isRedStroke, isReddishButWrong } from "./color";
import { buildBodyWithHoles } from "./geometry";
import { rasterizeEngrave } from "./rasterize";
import type { BadgeData } from "./types";

export type { BadgeData } from "./types";

export async function parseBadgeSVG(url: string): Promise<BadgeData> {
  const loader = new SVGLoader();
  const svg: SVGResult = await new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });

  // Reject SVGs that use non-#FF0000 reds for CUT lines
  for (const path of svg.paths) {
    const style = (path.userData?.style ?? {}) as Record<string, unknown>;
    const wrongRed = isReddishButWrong(style.stroke as string | null);
    if (wrongRed) {
      throw new Error(`Found stroke color ${wrongRed} — CUT lines must use exactly #FF0000.`);
    }
  }

  // Collect shapes from red-stroked (CUT) paths
  const cutShapes: Shape[] = [];
  for (const path of svg.paths) {
    const style = (path.userData?.style ?? {}) as Record<string, unknown>;
    if (isRedStroke(style.stroke as string | null)) {
      cutShapes.push(...SVGLoader.createShapes(path));
    }
  }

  const bodyShapes = buildBodyWithHoles(cutShapes);

  // Extract viewBox dimensions
  const root = svg.xml as unknown as Element | null;
  let width = 100;
  let height = 100;
  if (root) {
    const vb = root.getAttribute("viewBox");
    if (vb) {
      const parts = vb.split(/\s+/).map(Number);
      if (parts.length === 4) {
        width = parts[2];
        height = parts[3];
      }
    }
    if (width === 100 && root.getAttribute("width"))
      width = parseFloat(root.getAttribute("width")!);
    if (height === 100 && root.getAttribute("height"))
      height = parseFloat(root.getAttribute("height")!);
  }

  const viewBox = { width, height };
  const engraveCanvas = await rasterizeEngrave(url, viewBox);

  return { bodyShapes, engraveCanvas, viewBox };
}
