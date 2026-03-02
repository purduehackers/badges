import type { Shape } from "three";

export interface BadgeData {
  bodyShapes: Shape[];
  engraveCanvas: HTMLCanvasElement;
  viewBox: { width: number; height: number };
}
