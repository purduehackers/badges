import { Resvg } from "@resvg/resvg-js";
import { join } from "node:path";
import { XMLSerializer } from "@xmldom/xmldom";
import type { Path } from "clipper-lib";

import { hash, MAX_BADGE_COUNT } from "./contracts.ts";
import type { CuttingSheet, Layout, Settings, SheetSize } from "./contracts.ts";
import { materialDescription } from "../lib/materials.ts";
import { sheetLabel } from "./sheets.ts";
import {
  bounds,
  assertSimple,
  clip,
  Clipper,
  flatten,
  fromPath,
  MARGIN,
  offset,
  packingBoundary,
  rotate,
  SCALE,
  toPath,
  translate,
} from "./geometry.ts";
import type { Point } from "./geometry.ts";
import { physicalDimensions } from "./manufacturing.ts";
import { BADGE_SIZE_STEP_IN, MIN_BADGE_SIZE_IN } from "./policy.ts";
import type { BadgeStore } from "./store.ts";
import { parseSvg } from "./svg.ts";

type Placement = Layout["placements"][number];
interface Shape {
  points: Point[];
  searchPoints: Point[];
  center: Point;
  scale: number;
  widthIn: number;
  heightIn: number;
}

function shapeAt(cuts: string[], sizeIn: number): Shape {
  const { box, scale, widthIn, heightIn } = physicalDimensions(cuts, "badge", sizeIn);
  const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const boundary = (tolerance: number) =>
    packingBoundary(
      cuts.map((cut) =>
        flatten(cut, tolerance / scale).map((p) => ({
          x: (p.x - center.x) * scale,
          y: (p.y - center.y) * scale,
        })),
      ),
    );
  const points = boundary(0.01);
  if (points.length > 384)
    throw new Error(
      "Cut outline exceeds the 384-vertex packing budget. Simplify the exterior path.",
    );
  assertSimple(points);
  const simple = Clipper.Clipper.SimplifyPolygon(toPath(points), Clipper.PolyFillType.pftNonZero);
  if (
    simple.length !== 1 ||
    !simple[0] ||
    Math.abs(Clipper.Clipper.Area(simple[0])) < SCALE * SCALE
  )
    throw new Error("Cut outline is disconnected, self-intersecting, or too small.");
  const searchPoints = boundary(0.1);
  if (searchPoints.length > 128)
    throw new Error(
      "Cut outline exceeds the 128-vertex search budget. Simplify the exterior path.",
    );
  return { points, searchPoints, center, scale, widthIn, heightIn };
}

function nest(
  points: Point[],
  sheets: SheetSize[],
  gap: number,
  deadline: number,
  attempt: number,
): Placement[] {
  const padded = offset(points, gap / 2 + 0.14);
  // Pick an orientation suited to long shapes, then allow quarter turns and flips.
  const baseAngle =
    [(attempt % 3) * 10, 30 + (attempt % 3) * 10, 60 + (attempt % 3) * 10]
      .map((angle) => ({ angle, box: bounds(rotate(padded, angle)) }))
      .sort(
        (a, b) =>
          (a.box.maxX - a.box.minX) * (a.box.maxY - a.box.minY) -
          (b.box.maxX - b.box.minX) * (b.box.maxY - b.box.minY),
      )[0]?.angle ?? 0;
  const shapes = [0, 90, 180, 270].map((turn) => {
    const angle = baseAngle + turn,
      polygon = rotate(padded, angle);
    return { angle, polygon, box: bounds(polygon) };
  });
  const noFit = exclusionRegions(
    points,
    shapes.map((s) => s.angle),
    gap,
    deadline,
  );
  const placements: Placement[] = [];
  for (const [sheet, size] of sheets.entries()) {
    const dimensions = { width: size.widthIn * 25.4, height: size.heightIn * 25.4 };
    while (placements.length < MAX_BADGE_COUNT) {
      if (Date.now() > deadline) throw new Error("Packing reached its time budget. Try again.");
      const choices = shapes.flatMap((orientation) =>
        placementChoices({ orientation, dimensions, sheet, placements, noFit }),
      );
      const best = choices.sort((a, b) => a.score - b.score)[0];
      if (!best) break;
      placements.push(best.pose);
    }
  }
  return placements;
}

function placementChoices(input: {
  orientation: { angle: number; box: ReturnType<typeof bounds> };
  dimensions: { width: number; height: number };
  sheet: number;
  placements: Placement[];
  noFit: Map<string, Path>;
}): { pose: Placement; score: number }[] {
  const { orientation, dimensions, sheet, placements, noFit } = input;
  const { box } = orientation;
  const left = MARGIN - box.minX,
    right = dimensions.width - MARGIN - box.maxX,
    top = MARGIN - box.minY,
    bottom = dimensions.height - MARGIN - box.maxY;
  if (left > right || top > bottom) return [];
  const rectangle = toPath([
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]);
  const exclusions = placements
    .filter((p) => p.sheet === sheet)
    .map((p) => {
      const polygon = noFit.get(`${p.angle}:${orientation.angle}`);
      if (!polygon) throw new Error("Missing clearance geometry.");
      return polygon.map((point) => ({
        X: point.X + Math.round(p.x * SCALE),
        Y: point.Y + Math.round(p.y * SCALE),
      }));
    });
  return clip([rectangle], exclusions, Clipper.ClipType.ctDifference)
    .flatMap(fromPath)
    .filter(
      (p) =>
        p.x >= left - 0.001 && p.x <= right + 0.001 && p.y >= top - 0.001 && p.y <= bottom + 0.001,
    )
    .map((p) => ({
      pose: { sheet, ...p, angle: orientation.angle },
      score: p.y + box.maxY + p.x * 0.01,
    }));
}

/** Separate from the no-fit search: audit every expanded contour against sheet bounds and every other contour. */
export function audit(
  points: Point[],
  placements: Placement[],
  gap: number,
  sheets: SheetSize[],
): void {
  const padded = offset(points, gap / 2 + 0.02);
  const placed = placements.map((pose) => ({
    ...pose,
    polygon: translate(rotate(padded, pose.angle), pose.x, pose.y),
  }));
  for (const [i, a] of placed.entries()) {
    const sheet = sheets[a.sheet];
    if (
      !sheet ||
      a.polygon.some(
        (p) =>
          p.x < MARGIN ||
          p.y < MARGIN ||
          p.x > sheet.widthIn * 25.4 - MARGIN ||
          p.y > sheet.heightIn * 25.4 - MARGIN,
      )
    )
      throw new Error("Layout exceeds the sheet's 0.2-inch edge margin.");
    for (const b of placed.slice(i + 1)) {
      if (a.sheet !== b.sheet) continue;
      const intersection = clip(
        [toPath(a.polygon)],
        [toPath(b.polygon)],
        Clipper.ClipType.ctIntersection,
      );
      if (intersection.some((p) => Math.abs(Clipper.Clipper.Area(p)) > 1))
        throw new Error("Layout has overlapping badge clearances.");
    }
  }
}

function sheetSvg(
  source: string,
  shape: Shape,
  placements: Placement[],
  sheet: number,
  size: SheetSize,
): string {
  const dimensions = { width: size.widthIn * 25.4, height: size.heightIn * 25.4 };
  const { root } = parseSvg(source);
  // A group preserves root presentation attributes, without a viewport that could crop the art.
  const document = root.ownerDocument;
  if (!document) throw new Error("Missing SVG document.");
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  for (const attribute of Array.from(root.attributes))
    if (!["xmlns", "viewBox", "width", "height", "id"].includes(attribute.name))
      group.setAttribute(attribute.name, attribute.value);
  group.setAttribute("id", "badge-art");
  for (const child of Array.from(root.childNodes)) group.appendChild(child.cloneNode(true));
  const drawing = new XMLSerializer().serializeToString(group);
  const copies = placements
    .filter((p) => p.sheet === sheet)
    .map(
      (p) =>
        `<use href="#badge-art" transform="translate(${p.x} ${p.y}) rotate(${p.angle}) scale(${shape.scale}) translate(${-shape.center.x} ${-shape.center.y})"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}mm" height="${dimensions.height}mm" viewBox="0 0 ${dimensions.width} ${dimensions.height}"><defs>${drawing}</defs>${copies}</svg>`;
}

export async function pack(
  source: string,
  cuts: string[],
  settings: Settings,
  store: Pick<BadgeStore, "putAsset">,
  sheets: CuttingSheet[],
  options: { attempt?: number; target?: number; cached?: Layout[]; fixedSize?: boolean } = {},
): Promise<{ layouts: Layout[]; shortfall?: { count: number; sizeIn: number } }> {
  const { attempt = 0, target, cached = [] } = options;
  const deadline = Date.now() + 45_000;
  const search = async (sizeIn: number) => {
    const shape = shapeAt(cuts, sizeIn);
    const placements = nest(shape.searchPoints, sheets, settings.gapMm, deadline, attempt);
    if (!placements.length) throw new Error("The cut outline does not fit on the selected sheets.");
    return renderLayout(
      source,
      shape,
      placements,
      { sizeIn, gapMm: settings.gapMm, sheets },
      store,
    );
  };
  const capacity =
    cached
      .filter(
        (layout) =>
          layout.sizeIn === settings.badgeSizeIn &&
          JSON.stringify(layout.sheetSizes) === JSON.stringify(sheets),
      )
      .sort((a, b) => b.count - a.count)[0] ?? (await search(settings.badgeSizeIn));
  let candidate = capacity;
  // Long designs have an organizer-owned size exception. Do not shrink them to a normal badge.
  const minimum =
    options.fixedSize || settings.badgeSizeIn > 2.2 ? settings.badgeSizeIn : MIN_BADGE_SIZE_IN;
  for (
    let sizeIn = Number((settings.badgeSizeIn - BADGE_SIZE_STEP_IN).toFixed(2));
    target !== undefined && candidate.count < target && sizeIn >= minimum;
    sizeIn = Number((sizeIn - BADGE_SIZE_STEP_IN).toFixed(2))
  ) {
    const found = await search(sizeIn);
    if (found.count > candidate.count) candidate = found;
  }
  if (target === undefined) return { layouts: [capacity] };
  if (candidate.count < target)
    return { layouts: [capacity], shortfall: { count: candidate.count, sizeIn: candidate.sizeIn } };
  const selected =
    target === candidate.count
      ? candidate
      : await renderLayout(
          source,
          shapeAt(cuts, candidate.sizeIn),
          selectPlacements(candidate, target),
          { sizeIn: candidate.sizeIn, gapMm: settings.gapMm, sheets: candidate.sheetSizes },
          store,
        );
  return { layouts: candidate.id === selected.id ? [candidate] : [candidate, selected] };
}

function selectPlacements(layout: Layout, target: number): Placement[] {
  const byColor = new Map<string, Placement[]>();
  for (const pose of layout.placements) {
    const color = layout.sheetSizes[pose.sheet]?.material?.materialId ?? "";
    const group = byColor.get(color) ?? [];
    group.push(pose);
    byColor.set(color, group);
  }
  // Share the target across selected colors, then fill from any remaining capacity.
  const selected: Placement[] = [];
  for (let index = 0; selected.length < target; index++)
    for (const group of byColor.values()) {
      const pose = group[index];
      if (pose && selected.length < target) selected.push(pose);
    }
  return selected;
}

async function renderLayout(
  source: string,
  shape: Shape,
  placements: Placement[],
  dimensions: { sizeIn: number; gapMm: number; sheets: CuttingSheet[] },
  store: Pick<BadgeStore, "putAsset">,
): Promise<Layout> {
  const { sizeIn, gapMm } = dimensions;
  audit(shape.points, placements, gapMm, dimensions.sheets);
  const used = [...new Set(placements.map((pose) => pose.sheet))].sort((a, b) => a - b);
  const sheetSizes = used.map((index) => {
    const sheet = dimensions.sheets[index];
    if (!sheet) throw new Error("Unknown cutting sheet.");
    return sheet;
  });
  const sheets = sheetSizes.map((size, position) =>
    sheetSvg(source, shape, placements, used[position] ?? -1, size),
  );
  const previewSheets = sheets.map((svg, index) => {
    const size = sheetSizes[index];
    if (!size) throw new Error("Unknown sheet.");
    return svg
      .replace(`width="${size.widthIn * 25.4}mm"`, `width="${size.widthIn * 25.4}"`)
      .replace(`height="${size.heightIn * 25.4}mm"`, `height="${size.heightIn * 25.4}"`);
  });
  const sheetHashes = await Promise.all(
    sheets.map((svg) => store.putAsset(Buffer.from(svg), "image/svg+xml")),
  );
  const preview = await store.putAsset(
    new Resvg(previewSvg(previewSheets, sheetSizes), {
      background: "white",
      fitTo: { mode: "width", value: 1200 },
      font: {
        loadSystemFonts: false,
        fontDirs: [join(process.cwd(), "src/server/fonts")],
        defaultFontFamily: "Lato",
      },
    })
      .render()
      .asPng(),
    "image/png",
  );
  return {
    id: hash(JSON.stringify({ sheetHashes, sheetSizes, sizeIn, count: placements.length })),
    sheets: sheetHashes,
    sheetSizes,
    preview,
    sizeIn,
    widthIn: shape.widthIn,
    heightIn: shape.heightIn,
    count: placements.length,
    placements: placements.map((pose) => ({ ...pose, sheet: used.indexOf(pose.sheet) })),
    audited: true,
  };
}

function previewSvg(svgs: string[], sizes: CuttingSheet[]): string {
  const columns = Math.min(2, sizes.length);
  const cellWidth = Math.max(...sizes.map((size) => size.widthIn * 25.4)) + 24;
  const cellHeight = Math.max(...sizes.map((size) => size.heightIn * 25.4)) + 58;
  const panels = sizes
    .map((size, index) => {
      const width = size.widthIn * 25.4,
        height = size.heightIn * 25.4;
      const x = (index % columns) * cellWidth + 12;
      const y = Math.floor(index / columns) * cellHeight + 46;
      return `<g transform="translate(${x} ${y})"><text y="-26" font-family="Lato" font-size="12">Sheet ${index + 1} · ${sheetLabel(size)} in</text><text y="-10" font-family="Lato" font-size="10">${size.material ? materialDescription(size.material) : ""}</text><rect width="${width}" height="${height}" fill="white" stroke="#888"/>${svgs[index]}</g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cellWidth * columns} ${cellHeight * Math.ceil(sizes.length / columns)}">${panels}</svg>`;
}

function exclusionRegions(
  points: Point[],
  angles: number[],
  gap: number,
  deadline: number,
): Map<string, Path> {
  const cache = new Map<number, Point[]>(),
    result = new Map<string, Path>();
  for (const a of angles)
    for (const b of angles) {
      const relative = (((b - a) % 360) + 360) % 360;
      let region = cache.get(relative);
      if (!region) {
        if (Date.now() > deadline) throw new Error("Packing reached its time budget.");
        const sums = Clipper.Clipper.MinkowskiSum(
          toPath(rotate(points, relative).map((p) => ({ x: -p.x, y: -p.y }))),
          toPath(points),
          true,
        );
        sums.sort((x, y) => Math.abs(Clipper.Clipper.Area(y)) - Math.abs(Clipper.Clipper.Area(x)));
        const outside = sums[0];
        if (!outside) throw new Error("Unable to construct clearance geometry.");
        region = offset(fromPath(outside), gap + 0.24);
        cache.set(relative, region);
      }
      const polygon = toPath(rotate(region, a));
      if (!Clipper.Clipper.Orientation(polygon)) polygon.reverse();
      result.set(`${a}:${b}`, polygon);
    }
  return result;
}
