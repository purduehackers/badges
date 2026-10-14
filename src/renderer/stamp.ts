import { canvas2d, readArtwork } from "./artwork.ts";

export interface StampOptions {
  ink: number;
  pressure: number;
  tilt: number;
  paper: "smooth" | "textured";
  seed: number;
}

export const DEFAULT_STAMP: StampOptions = {
  ink: 0.72,
  pressure: 0.72,
  tilt: 0,
  paper: "smooth",
  seed: 17,
};

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
function noise(x: number, y: number, seed: number) {
  function hash(a: number, b: number) {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 144269);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const top = hash(ix, iy) * (1 - sx) + hash(ix + 1, iy) * sx;
  const bottom = hash(ix, iy + 1) * (1 - sx) + hash(ix + 1, iy + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

/** An appearance model of ink transfer, not a calibrated rubber/contact solver. */
export async function createStamp(svg: string, paperImage?: HTMLImageElement) {
  const artwork = await readArtwork(svg);
  const points = artwork.shapes[0]!.getPoints(512);
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const cutWidth = Math.max(...points.map((point) => point.x)) - minX;
  const cutHeight = Math.max(...points.map((point) => point.y)) - minY;
  const mmPerUnit = 38.1 / Math.min(cutWidth, cutHeight);
  const widthMm = cutWidth * mmPerUnit,
    heightMm = cutHeight * mmPerUnit;
  const pixelsPerMm = 800 / (Math.max(widthMm, heightMm) + 12);
  const scale = mmPerUnit * pixelsPerMm;
  const margin = 6 * pixelsPerMm;
  const width = Math.ceil((widthMm + 12) * pixelsPerMm);
  const height = Math.ceil((heightMm + 12) * pixelsPerMm);
  const shape = canvas2d(width, height);
  shape.context.setTransform(scale, 0, 0, scale, margin - minX * scale, margin - minY * scale);
  shape.context.beginPath();
  for (const [index, point] of points.entries()) {
    if (index === 0) shape.context.moveTo(point.x, point.y);
    else shape.context.lineTo(point.x, point.y);
  }
  shape.context.closePath();
  shape.context.fill();
  const silhouette = shape.context.getImageData(0, 0, width, height).data;
  const removal = canvas2d(width, height);
  removal.context.setTransform(scale, 0, 0, scale, margin - minX * scale, margin - minY * scale);
  removal.context.drawImage(artwork.engraving, artwork.x, artwork.y, artwork.width, artwork.height);
  const engraving = removal.context.getImageData(0, 0, width, height).data;
  const retained = new Float32Array(width * height);
  for (let i = 0; i < retained.length; i++)
    retained[i] = (silhouette[i * 4 + 3]! / 255) * (1 - engraving[i * 4]! / 255);
  const paper = canvas2d(width, height);
  if (paperImage) {
    const tile = 80 * pixelsPerMm;
    for (let y = 0; y < height; y += tile)
      for (let x = 0; x < width; x += tile) paper.context.drawImage(paperImage, x, y, tile, tile);
  }
  const texture = paper.context.getImageData(0, 0, width, height).data;

  function render(settings: StampOptions = DEFAULT_STAMP) {
    const ink = clamp(settings.ink),
      pressure = clamp(settings.pressure);
    const tilt = Math.max(-1, Math.min(1, settings.tilt));
    if (![ink, pressure, tilt, settings.seed].every(Number.isFinite))
      throw new Error("Invalid stamp settings.");
    const roughness = settings.paper === "textured" ? 0.9 : 0.38;
    // More pressure and ink broaden the contact edge, measured in millimeters.
    const spread = Math.max(0, pressure - 0.45) * ink * 0.25 * pixelsPerMm;
    const radius = Math.ceil(spread);
    const result = canvas2d(width, height);
    const pixels = result.context.createImageData(width, height);
    let deposited = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x,
          p = i * 4;
        const mmX = x / pixelsPerMm,
          mmY = y / pixelsPerMm;
        const fiber = paperImage ? texture[p]! / 255 : noise(mmX * 9, mmY * 9, 5);
        const grain = noise(mmX * 12, mmY * 12, settings.seed);
        const patch = noise(mmX / 3, mmY / 3, settings.seed);
        const press = pressure * (1 + tilt * (x / width - 0.5)) - roughness * (1 - fiber) * 0.62;
        const contact =
          pressure === 0 ? 0 : clamp((press + (patch - 0.5) * 0.16 - (1 - grain) * 0.16) / 0.2);
        const wetting = clamp((ink - 0.2 + (patch - 0.5) * 0.3 + (grain - 0.5) * 0.5) / 0.32);
        const load = ink * clamp(0.6 + patch * 0.7 + (grain - 0.5) * (1 - ink));
        let mask = retained[i]!;
        if (radius && ink > 0) {
          let expanded = mask;
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              if (dx * dx + dy * dy > radius * radius) continue;
              const xx = x + dx,
                yy = y + dy;
              if (xx >= 0 && xx < width && yy >= 0 && yy < height)
                expanded = Math.max(expanded, retained[yy * width + xx]!);
            }
          }
          mask += (expanded - mask) * Math.min(1, spread) * (0.4 + fiber * 0.6);
        }
        const density = mask * wetting * (1 - Math.exp(-4.2 * load * contact));
        deposited += density;
        const paperShade = (fiber - 0.5) * (settings.paper === "textured" ? 15 : 7);
        const paperColor = [249 + paperShade, 247 + paperShade, 240 + paperShade];
        const inkColor = [26, 31, 43];
        for (let channel = 0; channel < 3; channel++)
          pixels.data[p + channel] =
            paperColor[channel]! * (1 - density * (1 - inkColor[channel]! / 255));
        pixels.data[p + 3] = 255;
      }
    }
    result.context.putImageData(pixels, 0, 0);
    return { canvas: result.canvas, coverage: deposited / retained.length };
  }
  return { render, widthMm, heightMm };
}
