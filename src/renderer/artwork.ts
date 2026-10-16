import { SVGLoader } from "three/addons/loaders/SVGLoader.js";

export function canvas2d(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Cannot draw the preview.");
  return { canvas, context };
}

/** Black artwork becomes white in the engraving mask. The cut line never engraves. */
export async function readArtwork(svg: string) {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.importNode(parsed.documentElement, true);
  if (!(root instanceof SVGSVGElement)) throw new Error("Invalid SVG.");
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (
      ![
        "svg",
        "g",
        "path",
        "rect",
        "circle",
        "ellipse",
        "polygon",
        "polyline",
        "line",
        "title",
        "desc",
      ].includes(element.localName)
    )
      throw new Error("Export plain vector shapes to preview this design.");
    if (
      [...element.attributes].some(
        (attribute) =>
          /^on/iu.test(attribute.name) ||
          /href/iu.test(attribute.name) ||
          /url\s*\(/iu.test(attribute.value),
      )
    )
      throw new Error("Linked artwork is not supported.");
  }
  const originalStyle = root.getAttribute("style");
  root.style.position = "absolute";
  root.style.visibility = "hidden";
  document.body.append(root);
  try {
    const { x, y, width, height } = root.viewBox.baseVal;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
      throw new Error("The SVG needs a valid viewBox.");
    const cuts = [...root.querySelectorAll("path")].filter(
      (path) => getComputedStyle(path).stroke === "rgb(255, 0, 0)",
    );
    if (!cuts.length) throw new Error("Missing cut outline.");
    for (const [index, cut] of cuts.entries()) cut.id = `badge-preview-cut-${index}`;
    const ids = new Set(cuts.map((cut) => cut.id));
    const loaded = new SVGLoader().parse(new XMLSerializer().serializeToString(root)).paths;
    const shapes = loaded
      .filter((path) => ids.has(path.userData?.node.id))
      .flatMap((path) => SVGLoader.createShapes(path));
    if (!shapes.length) throw new Error("Cannot read cut outlines.");
    for (const cut of cuts) cut.remove();
    const imageRoot = root.cloneNode(true) as SVGSVGElement;
    if (originalStyle) imageRoot.setAttribute("style", originalStyle);
    else imageRoot.removeAttribute("style");
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(imageRoot))}`;
    await image.decode();
    const scale = 1600 / Math.max(width, height);
    const { canvas, context } = canvas2d(Math.ceil(width * scale), Math.ceil(height * scale));
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const shade = 255 - pixels.data[i]!;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade;
    }
    context.putImageData(pixels, 0, 0);
    return { x, y, width, height, shapes, engraving: canvas };
  } finally {
    root.remove();
  }
}
