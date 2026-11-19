"use client";
import dynamic from "next/dynamic";
import { ACRYLIC_THICKNESS_MM } from "@/workflow/policy";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ACRYLIC_MATERIALS, DEFAULT_MATERIAL_ID, materialLabel } from "@/lib/materials";
import { Field } from "./ph/field";
const DesignPreview = dynamic(() => import("./design-preview"), { ssr: false });
export default function BadgeViewer() {
  const params = useSearchParams();
  const [file, setFile] = useState<File>();
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const url = params.get("badge") || "/badge.svg";
  const [materialId, setMaterial] = useState(DEFAULT_MATERIAL_ID);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setSvg("");
    void (async () => {
      if (file) return file.text();
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error("Could not load the badge SVG.");
      return response.text();
    })()
      .then((value) => {
        if (!controller.signal.aborted) setSvg(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Could not load the badge.");
      });
    return () => controller.abort();
  }, [file, url]);
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
        {svg && (
          <DesignPreview
            file={{
              svg,
              kind: "badge",
              materialId,
              thicknessMm: ACRYLIC_THICKNESS_MM,
              mirrored: false,
              file: { name: file?.name ?? "Badge" },
            }}
          />
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </main>
  );
}
