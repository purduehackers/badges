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
      const saved = z
        .array(receiptSchema)
        .parse(JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? "[]"));
      setReceipts(
        saved.map((item) =>
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
    const errors = [laser, jobs]
      .filter((result) => result.status === "rejected")
      .map((result) => message(result.reason));
    setQueueError(errors.join(" "));
    if (laser.status === "rejected") throw new Error(message(laser.reason));
  }

  async function addFiles(incoming: File[]) {
    const prepared = await Promise.all(incoming.map(prepareSvg));
    setFiles((current) => [
      ...current,
      ...prepared.filter(
        (item, index) =>
          !current.some(
            (existing) => existing.digest === item.digest && existing.file.name === item.file.name,
          ) &&
          prepared.findIndex(
            (other) => other.digest === item.digest && other.file.name === item.file.name,
          ) === index,
      ),
    ]);
  }

  async function importFiles() {
    if (!client || !historyReady) return;
    const connection = client.connection;
    const saved = z
      .array(receiptSchema)
      .parse(JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? "[]"));
    let history = saved;
    const persist = (next: RubyReceipt[]) => {
      localStorage.setItem(RECEIPTS_KEY, JSON.stringify(next));
      history = next;
      setReceipts(next);
    };
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
      persist([...history, receipt]);
      const result = await client.upload(item.file, receipt.id);
      persist(history.map((entry) => (entry.id === receipt.id ? { ...entry, ...result } : entry)));
      // An uncertain import must be checked before continuing a batch.
      if (result.state !== "submitted") break;
    }
    await refresh(client);
  }

  async function checkImport(receipt: RubyReceipt) {
    if (!client) return;
    const jobs = await client.jobs(receipt.id);
    const detail = jobs.length
      ? jobs.map((job) => `${job.name ?? receipt.name}: ${job.status ?? "found"}`).join("; ")
      : "No tracked queue entry yet. The design may still need setup in Ruby; do not re-upload based on this result alone.";
    const saved = z
      .array(receiptSchema)
      .parse(JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? "[]"));
    const next = saved.map((item) =>
      item.id === receipt.id
        ? {
            ...item,
            state: jobs.length
              ? ("submitted" as const)
              : item.state === "sending"
                ? ("unknown" as const)
                : item.state,
            detail,
          }
        : item,
    );
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(next));
    setReceipts(next);
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
  const pending = files.filter(
    (item) => !client || !duplicateImport(receipts, client.connection, item.digest, item.file.name),
  );
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
      <nav className="ruby-nav">
        <Link href="/">
          Purdue Hackers <span>/ Badges</span>
        </Link>
        <span className="ruby-tag">Bechtel · Production</span>
      </nav>
      <header className="ruby-header">
        <div className="ruby-eyebrow">FROM DESIGN TO CUTTING</div>
        <h1>Make the badges.</h1>
        <p>Send your cutting files to Ruby, set up the jobs, and keep an eye on the queue.</p>
      </header>
      <div className="ruby-grid">
        <div className="ruby-stack">
          <section className="ruby-panel">
            <div className="ruby-section-heading">
              <span className="ruby-number">01</span>
              <h2>Connect to Ruby</h2>
            </div>
            {client ? (
              <>
                <p className="ruby-connected">Connected to {client.connection.targetDevice}</p>
                <p className="ruby-muted">{client.connection.baseUrl}</p>
                <div className="ruby-actions">
                  <button
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setClient(undefined);
                      setDevice(undefined);
                      setQueue(undefined);
                      setToken("");
                    }}
                  >
                    Disconnect
                  </button>
                  {rubyUrl && (
                    <a className="ruby-button" href={rubyUrl} target="_blank" rel="noreferrer">
                      Open Ruby ↗
                    </a>
                  )}
                </div>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run("Connecting…", async () => {
                    const next = rubyClient({ baseUrl, token, targetDevice });
                    await refresh(next);
                    setClient(next);
                  });
                }}
              >
                <p className="ruby-muted">Open this page on the BIDC computer with Ruby running.</p>
                <fieldset disabled={Boolean(busy)}>
                  <label htmlFor="ruby-address">Ruby API address</label>
                  <input
                    id="ruby-address"
                    type="url"
                    required
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <label htmlFor="ruby-token">Personal Access Token</label>
                  <input
                    id="ruby-token"
                    type="password"
                    required
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Paste the Ruby token"
                  />
                  <p className="ruby-help">Kept in this tab and sent only to Ruby.</p>
                  <label htmlFor="ruby-device">Laser serial number</label>
                  <input
                    id="ruby-device"
                    required
                    value={targetDevice}
                    onChange={(event) => setTargetDevice(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="ruby-actions">
                    <button className="ruby-primary" type="submit">
                      {busy === "Connecting…" ? busy : "Connect"}
                    </button>
                    {rubyUrl && (
                      <a className="ruby-text-link" href={rubyUrl} target="_blank" rel="noreferrer">
                        Open Ruby ↗
                      </a>
                    )}
                  </div>
                </fieldset>
                <p className="ruby-help">
                  Allow local-network access if your browser asks. For a certificate error, open
                  Ruby and check its certificate setup with BIDC staff.
                </p>
              </form>
            )}
          </section>
          <section className="ruby-panel">
            <div className="ruby-section-heading">
              <span className="ruby-number">02</span>
              <h2>Choose cutting files</h2>
            </div>
            <p className="ruby-muted">
              Published files include the packed sheets and the mirrored stamp.
            </p>
            {releases.length > 0 && (
              <div className="ruby-release-picker">
                <label htmlFor="ruby-version">Hack Night</label>
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
                  Add published files
                </button>
              </div>
            )}
            {catalogError && <p className="ruby-muted">{catalogError}</p>}
            <label htmlFor="ruby-files">Or choose local SVG files</label>
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
            {files.length > 0 && (
              <ul className="ruby-file-list">
                {files.map((item) => {
                  const previous =
                    client &&
                    duplicateImport(receipts, client.connection, item.digest, item.file.name);
                  return (
                    <li key={`${item.file.name}-${item.digest}`}>
                      <div>
                        <strong>{item.file.name}</strong>
                        <span>{item.dimensions}</span>
                        {previous && (
                          <span className="ruby-connected">
                            Import recorded · {stateLabel[previous.state]}
                          </span>
                        )}
                      </div>
                      <button
                        disabled={Boolean(busy)}
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() =>
                          setFiles((current) => current.filter((file) => file !== item))
                        }
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="ruby-actions">
              <button
                className="ruby-primary"
                disabled={!client || !historyReady || !pending.length || Boolean(busy)}
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
                  : `Send ${pending.length || "files"}${pending.length ? ` file${pending.length === 1 ? "" : "s"}` : ""} to Ruby`}
              </button>
            </div>
            <p className="ruby-help">
              Files are sent unchanged, without an import profile. Finish their setup in Ruby.
            </p>
          </section>
        </div>
        <div className="ruby-stack">
          <section className="ruby-panel ruby-queue">
            <div className="ruby-section-heading">
              <h2>Laser queue</h2>
              <button
                disabled={!client || Boolean(busy)}
                onClick={() => client && void run("Refreshing…", () => refresh(client))}
              >
                Refresh
              </button>
            </div>
            {device && (
              <div className="ruby-device">
                <span>
                  {device.serialNo} · {device.status ?? "Status unavailable"}
                </span>
                {device.jobName && <strong>{device.jobName}</strong>}
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
            {queue ? (
              queue.length ? (
                <ol className="ruby-queue-list">
                  {queue.map((job) => (
                    <li key={job.id}>
                      <span>{job.name ?? "Untitled job"}</span>
                      <span
                        className={`ruby-job-status ${job.status === "Running" ? "ruby-connected" : ""}`}
                      >
                        {job.status ?? "Unknown"}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="ruby-empty">Ruby’s queue is empty.</p>
              )
            ) : (
              <p className="ruby-empty">Connect to see the laser and its queued jobs.</p>
            )}
            {client && refreshedAt && (
              <p className="ruby-help">Last checked at {refreshedAt}. Use Refresh to update.</p>
            )}
          </section>
          <section className="ruby-panel ruby-handoff">
            <div className="ruby-section-heading">
              <span className="ruby-number">03</span>
              <h2>Finish setup in Ruby</h2>
            </div>
            <ol>
              <li>Find the imported designs and check their physical size.</li>
              <li>Set the material, processing settings, and placement for each sheet.</li>
              <li>Review the cutting preview, then add the jobs to Ruby’s queue.</li>
            </ol>
            <p className="ruby-help">
              Published stamp files are already mirrored. Keep that orientation.
            </p>
            {rubyUrl && (
              <a className="ruby-button" href={rubyUrl} target="_blank" rel="noreferrer">
                Open Ruby ↗
              </a>
            )}
          </section>
        </div>
      </div>
      {busy && (
        <p role="status" className="ruby-activity">
          {busy}
        </p>
      )}
      {error && (
        <p role="alert" className="ruby-error ruby-page-error">
          {error}
        </p>
      )}
      {visibleReceipts.length > 0 && (
        <section className="ruby-panel ruby-imports">
          <div className="ruby-section-heading">
            <h2>Import receipts</h2>
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
          </div>
          <p className="ruby-muted">
            Saved in this browser to prevent repeat uploads. An accepted upload still needs setup in
            Ruby.
          </p>
          <ul>
            {visibleReceipts.map((receipt) => (
              <li key={receipt.id}>
                <div>
                  <strong>{receipt.name}</strong>
                  <span className={`ruby-receipt-state ${receipt.state}`}>
                    {stateLabel[receipt.state]}
                  </span>
                  <p>{receipt.detail}</p>
                  <details>
                    <summary>Tracking number</summary>
                    <code>{receipt.id}</code>
                  </details>
                </div>
                <button
                  disabled={
                    Boolean(busy) || receipt.state === "sending" || receipt.state === "rejected"
                  }
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
              </li>
            ))}
          </ul>
        </section>
      )}
      <RubyDiagnostics
        connection={client?.connection ?? { baseUrl, token, targetDevice }}
        receipts={receipts}
        disabled={Boolean(busy)}
      />
      <footer className="ruby-footer">
        <span>Purdue Hackers · Badge production</span>
        <a href="https://github.com/purduehackers/badge-designs" target="_blank" rel="noreferrer">
          Published badge files ↗
        </a>
      </footer>
    </main>
  );
}
