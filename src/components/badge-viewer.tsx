"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ACRYLIC_MATERIALS,
  getMaterial,
  DEFAULT_MATERIAL_ID,
  materialLabel,
} from "@/lib/materials";
import { Field } from "./ph/field";
const Scene = dynamic(() => import("./badge-scene").then((m) => m.BadgeScene), { ssr: false });
export default function BadgeViewer() {
  const params = useSearchParams();
  const [file, setFile] = useState<File>();
  const [upload, setUpload] = useState("");
  const [materialId, setMaterial] = useState(DEFAULT_MATERIAL_ID);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setUpload(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <main className="viewer-page">
      <header className="page-heading">
        <h1 className="ph-headline">See it in acrylic.</h1>
        <p>Rotate your badge and try another color.</p>
      </header>
      <div className="viewer-controls">
        <Field label="Badge SVG" htmlFor="viewer-upload">
          <input
            id="viewer-upload"
            type="file"
            accept=".svg,image/svg+xml"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
        </Field>
        <Field label="Acrylic" htmlFor="viewer-material">
          <select
            id="viewer-material"
            value={materialId}
            onChange={(e) => setMaterial(e.target.value)}
          >
            {ACRYLIC_MATERIALS.map((m) => (
              <option value={m.id} key={m.id}>
                {materialLabel(m.id)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="viewer-stage">
        <Scene
          svgUrl={upload || params.get("badge") || "/badge.svg"}
          material={getMaterial(materialId)}
        />
      </div>
    </main>
  );
}
