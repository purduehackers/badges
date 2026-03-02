import { Color } from "three";

/** CUT lines must be exactly #FF0000. */
export function isRedStroke(strokeValue: string | null): boolean {
  if (!strokeValue || strokeValue === "none") return false;
  try {
    return new Color(strokeValue).getHexString() === "ff0000";
  } catch {
    return false;
  }
}

/** Detect strokes that look red but aren't exactly #FF0000. Returns the wrong hex or null. */
export function isReddishButWrong(strokeValue: string | null): string | null {
  if (!strokeValue || strokeValue === "none") return null;
  try {
    const c = new Color(strokeValue);
    if (c.r > 0.5 && c.g < 0.3 && c.b < 0.3 && c.getHexString() !== "ff0000") {
      return "#" + c.getHexString().toUpperCase();
    }
  } catch {
    // ignore unparseable color values
  }
  return null;
}
