"use client";

import Image from "next/image";
import paperTexture from "@/renderer/assets/paper-height.png";
import { useEffect, useRef, useState } from "react";
import { getMaterial } from "@/lib/materials";
import type { ProductionFile } from "@/lib/ruby-batch";

export function svgImage(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export type PreviewDesign = Pick<
  ProductionFile,
  "svg" | "kind" | "previewSvg" | "materialId" | "thicknessMm" | "mirrored"
> & { file: { name: string }; sizeIn?: number };

export function FileThumbnail({ file }: { file: PreviewDesign }) {
  return <Image src={svgImage(file.svg)} alt={file.file.name} width={80} height={80} unoptimized />;
}

export default function DesignPreview({
  file,
  onStatus,
}: {
  file: PreviewDesign;
  onStatus?(kind: "badge" | "stamp", ready: boolean): void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const target = viewport.current;
    if (!target) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setError("");
    setReady(false);
    onStatus?.(file.kind, false);
    void (async () => {
      if (file.kind === "badge") {
        if (!file.materialId) throw new Error("Choose acrylic to see the material preview.");
        const { mountBadge } = await import("@/renderer/mount");
        const cleanup = await mountBadge(target, {
          svg: file.previewSvg ?? file.svg,
          material: getMaterial(file.materialId),
          thicknessMm: file.thicknessMm,
          sizeIn: file.sizeIn ?? 2.2,
        });
        if (cancelled) cleanup();
        else {
          dispose = cleanup;
          setReady(true);
          onStatus?.(file.kind, true);
        }
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
        const paper = document.createElement("img");
        paper.src = paperTexture.src;
        await paper.decode();
        if (cancelled) return;
        const stamp = await createStamp(svg, paper);
        const { canvas } = stamp.render();
        canvas.setAttribute("aria-label", "Simulated stamp impression on paper");
        if (cancelled) return;
        target.append(canvas);
        dispose = () => canvas.remove();
        setReady(true);
        onStatus?.(file.kind, true);
      }
    })().catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Preview unavailable.");
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [file, onStatus]);
  return (
    <div className="ruby-design-preview">
      <div ref={viewport} className="ruby-design-canvas" />
      {!ready && !error && (
        <div className="ruby-preview-fallback" role="status">
          Preparing render…
        </div>
      )}
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
