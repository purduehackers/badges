import { isRedStroke } from "./color";

const MAX_TEXTURE_SIZE = 2048;

/**
 * Rasterize all non-CUT elements of the SVG to a canvas.
 *
 * Mirrors the Trotec laser's raster pass: rasterizes the design into a bitmap,
 * then inverts so it works as a THREE.js alphaMap:
 *   white = opaque (engraved / matte)
 *   black = transparent (unengraved / glossy body shows through)
 */
export async function rasterizeEngrave(
  svgUrl: string,
  viewBox: { width: number; height: number },
): Promise<HTMLCanvasElement> {
  const response = await fetch(svgUrl);
  const svgText = await response.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svgEl = doc.documentElement;

  // Strip red strokes (CUT lines) but keep fills for the raster pass.
  for (const el of Array.from(svgEl.querySelectorAll("*"))) {
    if (isRedStroke(el.getAttribute("stroke"))) {
      el.setAttribute("stroke", "none");
    }
  }

  const aspect = viewBox.width / viewBox.height;
  const w = aspect >= 1 ? MAX_TEXTURE_SIZE : Math.round(MAX_TEXTURE_SIZE * aspect);
  const h = aspect >= 1 ? Math.round(MAX_TEXTURE_SIZE / aspect) : MAX_TEXTURE_SIZE;

  svgEl.setAttribute("width", String(w));
  svgEl.setAttribute("height", String(h));

  // Render modified SVG to canvas via Image
  const blob = new Blob([new XMLSerializer().serializeToString(svgEl)], {
    type: "image/svg+xml;charset=utf-8",
  });
  const blobUrl = URL.createObjectURL(blob);

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to rasterize SVG"));
    img.src = blobUrl;
  });
  URL.revokeObjectURL(blobUrl);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  // Invert: alphaMap needs white=opaque (engrave) / black=transparent
  const imageData = ctx.getImageData(0, 0, w, h);
  const px = imageData.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 255 - px[i];
    px[i + 1] = 255 - px[i + 1];
    px[i + 2] = 255 - px[i + 2];
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}
