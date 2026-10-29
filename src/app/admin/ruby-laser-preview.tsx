"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { stockMaterial } from "@/lib/materials";
import type { ProductionFile } from "@/lib/ruby-batch";
import { svgImage } from "./ruby-design-preview";

export default function LaserPreview({ file }: { file?: ProductionFile }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const target = viewport.current;
    if (!target) return;
    setError(false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#101113");
    const camera = new THREE.PerspectiveCamera(34, 16 / 9, 1, 1000);
    camera.position.set(118, 125, 180);
    camera.lookAt(0, 20, 0);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive schematic of the Speedy 400 laser and selected cutting sheet",
    );
    target.append(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 20, 0);
    controls.enablePan = false;
    controls.minDistance = 130;
    controls.maxDistance = 280;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.update();
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    function box(size: number[], position: number[], color: string, roughness = 0.55) {
      const geometry = new THREE.BoxGeometry(...(size as [number, number, number]));
      const material = new THREE.MeshStandardMaterial({ color, roughness });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...(position as [number, number, number]));
      scene.add(mesh);
      materials.push(material);
      geometries.push(geometry);
      return mesh;
    }
    // Schematic enclosure; positions are illustrative, never machine telemetry.
    box([112, 15, 78], [0, 0, 0], "#d5d6d8");
    box([110, 3, 76], [0, -9, 0], "#202228");
    box([105, 2, 70], [0, 9, 0], "#24272b");
    box([6, 14, 76], [-53, 15, 0], "#c9cbce");
    box([6, 14, 76], [53, 15, 0], "#c9cbce");
    box([112, 17, 8], [0, 16, -36], "#c82f3c");
    box([112, 10, 7], [0, 12, 36], "#c9cbce");
    box([18, 1, 5], [37, 18, 36], "#181b21");
    box([2, 1.2, 2], [43, 19, 36], "#ca3b43");
    for (let x = -45; x <= 45; x += 5) box([0.25, 0.3, 61], [x, 10.2, 0], "#494b4e");
    for (let z = -30; z <= 30; z += 5) box([92, 0.3, 0.25], [0, 10.2, z], "#494b4e");
    box([3, 3, 65], [-46, 15, 0], "#24262b");
    box([3, 3, 65], [46, 15, 0], "#24262b");
    box([91, 3, 3], [0, 18, -22], "#9ba0a6");
    box([7, 9, 7], [-32, 16, -22], "#2b2e35");
    box([3, 3, 3], [-32, 10, -22], "#b19361");
    const lid = box([104, 1.5, 65], [0, 48, -50], "#90313b", 0.25);
    lid.rotation.x = -0.9;
    const lidMaterial = lid.material as THREE.MeshStandardMaterial;
    lidMaterial.transparent = true;
    lidMaterial.opacity = 0.22;
    const floor = box([240, 1, 200], [0, -12, 0], "#18191c");
    floor.material.roughness = 1;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x343844, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(-50, 110, 70);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xb3bedf, 1.5);
    rim.position.set(80, 50, -50);
    scene.add(rim);
    const draw = () => renderer.render(scene, camera);
    let cancelled = false;
    let texture: THREE.Texture | undefined;
    if (file) {
      const image = new window.Image();
      image.src = svgImage(file.svg);
      void image
        .decode()
        .then(() => {
          if (cancelled) return;
          const aspect = image.naturalWidth / Math.max(image.naturalHeight, 1);
          const width = Math.min(39, 48 * aspect),
            height = width / aspect;
          const materialColor =
            file.kind === "stamp"
              ? "#77716d"
              : (stockMaterial(file.materialId ?? "")?.color ?? "#a2b4c6");
          box([width, 0.5, height], [-10, 10.8, 4], materialColor, 0.3);
          texture = new THREE.Texture(image);
          texture.needsUpdate = true;
          texture.colorSpace = THREE.SRGBColorSpace;
          const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.83,
            side: THREE.DoubleSide,
          });
          const geometry = new THREE.PlaneGeometry(width, height);
          const artwork = new THREE.Mesh(geometry, material);
          artwork.rotation.x = -Math.PI / 2;
          artwork.position.set(-10, 11.1, 4);
          scene.add(artwork);
          materials.push(material);
          geometries.push(geometry);
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
      texture?.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [file]);
  return (
    <div className="ruby-laser-canvas" ref={viewport}>
      {error && <p>Laser preview unavailable. Your queue is still live.</p>}
    </div>
  );
}
