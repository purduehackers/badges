"use client";

import { useState } from "react";
import { collectRuby, downloadReport, redact, type RubyReport } from "@/lib/ruby-diagnostics";
import type { RubyConnection, RubyReceipt } from "@/lib/ruby-production";

export default function RubyDiagnostics({
  connection,
  receipts,
  disabled,
  rubyUrl,
}: {
  connection: RubyConnection;
  receipts: RubyReceipt[];
  disabled: boolean;
  rubyUrl: string;
}) {
  const [report, setReport] = useState<RubyReport>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  async function collect() {
    setRunning(true);
    setError("");
    setReport({
      version: 1,
      collectedAt: new Date().toISOString(),
      source: "browser",
      baseUrl: connection.baseUrl,
      targetDevice: connection.targetDevice,
      pageOrigin: location.origin,
      userAgent: navigator.userAgent,
      secureContext: isSecureContext,
      auth: { supplied: Boolean(connection.token), format: "personal-access-token" },
      checks: [],
    });
    try {
      await collectRuby({ ...connection, signal: AbortSignal.timeout(100_000) }, (check) =>
        setReport((current) => current && { ...current, checks: [...current.checks, check] }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not collect diagnostics.");
    } finally {
      setRunning(false);
    }
  }
  return (
    <details className="ruby-disclosure">
      <summary>Connection help</summary>
      <p className="ruby-muted">
        Keep Ruby running and allow local-network access. For certificate errors, check the setup
        with BIDC staff.
      </p>
      {rubyUrl && (
        <p>
          <a className="ruby-text-link" href={rubyUrl} target="_blank" rel="noreferrer">
            Open Ruby ↗
          </a>
        </p>
      )}
      <div className="ruby-actions">
        <button onClick={collect} disabled={disabled || running}>
          {running ? "Collecting…" : "Collect debug report"}
        </button>
        {report && !running && (
          <button
            onClick={() =>
              downloadReport(
                redact(
                  { ...report, imports: receipts },
                  connection.token.trim().replace(/^PersonalAccessToken\s+/i, ""),
                ),
              )
            }
          >
            Download report
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="ruby-error">
          {error}
        </p>
      )}
      {report && (
        <ul className="ruby-diagnostic-list">
          {report.checks.map((check) => (
            <li key={check.path}>
              <strong>{check.name}</strong>
              <span>
                {check.status ?? "No response"} · {check.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
