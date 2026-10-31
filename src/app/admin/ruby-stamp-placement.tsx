"use client";

import { useState } from "react";
import { RUBY_BED, fitsBed, svgPhysicalSize } from "@/lib/ruby-bed";
import type { ProductionFile } from "@/lib/ruby-batch";
import type { RubyConnection, RubyJob } from "@/lib/ruby-production";
import { controlSimulation, readSimulation } from "@/lib/ruby-simulator";
import { svgImage } from "./ruby-design-preview";

export default function RubyStampPlacement({
  connection,
  file,
  job,
  busy,
  onAligned,
}: {
  connection: RubyConnection;
  file: ProductionFile;
  job: RubyJob;
  busy: boolean;
  onAligned(): void;
}) {
  const [coordinates, setCoordinates] = useState(["", ""]);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const used = readSimulation(connection).jobs.filter(
    (item) => item.id !== job.id && item.kind === "stamp" && item.origin && item.size,
  );
  const size = svgPhysicalSize(file.svg);
  const point =
    job.simulatedOrigin ??
    (coordinates.every((value) => value.trim())
      ? { x: Number(coordinates[0]) * 25.4, y: Number(coordinates[1]) * 25.4 }
      : undefined);
  const valid = point && size && fitsBed(point, size);
  const disabled = busy || saving || job.status !== "NeedsAlignment";
  const aligned = Boolean(job.simulatedOrigin);
  return (
    <section className="ruby-stamp-placement" aria-label="Stamp alignment">
      <h3>{aligned ? "Stamp aligned" : "Align your stamp"}</h3>
      {!aligned && (
        <p>Choose unused rubber, then align the laser pointer with the stamp’s top-left corner.</p>
      )}
      {!size ? (
        <p className="ruby-error">
          Set the SVG’s width and height in inches or millimeters to preview its footprint.
        </p>
      ) : (
        <>
          <button
            className="ruby-bed-map"
            aria-label="Choose the stamp’s top-left point on the 40 by 24 inch bed"
            disabled={disabled}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setCoordinates([
                ((((event.clientX - bounds.left) / bounds.width) * RUBY_BED.width) / 25.4).toFixed(
                  2,
                ),
                ((((event.clientY - bounds.top) / bounds.height) * RUBY_BED.height) / 25.4).toFixed(
                  2,
                ),
              ]);
              setConfirmed(false);
              setError("");
            }}
          >
            <svg viewBox={`0 0 ${RUBY_BED.width} ${RUBY_BED.height}`} aria-hidden="true">
              <defs>
                <pattern
                  id="stamp-bed-grid"
                  width="50.8"
                  height="50.8"
                  patternUnits="userSpaceOnUse"
                >
                  <path d="M 50.8 0 H 0 V 50.8" fill="none" stroke="#34343b" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width={RUBY_BED.width} height={RUBY_BED.height} fill="url(#stamp-bed-grid)" />
              {used.map((item) => (
                <rect
                  key={item.id}
                  x={item.origin!.x}
                  y={item.origin!.y}
                  width={item.size!.width}
                  height={item.size!.height}
                  fill="#6f3f3b"
                  stroke="#c3847c"
                />
              ))}
              {point && (
                <g>
                  <rect
                    x={point.x}
                    y={point.y}
                    width={size.width}
                    height={size.height}
                    fill="#c5bca8"
                  />
                  <image
                    href={svgImage(file.svg)}
                    x={point.x}
                    y={point.y}
                    width={size.width}
                    height={size.height}
                  />
                  <rect
                    x={point.x}
                    y={point.y}
                    width={size.width}
                    height={size.height}
                    fill="none"
                    stroke={valid ? "#fff34b" : "#ff887e"}
                    strokeWidth="2"
                  />
                  <path
                    d={`M ${point.x - 12} ${point.y} h 24 M ${point.x} ${point.y - 12} v 24`}
                    stroke="#fff34b"
                    strokeWidth="2"
                  />
                </g>
              )}
            </svg>
          </button>
          <p className="ruby-help">
            40 × 24 in bed · Stamp footprint: {file.dimensions} · Shaded areas are used in this
            simulation.
          </p>
          {aligned ? (
            <p>
              Top-left: {(point!.x / 25.4).toFixed(2)} in from the left,{" "}
              {(point!.y / 25.4).toFixed(2)} in from the back.
              {job.status === "Ready" && " Start the queue when ready."}
            </p>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!valid || !confirmed || disabled) return;
                setSaving(true);
                setError("");
                void controlSimulation(connection, {
                  type: "align",
                  jobId: job.id,
                  origin: point,
                  size,
                })
                  .then(onAligned)
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error ? cause.message : "Could not save the stamp position.",
                    ),
                  )
                  .finally(() => setSaving(false));
              }}
            >
              <div className="ruby-stamp-coordinates">
                {["From left (in)", "From back (in)"].map((label, index) => (
                  <label key={label}>
                    {label}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      disabled={disabled}
                      value={coordinates[index]}
                      onChange={(event) => {
                        setCoordinates((current) =>
                          current.map((value, i) => (i === index ? event.target.value : value)),
                        );
                        setConfirmed(false);
                      }}
                    />
                  </label>
                ))}
              </div>
              {point && !valid && (
                <p className="ruby-error">Keep the entire stamp inside the bed.</p>
              )}
              <label className="ruby-stamp-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={disabled}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                This spot has enough unused rubber for the stamp.
              </label>
              <button className="ruby-primary" disabled={disabled || !valid || !confirmed}>
                Confirm stamp position
              </button>
              {job.status !== "NeedsAlignment" && (
                <p className="ruby-help">The simulator will stop here when this stamp is next.</p>
              )}
            </form>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="ruby-error">
          {error}
        </p>
      )}
    </section>
  );
}
