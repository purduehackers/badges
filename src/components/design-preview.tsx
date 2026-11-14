"use client";

import Image from "next/image";
import paperTexture from "@/renderer/assets/paper-height.png";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_BADGE_SIZE_IN } from "@/workflow/policy";
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
          sizeIn: file.sizeIn ?? DEFAULT_BADGE_SIZE_IN,
        });
        if (cancelled) cleanup();
        else {
          dispose = cleanup;
          setReady(true);
          onStatus?.(file.kind, true);
        }
      } else {
        const { renderStamp } = await import("@/renderer/stamp");
        const canvas = await renderStamp(
          file.previewSvg ?? file.svg,
          paperTexture.src,
          !file.previewSvg && file.mirrored,
        );
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
