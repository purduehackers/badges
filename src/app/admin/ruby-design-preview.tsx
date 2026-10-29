"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { getMaterial } from "@/lib/materials";
import type { ProductionFile } from "@/lib/ruby-batch";

export function svgImage(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function FileThumbnail({ file }: { file: ProductionFile }) {
  return <Image src={svgImage(file.svg)} alt={file.file.name} width={80} height={80} unoptimized />;
}

export default function DesignPreview({ file }: { file: ProductionFile }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const target = viewport.current;
    if (!target) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setError("");
    void (async () => {
      if (file.kind === "badge") {
        if (!file.materialId) throw new Error("Choose acrylic to see the material preview.");
        const { mountBadge } = await import("@/renderer/mount");
        const cleanup = await mountBadge(target, {
          svg: file.previewSvg ?? file.svg,
          material: getMaterial(file.materialId),
          thicknessMm: file.thicknessMm,
          sizeIn: 2.2,
        });
        if (cancelled) cleanup();
        else dispose = cleanup;
      } else {
        const { createStamp } = await import("@/renderer/stamp");
        let svg = file.svg;
        if (file.mirrored) {
          const document = new DOMParser().parseFromString(svg, "image/svg+xml");
          const root = document.documentElement;
          const [x, , width] = (root.getAttribute("viewBox") ?? "")
            .trim()
            .split(/[\s,]+/)
            .map(Number);
          if (!Number.isFinite(width))
            throw new Error("The stamp needs a viewBox to show its impression.");
          const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
          group.setAttribute("transform", `translate(${x * 2 + width} 0) scale(-1 1)`);
          while (root.firstChild) group.append(root.firstChild);
          root.append(group);
          svg = new XMLSerializer().serializeToString(root);
        }
        const stamp = await createStamp(svg);
        const { canvas } = stamp.render();
        canvas.setAttribute("aria-label", "Simulated stamp impression on paper");
        if (cancelled) return;
        target.append(canvas);
        dispose = () => canvas.remove();
      }
    })().catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Preview unavailable.");
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [file]);
  return (
    <div className="ruby-design-preview">
      <div ref={viewport} className="ruby-design-canvas" />
      {error && (
        <div className="ruby-preview-fallback">
          <FileThumbnail file={file} />
          <p>{error}</p>
          <span>Cutting artwork</span>
        </div>
      )}
    </div>
  );
}
