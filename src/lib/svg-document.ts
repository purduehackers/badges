import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Element } from "@xmldom/xmldom";

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export function parseSvg(input: string, allowReuse = false) {
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
  if (!root || root.localName !== "svg" || root.namespaceURI !== SVG_NAMESPACE)
    throw new Error("Expected an SVG document.");
  validateViewport(root);
  const elements = [root, ...Array.from(root.getElementsByTagName("*"))];
  if (elements.length > 5000)
    throw new Error("SVG has too many elements. Simplify it before uploading.");
  for (const node of elements) {
    if (node.localName === "image") throw new Error("SVG contains an embedded image element.");
    if (
      ["script", "foreignObject", "style"].includes(node.localName ?? "") ||
      (node.localName === "use" && !allowReuse)
    ) {
      throw new Error(
        "Only self-contained vector SVGs are accepted. Remove images, linked objects, scripts, and stylesheets.",
      );
    }
    if (node.namespaceURI !== SVG_NAMESPACE) {
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
      if (
        allowReuse &&
        node.localName === "use" &&
        /^(?:xlink:)?href$/u.test(attribute.name) &&
        /^#[\w.-]+$/u.test(attribute.value)
      )
        continue;
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

export function localReference(value: string): string | undefined {
  return /^url\(\s*["']?#([\w.-]+)["']?\s*\)$/u.exec(value)?.[1];
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

/** Preserve root paint/transform attributes when embedding an SVG without its viewport. */
export function svgGroup(source: string, id?: string): string {
  const { root } = parseSvg(source);
  const document = root.ownerDocument;
  if (!document) throw new Error("Missing SVG document.");
  const group = document.createElementNS(SVG_NAMESPACE, "g");
  for (const attribute of Array.from(root.attributes))
    if (!["xmlns", "viewBox", "width", "height"].includes(attribute.name))
      group.setAttribute(attribute.name, attribute.value);
  if (id) group.setAttribute("id", id);
  for (const child of Array.from(root.childNodes)) group.appendChild(child.cloneNode(true));
  return new XMLSerializer().serializeToString(group);
}

export function mirrorSvg(source: string): string {
  const { root } = parseSvg(source, true);
  const [x, , width] = root
    .getAttribute("viewBox")!
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  const group = root.ownerDocument!.createElementNS(SVG_NAMESPACE, "g");
  group.setAttribute("transform", `translate(${x * 2 + width} 0) scale(-1 1)`);
  while (root.firstChild) group.appendChild(root.firstChild);
  root.appendChild(group);
  return new XMLSerializer().serializeToString(root);
}
