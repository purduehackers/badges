"use client";

import {
  ACRYLIC_MATERIALS,
  MATERIAL_TYPE_CONFIGS,
  type AcrylicMaterial,
  type MaterialType,
} from "@/lib/materials";

const TYPES_BY_ORDER = (Object.keys(MATERIAL_TYPE_CONFIGS) as MaterialType[]).toSorted(
  (a, b) => MATERIAL_TYPE_CONFIGS[a].order - MATERIAL_TYPE_CONFIGS[b].order,
);

const GROUPED_MATERIALS = TYPES_BY_ORDER.map((type) => ({
  type,
  label: MATERIAL_TYPE_CONFIGS[type].label,
  materials: ACRYLIC_MATERIALS.filter((m) => m.type === type),
}));

export function MaterialPicker({
  selected,
  onSelect,
}: {
  selected: AcrylicMaterial;
  onSelect: (material: AcrylicMaterial) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">Material</p>
      {GROUPED_MATERIALS.map(({ type, label, materials }) => (
        <div key={type}>
          <p className="mb-1.5 text-xs text-neutral-500">{label}</p>
          <div className="flex flex-wrap gap-1.5">
            {materials.map((m) => {
              const isSelected = m.id === selected.id;
              return (
                <button
                  key={m.id}
                  onClick={() => onSelect(m)}
                  title={`${m.name} ${label}`}
                  aria-label={`${m.name} ${label}`}
                  aria-pressed={isSelected}
                  className={`h-7 w-7 rounded-full border-2 transition-[border-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-neutral-900 outline-none ${
                    isSelected
                      ? "border-white scale-110"
                      : "border-neutral-600 hover:border-neutral-400"
                  }`}
                  style={{
                    background: MATERIAL_TYPE_CONFIGS[type].physical.transparent
                      ? `linear-gradient(135deg, ${m.color}88, ${m.color}cc)`
                      : m.color,
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-neutral-500">
        {selected.name}{" "}
        <span className="text-neutral-600">({MATERIAL_TYPE_CONFIGS[selected.type].label})</span>
      </p>
    </div>
  );
}
