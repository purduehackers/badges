"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { materialSummary, type ProductionFile } from "@/lib/ruby-batch";
import {
  duplicateImport,
  type RubyConnection,
  type RubyDevice,
  type RubyJob,
  type RubyReceipt,
} from "@/lib/ruby-production";
import { FileThumbnail } from "./ruby-design-preview";
import RubyStampPlacement from "./ruby-stamp-placement";
import { controlSimulation, readSimulation } from "@/lib/ruby-simulator";

const LaserPreview = dynamic(() => import("./ruby-laser-preview"), {
  ssr: false,
  loading: () => <div className="ruby-preview-loading">Loading laser preview…</div>,
});
function duration(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
function jobLabel(receipt?: RubyReceipt) {
  if (!receipt) return "Not sent";
  if (receipt.state === "rejected") return "Upload rejected";
  if (receipt.state === "unknown") return "Checking upload";
  if (receipt.state === "sending") return "Sending";
  if (receipt.queueError) return "Needs attention";
  const states = receipt.jobs?.map((job) => job.status) ?? [];
  if (states.includes("Erroneous")) return "Needs attention";
  if (states.includes("Running")) return "Running";
  if (states.includes("NeedsAlignment")) return "Needs alignment";
  if (states.includes("Paused")) return "Paused";
  if (states.length && states.every((state) => state === "Finished")) return "Finished";
  if (states.includes("Removed")) return "Removed from queue";
  if (receipt.queuedAt) return receipt.jobs?.length === 0 ? "Not in queue" : "Queued";
  return "Creating job";
}

export default function RubyPlayer({
  files,
  receipts,
  connection,
  device,
  queue,
  stale,
  busy,
  rubyUrl,
  onCheck,
  onEdit,
  onNew,
  onSimulationChange,
}: {
  files: ProductionFile[];
  receipts: RubyReceipt[];
  connection: RubyConnection;
  device?: RubyDevice;
  queue?: RubyJob[];
  stale: boolean;
  busy: boolean;
  rubyUrl: string;
  onCheck(): void;
  onEdit(): void;
  onNew(): void;
  onSimulationChange(): void;
}) {
  const [selection, setSelection] = useState<number>();
  const [changing, setChanging] = useState(false);
  const [controlError, setControlError] = useState("");
  const entries = files.map((file) => {
    const receipt = duplicateImport(
      receipts,
      connection,
      file.digest,
      file.file.name,
      file.batchId,
      true,
    );
    const job = receipt?.jobs?.find((item) =>
      ["Ready", "Running", "Paused", "NeedsAlignment"].includes(item.status ?? ""),
    );
    const tracked =
      !stale &&
      job &&
      device?.jobName &&
      [job.name, receipt?.rubyName, receipt?.rubyName?.replace(/\.svg$/i, "")].includes(
        device.jobName,
      );
    return {
      file,
      receipt,
      tracked,
      running: tracked && job?.status === "Running",
      progress:
        tracked &&
        ["Running", "Paused"].includes(job.status ?? "") &&
        typeof device?.progress === "number"
          ? Math.max(0, Math.min(100, device.progress))
          : undefined,
    };
  });
  const activeIndex = entries.findIndex((entry) => entry.tracked);
  const selected = Math.min(selection ?? Math.max(0, activeIndex), files.length - 1);
  const current = entries[selected];
  const file = current?.file,
    receipt = current?.receipt;
  const active = current?.running;
  const selectedJob = receipt?.jobs?.[0];
  const simulation = connection.simulated ? readSimulation(connection) : undefined;
  const simulatedJob = simulation?.jobs.find((job) => job.id === selectedJob?.id);
  const nextJob = simulation?.jobs.find((job) => job.status !== "Finished");
  const needsAlignment = nextJob?.status === "NeedsAlignment";
  const placingStamp = simulatedJob?.status === "NeedsAlignment";
  const progress = current?.progress;
  const remaining =
    progress !== undefined && device?.remainingTime && device.remainingTime > 0
      ? device.remainingTime
      : undefined;
  const elapsed =
    progress !== undefined && progress > 0 && progress < 100 && remaining !== undefined
      ? (remaining * progress) / (100 - progress)
      : undefined;
  const finished = entries.filter((entry) => jobLabel(entry.receipt) === "Finished").length;
  const complete = files.length > 0 && finished === files.length;
  const needsRetry = entries.some((entry) => !entry.receipt?.queuedAt || entry.receipt.queueError);
  const canEdit = entries.every((entry) => !entry.receipt || entry.receipt.state === "rejected");
  const label = stale ? "Status unavailable" : jobLabel(receipt);
  const otherJobs = queue?.filter(
    (job) =>
      !entries.some(
        (entry) =>
          entry.receipt?.id === job.trackingNumber || entry.receipt?.jobIds?.includes(job.id),
      ),
  ).length;

  async function toggleSimulation() {
    setChanging(true);
    setControlError("");
    try {
      await controlSimulation(connection, { type: simulation?.playing ? "pause" : "start" });
      setSelection(undefined);
      onSimulationChange();
    } catch (cause) {
      setControlError(cause instanceof Error ? cause.message : "Could not update the simulation.");
    } finally {
      setChanging(false);
    }
  }
  return (
    <>
      <div className="ruby-player-heading">
        <h1>{complete ? "Batch complete" : "Produce"}</h1>
        <button
          className={complete ? "ruby-primary" : "ruby-text-button"}
          onClick={canEdit ? onEdit : onNew}
          disabled={busy}
        >
          {canEdit ? "Back to files" : "New batch"}
        </button>
      </div>
      <div className="ruby-player">
        <aside className="ruby-playlist">
          <div className="ruby-section-heading">
            <h2>Jobs</h2>
            <span>
              {finished}/{files.length} done
            </span>
          </div>
          <ol>
            {entries.map((entry, index) => (
              <li key={`${entry.file.digest}:${entry.file.file.name}`}>
                <button
                  className={selected === index ? "selected" : ""}
                  aria-pressed={selected === index}
                  onClick={() => setSelection(index)}
                >
                  <span className="ruby-track-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="ruby-track-art">
                    <FileThumbnail file={entry.file} />
                  </span>
                  <span className="ruby-track-name">
                    <strong>
                      {entry.file.kind === "stamp" ? "Stamp" : "Badge sheet"}
                      {entry.file.version ? ` · ${entry.file.version}` : ""}
                    </strong>
                    <small>{entry.file.dimensions}</small>
                    <span
                      className={`ruby-job-state ${jobLabel(entry.receipt).toLowerCase().replaceAll(" ", "-")}`}
                    >
                      {stale ? "Status unavailable" : jobLabel(entry.receipt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {Boolean(otherJobs) && (
            <p className="ruby-help">
              {otherJobs} other {otherJobs === 1 ? "job is" : "jobs are"} in Ruby’s queue.
            </p>
          )}
          {needsRetry && !busy && (
            <button className="ruby-text-button" onClick={onCheck}>
              Retry queue
            </button>
          )}
        </aside>
        <section className="ruby-player-main" aria-label="Laser player">
          {placingStamp && simulatedJob && file ? (
            <RubyStampPlacement
              key={simulatedJob.id}
              connection={connection}
              file={file}
              job={simulatedJob}
              busy={busy || stale}
              onAligned={() => {
                setSelection(undefined);
                onSimulationChange();
              }}
            />
          ) : (
            <div className="ruby-player-screen">
              <LaserPreview file={file} origin={simulatedJob?.origin} />
              <div className="ruby-player-screen-top">
                <span className="ruby-live-status">
                  <i className={active ? "active" : ""} />
                  {label}
                </span>
                <span>Speedy 400</span>
              </div>
              <span className="ruby-schematic-label">Drag to rotate</span>
            </div>
          )}
          <div className="ruby-now-playing">
            <div>
              <h2>{file?.file.name ?? "Choose a job"}</h2>
              <p>{file ? materialSummary(file) : ""}</p>
            </div>
            {!needsAlignment &&
              selection !== undefined &&
              activeIndex >= 0 &&
              selection !== activeIndex && (
                <button className="ruby-text-button" onClick={() => setSelection(undefined)}>
                  Follow current job
                </button>
              )}
          </div>
          {file?.kind === "stamp" && !connection.simulated && label !== "Finished" && (
            <section className="ruby-stamp-placement" aria-label="Stamp alignment">
              <h3>Align your stamp in Ruby</h3>
              <p>
                Move the laser pointer to unused rubber. Align the stamp’s top-left corner with that
                point in Ruby before starting.
              </p>
            </section>
          )}
          {controlError && (
            <p className="ruby-error" role="alert">
              {controlError}
            </p>
          )}
          {receipt?.queueError && (
            <p className="ruby-error" role="alert">
              {receipt.queueError}
            </p>
          )}
          {device?.error && (
            <p className="ruby-error" role="alert">
              {device.error.additionalInfo || device.error.code}
            </p>
          )}
          {device?.issues
            ?.filter((issue) => issue.active)
            .map((issue) => (
              <p className="ruby-error" role="alert" key={issue.code}>
                {issue.extraInfo || issue.code}
              </p>
            ))}
          <div className="ruby-timeline">
            <div className="ruby-timeline-heading">
              <strong>Timeline</strong>
              <span>
                {remaining !== undefined
                  ? `${duration(remaining)} remaining`
                  : label === "Finished"
                    ? "Complete"
                    : ""}
              </span>
            </div>
            <div className="ruby-timeline-tracks">
              {entries.map((entry, index) => {
                const state = jobLabel(entry.receipt);
                const value = state === "Finished" ? 100 : (entry.progress ?? 0);
                return (
                  <button
                    key={entry.file.file.name}
                    aria-label={`Preview job ${index + 1}: ${entry.file.file.name}`}
                    className={index === selected ? "selected" : ""}
                    onClick={() => setSelection(index)}
                  >
                    <span
                      className="ruby-track-progress"
                      style={{ width: `${stale ? 0 : value}%` }}
                    />
                    <span>
                      {String(index + 1).padStart(2, "0")}{" "}
                      {entry.file.kind === "stamp" ? "Stamp" : "Acrylic"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="ruby-timeline-time">
              <span>{elapsed === undefined ? "" : `~${duration(elapsed)} elapsed`}</span>
              <span>{progress !== undefined ? `${Math.round(progress)}%` : ""}</span>
            </div>
          </div>
          {!complete && !placingStamp && (
            <div className="ruby-playback">
              {simulation ? (
                <button
                  className="ruby-primary"
                  disabled={busy || stale || changing || !nextJob}
                  onClick={() =>
                    needsAlignment ? setSelection(undefined) : void toggleSimulation()
                  }
                >
                  {needsAlignment
                    ? "Position stamp"
                    : simulation.playing
                      ? "Pause"
                      : nextJob?.status === "Paused"
                        ? "Resume"
                        : "Start batch"}
                </button>
              ) : (
                <a
                  href={rubyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ruby-button ruby-primary"
                >
                  Open in Ruby ↗
                </a>
              )}
              <p className="ruby-help">
                {simulation
                  ? "Simulation · 1 minute per job"
                  : "Start the laser in Ruby. Progress updates here."}
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
