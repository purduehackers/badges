"use client";

import { useEffect, useState } from "react";
import { RECEIPTS_KEY, type RubyConnection } from "@/lib/ruby-production";
import {
  controlSimulation,
  readSimulation,
  SIMULATOR_KEY,
  type SimulationAction,
} from "@/lib/ruby-simulator";

export default function RubySimulatorControls({
  connection,
  busy,
  onChange,
  onReset,
}: {
  connection: RubyConnection;
  busy: boolean;
  onChange(): void;
  onReset(): Promise<void>;
}) {
  const [state, setState] = useState(() => readSimulation(connection));
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  useEffect(() => {
    const refresh = () => setState(readSimulation(connection));
    const timer = setInterval(refresh, 1000);
    const changed = (event: StorageEvent) => {
      if (event.key === SIMULATOR_KEY) refresh();
    };
    window.addEventListener("storage", changed);
    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", changed);
    };
  }, [connection]);

  async function change(action: SimulationAction) {
    setChanging(true);
    setError("");
    try {
      const apply = async () => {
        setState(await controlSimulation(connection, action));
        if (action.type === "reset") await onReset();
      };
      if (action.type === "reset") await navigator.locks.request(RECEIPTS_KEY, apply);
      else await apply();
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the simulator.");
    } finally {
      setChanging(false);
    }
  }
  const disabled = busy || changing;
  const pending = state.jobs.some((job) => job.status !== "Finished");
  const needsAlignment = state.jobs.some((job) => job.status === "NeedsAlignment");
  return (
    <section className="ruby-simulator" aria-label="Simulator controls">
      <div className="ruby-simulator-toolbar">
        <button
          className="ruby-primary"
          disabled={disabled || !pending || state.lidOpen || state.offline || needsAlignment}
          onClick={() => void change({ type: state.playing ? "pause" : "start" })}
        >
          {needsAlignment
            ? "Align stamp below"
            : state.playing
              ? "Pause"
              : state.jobs.some((job) => job.status === "Paused")
                ? "Resume"
                : "Start queue"}
        </button>
        <label>
          Playback speed
          <select
            value={state.speed}
            disabled={disabled}
            onChange={(event) =>
              void change({ type: "speed", value: Number(event.target.value) as 1 | 10 | 60 })
            }
          >
            <option value={1}>1×</option>
            <option value={10}>10×</option>
            <option value={60}>60×</option>
          </select>
        </label>
        <button disabled={disabled} onClick={() => void change({ type: "reset" })}>
          Reset test
        </button>
      </div>
      <details className="ruby-simulator-settings">
        <summary>Test settings</summary>
        <label>
          Time per new job
          <select
            value={state.jobSeconds}
            disabled={disabled}
            onChange={(event) =>
              void change({ type: "jobSeconds", value: Number(event.target.value) })
            }
          >
            <option value={15}>15 seconds</option>
            <option value={60}>1 minute</option>
            <option value={300}>5 minutes</option>
            <option value={900}>15 minutes</option>
          </select>
        </label>
        <p className="ruby-help">
          Synthetic timing for testing. Each job keeps the duration it had when queued.
        </p>
        <div className="ruby-simulator-faults">
          {(
            [
              ["lidOpen", "Lid open"],
              ["offline", "Connection lost"],
              ["rejectNextUpload", "Reject next upload"],
            ] as const
          ).map(([type, label]) => (
            <label key={type}>
              <input
                type="checkbox"
                checked={state[type]}
                disabled={disabled}
                onChange={(event) => void change({ type, value: event.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </details>
      {error && (
        <p role="alert" className="ruby-error">
          {error}
        </p>
      )}
    </section>
  );
}
