"use client";

import Image from "next/image";
import { Button } from "@/components/ph/button";
import { Input } from "@/components/ph/input";
import { Field } from "@/components/ph/field";
import {
  materialDescription,
  materialLabel,
  ACRYLIC_MATERIALS,
  DEFAULT_MATERIAL_ID,
} from "@/lib/materials";
import {
  roles,
  type DesignCatalog,
  type DesignChecks,
  type DesignPair,
  type DesignRole,
  type DesignSheet,
  type DesignUpload,
} from "@/lib/designs";
import { useState } from "react";

export function DesignFiles({
  files,
  checks,
  busy,
  onUpload,
}: {
  files: Partial<DesignPair>;
  checks?: DesignChecks;
  busy: boolean;
  onUpload(role: DesignRole, file: DesignUpload): void;
}) {
  const [error, setError] = useState("");
  return (
    <>
      <div className="design-pair">
        {roles.map((role) => (
          <section className="design-upload" key={role}>
            <label className="ph-subheadline" htmlFor={`upload-${role}`}>
              {role === "badge" ? "Badge SVG" : "Stamp SVG"}
            </label>
            <p className="file-name">{files[role]?.name ?? `Upload your ${role}`}</p>
            {checks?.[role].preview && (
              <Image
                className="upload-art"
                src={checks[role].preview}
                alt={`${role} artwork`}
                width={420}
                height={420}
                unoptimized
              />
            )}
            <input
              id={`upload-${role}`}
              type="file"
              accept=".svg,image/svg+xml"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setError("");
                void file
                  .text()
                  .then((svg) => onUpload(role, { name: file.name, svg }))
                  .catch(() => setError(`Could not open ${file.name}. Upload it again.`));
              }}
            />
            <p className="help">
              {role === "badge"
                ? "Your finished design, with red cutting lines."
                : "Upload unmirrored. Black areas engrave away."}
            </p>
          </section>
        ))}
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {checks && <CheckResults checks={checks} />}
    </>
  );
}

export function CheckResults({ checks }: { checks: DesignChecks }) {
  return (
    <div className="design-pair">
      {roles.map((role) => (
        <section key={role} className="qa-results">
          <h2>{role === "badge" ? "Badge" : "Stamp"} file checks</h2>
          <ul>
            {checks[role].checks.map((check) => (
              <li key={check.id}>
                <span className={check.status === "pass" ? "pass" : "error"}>
                  {check.status === "pass" ? "✓" : "×"}
                </span>
                <span>
                  {check.label}
                  {check.guidance && <small>{check.guidance}</small>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function SheetPicker({
  catalog,
  sheets,
  onChange,
  busy,
}: {
  catalog: DesignCatalog;
  sheets: DesignSheet[];
  onChange(sheets: DesignSheet[]): void;
  busy: boolean;
}) {
  const [search, setSearch] = useState("");
  return (
    <section className="sheet-picker">
      <h2>Acrylic sheets</h2>
      <p className="help">Choose the sheets you have. You can mix colors and sizes.</p>
      {catalog.stock.length > 0 && (
        <>
          <Input
            aria-label="Search acrylic inventory"
            type="search"
            placeholder="Search by color or size…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="stock-list">
            {catalog.stock
              .filter((item) =>
                `${materialLabel(item.materialId)} ${item.widthIn}x${item.heightIn}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((item) => {
                const selected = sheets.find(
                  (s) =>
                    s.material.materialId === item.materialId &&
                    s.widthIn === item.widthIn &&
                    s.heightIn === item.heightIn &&
                    s.material.thicknessMm === item.thicknessMm,
                );
                return (
                  <li key={item.id}>
                    <label htmlFor={`stock-${item.id}`}>
                      <strong>
                        {materialLabel(item.materialId)} · {item.widthIn} × {item.heightIn} in
                      </strong>
                      <small>{item.quantity - item.reserved} available</small>
                    </label>
                    <Input
                      id={`stock-${item.id}`}
                      type="number"
                      min={0}
                      max={Math.min(10, item.quantity - item.reserved)}
                      value={selected?.quantity ?? 0}
                      disabled={busy}
                      onChange={(e) => {
                        const next = sheets.filter((s) => s !== selected);
                        const quantity = Number(e.target.value);
                        if (quantity > 0)
                          next.push({
                            widthIn: item.widthIn,
                            heightIn: item.heightIn,
                            quantity,
                            material: {
                              materialId: item.materialId,
                              thicknessMm: item.thicknessMm,
                            },
                          });
                        onChange(next);
                      }}
                    />
                  </li>
                );
              })}
          </ul>
        </>
      )}
      {sheets.length > 0 && (
        <ul className="selected-sheets">
          {sheets.map((sheet, index) => (
            <li key={index}>
              <span>
                {sheet.quantity} × {materialDescription(sheet.material)} · {sheet.widthIn} ×{" "}
                {sheet.heightIn} in
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onChange(sheets.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>Use sheets not listed in inventory</summary>
        <ManualSheet busy={busy} onAdd={(sheet) => onChange([...sheets, sheet])} />
      </details>
    </section>
  );
}

function ManualSheet({ busy, onAdd }: { busy: boolean; onAdd(sheet: DesignSheet): void }) {
  const [materialId, setMaterial] = useState(DEFAULT_MATERIAL_ID);
  const [width, setWidth] = useState("12"),
    [height, setHeight] = useState("12"),
    [quantity, setQuantity] = useState("1");
  return (
    <div className="manual-sheet">
      <Field label="Acrylic" htmlFor="sheet-material">
        <select
          id="sheet-material"
          value={materialId}
          onChange={(e) => setMaterial(e.target.value)}
        >
          {ACRYLIC_MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {materialLabel(m.id)}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-row">
        <Field label="Width (in)" htmlFor="sheet-width">
          <Input
            id="sheet-width"
            type="number"
            min="0.25"
            max="40"
            step="0.01"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
          />
        </Field>
        <Field label="Height (in)" htmlFor="sheet-height">
          <Input
            id="sheet-height"
            type="number"
            min="0.25"
            max="40"
            step="0.01"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
          />
        </Field>
        <Field label="Quantity" htmlFor="sheet-quantity">
          <Input
            id="sheet-quantity"
            type="number"
            min="1"
            max="10"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
      </div>
      <Button
        variant="outline"
        disabled={busy || ![width, height, quantity].every((v) => Number(v) > 0)}
        onClick={() =>
          onAdd({
            widthIn: Number(width),
            heightIn: Number(height),
            quantity: Number(quantity),
            material: { materialId, thicknessMm: 3.175 },
          })
        }
      >
        Add sheets
      </Button>
    </div>
  );
}
