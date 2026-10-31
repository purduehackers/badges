"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { stockMaterial } from "@/lib/materials";
import type { ProductionFile } from "@/lib/ruby-batch";
import { RUBY_BED, svgPhysicalSize, type BedPoint } from "@/lib/ruby-bed";
import { svgImage } from "./ruby-design-preview";

type Vector = [number, number, number];

export default function LaserPreview({
  file,
  origin,
}: {
  file?: ProductionFile;
  origin?: BedPoint;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const originX = origin?.x,
    originY = origin?.y;
  const size = file ? svgPhysicalSize(file.svg) : undefined;
  useEffect(() => {
    const target = viewport.current;
    if (!target) return;
    setError(false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#141518");
    const camera = new THREE.PerspectiveCamera(36, 16 / 9, 1, 10000);
    camera.position.set(1860, 1800, 2520);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute(
      "aria-label",
      "Speedy 400 flexx model with a 1016 by 610 millimeter bed and material at physical scale",
    );
    target.append(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, -80, 0);
    controls.enablePan = false;
    controls.minDistance = 1100;
    controls.maxDistance = 4200;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();
    const textures: THREE.Texture[] = [];
    function box(
      size: Vector,
      position: Vector,
      color: string,
      parent: THREE.Object3D = scene,
      radius = 0,
    ) {
      const geometry = radius
        ? new RoundedBoxGeometry(...size, 2, radius)
        : new THREE.BoxGeometry(...size);
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.52, metalness: 0.12 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }
    // Millimeter scale, based on Trotec's 8070 machine overview and technical drawing.
    // The enclosure is illustrative; the working area and SVG footprint use physical dimensions.
    box([1380, 710, 870], [0, -375, 0], "#25272b", scene, 16);
    box([1390, 105, 900], [0, -795, 0], "#191b20", scene, 10);
    for (const x of [-630, 630]) {
      box([166, 950, 940], [x, -350, 0], "#d9d9d7", scene, 16);
      box([150, 15, 900], [x, 125, 0], "#eeeeeb", scene, 5);
      box([26, 9, 670], [Math.sign(x) * 553, 14, 0], "#999c9e", scene, 2);
      for (const z of [-355, 355]) box([65, 50, 70], [x, -845, z], "#15171b", scene, 18);
    }
    box([1090, 330, 35], [0, -130, 422], "#b91e2c", scene, 12);
    box([1090, 14, 24], [0, 43, 408], "#761824", scene, 4);
    box([1090, 70, 35], [0, 76, -405], "#d1d2d2", scene, 7);
    box([1100, 130, 70], [0, 76, -450], "#dfdfdd", scene, 8);
    box([1096, 30, 698], [0, -22, 0], "#1c1e20");
    box([RUBY_BED.width, 10, RUBY_BED.height], [0, 0, 0], "#292c2e");
    const grid: number[] = [];
    for (let x = -RUBY_BED.width / 2; x <= RUBY_BED.width / 2; x += 25.4)
      grid.push(x, 5.2, -RUBY_BED.height / 2, x, 5.2, RUBY_BED.height / 2);
    for (let z = -RUBY_BED.height / 2; z <= RUBY_BED.height / 2; z += 25.4)
      grid.push(-RUBY_BED.width / 2, 5.2, z, RUBY_BED.width / 2, 5.2, z);
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(grid, 3));
    scene.add(
      new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: "#52565a" })),
    );
    // Side rails and carriage. Only a chosen simulator origin positions the pointer.
    for (const x of [-530, 530]) box([22, 24, 678], [x, 33, 0], "#383b3f", scene, 3);
    const headX = (originX ?? 50) - RUBY_BED.width / 2;
    const headZ = (originY ?? 35) - RUBY_BED.height / 2;
    box([1060, 40, 43], [0, 91, headZ - 25], "#b1b4b7", scene, 3);
    box([55, 40, 58], [headX, 80, headZ - 12], "#b6212e", scene, 5);
    box([34, 55, 34], [headX, 39, headZ], "#34373b", scene, 4);
    if (originX !== undefined) {
      const pointer = new THREE.Mesh(
        new THREE.CircleGeometry(4, 24),
        new THREE.MeshBasicMaterial({ color: "#ff3030" }),
      );
      pointer.rotation.x = -Math.PI / 2;
      pointer.position.set(headX, 10, headZ);
      scene.add(pointer);
    }
    // Right console: recessed display, physical keypad, and emergency stop.
    const consolePanel = box([108, 12, 260], [630, 140, 150], "#b4b7b9", scene, 6);
    consolePanel.rotation.x = 0.12;
    box([88, 9, 130], [630, 150, 150], "#22252a", scene, 5);
    box([70, 3, 106], [630, 156, 150], "#496d76", scene, 2);
    for (const x of [607, 630, 653])
      for (const z of [240, 262]) box([14, 7, 14], [x, 148, z], "#44484c", scene, 4);
    const stop = new THREE.Mesh(
      new THREE.CylinderGeometry(16, 16, 20, 24),
      new THREE.MeshStandardMaterial({ color: "#cf2430" }),
    );
    stop.position.set(630, 156, -8);
    scene.add(stop);
    box([43, 5, 43], [630, 144, -8], "#d8b72d", scene, 5);
    // Hinged blue acrylic lid with a solid black frame and front handle.
    const lid = new THREE.Group();
    lid.position.set(0, 150, -410);
    lid.rotation.x = -1.02;
    scene.add(lid);
    for (const x of [-554, 554]) box([26, 25, 800], [x, 0, 400], "#1b2025", lid, 4);
    for (const z of [12, 788]) box([1134, 25, 26], [0, 0, z], "#171b20", lid, 4);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(1080, 5, 748),
      new THREE.MeshPhysicalMaterial({
        color: "#578c9e",
        metalness: 0,
        roughness: 0.14,
        transparent: true,
        opacity: 0.34,
        transmission: 0.15,
        thickness: 5,
        side: THREE.DoubleSide,
      }),
    );
    glass.position.set(0, 0, 400);
    lid.add(glass);
    box([280, 22, 28], [0, 16, 755], "#15191d", lid, 8);
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 1024;
    labelCanvas.height = 128;
    const labelContext = labelCanvas.getContext("2d")!;
    labelContext.fillStyle = "#f1f1f1";
    labelContext.font = "italic bold 70px sans-serif";
    labelContext.fillText("trotec", 12, 88);
    labelContext.font = "38px sans-serif";
    labelContext.fillText("SPEEDY 400 FLEXX", 550, 80);
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    textures.push(labelTexture);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(920, 115),
      new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true }),
    );
    label.position.set(0, -130, 441);
    scene.add(label);
    const floor = box([4000, 10, 3500], [0, -877, 0], "#1d1f23");
    floor.material.roughness = 1;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x525967, 2.6));
    const key = new THREE.DirectionalLight(0xffffff, 3.3);
    key.position.set(-800, 2200, 1400);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, {
      left: -1800,
      right: 1800,
      top: 1800,
      bottom: -1800,
      near: 1,
      far: 6000,
    });
    key.shadow.bias = -0.0003;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xc4d6ee, 1.5);
    rim.position.set(1200, 600, -1000);
    scene.add(rim);
    const draw = () => renderer.render(scene, camera);
    let cancelled = false;
    const footprint = file ? svgPhysicalSize(file.svg) : undefined;
    if (file && footprint && (file.kind !== "stamp" || originX !== undefined)) {
      const image = new window.Image();
      image.src = svgImage(file.svg);
      void image
        .decode()
        .then(() => {
          if (cancelled) return;
          const { width, height } = footprint;
          const x = -RUBY_BED.width / 2 + (originX ?? 0) + width / 2;
          const z = -RUBY_BED.height / 2 + (originY ?? 0) + height / 2;
          const thickness = file.kind === "stamp" ? 2.3 : file.thicknessMm;
          const color =
            file.kind === "stamp"
              ? "#b3a797"
              : (stockMaterial(file.materialId ?? "")?.color ?? "#a2b4c6");
          box([width, thickness, height], [x, 6 + thickness / 2, z], color);
          const texture = new THREE.Texture(image);
          texture.needsUpdate = true;
          texture.colorSpace = THREE.SRGBColorSpace;
          textures.push(texture);
          const artwork = new THREE.Mesh(
            new THREE.PlaneGeometry(width, height),
            new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              side: THREE.DoubleSide,
            }),
          );
          artwork.rotation.x = -Math.PI / 2;
          artwork.position.set(x, 6.2 + thickness, z);
          scene.add(artwork);
          draw();
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    }
    controls.addEventListener("change", draw);
    const resize = new ResizeObserver(() => {
      const { width, height } = target.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      draw();
    });
    resize.observe(target);
    return () => {
      cancelled = true;
      resize.disconnect();
      controls.dispose();
      for (const texture of textures) texture.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            material.dispose();
        }
      });
      key.shadow.map?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [file, originX, originY]);
  return (
    <div className="ruby-laser-canvas" ref={viewport}>
      {error && <p>Laser preview unavailable. Your queue is still live.</p>}
      {!error && file && (
        <span className="ruby-material-scale">
          {!size
            ? "Physical size unavailable"
            : file.kind === "stamp" && !origin
              ? "Stamp position not set"
              : `${file.dimensions} · actual scale`}
        </span>
      )}
    </div>
  );
}
