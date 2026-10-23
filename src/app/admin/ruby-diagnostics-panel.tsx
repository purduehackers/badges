"use client";

import { useState } from "react";
import { collectRuby, downloadReport, redact, type RubyReport } from "@/lib/ruby-diagnostics";
import type { RubyConnection, RubyReceipt } from "@/lib/ruby-production";

export default function RubyDiagnostics({
  connection,
  receipts,
  disabled,
}: {
  connection: RubyConnection;
  receipts: RubyReceipt[];
  disabled: boolean;
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
      notes: "",
    });
    try {
      await collectRuby(
        { ...connection, format: "personal-access-token", signal: AbortSignal.timeout(100_000) },
        (check) =>
          setReport((current) => current && { ...current, checks: [...current.checks, check] }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not collect diagnostics.");
    } finally {
      setRunning(false);
    }
  }
  return (
    <details className="ruby-panel ruby-diagnostics">
      <summary>Connection diagnostics</summary>
      <p className="ruby-muted">
        Collect a report if Ruby cannot connect or an import fails. The token is removed.
      </p>
      <div className="ruby-actions">
        <button onClick={collect} disabled={disabled || running}>
          {running ? "Collecting…" : "Collect debug report"}
        </button>
        <button
          disabled={!report || running}
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
        <a className="ruby-text-link" href="/ruby-diagnostics.ps1" download>
          Windows collector ↓
        </a>
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
