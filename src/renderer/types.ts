import type { AcrylicMaterial } from "../lib/materials.ts";

export interface RenderInput {
  /** A checked, physical SVG with millimeter viewBox coordinates. */
  svg: string;
  material: AcrylicMaterial;
  thicknessMm: number;
  sizeIn?: number;
}

declare global {
  interface Window {
    renderBadge(input: RenderInput): Promise<string>;
    badgeInput: RenderInput;
  }
}
