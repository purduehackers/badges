"use client";

import { useState, useRef, useEffect } from "react";

interface UploadPanelProps {
  svgUrl: string | null;
  onSvgChange: (url: string) => void;
}

/** Recolor dark strokes/fills to light gray for dark background visibility. */
function recolorForDarkBg(svgText: string): string {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const isRed = (c: string) => /^(red|#f{2}0{4})$/i.test(c.trim());

  for (const el of Array.from(doc.querySelectorAll("*"))) {
    const stroke = el.getAttribute("stroke");
    if (stroke && stroke !== "none" && !isRed(stroke)) {
      el.setAttribute("stroke", "#ccc");
    }
    const fill = el.getAttribute("fill");
    if (fill && fill !== "none" && !isRed(fill)) {
      el.setAttribute("fill", "#ccc");
    }

    // Handle inline style colors
    const style = el.getAttribute("style");
    if (style) {
      const recolored = style
        .replace(/stroke:\s*(?!none|red|#ff0000)[^;]+/gi, "stroke: #ccc")
        .replace(/fill:\s*(?!none|red|#ff0000)[^;]+/gi, "fill: #ccc");
      el.setAttribute("style", recolored);
    }
  }

  return new XMLSerializer().serializeToString(doc);
}

export function UploadPanel({ svgUrl, onSvgChange }: UploadPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!svgUrl) {
      setPreviewUrl(null);
      return;
    }

    let revoke: string | null = null;

    fetch(svgUrl)
      .then((r) => r.text())
      .then((text) => {
        const recolored = recolorForDarkBg(text);
        const blob = new Blob([recolored], { type: "image/svg+xml" });
        revoke = URL.createObjectURL(blob);
        setPreviewUrl(revoke);
      })
      .catch(() => setPreviewUrl(null));

    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [svgUrl]);

  function handleFile(file: File) {
    if (!file.type.includes("svg")) return;
    const url = URL.createObjectURL(file);
    onSvgChange(url);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <button
        type="button"
        aria-label="Upload SVG file"
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 transition-colors ${
          isDragging
            ? "border-amber-400 bg-amber-400/10"
            : "border-neutral-600 bg-neutral-800/50 hover:border-neutral-400"
        }`}
      >
        <svg
          aria-hidden="true"
          className="mb-2 h-8 w-8 text-neutral-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
          />
        </svg>
        <p className="text-sm text-neutral-300">
          Drop an SVG here or <span className="text-amber-400 underline">browse</span>
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </button>

      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg bg-neutral-800/50 p-4">
        {previewUrl ? (
          /* eslint-disable-next-line nextjs/no-img-element -- blob URL from createObjectURL, not optimizable by next/image */
          <img
            src={previewUrl}
            alt="Badge SVG preview"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <p className="text-sm text-neutral-500">No SVG loaded</p>
        )}
      </div>
    </div>
  );
}
