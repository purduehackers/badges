"use client";

import Image from "next/image";
import { useState } from "react";
import { ACRYLIC_MATERIALS, materialLabel } from "@/lib/materials";
import { type ProductionFile, type Release } from "@/lib/ruby-batch";
import { FileThumbnail } from "./ruby-design-preview";

export default function RubySelection({
  releases,
  files,
  busy,
  catalogError,
  onRelease,
  onUpload,
  onFiles,
  onReview,
}: {
  releases: Release[];
  files: ProductionFile[];
  busy: boolean;
  catalogError: string;
  onRelease(release: Release): void;
  onUpload(files: File[]): void;
  onFiles(files: ProductionFile[]): void;
  onReview(): void;
}) {
  const [search, setSearch] = useState("");
  const missingMaterial = files.some((file) => file.kind === "badge" && !file.materialId);
  const update = (index: number, values: Partial<ProductionFile>) =>
    onFiles(files.map((file, i) => (i === index ? { ...file, ...values } : file)));
  return (
    <>
      <div className="ruby-page-heading">
        <h1>Choose designs</h1>
        <p>Add a published set or upload your cutting SVGs.</p>
      </div>
      <div className="ruby-selection">
        <aside className="ruby-library">
          <label htmlFor="ruby-search">Published designs</label>
          <input
            id="ruby-search"
            type="search"
            placeholder="Find a Hack Night…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {catalogError && <p className="ruby-help">{catalogError}</p>}
          <ul className="ruby-release-list">
            {releases
              .filter((release) =>
                `Hack Night ${release.version}`.toLowerCase().includes(search.toLowerCase()),
              )
              .map((release) => {
                const added = files.some((file) => file.version === release.version);
                return (
                  <li key={release.version}>
                    <button
                      className="ruby-release"
                      disabled={busy || added}
                      onClick={() => onRelease(release)}
                    >
                      <span className="ruby-release-art">
                        {release.badgeImage ? (
                          <Image
                            src={release.badgeImage}
                            alt=""
                            width={68}
                            height={68}
                            unoptimized
                          />
                        ) : (
                          <span>{release.version}</span>
                        )}
                      </span>
                      <span>
                        <strong>Hack Night {release.version}</strong>
                        <small>{release.files.length} cutting files</small>
                      </span>
                      <span className="ruby-release-add">{added ? "Added" : "+"}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
          {releases.length > 0 &&
            !releases.some((release) =>
              `Hack Night ${release.version}`.toLowerCase().includes(search.toLowerCase()),
            ) && <p className="ruby-help">No matching designs.</p>}
        </aside>
        <section className="ruby-batch-selection" aria-label="Selected cutting files">
          <div className="ruby-section-heading">
            <h2>
              Cutting files <span>{files.length || ""}</span>
            </h2>
            <label className="ruby-upload-button">
              Upload SVGs
              <input
                aria-label="Upload cutting SVGs"
                type="file"
                multiple
                accept=".svg,image/svg+xml"
                disabled={busy}
                onChange={(event) => {
                  onUpload(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {!files.length && (
            <div className="ruby-empty-batch">
              <p>Your selected files will appear here.</p>
            </div>
          )}
          <ul className="ruby-file-list">
            {files.map((file, index) => (
              <li key={`${file.digest}:${file.file.name}`}>
                <div className="ruby-file-thumb">
                  <FileThumbnail file={file} />
                </div>
                <div className="ruby-file-info">
                  <strong title={file.file.name}>{file.file.name}</strong>
                  <p className="ruby-help">{file.dimensions}</p>
                  <div className="ruby-file-options">
                    <label>
                      <span className="ruby-sr-only">File type for {file.file.name}</span>
                      <select
                        aria-label={`File type for ${file.file.name}`}
                        value={file.kind}
                        disabled={busy}
                        onChange={(event) =>
                          update(index, {
                            kind: event.target.value === "stamp" ? "stamp" : "badge",
                            mirrored: event.target.value === "stamp",
                          })
                        }
                      >
                        <option value="badge">Badge sheet</option>
                        <option value="stamp">Stamp</option>
                      </select>
                    </label>
                    {file.kind === "badge" ? (
                      <label>
                        <span className="ruby-sr-only">Acrylic for {file.file.name}</span>
                        <select
                          aria-label={`Acrylic for ${file.file.name}`}
                          value={file.materialId ?? ""}
                          disabled={busy}
                          onChange={(event) =>
                            update(index, { materialId: event.target.value || undefined })
                          }
                        >
                          <option value="">Choose acrylic…</option>
                          {ACRYLIC_MATERIALS.map((material) => (
                            <option key={material.id} value={material.id}>
                              {materialLabel(material.id)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <span className="ruby-help">Stamp rubber · 2.3 mm</span>
                    )}
                  </div>
                </div>
                <button
                  className="ruby-icon-button"
                  aria-label={`Remove ${file.file.name}`}
                  disabled={busy}
                  onClick={() => onFiles(files.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {files.length > 0 && (
            <div className="ruby-step-footer">
              <p>
                {missingMaterial
                  ? "Choose acrylic for each badge sheet."
                  : "Stamp cutting files must already be mirrored."}
              </p>
              <button
                className="ruby-primary"
                disabled={busy || !files.length || missingMaterial}
                onClick={onReview}
              >
                Review batch
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
