import * as THREE from "three";
import { MATERIAL_TYPE_CONFIGS, type AcrylicMaterial } from "../lib/materials.ts";
import { getTextureGenerator } from "../lib/texture-generators.ts";
import { canvas2d } from "./artwork.ts";

export interface SurfaceOptions {
  /** A comparison control; normal previews always use matte engraving. */
  uniformGloss?: boolean;
  fingerprints?: HTMLImageElement;
  scratches?: HTMLImageElement;
}

function tiledPixels(
  image: HTMLImageElement | undefined,
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number,
) {
  if (!image) return undefined;
  const { canvas, context } = canvas2d(width, height);
  // Stable offsets avoid aligning every badge with the texture's corner.
  for (let y = -tileHeight * 0.63; y < height; y += tileHeight)
    for (let x = -tileWidth * 0.41; x < width; x += tileWidth)
      context.drawImage(image, x, y, tileWidth, tileHeight);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

export function badgeSurface(
  mask: HTMLCanvasElement,
  material: AcrylicMaterial,
  widthMm: number,
  heightMm: number,
  options: SurfaceOptions = {},
) {
  const { width, height } = mask;
  const context = mask.getContext("2d")!;
  const engraving = context.getImageData(0, 0, width, height).data;
  const base = MATERIAL_TYPE_CONFIGS[material.type].physical;
  const generated = getTextureGenerator(material.type)?.(material.color);
  const body = new THREE.Color(material.color)
    .convertLinearToSRGB()
    .toArray()
    .map((value) => value * 255);
  const etched = new THREE.Color(material.engraveColor)
    .convertLinearToSRGB()
    .toArray()
    .map((value) => value * 255);
  const colors = generated ? canvas2d(width, height) : undefined;
  colors?.context.drawImage(generated!.color, 0, 0, width, height);
  const colorPixels = colors?.context.getImageData(0, 0, width, height).data;
  const pearl = generated ? canvas2d(width, height) : undefined;
  pearl?.context.drawImage(generated!.roughness, 0, 0, width, height);
  const pearlPixels = pearl?.context.getImageData(0, 0, width, height).data;
  const smudges = tiledPixels(
    options.fingerprints,
    width,
    height,
    (width * 160) / widthMm,
    (height * 160) / heightMm,
  );
  const scratches = tiledPixels(
    options.scratches,
    width,
    height,
    (width * 60) / widthMm,
    (height * 60) / heightMm,
  );
  const color = new Uint8Array(width * height * 4);
  const rough = new Uint8Array(color.length);
  const coating = new Uint8Array(color.length);
  const normals = new Uint8Array(color.length);
  for (let i = 0; i < color.length; i += 4) {
    const e = engraving[i]! / 255;
    const surface = options.uniformGloss ? 0 : e;
    const grain = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const smudge = (smudges?.[i] ?? 0) / 255;
    const polished = (base.roughness * (pearlPixels?.[i] ?? 255)) / 255 + 0.16 * smudge;
    const r = polished * (1 - surface) + (0.88 + 0.04 * grain) * surface;
    for (let channel = 0; channel < 3; channel++) {
      const bodyChannel = colorPixels?.[i + channel] ?? body[channel]!;
      color[i + channel] = Math.round(bodyChannel * (1 - e) + etched[channel]! * e);
      rough[i + channel] = Math.round(r * 255);
      coating[i + channel] = Math.round((1 - surface) * 255);
    }
    // Transmission reads red; roughness reads green. Engraving blocks transmission in every comparison.
    rough[i] = Math.round((1 - e) * 255);
    // The normal map only perturbs reflections. It never paints scratches onto the artwork.
    normals[i] = 128 + ((scratches?.[i] ?? 128) - 128) * 0.18 * (1 - surface) + grain * 8 * surface;
    normals[i + 1] =
      128 + ((scratches?.[i + 1] ?? 128) - 128) * 0.18 * (1 - surface) - grain * 8 * surface;
    normals[i + 2] = 255;
    color[i + 3] = rough[i + 3] = coating[i + 3] = normals[i + 3] = 255;
  }
  function texture(data: Uint8Array, colorSpace: THREE.ColorSpace = THREE.NoColorSpace) {
    const result = new THREE.DataTexture(data, width, height);
    result.colorSpace = colorSpace;
    result.flipY = true;
    result.generateMipmaps = true;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.magFilter = THREE.LinearFilter;
    result.needsUpdate = true;
    return result;
  }
  const map = texture(color, THREE.SRGBColorSpace);
  const roughnessMap = texture(rough);
  const clearcoatMap = texture(coating);
  const normalMap = texture(normals);
  const face = new THREE.MeshPhysicalMaterial({
    ...base,
    color: "white",
    map,
    roughness: 1,
    roughnessMap,
    clearcoatMap,
    normalMap,
    clearcoatNormalMap: normalMap,
    clearcoatRoughness: 1,
    clearcoatRoughnessMap: roughnessMap,
    transparent: false,
    opacity: 1,
    metalness: 0,
    ior: 1.49,
    transmissionMap: roughnessMap,
    thickness: 3.175,
    envMapIntensity: 0.8,
    side: THREE.DoubleSide,
  });
  return {
    material: face,
    dispose() {
      face.dispose();
      map.dispose();
      roughnessMap.dispose();
      clearcoatMap.dispose();
      normalMap.dispose();
    },
  };
}
