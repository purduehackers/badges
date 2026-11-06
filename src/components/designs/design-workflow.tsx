"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ph/button";
import { DitherButton } from "@/components/ph/dither-button";
import { Field } from "@/components/ph/field";
import { Input } from "@/components/ph/input";
import { Checkbox } from "@/components/ph/checkbox";
import { Badge } from "@/components/ph/badge";
import { DesignFiles, SheetPicker, CheckResults } from "./design-inputs";
import {
  roles,
  designRequest,
  type DesignCatalog,
  type DesignChecks,
  type DesignPair,
  type DesignRole,
  type DesignSheet,
  type DesignLayout,
  type DesignUpload,
} from "@/lib/designs";
import type { PreviewDesign } from "@/components/design-preview";
import { designDraft } from "@/lib/browser-store";
import { productionFile, savedBatch } from "@/lib/ruby-batch";

const DesignPreview = dynamic(() => import("@/components/design-preview"), {
  ssr: false,
  loading: () => <div className="preview-loading">Preparing render…</div>,
});
type Phase = "upload" | "review" | "manufacture" | "ready";
type Draft = {
  files: Partial<DesignPair>;
  sheets: DesignSheet[];
  version: string;
  date: string;
  phase: Phase;
  checks?: DesignChecks;
  confirmed: boolean;
  target: string;
  min: string;
  max: string;
  layout?: DesignLayout;
};
const empty: Draft = {
  files: {},
  sheets: [],
  version: "",
  date: "",
  phase: "upload",
  confirmed: false,
  target: "90",
  min: "1.8",
  max: "2.5",
};

export default function DesignWorkflow() {
  const [draft, setDraft] = useState<Draft>(empty);
  const [catalog, setCatalog] = useState<DesignCatalog>({ events: [], stock: [], notices: [] });
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [renders, setRenders] = useState({ badge: false, stamp: false });
  const renderStatus = useCallback(
    (role: DesignRole, ready: boolean) =>
      setRenders((previous) =>
        previous[role] === ready ? previous : { ...previous, [role]: ready },
      ),
    [],
  );
  const lock = useRef(false);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void designDraft<Draft>()
      .then((value) => {
        if (live) {
          if (value) setDraft(value);
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (live) {
          setError(cause.message);
          setLoaded(true);
        }
      });
    void fetch("/api/designs", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((value: DesignCatalog) => {
        if (live) setCatalog(value);
      })
      .catch(() => {
        if (live)
          setCatalog({
            events: [],
            stock: [],
            notices: ["Event and inventory suggestions are unavailable. Enter your details below."],
          });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      void designDraft(draft).catch((cause) => setError(cause.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, loaded]);
  const materialId = draft.sheets[0]?.material.materialId;
  const thicknessMm = draft.sheets[0]?.material.thicknessMm ?? 3.175;
  const previews = useMemo<PreviewDesign[]>(
    () =>
      draft.checks && materialId
        ? roles.map((role) => ({
            svg: draft.checks![role].svg,
            file: { name: draft.checks![role].name },
            kind: role,
            materialId: role === "badge" ? materialId : undefined,
            thicknessMm: role === "badge" ? thicknessMm : 2.3,
            mirrored: false,
            sizeIn: draft.layout?.sizeIn,
          }))
        : [],
    [draft.checks, materialId, thicknessMm, draft.layout?.sizeIn],
  );

  function change(values: Partial<Draft>) {
    setDraft((previous) => ({ ...previous, ...values }));
    setError("");
  }
  async function checkpoint(values: Partial<Draft>) {
    await designDraft({ ...draft, ...values });
    change(values);
  }
  function revise(role: DesignRole, file: DesignUpload) {
    setDraft((previous) => ({
      ...previous,
      files: { ...previous.files, [role]: file },
      checks: undefined,
      layout: undefined,
      confirmed: false,
      phase: "upload",
    }));
    setError("");
  }
  async function run(label: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finish this step. Try again.");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function check() {
    const checks = await designRequest<DesignChecks>(draft.files);
    await checkpoint({
      checks,
      layout: undefined,
      confirmed: false,
      phase: checks.badge.passed && checks.stamp.passed ? "review" : "upload",
    });
  }
  async function arrange() {
    if (
      !Number.isInteger(Number(draft.target)) ||
      Number(draft.target) < 1 ||
      Number(draft.target) > 500
    )
      throw new Error("Enter a whole number of badges between 1 and 500.");
    if (
      ![Number(draft.min), Number(draft.max)].every(Number.isFinite) ||
      Number(draft.min) < 1.8 ||
      Number(draft.max) > 10 ||
      Number(draft.max) < Number(draft.min)
    )
      throw new Error("Choose a size range between 1.8 and 10 inches, with the minimum first.");
    const layout = await designRequest<DesignLayout>({
      ...draft.files,
      confirmed: draft.confirmed,
      target: Number(draft.target),
      minSizeIn: Number(draft.min),
      maxSizeIn: Number(draft.max),
      sheets: draft.sheets,
    });
    await checkpoint({ layout, phase: "ready" });
  }
  async function prepare() {
    if (!draft.layout || draft.layout.shortfall) return;
    const batchId = crypto.randomUUID();
    const files = await Promise.all(
      draft.layout.files.map(async (file) => ({
        ...(await productionFile(
          new File([file.svg], file.name, { type: "image/svg+xml" }),
          draft.version || undefined,
        )),
        kind: file.kind,
        materialId: file.materialId,
        thicknessMm: file.thicknessMm,
        previewSvg: file.previewSvg,
        mirrored: file.kind === "stamp",
        batchId,
      })),
    );
    await savedBatch(files, "handoff");
    await designDraft(draft);
    router.push("/admin?batch=prepared");
  }
  const phaseIndex = ["upload", "review", "manufacture", "ready"].indexOf(draft.phase);
  const disabled = !loaded || Boolean(busy);
  return (
    <main className="design-workflow">
      <header className="page-heading">
        <h1 className="ph-headline">Make your mark.</h1>
        <p>From your badge design to the cutting table.</p>
      </header>
      <ol className="workflow-steps" aria-label="Badge workflow">
        {["Upload designs", "Check designs", "Arrange badges", "Cutting files"].map(
          (label, index) => (
            <li key={label} aria-current={index === phaseIndex ? "step" : undefined}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {label}
            </li>
          ),
        )}
      </ol>
      {!loaded ? (
        <p role="status">Loading your draft…</p>
      ) : (
        <fieldset disabled={disabled}>
          {draft.phase === "upload" && (
            <>
              <div className="section-heading">
                <h2>Your designs</h2>
                <p>
                  Upload a badge and stamp. We’ll check the files before you double-check the
                  designs.
                </p>
              </div>
              <DesignFiles
                files={draft.files}
                checks={draft.checks}
                busy={disabled}
                onUpload={revise}
              />
              <section className="event-picker">
                <h2>Hack Night</h2>
                {catalog.events.length > 0 && (
                  <Field label="Choose an event" htmlFor="design-event">
                    <select
                      id="design-event"
                      value={
                        catalog.events.find(
                          (e) => e.version === draft.version && e.date === draft.date,
                        )?.id ?? ""
                      }
                      onChange={(e) => {
                        const event = catalog.events.find((item) => item.id === e.target.value);
                        if (event) change({ version: event.version, date: event.date });
                      }}
                    >
                      <option value="">Choose a Hack Night…</option>
                      {catalog.events.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} · {e.date}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <div className="form-row">
                  <Field label="Version" htmlFor="design-version">
                    <Input
                      id="design-version"
                      placeholder="7.8"
                      value={draft.version}
                      onChange={(e) => change({ version: e.target.value })}
                    />
                  </Field>
                  <Field label="Date" htmlFor="design-date">
                    <Input
                      id="design-date"
                      type="date"
                      value={draft.date}
                      onChange={(e) => change({ date: e.target.value })}
                    />
                  </Field>
                </div>
              </section>
              {catalog.notices.map((notice) => (
                <p key={notice} className="help">
                  {notice}
                </p>
              ))}
              <SheetPicker
                catalog={catalog}
                sheets={draft.sheets}
                busy={disabled}
                onChange={(sheets) => change({ sheets, confirmed: false, layout: undefined })}
              />
              <div className="step-actions">
                <DitherButton
                  disabled={
                    disabled ||
                    !draft.files.badge ||
                    !draft.files.stamp ||
                    !draft.sheets.length ||
                    !/^\d+\.\d+$/.test(draft.version) ||
                    !draft.date
                  }
                  onClick={() => void run("Checking files…", check)}
                >
                  Check designs
                </DitherButton>
              </div>
            </>
          )}
          {draft.phase === "review" && (
            <>
              <div className="section-heading">
                <h2>Check your designs</h2>
                <p>
                  Check the version, date, readability, and thin connections. Make sure the stamp
                  impression looks right.
                </p>
              </div>
              <dl className="design-facts">
                <div>
                  <dt>Version</dt>
                  <dd>{draft.version}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>
                    {draft.date.split("-").slice(1).concat(draft.date.split("-")[0]!).join("/")}
                  </dd>
                </div>
              </dl>
              <div className="design-pair render-pair">
                {previews.map((file) => (
                  <figure key={file.kind}>
                    <figcaption>{file.file.name}</figcaption>
                    <DesignPreview file={file} onStatus={renderStatus} />
                  </figure>
                ))}
              </div>
              <details className="qa-disclosure">
                <summary>Automatic QA passed</summary>
                {draft.checks && <CheckResults checks={draft.checks} />}
              </details>
              <Checkbox
                checked={draft.confirmed}
                disabled={disabled}
                onChange={(e) => change({ confirmed: e.target.checked })}
              >
                I checked both designs. They’re ready to make.
              </Checkbox>
              <div className="step-actions">
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => change({ phase: "upload", confirmed: false, layout: undefined })}
                >
                  Change designs or acrylic
                </Button>
                <DitherButton
                  disabled={
                    disabled ||
                    !draft.confirmed ||
                    !materialId ||
                    previews.length !== 2 ||
                    !renders.badge ||
                    !renders.stamp
                  }
                  onClick={() =>
                    void run("Saving designs…", () => checkpoint({ phase: "manufacture" }))
                  }
                >
                  Confirm designs
                </DitherButton>
              </div>
            </>
          )}
          {draft.phase === "manufacture" && (
            <>
              <div className="section-heading">
                <h2>How many badges?</h2>
                <p>
                  We’ll find a larger size that fits your minimum, then fill the remaining space.
                </p>
              </div>
              <div className="qa-summary">
                <Badge color="lime">Automatic QA passed</Badge>
                <Badge color="lime">Manual QA passed</Badge>
              </div>
              <div className="quantity-presets">
                {[80, 90, 100].map((count) => (
                  <Button
                    key={count}
                    variant={draft.target === String(count) ? "solid" : "outline"}
                    onClick={() => change({ target: String(count), layout: undefined })}
                  >
                    {count} badges
                  </Button>
                ))}
              </div>
              <Field label="Minimum badges" htmlFor="target">
                <Input
                  id="target"
                  type="number"
                  min="1"
                  max="500"
                  value={draft.target}
                  onChange={(e) => change({ target: e.target.value, layout: undefined })}
                />
              </Field>
              <details className="size-settings">
                <summary>Badge size range</summary>
                <p className="help">
                  Longest side, in inches. Use a larger range for long shapes such as swords.
                </p>
                <div className="form-row">
                  <Field label="Minimum (in)" htmlFor="size-min">
                    <Input
                      id="size-min"
                      type="number"
                      min="1.8"
                      max="10"
                      step="0.05"
                      value={draft.min}
                      onChange={(e) => change({ min: e.target.value, layout: undefined })}
                    />
                  </Field>
                  <Field label="Maximum (in)" htmlFor="size-max">
                    <Input
                      id="size-max"
                      type="number"
                      min="1.8"
                      max="10"
                      step="0.05"
                      value={draft.max}
                      onChange={(e) => change({ max: e.target.value, layout: undefined })}
                    />
                  </Field>
                </div>
              </details>
              <SheetPicker
                catalog={catalog}
                sheets={draft.sheets}
                busy={disabled}
                onChange={(sheets) => {
                  const palette = (values: DesignSheet[]) =>
                    [
                      ...new Set(
                        values.map(
                          (sheet) => `${sheet.material.materialId}:${sheet.material.thicknessMm}`,
                        ),
                      ),
                    ]
                      .sort()
                      .join(",");
                  const changedMaterial = palette(sheets) !== palette(draft.sheets);
                  change({
                    sheets,
                    layout: undefined,
                    ...(changedMaterial
                      ? { phase: sheets.length ? "review" : "upload", confirmed: false }
                      : {}),
                  });
                }}
              />
              <div className="step-actions">
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => change({ phase: "review" })}
                >
                  Back
                </Button>
                <DitherButton
                  disabled={disabled || !draft.sheets.length}
                  onClick={() => void run("Arranging badges…", arrange)}
                >
                  Arrange badges
                </DitherButton>
              </div>
            </>
          )}
          {draft.phase === "ready" && draft.layout && (
            <>
              <div className="section-heading">
                <h2>{draft.layout.shortfall ? "Not enough space" : "Ready to make"}</h2>
                <p>
                  {draft.layout.count} badges at {Number(draft.layout.widthIn.toFixed(2))} ×{" "}
                  {Number(draft.layout.heightIn.toFixed(2))} inches.
                </p>
              </div>
              {draft.layout.shortfall && (
                <p className="notice">
                  This layout falls short of your {draft.target}-badge minimum. Add sheets or change
                  the size range.
                </p>
              )}
              <Image
                className="layout-preview"
                src={draft.layout.preview}
                alt={`Cutting layout for ${draft.layout.count} badges`}
                width={1200}
                height={800}
                unoptimized
              />
              <ul className="sheet-summary">
                {draft.layout.sheets.map((sheet, i) => (
                  <li key={i}>
                    Sheet {i + 1}: {sheet.count} badges · {sheet.widthIn} × {sheet.heightIn} in
                  </li>
                ))}
              </ul>
              <div className="download-list">
                {draft.layout.files.map((file) => (
                  <Button
                    key={file.name}
                    variant="outline"
                    size="sm"
                    href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.svg)}`}
                    download={file.name}
                  >
                    Download {file.name}
                  </Button>
                ))}
              </div>
              <p className="help">
                Cutting files include the mirrored stamp. Downloads don’t change inventory.
              </p>
              <div className="step-actions">
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    void run("Saving designs…", () => checkpoint({ phase: "manufacture" }))
                  }
                >
                  Change quantity or sheets
                </Button>
                <DitherButton
                  disabled={disabled || Boolean(draft.layout.shortfall)}
                  onClick={() => void run("Preparing cutting files…", prepare)}
                >
                  Continue to production
                </DitherButton>
              </div>
            </>
          )}
        </fieldset>
      )}
      {busy && (
        <p className="notice" role="status">
          {busy}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
