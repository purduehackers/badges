"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { downloadReport, rubyOrigin } from "@/lib/ruby-diagnostics";
import {
  duplicateImport,
  prepareSvg,
  receiptSchema,
  RECEIPTS_KEY,
  rubyClient,
  type RubyDevice,
  type RubyJob,
  type RubyReceipt,
} from "@/lib/ruby-production";
import RubyDiagnostics from "./ruby-diagnostics-panel";
import "./ruby-admin.css";

type Client = ReturnType<typeof rubyClient>;
type CuttingFile = Awaited<ReturnType<typeof prepareSvg>>;
const releaseSchema = z.array(
  z.object({ version: z.string(), files: z.array(z.object({ name: z.string(), url: z.url() })) }),
);
type Release = z.infer<typeof releaseSchema>[number];
const stateLabel = {
  sending: "Sending",
  submitted: "Upload accepted",
  rejected: "Upload rejected",
  unknown: "Check in Ruby",
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Please try again.";

function readReceipts() {
  return z.array(receiptSchema).parse(JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? "[]"));
}

export default function RubyAdmin() {
  const [baseUrl, setBaseUrl] = useState("https://localhost:5001");
  const [token, setToken] = useState("");
  const [targetDevice, setTargetDevice] = useState("X4-0436");
  const [client, setClient] = useState<Client>();
  const [device, setDevice] = useState<RubyDevice>();
  const [queue, setQueue] = useState<RubyJob[]>();
  const [refreshedAt, setRefreshedAt] = useState("");
  const [queueError, setQueueError] = useState("");
  const [files, setFiles] = useState<CuttingFile[]>([]);
  const [receipts, setReceipts] = useState<RubyReceipt[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [releases, setReleases] = useState<Release[]>([]);
  const [version, setVersion] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);

  useEffect(() => {
    try {
      setReceipts(
        readReceipts().map((item) =>
          item.state === "sending"
            ? {
                ...item,
                state: "unknown",
                detail:
                  "This page closed before the upload was confirmed. Check Ruby before trying again.",
              }
            : item,
        ),
      );
      setHistoryReady(true);
    } catch {
      setError(
        "Could not read import history. Allow browser storage before uploading so imports can be tracked.",
      );
    }
    const controller = new AbortController();
    fetch("/api/admin/releases", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Published files are unavailable. You can still choose local files.");
        const catalog = releaseSchema.parse(await response.json());
        setReleases(catalog);
        setVersion(catalog[0]?.version ?? "");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCatalogError("Published files are unavailable. You can still choose local files.");
      });
    return () => controller.abort();
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(message(cause));
    } finally {
      lock.current = false;
      setBusy("");
    }
  }

  async function refresh(current: Client) {
    setQueueError("");
    const [laser, jobs] = await Promise.allSettled([current.device(), current.queue()]);
    setDevice(laser.status === "fulfilled" ? laser.value : undefined);
    setQueue(jobs.status === "fulfilled" ? jobs.value : undefined);
    setRefreshedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    setQueueError(jobs.status === "rejected" ? message(jobs.reason) : "");
    if (laser.status === "rejected") throw new Error(message(laser.reason));
  }

  async function addFiles(incoming: File[]) {
    const prepared = await Promise.all(incoming.map(prepareSvg));
    setFiles((current) => {
      const next = [...current];
      for (const item of prepared) {
        if (
          !next.some((other) => other.digest === item.digest && other.file.name === item.file.name)
        )
          next.push(item);
      }
      return next;
    });
  }

  function saveReceipts(next: RubyReceipt[]) {
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(next));
    setReceipts(next);
  }

  async function importFiles() {
    if (!client || !historyReady) return;
    const connection = client.connection;
    let history = readReceipts();
    for (const item of files) {
      if (duplicateImport(history, connection, item.digest, item.file.name)) continue;
      const receipt: RubyReceipt = {
        id: `ph-${crypto.randomUUID()}`,
        name: item.file.name,
        digest: item.digest,
        baseUrl: connection.baseUrl,
        targetDevice: connection.targetDevice,
        startedAt: new Date().toISOString(),
        state: "sending",
        detail: "Waiting for Ruby’s upload response.",
      };
      history = [...history, receipt];
      saveReceipts(history);
      const result = await client.upload(item.file, receipt.id);
      history = history.map((entry) => (entry.id === receipt.id ? { ...entry, ...result } : entry));
      saveReceipts(history);
      // An uncertain import must be checked before continuing a batch.
      if (result.state !== "submitted") {
        setError(
          result.state === "unknown"
            ? "Couldn’t confirm the upload. Check Ruby before sending this file again."
            : result.detail,
        );
        break;
      }
    }
    await refresh(client);
  }

  async function checkImport(receipt: RubyReceipt) {
    if (!client) return;
    const jobs = await client.jobs(receipt.id);
    const detail = jobs.length
      ? jobs.map((job) => `${job.name ?? receipt.name}: ${job.status ?? "found"}`).join("; ")
      : "No tracked queue entry yet. The design may still need setup in Ruby; do not re-upload based on this result alone.";
    saveReceipts(
      readReceipts().map((item) => {
        if (item.id !== receipt.id) return item;
        let state = item.state;
        if (jobs.length) state = "submitted";
        else if (state === "sending") state = "unknown";
        return { ...item, state, detail };
      }),
    );
    await refresh(client);
  }

  let rubyUrl = "";
  try {
    const url = new URL(rubyOrigin(baseUrl));
    url.port = "2402";
    rubyUrl = url.origin;
  } catch {
    /* Validate the address on connect. */
  }
  const selectedFiles = files.map((item) => ({
    item,
    receipt: client
      ? duplicateImport(receipts, client.connection, item.digest, item.file.name)
      : undefined,
  }));
  const pendingCount = selectedFiles.filter(({ receipt }) => !receipt).length;
  const uploaded =
    selectedFiles.length > 0 &&
    selectedFiles.every(({ receipt }) => receipt?.state === "submitted");
  const visibleReceipts = receipts
    .filter(
      (item) =>
        client &&
        item.baseUrl === client.connection.baseUrl &&
        item.targetDevice.toLowerCase() === client.connection.targetDevice.toLowerCase(),
    )
    .toReversed();

  return (
    <main className="ruby-admin">
      <nav className="ruby-nav" aria-label="Badge navigation">
        <Link href="/" className="ruby-brand" aria-label="Purdue Hackers Badges home">
          <svg viewBox="0 0 172 166" fill="none" aria-hidden="true">
            <path
              d="M57.333 166H0V110.667H57.333V166ZM114.667 55.333H172V166H114.667V110.667H57.333V0H114.667V55.333Z"
              fill="currentColor"
            />
          </svg>
          <span>
            Purdue Hackers <span className="ruby-muted">/ Badges</span>
          </span>
        </Link>
      </nav>
      <h1>Badge production</h1>
      {client ? (
        <div className="ruby-connection">
          <p className="ruby-success">Connected to {client.connection.targetDevice}</p>
          <button
            className="ruby-text-button"
            disabled={Boolean(busy)}
            onClick={() => {
              setClient(undefined);
              setDevice(undefined);
              setQueue(undefined);
              setQueueError("");
              setError("");
              setToken("");
            }}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <form
          className="ruby-connect"
          onSubmit={(event) => {
            event.preventDefault();
            void run("Connecting…", async () => {
              const next = rubyClient({ baseUrl, token, targetDevice });
              await refresh(next);
              setClient(next);
            });
          }}
        >
          <p className="ruby-muted">Connect to Ruby on the BIDC computer.</p>
          <fieldset disabled={Boolean(busy)}>
            <label htmlFor="ruby-token">Ruby token</label>
            <div className="ruby-row">
              <input
                id="ruby-token"
                type="password"
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your Personal Access Token"
              />
              <button className="ruby-primary" type="submit">
                {busy === "Connecting…" ? busy : "Connect"}
              </button>
            </div>
            <details className="ruby-settings">
              <summary>Connection settings</summary>
              <label htmlFor="ruby-address">Ruby API address</label>
              <input
                id="ruby-address"
                type="url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <label htmlFor="ruby-device">Laser serial number</label>
              <input
                id="ruby-device"
                value={targetDevice}
                onChange={(event) => setTargetDevice(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="ruby-help">Your token stays in this tab and is sent only to Ruby.</p>
            </details>
          </fieldset>
        </form>
      )}
      {client && (
        <section className="ruby-files" aria-label="Cutting files">
          {releases.length > 0 && (
            <>
              <label htmlFor="ruby-version">Hack Night</label>
              <div className="ruby-row">
                <select
                  id="ruby-version"
                  value={version}
                  disabled={Boolean(busy)}
                  onChange={(event) => setVersion(event.target.value)}
                >
                  {releases.map((release) => (
                    <option key={release.version} value={release.version}>
                      Hack Night {release.version}
                    </option>
                  ))}
                </select>
                <button
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("Loading files…", async () => {
                      const release = releases.find((item) => item.version === version);
                      if (!release) return;
                      const downloads = await Promise.all(
                        release.files.map(async (item) => {
                          const response = await fetch(item.url, {
                            credentials: "omit",
                            referrerPolicy: "no-referrer",
                            signal: AbortSignal.timeout(30_000),
                          });
                          if (!response.ok) throw new Error(`Could not download ${item.name}.`);
                          return new File(
                            [await response.blob()],
                            `${release.version}-${item.name}`,
                            { type: "image/svg+xml" },
                          );
                        }),
                      );
                      await addFiles(downloads);
                    })
                  }
                >
                  {busy === "Loading files…" ? busy : "Load files"}
                </button>
              </div>
            </>
          )}
          {catalogError && <p className="ruby-help">{catalogError}</p>}
          <label className="ruby-file-picker" htmlFor="ruby-files">
            Choose local SVGs
            <input
              id="ruby-files"
              type="file"
              accept=".svg,image/svg+xml"
              multiple
              disabled={Boolean(busy)}
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                event.target.value = "";
                void run("Reading files…", () => addFiles(selected));
              }}
            />
          </label>
          {files.length > 0 && (
            <>
              <ul className="ruby-file-list">
                {selectedFiles.map(({ item, receipt }) => (
                  <li key={`${item.file.name}-${item.digest}`}>
                    <div>
                      <strong>{item.file.name}</strong>
                      <p className="ruby-help">{item.dimensions}</p>
                      {receipt && !uploaded && (
                        <p className={`ruby-status ${receipt.state}`}>
                          {stateLabel[receipt.state]}
                        </p>
                      )}
                    </div>
                    <button
                      className="ruby-text-button"
                      disabled={Boolean(busy)}
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() => setFiles((current) => current.filter((file) => file !== item))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              {uploaded ? (
                <div className="ruby-handoff">
                  <p>
                    Files uploaded. Check the size, material, and placement in Ruby, then add the
                    jobs to its queue.
                  </p>
                  <p className="ruby-help">Published stamps are already mirrored.</p>
                  <a
                    className="ruby-button ruby-primary"
                    href={rubyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Continue in Ruby ↗
                  </a>
                </div>
              ) : (
                pendingCount > 0 && (
                  <button
                    className="ruby-primary"
                    disabled={!historyReady || Boolean(busy)}
                    onClick={() =>
                      void run("Sending files to Ruby…", async () => {
                        if (!navigator.locks)
                          throw new Error(
                            "Use a current Chrome or Edge browser to track uploads safely.",
                          );
                        await navigator.locks.request(RECEIPTS_KEY, importFiles);
                      })
                    }
                  >
                    {busy === "Sending files to Ruby…"
                      ? busy
                      : `Send ${pendingCount} file${pendingCount === 1 ? "" : "s"} to Ruby`}
                  </button>
                )
              )}
            </>
          )}
        </section>
      )}
      {busy && (
        <p role="status" className="ruby-sr-only">
          {busy}
        </p>
      )}
      {error && (
        <p role="alert" className="ruby-error">
          {error}
        </p>
      )}
      {visibleReceipts.length > 0 && (
        <details
          className="ruby-disclosure ruby-imports"
          open={visibleReceipts[0]?.state === "unknown" || visibleReceipts[0]?.state === "rejected"}
        >
          <summary>Upload history</summary>
          <ul>
            {visibleReceipts.map((receipt) => (
              <li key={receipt.id}>
                <strong>{receipt.name}</strong>
                <p className={`ruby-status ${receipt.state}`}>{stateLabel[receipt.state]}</p>
                {receipt.state !== "submitted" && <p className="ruby-help">{receipt.detail}</p>}
                {receipt.state === "unknown" && (
                  <button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("Checking import…", async () => {
                        if (!navigator.locks)
                          throw new Error("Use a current Chrome or Edge browser to check imports.");
                        await navigator.locks.request(RECEIPTS_KEY, () => checkImport(receipt));
                      })
                    }
                  >
                    Check import
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            disabled={Boolean(busy)}
            onClick={() =>
              downloadReport({
                version: 1,
                collectedAt: new Date().toISOString(),
                imports: visibleReceipts,
              })
            }
          >
            Download receipts
          </button>
        </details>
      )}
      {client && (
        <details className="ruby-disclosure" open={Boolean(queueError)}>
          <summary>Laser queue{queue && ` · ${queue.length}`}</summary>
          {device && (
            <div className="ruby-device">
              <p>
                {device.status ?? "Status unavailable"}
                {device.jobName && ` · ${device.jobName}`}
              </p>
              {device.status === "Busy" && device.progress !== undefined && (
                <progress
                  max={100}
                  value={device.progress}
                  aria-label="Current laser job progress"
                />
              )}
            </div>
          )}
          {queueError && (
            <p role="alert" className="ruby-error">
              {queueError}
            </p>
          )}
          {queue &&
            (queue.length ? (
              <ol className="ruby-queue-list">
                {queue.map((job) => (
                  <li key={job.id}>
                    <span>{job.name ?? "Untitled job"}</span>
                    <span className="ruby-muted">{job.status ?? "Unknown"}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="ruby-help">No queued jobs.</p>
            ))}
          <div className="ruby-actions">
            <button
              disabled={Boolean(busy)}
              onClick={() => void run("Refreshing…", () => refresh(client))}
            >
              {busy === "Refreshing…" ? busy : "Refresh"}
            </button>
            {refreshedAt && <span className="ruby-help">Updated {refreshedAt}</span>}
          </div>
        </details>
      )}
      <RubyDiagnostics
        connection={client?.connection ?? { baseUrl, token, targetDevice }}
        receipts={receipts}
        disabled={Boolean(busy)}
        rubyUrl={rubyUrl}
      />
    </main>
  );
}
