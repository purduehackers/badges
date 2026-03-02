"use client";

import { useMemo } from "react";
import { CanvasTexture, DoubleSide, ExtrudeGeometry, ShapeGeometry, SRGBColorSpace } from "three";
import type { BadgeData } from "@/lib/svg";
import { applyKerf, KERF_MM } from "@/lib/kerf";

// Units are inches
const BADGE_HEIGHT = 2.5;
const BODY_DEPTH = 0.125; // 1/8 inch

export function BadgeModel({ data }: { data: BadgeData }) {
  const { bodyGeometry, engraveGeometry, engraveTexture } = useMemo(() => {
    const { bodyShapes, engraveCanvas, viewBox } = data;

    const maxDim = Math.max(viewBox.width, viewBox.height);
    const scale = BADGE_HEIGHT / maxDim;
    const bodyDepthSvg = BODY_DEPTH / scale;

    // Apply laser kerf: shrink each piece by half the kerf on every edge
    const halfKerfSvg = KERF_MM / 25.4 / 2 / scale;
    const kerfedShapes = applyKerf(bodyShapes, halfKerfSvg);

    // Body extrusion with subtle bevel (~0.05 mm)
    const bevelSvg = 0.002 / scale;
    const bodyGeo = new ExtrudeGeometry(kerfedShapes, {
      depth: bodyDepthSvg,
      bevelEnabled: true,
      bevelThickness: bevelSvg,
      bevelSize: bevelSvg,
      bevelSegments: 2,
    });
    bodyGeo.scale(scale, -scale, scale);
    bodyGeo.computeBoundingBox();

    const box = bodyGeo.boundingBox!;
    const cx = (box.min.x + box.max.x) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    bodyGeo.translate(-cx, -cy, -cz);
    bodyGeo.computeBoundingBox();

    const bodyFrontZ = bodyGeo.boundingBox!.max.z;

    // Engrave overlay (flat shape at the front face)
    const engraveGeo = new ShapeGeometry(kerfedShapes);

    // Map UVs to the full viewBox so the rasterized texture aligns.
    // SVG Y=0 is top; THREE.js UV v=1 is top.
    const posAttr = engraveGeo.getAttribute("position");
    const uvAttr = engraveGeo.getAttribute("uv");
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      uvAttr.setXY(i, x / viewBox.width, 1 - y / viewBox.height);
    }
    uvAttr.needsUpdate = true;

    engraveGeo.scale(scale, -scale, 1);
    engraveGeo.translate(-cx, -cy, bodyFrontZ + 0.001);

    const texture = new CanvasTexture(engraveCanvas);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;

    return {
      bodyGeometry: bodyGeo,
      engraveGeometry: engraveGeo,
      engraveTexture: texture,
    };
  }, [data]);

  return (
    <group>
      <mesh geometry={bodyGeometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          color="#c0a050"
          metalness={0.05}
          roughness={0.05}
          clearcoat={1}
          clearcoatRoughness={0.05}
          reflectivity={0.9}
          side={DoubleSide}
        />
      </mesh>

      <mesh geometry={engraveGeometry}>
        <meshPhysicalMaterial
          color="#d4b870"
          metalness={0}
          roughness={0.9}
          clearcoat={0}
          alphaMap={engraveTexture}
          transparent
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}
