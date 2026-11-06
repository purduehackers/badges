import { Resvg } from "@resvg/resvg-js";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Element } from "@xmldom/xmldom";
import svgpath from "svgpath";

import { checkIds, hash } from "./contracts.ts";
import type { Check } from "./contracts.ts";

const namespace = "http://www.w3.org/2000/svg";
const drawable = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
  "text",
  "image",
]);
const supported = new Set(["svg", "g", "defs", "metadata", "title", "desc", ...drawable]);
const properties = [
  "fill",
  "stroke",
  "stroke-width",
  "fill-opacity",
  "stroke-opacity",
  "visibility",
];
const allowedAttributes = new Set([
  "xmlns",
  "id",
  "version",
  "width",
  "height",
  "viewBox",
  "preserveAspectRatio",
  "transform",
  "style",
  "opacity",
  "display",
  "fill-rule",
  "clip-rule",
  "clip-path",
  "mask",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "points",
  ...properties,
]);
const allowedStyles = new Set([
  ...properties,
  "opacity",
  "display",
  "fill-rule",
  "clip-rule",
  "clip-path",
  "mask",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
]);

export function parseSvg(input: string) {
  const source = input.replace(/^\s*<\?xml\s[^?]*\?>/u, "");
  if (/<!DOCTYPE|<!ENTITY|<\?/iu.test(source)) {
    throw new Error("Export a plain SVG without XML directives or entities.");
  }
  const document = new DOMParser({
    onError: (level, detail) => {
      throw new Error(`Invalid SVG (${level}): ${detail.slice(0, 200)}`);
    },
  }).parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (!root || root.localName !== "svg" || root.namespaceURI !== namespace)
    throw new Error("Expected an SVG document.");
  validateViewport(root);
  const elements = [root, ...Array.from(root.getElementsByTagName("*"))];
  if (elements.length > 5000)
    throw new Error("SVG has too many elements. Simplify it before uploading.");
  for (const node of elements) {
    if (node.localName === "image") throw new Error("SVG contains an embedded image element.");
    if (["script", "foreignObject", "use", "style"].includes(node.localName ?? "")) {
      throw new Error(
        "Only self-contained vector SVGs are accepted. Remove images, linked objects, scripts, and stylesheets.",
      );
    }
    if (node.namespaceURI !== namespace) {
      node.parentNode?.removeChild(node);
      continue;
    }
    let depth = 0,
      parent = node.parentNode;
    while (parent) {
      depth += 1;
      if (depth > 64) throw new Error("SVG nesting exceeds the supported depth.");
      parent = parent.parentNode;
    }
    for (const attribute of Array.from(node.attributes)) {
      if (["clip-path", "mask"].includes(attribute.name) && localReference(attribute.value))
        continue;
      if (
        /^on|href$/iu.test(attribute.name) ||
        /url\s*\(|@import|expression\s*\(/iu.test(attribute.value)
      ) {
        throw new Error("SVG contains an external reference or executable content.");
      }
    }
  }
  return { root, elements };
}

function localReference(value: string): string | undefined {
  return /^url\(\s*["']?#([\w.-]+)["']?\s*\)$/u.exec(value)?.[1];
}

/** Figma's solid white vector masks affect engraving, never cutting geometry. */
function vectorMask(element: Element, reference: string): boolean {
  const id = localReference(reference);
  const masks = Array.from(element.ownerDocument?.getElementsByTagName("mask") ?? []).filter(
    (mask) => mask.getAttribute("id") === id,
  );
  const mask = masks[0],
    path = mask?.children[0];
  return Boolean(
    id &&
    masks.length === 1 &&
    mask?.children.length === 1 &&
    path?.localName === "path" &&
    !path.children.length &&
    color(path.getAttribute("fill") ?? "") === "#ffffff" &&
    Array.from(path.attributes).every((attribute) =>
      ["d", "fill", "fill-rule", "clip-rule"].includes(attribute.name),
    ) &&
    Array.from(mask.attributes).every((attribute) =>
      ["id", "style", "maskUnits", "x", "y", "width", "height"].includes(attribute.name),
    ) &&
    /^(?:mask-type\s*:\s*(?:luminance|alpha)\s*;?)?$/u.test(
      (mask.getAttribute("style") ?? "").trim(),
    ) &&
    ["", "userSpaceOnUse", "objectBoundingBox"].includes(mask.getAttribute("maskUnits") ?? ""),
  );
}

/** Keep export-frame clipping, but do not certify contours that it would crop. */
function containsArtwork(element: Element, reference: string): boolean {
  const id = localReference(reference);
  const clips = Array.from(element.ownerDocument?.getElementsByTagName("clipPath") ?? []).filter(
    (clip) => clip.getAttribute("id") === id,
  );
  const clip = clips[0],
    rect = clip?.children[0];
  if (
    !id ||
    clips.length !== 1 ||
    clip?.children.length !== 1 ||
    rect?.localName !== "rect" ||
    Array.from(clip.attributes).some(
      (attribute) => !["id", "clipPathUnits"].includes(attribute.name),
    ) ||
    !["", "userSpaceOnUse"].includes(clip.getAttribute("clipPathUnits") ?? "") ||
    Array.from(rect.attributes).some(
      (attribute) => !["x", "y", "width", "height", "fill"].includes(attribute.name),
    )
  )
    return false;
  const x = Number(rect.getAttribute("x") ?? 0),
    y = Number(rect.getAttribute("y") ?? 0),
    width = Number(rect.getAttribute("width")),
    height = Number(rect.getAttribute("height"));
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return false;
  const drawing = element.cloneNode(true) as Element;
  drawing.removeAttribute("transform");
  for (const node of [drawing, ...Array.from(drawing.getElementsByTagName("*"))]) {
    node.removeAttribute("clip-path");
    // Cutting follows the path centerline, not the displayed stroke's width.
    if (drawable.has(node.localName ?? "")) {
      node.setAttribute("stroke", "none");
      node.setAttribute("fill", "black");
      node.setAttribute(
        "style",
        [node.getAttribute("style"), "stroke:none", "fill:black"].filter(Boolean).join(";"),
      );
    }
  }
  const source = new XMLSerializer().serializeToString(drawing);
  const box = new Resvg(`<svg xmlns="${namespace}" width="1" height="1">${source}</svg>`, {
    font: { loadSystemFonts: false },
  }).getBBox();
  return Boolean(
    box &&
    box.x >= x &&
    box.y >= y &&
    box.x + box.width <= x + width &&
    box.y + box.height <= y + height,
  );
}

function color(value: string): string | undefined {
  const named: Record<string, string> = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    gray: "#808080",
    grey: "#808080",
  };
  const lower = value.toLowerCase();
  if (named[lower]) return named[lower];
  if (/^#[a-f\d]{6}$/u.test(lower)) return lower;
  if (/^#[a-f\d]{3}$/u.test(lower))
    return `#${lower
      .slice(1)
      .split("")
      .map((digit) => digit + digit)
      .join("")}`;
  return undefined;
}

function localStyle(element: Element): Map<string, string> {
  const style = new Map(
    Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]),
  );
  for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon > 0)
      style.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
  }
  return style;
}

export interface SvgFacts {
  checks: Check[];
  source: string;
  cuts: string[];
}

interface Observations {
  unknown: Set<string>;
  palette: Set<string>;
  text: number;
  cuts: string[];
  filledCuts: boolean;
  invalidCuts: boolean;
  unsupportedCuts: boolean;
}

function observe(
  element: Element,
  inherited: Map<string, string>,
  ancestorTransform: string,
  observations: Observations,
  masked = false,
): void {
  const tag = element.localName ?? "";
  if (tag === "mask") return;
  if (tag === "defs") {
    if (
      Array.from(element.children).some(
        (child) => !["clipPath", "mask"].includes(child.localName ?? ""),
      )
    )
      observations.unknown.add("artwork in defs");
    return;
  }
  const local = localStyle(element);
  const mask = local.get("mask");
  if (mask && mask !== "none") {
    masked = true;
    if (!vectorMask(element, mask)) observations.unknown.add("unsupported vector mask");
  }
  const clip = local.get("clip-path");
  if (clip && clip !== "none" && !containsArtwork(element, clip))
    observations.unknown.add("clipping that changes the artwork geometry");
  const style = new Map(inherited);
  for (const property of properties) {
    const value = local.get(property);
    if (value !== undefined && value !== "inherit") style.set(property, value);
  }
  inspectVisibility(element, local, observations);
  for (const attribute of Array.from(element.attributes)) {
    if (
      !allowedAttributes.has(attribute.name) &&
      !attribute.name.startsWith("data-") &&
      !attribute.namespaceURI
    )
      observations.unknown.add(attribute.name);
  }
  for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
    const name = declaration.split(":")[0]?.trim();
    if (name && !allowedStyles.has(name)) observations.unknown.add(name);
  }
  if (!supported.has(tag) || (tag === "svg" && element.parentNode?.nodeType === 1))
    observations.unknown.add(tag);
  const transform = `${ancestorTransform} ${element.getAttribute("transform") ?? ""}`.trim();
  if (drawable.has(tag)) {
    if (masked && color(style.get("stroke") ?? "none") === "#ff0000")
      observations.unsupportedCuts = true;
    observePaint(element, style, transform, observations);
  }
  for (const child of Array.from(element.children))
    observe(child, style, transform, observations, masked);
}

/** SVG primitives are equivalent closed cutting contours, not unsupported effects. */
function cuttingPath(element: Element): string | undefined {
  const number = (name: string, fallback = 0) => {
    const value = element.getAttribute(name);
    return value === null || value === ""
      ? fallback
      : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(value)
        ? Number(value)
        : NaN;
  };
  if (element.localName === "path") return element.getAttribute("d") ?? "";
  if (element.localName === "polygon") {
    const points = (element.getAttribute("points") ?? "")
      .trim()
      .split(/[\s,]+/u)
      .map(Number);
    return points.length >= 6 && points.length % 2 === 0 && points.every(Number.isFinite)
      ? `M${points.join(" ")}Z`
      : undefined;
  }
  if (["circle", "ellipse"].includes(element.localName ?? "")) {
    const x = number("cx"),
      y = number("cy");
    const rx = number(element.localName === "circle" ? "r" : "rx"),
      ry = element.localName === "circle" ? rx : number("ry");
    if (![x, y, rx, ry].every(Number.isFinite) || rx <= 0 || ry <= 0) return;
    return `M${x - rx} ${y}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
  }
  if (element.localName !== "rect") return;
  const x = number("x"),
    y = number("y"),
    w = number("width"),
    h = number("height");
  const rx = Math.min(number("rx", number("ry")), w / 2),
    ry = Math.min(number("ry", number("rx")), h / 2);
  if (![x, y, w, h, rx, ry].every(Number.isFinite) || w <= 0 || h <= 0 || rx < 0 || ry < 0) return;
  if (!rx || !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  return `M${x + rx} ${y}H${x + w - rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}V${y + h - ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}H${x + rx}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}V${y + ry}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`;
}

function observePaint(
  element: Element,
  style: Map<string, string>,
  transform: string,
  observations: Observations,
): void {
  const tag = element.localName;
  if (tag === "text") observations.text += 1;
  const fill = style.get("fill") ?? "#000000";
  const stroke = style.get("stroke") ?? "none";
  if (color(fill) === "#ff0000") observations.filledCuts = true;
  for (const paint of [fill, stroke]) {
    if (paint === "none") continue;
    const hex = color(paint);
    if (hex === undefined) observations.unknown.add(`paint ${paint}`);
    else observations.palette.add(hex);
  }
  if (color(stroke) !== "#ff0000") return;
  const path = cuttingPath(element);
  if (path === undefined) {
    observations.unsupportedCuts = true;
    return;
  }
  const parsed = svgpath(path);
  if (("err" in parsed && parsed.err !== "") || !path.trim()) {
    observations.invalidCuts = true;
    return;
  }
  // Split compound paths for measurement; retain the original SVG for cutting.
  const paths = parsed.transform(transform).abs().unshort().unarc().toString().split(/(?=M)/u);
  for (const contour of paths.filter(Boolean)) {
    if (!/[zZ]\s*$/u.test(contour)) observations.invalidCuts = true;
    else observations.cuts.push(contour);
  }
}

function checkCut(observation: Observations): Pick<Check, "status" | "detail"> {
  if (observation.invalidCuts)
    return { status: "fail", detail: "Close each red cutting outline and repair invalid paths." };
  if (observation.unsupportedCuts)
    return {
      status: "unknown",
      detail: "I can’t verify this type of cutting shape yet. Ask an organizer to check it.",
    };
  if (!observation.cuts.length)
    return { status: "fail", detail: "Add a closed red cutting outline." };
  try {
    for (const cut of observation.cuts) {
      const box = new Resvg(
        `<svg xmlns="${namespace}" width="1" height="1"><path d="${cut}"/></svg>`,
        { font: { loadSystemFonts: false } },
      ).getBBox();
      if (!box || box.width <= 0 || box.height <= 0)
        return { status: "fail", detail: "The cutting outline must enclose an area." };
    }
    return {
      status: "pass",
      detail: "Closed red cutting outlines. Multiple pieces and crossing paths are preserved.",
    };
  } catch {
    return {
      status: "unknown",
      detail: "I couldn’t measure these cutting outlines. Ask an organizer to check them.",
    };
  }
}

export function inspectSvg(source: string, role: "badge" | "stamp"): SvgFacts {
  const { root } = parseSvg(source);
  const observation: Observations = {
    unknown: new Set(),
    palette: new Set(),
    text: 0,
    cuts: [],
    filledCuts: false,
    invalidCuts: false,
    unsupportedCuts: false,
  };
  observe(root, new Map(), "", observation);
  const disallowed = [...observation.palette].filter(
    (value) =>
      value !== "#ff0000" &&
      (role === "stamp"
        ? !["#000000", "#ffffff"].includes(value)
        : !(value.slice(1, 3) === value.slice(3, 5) && value.slice(3, 5) === value.slice(5, 7))),
  );
  const statuses: Record<Check["id"], { status: Check["status"]; detail: string }> = {
    supported: {
      status: observation.unknown.size ? "unknown" : "pass",
      detail: observation.unknown.size
        ? `Re-export plain paths. Unsupported SVG features: ${[...observation.unknown].join(", ").slice(0, 2400)}`
        : "Plain vector geometry and supported inherited paints.",
    },
    palette: {
      status: disallowed.length ? "fail" : "pass",
      detail: disallowed.length
        ? `Replace these colors: ${disallowed.join(", ")}.`
        : role === "badge"
          ? "Grayscale engraving and exact red cut lines."
          : "Black/white engraving and exact red cut lines.",
    },
    vectors: { status: "pass", detail: "No raster or external content." },
    text: {
      status: observation.text ? "fail" : "pass",
      detail: observation.text ? "Convert all text to vector outlines." : "No live text elements.",
    },
    fills: {
      status: observation.filledCuts ? "fail" : "pass",
      detail: observation.filledCuts
        ? "Remove red fills from artwork. Use red strokes for cutting."
        : "No red-filled artwork. Cutting paths may also have grayscale fills.",
    },
    cut: checkCut(observation),
  };
  return {
    checks: checkIds.map((id) => ({ id, role, ...statuses[id], evidenceId: hash(source) })),
    source: new XMLSerializer().serializeToString(root),
    cuts: observation.cuts,
  };
}

export function renderSvg(source: string): Uint8Array {
  const { root } = parseSvg(source);
  const box = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/u).map(Number);
  const mode = (box[2] ?? 1) >= (box[3] ?? 1) ? "width" : "height";
  return new Resvg(source, {
    background: "white",
    fitTo: { mode, value: 1024 },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
}

function validateViewport(root: Element): void {
  const viewport = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  const [, , width, height] = viewport;
  if (
    viewport.length !== 4 ||
    !viewport.every(Number.isFinite) ||
    !width ||
    !height ||
    width <= 0 ||
    height <= 0 ||
    width / height > 100 ||
    height / width > 100
  )
    throw new Error("Use a finite viewBox with a sensible aspect ratio (under 100:1).");
}

function inspectVisibility(
  element: Element,
  local: Map<string, string>,
  observations: Observations,
): void {
  // Invisible or reusable artwork cannot establish visible manufacturing evidence.
  for (const key of ["opacity", "fill-opacity", "stroke-opacity"]) {
    const value = local.get(key);
    if (value !== undefined && !["1", "100%", "inherit"].includes(value))
      observations.unknown.add(`non-opaque ${key}`);
  }
  if (
    ["none", "hidden", "collapse"].includes(local.get("display") ?? local.get("visibility") ?? "")
  )
    observations.unknown.add("hidden artwork");
}
