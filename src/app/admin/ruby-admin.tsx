"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import {
  collectRuby,
  downloadReport,
  redact,
  rubyOrigin,
  RUBY_CHECKS,
  RUBY_SCHEMA_PATH,
  type RubyReport,
} from "@/lib/ruby-diagnostics";
import "./ruby-admin.css";

const checks = [
  {
    name: "API schema",
    path: RUBY_SCHEMA_PATH,
    detail: "Exact request formats for uploads, profiles, and queueing",
  },
  ...RUBY_CHECKS,
];

export default function RubyAdmin() {
  const [baseUrl, setBaseUrl] = useState("https://localhost:5001");
  const [token, setToken] = useState("");
  const [format, setFormat] = useState<"bearer" | "raw">("bearer");
  const [notes, setNotes] = useState("");
  const [report, setReport] = useState<RubyReport>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  let origin = "";
  try {
    origin = rubyOrigin(baseUrl);
  } catch {
    /* Show validation when the form is submitted. */
  }

  const completed = report?.checks.filter((check) => check.state === "collected").length ?? 0;
  const blocked = report?.checks.some((check) => check.state === "blocked");
  const exportData = () => redact({ ...report, notes }, token.trim().replace(/^Bearer\s+/i, ""));

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running) return;
    setError("");
    setCopied(false);
    try {
      const base = rubyOrigin(baseUrl);
      controller.current = new AbortController();
      setRunning(true);
      setReport({
        version: 1,
        collectedAt: new Date().toISOString(),
        source: "browser",
        baseUrl: base,
        pageOrigin: location.origin,
        userAgent: navigator.userAgent,
        secureContext: isSecureContext,
        auth: { supplied: Boolean(token.trim()), format },
        checks: [],
        notes: "",
      });
      await collectRuby(
        { baseUrl: base, token, format, signal: controller.current.signal },
        (check) => {
          setReport((current) =>
            current ? { ...current, checks: [...current.checks, check] } : current,
          );
        },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the checks.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="ruby-admin">
      <nav className="ruby-nav">
        <Link href="/">
          Purdue Hackers <span>/ Badges</span>
        </Link>
        <span className="ruby-tag">Production setup</span>
      </nav>
      <header className="ruby-header">
        <div className="ruby-eyebrow">BECHTEL · RUBY CONNECTION</div>
        <h1>
          From designs
          <br />
          to the laser queue.
        </h1>
        <p>
          First, let’s learn how this computer runs Ruby. Open this page on the BIDC computer and
          collect a setup report.
        </p>
        <div className="ruby-mode">
          <span /> Read-only diagnostics{" "}
          <span className="ruby-mode-note">No uploads, queue changes, or laser commands.</span>
        </div>
      </header>

      <div className="ruby-grid">
        <section className="ruby-panel">
          <div className="ruby-section-heading">
            <span className="ruby-number">01</span>
            <h2>Connect to Ruby</h2>
          </div>
          <p className="ruby-muted">Keep Ruby and its TrayApp running on this computer.</p>
          <form onSubmit={run}>
            <fieldset disabled={running}>
              <label htmlFor="ruby-address">Ruby API address</label>
              <input
                id="ruby-address"
                type="url"
                required
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="ruby-help">
                Use port 5001 for the API. Port 2402 opens the Ruby dashboard.
              </p>
              <div className="ruby-presets">
                <button type="button" onClick={() => setBaseUrl("https://localhost:5001")}>
                  This computer
                </button>
                <button type="button" onClick={() => setBaseUrl("https://10.165.5.31:5001")}>
                  BIDC network address
                </button>
              </div>
              <label htmlFor="ruby-token">
                Personal Access Token <span>optional for connectivity checks</span>
              </label>
              <input
                id="ruby-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste the Ruby API token"
              />
              <p className="ruby-help">
                Kept in this tab’s memory and sent only to the Ruby address above. Never saved to
                this site or included in the report.
              </p>
              <details className="ruby-advanced">
                <summary>Authentication options</summary>
                <label htmlFor="ruby-auth">Authorization header format</label>
                <select
                  id="ruby-auth"
                  value={format}
                  onChange={(e) => setFormat(e.target.value === "raw" ? "raw" : "bearer")}
                >
                  <option value="bearer">Bearer token</option>
                  <option value="raw">Raw token</option>
                </select>
                <p className="ruby-help">
                  Match the format shown in Ruby’s Swagger “Authorize” dialog. Use a Personal Access
                  Token, not your Ruby password.
                </p>
              </details>
            </fieldset>
            {error ? (
              <p role="alert" className="ruby-error">
                {error}
              </p>
            ) : null}
            <div className="ruby-actions">
              <button className="ruby-primary" type="submit" disabled={running}>
                {running ? "Collecting…" : report ? "Run again" : "Run diagnostics"}
                <span aria-hidden="true">→</span>
              </button>
              {running ? (
                <button type="button" onClick={() => controller.current?.abort()}>
                  Stop
                </button>
              ) : token ? (
                <button type="button" onClick={() => setToken("")}>
                  Clear token
                </button>
              ) : null}
            </div>
          </form>
          {origin ? (
            <a
              className="ruby-text-link"
              href={`${origin}/swagger/index.html`}
              target="_blank"
              rel="noreferrer"
            >
              Open Ruby’s API docs ↗
            </a>
          ) : null}
          <p className="ruby-help">
            If the browser asks for local-network access, allow it for this site. If Ruby shows a
            certificate error, have BIDC staff check its certificate setup.
          </p>
        </section>

        <section className="ruby-panel ruby-results" aria-label="Diagnostic results">
          <div className="ruby-section-heading">
            <span className="ruby-number">02</span>
            <h2>Collect setup data</h2>
            <span className="ruby-count">
              {completed} / {checks.length}
            </span>
          </div>
          <p className="ruby-muted" aria-live="polite">
            {running
              ? "Reading Ruby. Each request has a 15-second timeout."
              : report
                ? `${completed} of ${checks.length} responses collected. This does not verify cutting settings.`
                : "Results appear here as each check finishes."}
          </p>
          <div className="ruby-checks">
            {checks.map((check, index) => {
              const result = report?.checks.find((item) => item.path === check.path);
              const active = running && report?.checks.length === index;
              return (
                <div className="ruby-check" key={check.path}>
                  <span
                    className={`ruby-check-icon ${result?.state ?? (active ? "active" : "waiting")}`}
                    aria-hidden="true"
                  >
                    {result?.state === "collected" ? "✓" : result ? "!" : active ? "…" : "·"}
                  </span>
                  <div>
                    <div className="ruby-check-title">
                      <h3>{check.name}</h3>
                      <span>
                        {result
                          ? result.status
                            ? `HTTP ${result.status}`
                            : "No response"
                          : active
                            ? "Reading"
                            : "Waiting"}
                      </span>
                    </div>
                    <p>{result?.detail ?? check.detail}</p>
                    {result?.data !== undefined ? (
                      <details>
                        <summary>View response</summary>
                        <pre>{JSON.stringify(result.data, undefined, 2)}</pre>
                      </details>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className={`ruby-panel ruby-fallback ${blocked ? "ruby-attention" : ""}`}>
        <div>
          <h2>Browser can’t reach Ruby?</h2>
          <p>
            Use the Windows collector on the BIDC computer. It reads the same API endpoints and
            records CORS response headers, without browser restrictions. It keeps normal certificate
            validation.
          </p>
        </div>
        <a className="ruby-button" href="/ruby-diagnostics.ps1" download>
          Download Windows collector ↓
        </a>
        <details>
          <summary>How to run it</summary>
          <ol>
            <li>Download the script and open PowerShell in your Downloads folder.</li>
            <li>
              Run <code>.\ruby-diagnostics.ps1</code>. Enter the API address and token when
              prompted.
            </li>
            <li>
              Send back the <code>ruby-diagnostics-*.json</code> file saved in that folder, along
              with the browser report.
            </li>
          </ol>
          <p>
            If Windows blocks the script, ask BIDC staff to run it. The collector does not change
            security settings or require administrator access.
          </p>
        </details>
      </section>

      <section className="ruby-panel ruby-export">
        <div className="ruby-section-heading">
          <span className="ruby-number">03</span>
          <h2>Send back the report</h2>
        </div>
        <p className="ruby-muted">
          Includes API schemas, responses, timings, and errors. Your token is removed. A failed
          check is useful too.
        </p>
        <label htmlFor="ruby-notes">
          Anything we should know? <span>optional</span>
        </label>
        <textarea
          id="ruby-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="For example: the profile names you normally use for acrylic and stamp rubber, or the browser error you saw."
          rows={3}
        />
        <div className="ruby-actions">
          <button
            className="ruby-primary"
            disabled={!report || running}
            onClick={() => downloadReport(exportData())}
          >
            Download debug report ↓
          </button>
          <button
            disabled={!report || running}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(JSON.stringify(exportData(), undefined, 2));
                setCopied(true);
              } catch {
                setError("Clipboard access was blocked. Download the report instead.");
              }
            }}
          >
            {copied ? "Copied" : "Copy report"}
          </button>
        </div>
      </section>

      <section className="ruby-next">
        <div className="ruby-eyebrow">WHAT THIS WILL UNLOCK</div>
        <h2>One job per sheet. The right profile for each material.</h2>
        <div className="ruby-pipeline">
          <span>Published badge files</span>
          <b>→</b>
          <span>This BIDC computer</span>
          <b>→</b>
          <span>Ruby import + profile</span>
          <b>→</b>
          <span>Laser queue</span>
        </div>
        <p>
          We’ll use this report to map the saved acrylic and rubber profiles, import the cutting
          sheets at their exact size, and avoid duplicate jobs. The operator checks the setup and
          starts the laser in Ruby.
        </p>
        <p className="ruby-help">
          Next step after diagnostics: a controlled import and queue test. Uploading and queueing
          are not enabled on this page yet.
        </p>
      </section>
      <footer className="ruby-footer">
        <span>Purdue Hackers · Badge production</span>
        <a
          href="https://www.troteclaser.com/en-gb/helpcenter/software/ruby/ruby-2-9"
          target="_blank"
          rel="noreferrer"
        >
          Ruby API documentation ↗
        </a>
      </footer>
    </main>
  );
}
