"use client";

import { useEffect, useRef, useState } from "react";
import type { AcrylicMaterial } from "@/lib/materials";
import { mountBadge } from "@/renderer/mount";

export function BadgeScene({ svgUrl, material }: { svgUrl: string; material: AcrylicMaterial }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const target = viewport.current;
    if (!target) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setError("");
    void (async () => {
      const response = await fetch(svgUrl);
      if (!response.ok) throw new Error("Could not load the badge SVG.");
      const cleanup = await mountBadge(target, {
        svg: await response.text(),
        material,
        thicknessMm: 3.175,
        sizeIn: 2.2,
      });
      if (cancelled) cleanup();
      else dispose = cleanup;
    })().catch((cause) => {
      if (!cancelled)
        setError(cause instanceof Error ? cause.message : "Could not show the badge.");
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [svgUrl, material]);
  return (
    <div className="relative h-full w-full">
      <div ref={viewport} className="h-full w-full" />
      {error && (
        <p
          role="alert"
          className="absolute inset-x-4 top-4 rounded bg-neutral-950 p-4 text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
