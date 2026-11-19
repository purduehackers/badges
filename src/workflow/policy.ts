import type { Settings } from "./contracts.ts";

export const ACRYLIC_THICKNESS_MM = 3.175;
export const STAMP_THICKNESS_MM = 2.3;
export const STAMP_SIZE_IN = 1.5;
export const DEFAULT_BADGE_SIZE_IN = 2.2;
export const MIN_BADGE_SIZE_IN = 1.8;
export const MAX_BADGE_SIZE_IN = 2.5;
export const MAX_DESIGN_SIZE_IN = 10;
export const BADGE_SIZE_STEP_IN = 0.05;
export function productionSettings(): Settings {
  return {
    material: "Acrylic",
    badgeSizeIn: DEFAULT_BADGE_SIZE_IN,
    stampSizeIn: STAMP_SIZE_IN,
    gapMm: 0.2,
  };
}
