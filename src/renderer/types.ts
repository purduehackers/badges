import type { AcrylicMaterial } from "../lib/materials.ts";
import type { StampOptions } from "./stamp.ts";

export interface RenderInput {
  /** A checked, physical SVG with millimeter viewBox coordinates. */
  svg: string;
  material: AcrylicMaterial;
  thicknessMm: number;
  sizeIn?: number;
}

export interface DesignRenderInput extends RenderInput {
  /** Unmirrored engraving source; black is removed rubber. */
  stampSvg: string;
  stampSettings?: StampOptions;
}

declare global {
  interface Window {
    renderDesigns(input: DesignRenderInput): Promise<{ badge: string; stamp: string }>;
    badgeInput: RenderInput;
  }
}
