"use client";

import { useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { BadgeModel } from "./badge-model";
import { parseBadgeSVG, type BadgeData } from "@/lib/svg";
import type { AcrylicMaterial } from "@/lib/materials";

const LOADING_PLACEHOLDER = (
  <mesh>
    <boxGeometry args={[1, 1, 0.1]} />
    <meshStandardMaterial color="#888" wireframe />
  </mesh>
);

export function BadgeScene({ svgUrl, material }: { svgUrl: string; material: AcrylicMaterial }) {
  const [data, setData] = useState<BadgeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    parseBadgeSVG(svgUrl)
      .then(setData)
      .catch((e) => {
        console.error("Failed to parse badge SVG:", e);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [svgUrl]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8" role="alert" aria-live="polite">
        <div className="max-w-md rounded-lg border border-red-500/50 bg-red-950/50 p-6 text-center">
          <p className="mb-1 text-sm font-medium text-red-400">Invalid SVG</p>
          <p className="text-sm text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <Canvas
      camera={{ position: [0, 0, 4], fov: 45 }}
      className="!h-full !w-full"
      style={{ background: "#111" }}
      shadows
    >
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[5, 5, 5]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight position={[-3, -2, 4]} intensity={0.6} />
      <pointLight position={[0, 0, 8]} intensity={0.5} />
      <Environment preset="studio" />

      {/* Backdrop plane behind the badge for depth and contrast */}
      <mesh position={[0, 0, -1]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#999" roughness={0.9} />
      </mesh>

      {data ? <BadgeModel key={material.id} data={data} material={material} /> : LOADING_PLACEHOLDER}

      <OrbitControls enableDamping dampingFactor={0.1} minDistance={2} maxDistance={15} />
    </Canvas>
  );
}
