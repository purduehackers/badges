import { MATERIAL_TYPE_CONFIGS } from "../lib/materials.ts";
import { getTextureGenerator } from "../lib/texture-generators.ts";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";

import type { RenderInput } from "./types.ts";

function isCut(element: Element): boolean {
  return getComputedStyle(element).stroke === "rgb(255, 0, 0)";
}

async function engraving(root: SVGSVGElement, width: number, height: number) {
  for (const path of root.querySelectorAll("path")) if (isCut(path)) path.remove();
  root.removeAttribute("style");
  const source = new XMLSerializer().serializeToString(root);
  const artwork = new Image();
  artwork.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  await artwork.decode();
  const canvas = document.createElement("canvas");
  const scale = 1600 / Math.max(width, height);
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot draw engraving.");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(artwork, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const shade = 255 - (pixels.data[offset] ?? 0);
    pixels.data[offset] = shade;
    pixels.data[offset + 1] = shade;
    pixels.data[offset + 2] = shade;
  }
  context.putImageData(pixels, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

async function readArtwork(svg: string) {
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
  root.style.position = "absolute";
  root.style.visibility = "hidden";
  document.body.append(root);
  try {
    const { x, y, width, height } = root.viewBox.baseVal;
    const cut = [...root.querySelectorAll("path")].find(isCut);
    if (!cut) throw new Error("Missing cut outline.");
    const cutId = "badge-preview-cut";
    cut.id = cutId;
    const loaded = new SVGLoader().parse(new XMLSerializer().serializeToString(root)).paths;
    const outline = loaded.find((path) => path.userData?.node.id === cutId);
    if (!outline) throw new Error("Cannot read cut outline.");
    const shapes = SVGLoader.createShapes(outline);
    if (shapes.length !== 1) throw new Error("Expected one exterior outline.");
    const texture = await engraving(root, width, height);

    return { x, y, width, height, shapes, texture };
  } finally {
    root.remove();
  }
}

export async function createBadgeScene(input: RenderInput) {
  const { x, y, width, height, shapes, texture } = await readArtwork(input.svg);
  const body = new THREE.ExtrudeGeometry(shapes, {
    depth: input.thicknessMm,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 2,
    curveSegments: 48,
  });
  const front = new THREE.ShapeGeometry(shapes, 48);
  const position = front.getAttribute("position");
  const uv = front.getAttribute("uv");
  for (let index = 0; index < position.count; index++)
    uv.setXY(index, (position.getX(index) - x) / width, 1 - (position.getY(index) - y) / height);
  const bodyUv = body.getAttribute("uv");
  for (let index = 0; index < bodyUv.count; index++)
    bodyUv.setXY(index, (bodyUv.getX(index) - x) / width, 1 - (bodyUv.getY(index) - y) / height);
  if (input.sizeIn) {
    front.computeBoundingBox();
    const size = front.boundingBox?.getSize(new THREE.Vector3());
    if (!size) throw new Error("Cannot measure badge.");
    const scale = (input.sizeIn * 25.4) / Math.max(size.x, size.y);
    body.scale(scale, scale, 1);
    front.scale(scale, scale, 1);
  }
  body.computeBoundingBox();
  const bounds = body.boundingBox;
  if (!bounds) throw new Error("Cannot measure badge.");
  const center = bounds.getCenter(new THREE.Vector3());
  body.translate(-center.x, -center.y, -center.z);
  front.translate(-center.x, -center.y, input.thicknessMm - center.z + 0.06);
  const generated = getTextureGenerator(input.material.type)?.(input.material.color);
  const colorMap = generated ? new THREE.CanvasTexture(generated.color) : undefined;
  const roughnessMap = generated ? new THREE.CanvasTexture(generated.roughness) : undefined;
  if (colorMap) colorMap.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshPhysicalMaterial({
    ...MATERIAL_TYPE_CONFIGS[input.material.type].physical,
    color: colorMap ? "#ffffff" : input.material.color,
    map: colorMap,
    roughnessMap,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const marks = new THREE.MeshPhysicalMaterial({
    color: input.material.engraveColor,
    alphaMap: texture,
    roughness: 0.85,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f3f3f3");
  const badge = new THREE.Group();
  badge.add(new THREE.Mesh(body, material), new THREE.Mesh(front, marks));
  // Mirror the group, not vertex data, so Three also reverses face winding.
  badge.scale.y = -1;
  badge.rotation.set(-0.16, -0.38, -0.08);
  scene.add(badge, new THREE.AmbientLight(0xffffff, 0.7));
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(-40, 60, 100);
  scene.add(light);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(640, 640);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const environment = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  const lighting = generator.fromScene(environment, 0, 0.1, 100, { size: 64 });
  scene.environment = lighting.texture;
  const extent = new THREE.Box3().setFromObject(badge).getSize(new THREE.Vector3());
  const half = Math.max(extent.x, extent.y) * 0.62;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 1000);
  camera.position.z = 200;
  function dispose() {
    lighting.dispose();
    generator.dispose();
    environment.dispose();
    body.dispose();
    front.dispose();
    material.dispose();
    marks.dispose();
    texture.dispose();
    colorMap?.dispose();
    roughnessMap?.dispose();
    renderer.dispose();
  }
  return { renderer, scene, camera, half, dispose };
}
