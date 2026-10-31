// Speedy 400 flexx working area; all placement coordinates are millimeters from the back-left.
export const RUBY_BED = { width: 1016, height: 610 };
export type BedPoint = { x: number; y: number };
export type BedSize = { width: number; height: number };

export function physicalSize(width: string | null, height: string | null): BedSize | undefined {
  function millimeters(value: string | null) {
    const match = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*(mm|cm|in|pt|pc)\s*$/i.exec(value ?? "");
    if (!match) return;
    const units: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6 };
    const result = Number(match[1]) * units[match[2].toLowerCase()];
    return Number.isFinite(result) && result > 0 ? result : undefined;
  }
  const w = millimeters(width),
    h = millimeters(height);
  return w && h ? { width: w, height: h } : undefined;
}

export function svgPhysicalSize(svg: string) {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  return physicalSize(root.getAttribute("width"), root.getAttribute("height"));
}

export function fitsBed(origin: BedPoint, size: BedSize) {
  return (
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0 &&
    Number.isFinite(origin.x) &&
    Number.isFinite(origin.y) &&
    origin.x >= 0 &&
    origin.y >= 0 &&
    origin.x + size.width <= RUBY_BED.width &&
    origin.y + size.height <= RUBY_BED.height
  );
}

export function overlaps(a: BedPoint, aSize: BedSize, b: BedPoint, bSize: BedSize) {
  return (
    a.x < b.x + bSize.width &&
    a.x + aSize.width > b.x &&
    a.y < b.y + bSize.height &&
    a.y + aSize.height > b.y
  );
}
