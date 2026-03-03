import type { MaterialType } from "./materials";

export interface GeneratedTextures {
  color: HTMLCanvasElement;
  roughness: HTMLCanvasElement;
}

export type TextureGenerator = (color: string) => GeneratedTextures;

// ── Registry ─────────────────────────────────────────────────────
// To add texture generation for a new material type, add an entry here.

const generators: Partial<Record<MaterialType, TextureGenerator>> = {
  pearlescent: generatePearlescentTexture,
};

export function getTextureGenerator(type: MaterialType): TextureGenerator | undefined {
  return generators[type];
}

// ── Pearlescent ──────────────────────────────────────────────────

const SIZE = 512;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function generatePearlescentTexture(hexColor: string): GeneratedTextures {
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = SIZE;
  colorCanvas.height = SIZE;
  const colorCtx = colorCanvas.getContext("2d")!;
  const colorData = colorCtx.createImageData(SIZE, SIZE);
  const colorPx = colorData.data;

  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = SIZE;
  roughCanvas.height = SIZE;
  const roughCtx = roughCanvas.getContext("2d")!;
  const roughData = roughCtx.createImageData(SIZE, SIZE);
  const roughPx = roughData.data;

  const [baseR, baseG, baseB] = hexToRgb(hexColor);
  const [baseH, baseS, baseL] = rgbToHsl(baseR, baseG, baseB);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const nx = x / SIZE;
      const ny = y / SIZE;

      // Light warp so stripes aren't perfectly straight
      const wx = nx + 0.03 * Math.sin(ny * 6.0 + 1.4) + 0.015 * Math.sin(ny * 13.0 + 3.7);
      const wy = ny + 0.01 * Math.sin(nx * 4.0 + 0.8);

      // Directional stripe pattern — heavily weighted toward one axis
      // Dominant horizontal bands with slight diagonal lean
      let stripe = 0;
      stripe += 0.45 * Math.sin(wy * 18.0 + wx * 1.5 + 0.8);
      stripe += 0.30 * Math.sin(wy * 35.0 - wx * 2.0 + 2.5);
      stripe += 0.15 * Math.sin(wy * 60.0 + wx * 3.0 + 4.1);
      stripe += 0.10 * Math.sin(wy * 90.0 - wx * 1.0 + 1.0);

      // Normalize to [0, 1]
      const t = stripe * 0.5 + 0.5;

      // Subtle color variation along stripes
      const hShift = (t - 0.5) * (10 / 360);
      const lShift = (t - 0.5) * 0.35;
      const sShift = (0.5 - t) * 0.1;

      const h = (baseH + hShift + 1) % 1;
      const s = Math.max(0, Math.min(1, baseS + sShift));
      const l = Math.max(0, Math.min(1, baseL + lShift));

      const [r, g, b] = hslToRgb(h, s, l);

      const idx = (y * SIZE + x) * 4;
      colorPx[idx] = r;
      colorPx[idx + 1] = g;
      colorPx[idx + 2] = b;
      colorPx[idx + 3] = 255;

      // Roughness map: stripe peaks are shinier, valleys are matte
      const roughVal = Math.round((0.50 - t * 0.30) * 255);
      roughPx[idx] = roughVal;
      roughPx[idx + 1] = roughVal;
      roughPx[idx + 2] = roughVal;
      roughPx[idx + 3] = 255;
    }
  }

  colorCtx.putImageData(colorData, 0, 0);
  roughCtx.putImageData(roughData, 0, 0);
  return { color: colorCanvas, roughness: roughCanvas };
}
