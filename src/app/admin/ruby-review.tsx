"use client";

import dynamic from "next/dynamic";
import { materialSummary, type ProductionFile } from "@/lib/ruby-batch";
const DesignPreview = dynamic(() => import("./ruby-design-preview"), {
  ssr: false,
  loading: () => <div className="ruby-preview-loading">Preparing preview…</div>,
});

export default function RubyReview({
  files,
  simulated,
  busy,
  onBack,
  onConfirm,
}: {
  files: ProductionFile[];
  simulated?: boolean;
  busy: boolean;
  onBack(): void;
  onConfirm(): void;
}) {
  const groups = Map.groupBy(files, (file) => file.version ?? "Local files");
  const materials = Map.groupBy(files, (file) => `${materialSummary(file)}|${file.dimensions}`);
  return (
    <>
      <div className="ruby-page-heading">
        <h1>Review batch</h1>
        <p>Check the designs and have these materials ready.</p>
      </div>
      <div className="ruby-review-grid">
        <section className="ruby-review-designs" aria-label="Design previews">
          {[...groups].map(([version, items]) => {
            const previews =
              version === "Local files"
                ? items
                : [...Map.groupBy(items, (file) => `${file.kind}:${file.materialId}`).values()].map(
                    (group) => group[0],
                  );
            return (
              <div className="ruby-design-set" key={version}>
                <h2>{version === "Local files" ? version : `Hack Night ${version}`}</h2>
                <div className="ruby-render-pair">
                  {previews.map((file) => (
                    <figure key={file.file.name}>
                      <DesignPreview file={file} />
                      <figcaption>
                        <strong>
                          {version === "Local files"
                            ? file.file.name
                            : file.kind === "badge"
                              ? "Badge"
                              : "Stamp impression"}
                        </strong>
                        <span>
                          {file.kind === "badge"
                            ? materialSummary(file)
                            : "Finished impression on paper"}
                        </span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
        <aside className="ruby-review-summary">
          <h2>Materials</h2>
          <ul>
            {[...materials].map(([key, items]) => (
              <li key={key}>
                <span className="ruby-quantity">{items.length}×</span>
                <div>
                  <strong>{materialSummary(items[0])}</strong>
                  <span>{items[0].dimensions}</span>
                </div>
              </li>
            ))}
          </ul>
          <details className="ruby-disclosure">
            <summary>{files.length} cutting files</summary>
            <ul>
              {files.map((file) => (
                <li key={`${file.digest}:${file.file.name}`}>
                  <span>{file.file.name}</span>
                </li>
              ))}
            </ul>
          </details>
          <p className="ruby-help">
            {simulated
              ? "Jobs run in this browser only."
              : "Uses the saved badge and stamp settings in Ruby."}
          </p>
          <button className="ruby-primary" disabled={busy} onClick={onConfirm}>
            Queue {files.length} {files.length === 1 ? "job" : "jobs"}
          </button>
          <button className="ruby-text-button" disabled={busy} onClick={onBack}>
            Back to files
          </button>
        </aside>
      </div>
    </>
  );
}
