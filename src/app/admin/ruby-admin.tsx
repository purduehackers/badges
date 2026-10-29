"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { downloadReport } from "@/lib/ruby-diagnostics";
import {
  loadRelease,
  productionFile,
  queueBatch,
  releaseSchema,
  savedBatch,
  type ProductionFile,
  type Release,
} from "@/lib/ruby-batch";
import {
  CONNECTION_KEY,
  connectionSchema,
  duplicateImport,
  receiptSchema,
  RECEIPTS_KEY,
  rubyAccount,
  rubyClient,
  type RubyConnection,
  type RubyDevice,
  type RubyJob,
  type RubyReceipt,
} from "@/lib/ruby-production";
import RubyDiagnostics from "./ruby-diagnostics-panel";
import RubySelection from "./ruby-selection";
import RubyReview from "./ruby-review";
import RubyPlayer from "./ruby-player";
import "./ruby-admin.css";

type Client = ReturnType<typeof rubyClient>;
type Phase = "select" | "review" | "produce";
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Something went wrong. Try again.";
const readReceipts = () =>
  z.array(receiptSchema).parse(JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? "[]"));
const defaults: RubyConnection = {
  baseUrl: "https://localhost:5001",
  token: "",
  targetDevice: "X4-0436",
  displayName: "",
};

export default function RubyAdmin() {
  const [connection, setConnection] = useState(defaults);
  const [client, setClient] = useState<Client>();
  const activeClient = useRef<Client | undefined>(undefined);
  const [device, setDevice] = useState<RubyDevice>();
  const [queue, setQueue] = useState<RubyJob[]>();
  const [statusError, setStatusError] = useState("");
  const [files, setFiles] = useState<ProductionFile[]>([]);
  const [receipts, setReceipts] = useState<RubyReceipt[]>([]);
  const history = useRef<RubyReceipt[]>([]);
  const batchId = useRef<string | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>("select");
  const [releases, setReleases] = useState<Release[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);

  const saveReceipt = useCallback((receipt: RubyReceipt) => {
    const previous = readReceipts();
    const next = previous.some((item) => item.id === receipt.id)
      ? previous.map((item) => (item.id === receipt.id ? receipt : item))
      : [...previous, receipt];
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(next));
    history.current = next;
    setReceipts(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const stored = readReceipts().map(
          (receipt): RubyReceipt =>
            receipt.state === "sending"
              ? {
                  ...receipt,
                  state: "unknown",
                  detail: "This page closed before Ruby confirmed the upload.",
                }
              : receipt,
        );
        localStorage.setItem(RECEIPTS_KEY, JSON.stringify(stored));
        history.current = stored;
        setReceipts(stored);
        const saved = await savedBatch();
        if (cancelled) return;
        setFiles(saved);
        batchId.current = saved.length ? saved[0].batchId : crypto.randomUUID();
        setReady(true);
        const raw = localStorage.getItem(CONNECTION_KEY);
        if (!raw) return;
        const value = connectionSchema.parse(JSON.parse(raw));
        setConnection(value);
        const restored = rubyClient(value);
        const laser = await restored.device();
        if (cancelled) return;
        activeClient.current = restored;
        setClient(restored);
        setDevice(laser);
        if (
          saved.some((file) =>
            duplicateImport(stored, restored.connection, file.digest, file.file.name, file.batchId),
          )
        )
          setPhase("produce");
      } catch (cause) {
        if (!cancelled) setError(message(cause));
      }
    })();
    fetch("/api/admin/releases", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Published designs are unavailable. You can still upload files.");
        const catalog = releaseSchema.parse(await response.json());
        if (!cancelled) setReleases(catalog);
      })
      .catch(() => {
        if (!cancelled)
          setCatalogError("Published designs are unavailable. You can still upload files.");
      });
    const changed = (event: StorageEvent) => {
      if (event.key === CONNECTION_KEY) {
        activeClient.current = undefined;
        setClient(undefined);
        setDevice(undefined);
        setConnection(defaults);
      }
      if (event.key === RECEIPTS_KEY) {
        try {
          history.current = readReceipts();
          setReceipts(history.current);
        } catch {
          setError("Could not read the saved upload history.");
        }
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener("storage", changed);
      activeClient.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!client || phase !== "produce") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const [laser, currentQueue] = await Promise.all([client!.device(), client!.queue()]);
        const currentReceipts = files.flatMap((file) => {
          const receipt = duplicateImport(
            history.current,
            client!.connection,
            file.digest,
            file.file.name,
            file.batchId,
          );
          return receipt?.state === "submitted" ? [receipt] : [];
        });
        const updates = await Promise.all(
          currentReceipts.map(async (receipt) => ({
            receipt,
            jobs: await client!.jobs(receipt.id),
          })),
        );
        if (cancelled) return;
        setDevice(laser);
        setQueue(currentQueue);
        setStatusError("");
        for (const { receipt, jobs: tracked } of updates) {
          const latest = history.current.find((item) => item.id === receipt.id);
          if (!latest) continue;
          const jobs = tracked.length
            ? tracked
            : currentQueue.filter(
                (job) => job.trackingNumber === receipt.id || latest.jobIds?.includes(job.id),
              );
          if (JSON.stringify(latest.jobs) === JSON.stringify(jobs)) continue;
          saveReceipt({
            ...latest,
            jobs,
            ...(jobs.length
              ? {
                  jobIds: jobs.map((job) => job.id),
                  queuedAt: latest.queuedAt ?? new Date().toISOString(),
                  queueError: undefined,
                }
              : {}),
          });
        }
      } catch (cause) {
        if (!cancelled) {
          setStatusError(message(cause));
          setDevice(undefined);
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, 5000);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, phase, files, saveReceipt]);

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
  async function updateFiles(next: ProductionFile[]) {
    await savedBatch(next);
    setFiles(next);
  }
  async function addFiles(incoming: ProductionFile[]) {
    const next = [...files];
    for (const file of incoming)
      if (!next.some((item) => item.digest === file.digest && item.file.name === file.file.name))
        next.push({ ...file, batchId: batchId.current });
    await updateFiles(next);
  }
  async function connect() {
    const current = rubyClient(connection);
    const laser = await current.device();
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(current.connection));
    activeClient.current = current;
    setClient(current);
    setDevice(laser);
    setStatusError("");
    if (
      files.some((file) =>
        duplicateImport(
          history.current,
          current.connection,
          file.digest,
          file.file.name,
          file.batchId,
        ),
      )
    )
      setPhase("produce");
  }
  function disconnect() {
    localStorage.removeItem(CONNECTION_KEY);
    activeClient.current = undefined;
    setClient(undefined);
    setDevice(undefined);
    setQueue(undefined);
    setConnection(defaults);
    setError("");
  }
  async function produce() {
    if (!client || !ready || !files.length) return;
    if (files.some((file) => file.kind === "badge" && !file.materialId))
      throw new Error("Choose acrylic for each badge sheet.");
    if (!navigator.locks) throw new Error("Use a current Chrome or Edge browser to prepare jobs.");
    const current = client;
    setPhase("produce");
    await navigator.locks.request(RECEIPTS_KEY, () =>
      queueBatch(
        current,
        files,
        readReceipts(),
        saveReceipt,
        () => activeClient.current === current,
      ),
    );
  }

  const account = rubyAccount(client?.connection.token ?? connection.token);
  const accountName = account.name ?? client?.connection.displayName ?? connection.displayName;
  const displayName =
    accountName || (account.id ? `Ruby account ${account.id.slice(0, 8)}` : "Ruby account");
  const rubyUrl = client
    ? `${new URL(client.connection.baseUrl).protocol}//${new URL(client.connection.baseUrl).hostname}:2402/app/produce`
    : "";
  const visibleReceipts = receipts.filter(
    (receipt) =>
      client &&
      receipt.baseUrl === client.connection.baseUrl &&
      receipt.targetDevice.toLowerCase() === client.connection.targetDevice.toLowerCase(),
  );

  return (
    <main className="ruby-admin">
      <header className="ruby-nav">
        <Link href="/admin" className="ruby-brand" aria-label="Purdue Hackers badge production">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 0h8v8H8ZM16 8h8v8h-8ZM0 16h8v8H0ZM8 16h8v8H8ZM16 16h8v8h-8Z" />
          </svg>
          <span>
            Purdue Hackers <span className="ruby-muted">/ Badges</span>
          </span>
        </Link>
        {client && (
          <div className="ruby-account">
            <span className="ruby-avatar" aria-hidden="true">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
            <span title={account.id ? `Ruby account ${account.id}` : undefined}>
              <strong>{displayName}</strong>
              <small>{client.connection.targetDevice}</small>
            </span>
            <button className="ruby-text-button" onClick={disconnect} disabled={Boolean(busy)}>
              Sign out
            </button>
          </div>
        )}
      </header>
      {!client ? (
        <section className="ruby-login">
          <h1>Badge production</h1>
          <p>Connect to Ruby on the BIDC computer. Your login stays in this browser.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run("Connecting…", connect);
            }}
          >
            {!account.name && (
              <>
                <label htmlFor="ruby-name">Display name</label>
                <input
                  id="ruby-name"
                  autoComplete="name"
                  placeholder="Your name"
                  value={connection.displayName ?? ""}
                  onChange={(event) =>
                    setConnection({ ...connection, displayName: event.target.value })
                  }
                />
              </>
            )}
            <label htmlFor="ruby-token">Ruby token</label>
            <input
              id="ruby-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
              value={connection.token}
              onChange={(event) => setConnection({ ...connection, token: event.target.value })}
            />
            <details className="ruby-settings">
              <summary>Connection settings</summary>
              <label htmlFor="ruby-address">Ruby API address</label>
              <input
                id="ruby-address"
                type="url"
                required
                value={connection.baseUrl}
                onChange={(event) => setConnection({ ...connection, baseUrl: event.target.value })}
              />
              <label htmlFor="ruby-device">Laser serial number</label>
              <input
                id="ruby-device"
                required
                value={connection.targetDevice}
                onChange={(event) =>
                  setConnection({ ...connection, targetDevice: event.target.value })
                }
              />
            </details>
            <button className="ruby-primary" type="submit" disabled={!ready || Boolean(busy)}>
              {busy || "Connect to Ruby"}
              <span aria-hidden="true">→</span>
            </button>
            <p className="ruby-help">Saved in this browser. Signing out removes the token.</p>
          </form>
        </section>
      ) : (
        <>
          <nav className="ruby-steps" aria-label="Production steps">
            {(["select", "review", "produce"] as const).map((step, index) => (
              <span key={step} aria-current={phase === step ? "step" : undefined}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {step === "select" ? "Select" : step === "review" ? "Review" : "Produce"}
              </span>
            ))}
          </nav>
          {phase === "select" && (
            <RubySelection
              releases={releases}
              files={files}
              busy={Boolean(busy)}
              catalogError={catalogError}
              onRelease={(release: Release) =>
                void run("Loading designs…", async () => addFiles(await loadRelease(release)))
              }
              onUpload={(incoming) =>
                void run("Opening files…", async () =>
                  addFiles(await Promise.all(incoming.map((file) => productionFile(file)))),
                )
              }
              onFiles={(next) => void run("Saving batch…", () => updateFiles(next))}
              onReview={() => {
                setError("");
                setPhase("review");
              }}
            />
          )}
          {phase === "review" && (
            <RubyReview
              files={files}
              busy={Boolean(busy)}
              onBack={() => setPhase("select")}
              onConfirm={() => void run("Preparing jobs…", produce)}
            />
          )}
          {phase === "produce" && (
            <RubyPlayer
              files={files}
              receipts={receipts}
              connection={client.connection}
              device={device}
              queue={queue}
              stale={Boolean(statusError)}
              busy={Boolean(busy)}
              rubyUrl={rubyUrl}
              onCheck={() => void run("Checking jobs…", produce)}
              onNew={() =>
                void run("Starting a new batch…", async () => {
                  await updateFiles([]);
                  batchId.current = crypto.randomUUID();
                  setPhase("select");
                })
              }
            />
          )}
        </>
      )}
      {busy && (
        <p className="ruby-working" role="status">
          <span />
          {busy}
        </p>
      )}
      {error && (
        <p className="ruby-error" role="alert">
          {error}
        </p>
      )}
      {statusError && (
        <p className="ruby-error" role="status">
          {statusError} Progress will update when the connection returns.
        </p>
      )}
      <footer className="ruby-admin-footer">
        <span>Made for Hack Night.</span>
        {client && (
          <div className="ruby-support">
            <RubyDiagnostics
              connection={client.connection}
              receipts={visibleReceipts}
              disabled={Boolean(busy)}
              rubyUrl={rubyUrl}
            />
            {visibleReceipts.length > 0 && (
              <button
                className="ruby-text-button"
                onClick={() => downloadReport({ version: 1, imports: visibleReceipts })}
              >
                Download upload history
              </button>
            )}
          </div>
        )}
      </footer>
    </main>
  );
}
