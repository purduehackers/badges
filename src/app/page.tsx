"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { UploadPanel } from "@/components/upload-panel";
import { MaterialPicker } from "@/components/material-picker";
import { DEFAULT_MATERIAL_ID, getMaterial, type AcrylicMaterial } from "@/lib/materials";

const BadgeScene = dynamic(() => import("@/components/badge-scene").then((m) => m.BadgeScene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-neutral-500">
      Loading 3D viewer…
    </div>
  ),
});

function HomeContent() {
  const searchParams = useSearchParams();
  const [svgUrl, setSvgUrl] = useState<string | null>(searchParams.get("badge") ?? "/badge.svg");
  const [material, setMaterial] = useState<AcrylicMaterial>(() => getMaterial(DEFAULT_MATERIAL_ID));

  return (
    <div className="flex h-screen flex-col lg:flex-row">
      <div className="flex h-1/2 shrink-0 flex-col border-b border-neutral-800 lg:h-full lg:w-[400px] lg:border-b-0 lg:border-r">
        <div className="min-h-0 flex-1">
          <UploadPanel svgUrl={svgUrl} onSvgChange={setSvgUrl} />
        </div>
        <div className="shrink-0 border-t border-neutral-800 px-6 py-4">
          <MaterialPicker selected={material} onSelect={setMaterial} />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {svgUrl ? (
          <BadgeScene svgUrl={svgUrl} material={material} />
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-500">
            Upload an SVG to preview in 3D
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}
