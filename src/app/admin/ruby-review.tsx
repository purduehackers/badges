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
        <h1>Check your batch</h1>
        <p>Check the designs, cutting files, and material before they go to Ruby.</p>
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
          <p className="ruby-eyebrow">Have these ready</p>
          <h2>Your materials</h2>
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
          {files.some((file) => file.kind === "stamp") && (
            <p className="ruby-help">
              Each stamp needs unused rubber. Before engraving, align the laser pointer with the
              stamp’s top-left corner.
            </p>
          )}
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
              ? "Confirming creates test jobs on your simulated laser."
              : "Confirming sends these files to Ruby and queues the jobs with your saved badge and stamp settings."}
          </p>
          <button className="ruby-primary" disabled={busy} onClick={onConfirm}>
            Looks good. Queue {files.length} {files.length === 1 ? "job" : "jobs"}{" "}
            <span aria-hidden="true">→</span>
          </button>
          <button className="ruby-text-button" disabled={busy} onClick={onBack}>
            Back to files
          </button>
        </aside>
      </div>
    </>
  );
}
