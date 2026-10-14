import * as THREE from "three";
import { MATERIAL_TYPE_CONFIGS } from "../lib/materials.ts";
import { readArtwork } from "./artwork.ts";
import { badgeSurface, type SurfaceOptions } from "./surface.ts";
import type { RenderInput } from "./types.ts";

export async function createBadgeScene(input: RenderInput, options: SurfaceOptions = {}) {
  const { x, y, width, height, shapes, engraving } = await readArtwork(input.svg);
  const body = new THREE.ExtrudeGeometry(shapes, {
    depth: input.thicknessMm,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 2,
    curveSegments: 48,
  });
  const positions = body.getAttribute("position");
  const normals = body.getAttribute("normal");
  const uv = body.getAttribute("uv");
  for (let index = 0; index < positions.count; index++)
    uv.setXY(index, (positions.getX(index) - x) / width, 1 - (positions.getY(index) - y) / height);
  // Only the front cap is engraved. The back and laser-cut edge stay polished.
  body.clearGroups();
  for (let index = 0; index < positions.count; index += 3) {
    const front = normals.getZ(index) > 0.99 && positions.getZ(index) >= input.thicknessMm;
    const materialIndex = front ? 1 : 0;
    const previous = body.groups.at(-1);
    if (previous?.materialIndex === materialIndex) previous.count += 3;
    else body.addGroup(index, 3, materialIndex);
  }
  body.computeBoundingBox();
  const originalSize = body.boundingBox!.getSize(new THREE.Vector3());
  const scale = input.sizeIn ? (input.sizeIn * 25.4) / Math.max(originalSize.x, originalSize.y) : 1;
  body.scale(scale, scale, 1);
  body.computeBoundingBox();
  const center = body.boundingBox!.getCenter(new THREE.Vector3());
  body.translate(-center.x, -center.y, -center.z);
  const base = MATERIAL_TYPE_CONFIGS[input.material.type].physical;
  const material = new THREE.MeshPhysicalMaterial({
    ...base,
    color: input.material.color,
    transparent: false,
    opacity: 1,
    thickness: input.thicknessMm,
    ior: 1.49,
    envMapIntensity: 0.8,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const surface = badgeSurface(engraving, input.material, width * scale, height * scale, options);
  surface.material.thickness = input.thicknessMm;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f3f2ef");
  const badge = new THREE.Group();
  badge.add(new THREE.Mesh(body, [material, surface.material]));
  // Mirroring the group also reverses face winding.
  badge.scale.y = -1;
  badge.rotation.set(-0.16, -0.38, -0.08);
  scene.add(badge, new THREE.AmbientLight(0xffffff, 0.65));
  const light = new THREE.DirectionalLight(0xffffff, 1.4);
  light.position.set(-40, 60, 100);
  scene.add(light);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(640, 640, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const studio = new THREE.Scene();
  studio.background = new THREE.Color("#343434");
  function softbox(w: number, h: number, position: [number, number, number], intensity: number) {
    const box = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(intensity, intensity, intensity),
        side: THREE.DoubleSide,
      }),
    );
    box.position.set(...position);
    box.lookAt(0, 0, 0);
    studio.add(box);
    return box;
  }
  const boxes = [
    softbox(2.4, 12, [-4.8, 2.7, 6.8], 3),
    softbox(1.5, 6, [5, -1, 6], 0.8),
    softbox(7, 2, [0, 7, -2], 2),
  ];
  const generator = new THREE.PMREMGenerator(renderer);
  const lighting = generator.fromScene(studio, 0.025, 0.1, 100, { size: 256 });
  scene.environment = lighting.texture;
  generator.dispose();
  for (const box of boxes) {
    box.geometry.dispose();
    box.material.dispose();
  }
  const extent = new THREE.Box3().setFromObject(badge).getSize(new THREE.Vector3());
  const half = Math.max(extent.x, extent.y) * 0.64;
  const camera = new THREE.PerspectiveCamera(
    (2 * Math.atan(half / 200) * 180) / Math.PI,
    1,
    10,
    1000,
  );
  camera.position.z = 200;
  function dispose() {
    lighting.dispose();
    body.dispose();
    material.dispose();
    surface.dispose();
    renderer.dispose();
  }
  return { renderer, scene, camera, half, badge, dispose };
}
