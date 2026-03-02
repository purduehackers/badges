import { Shape, Path, Vector2 } from "three";

// Laser kerf: width of material vaporized by the beam.
// CO2 laser on acrylic ~ 0.2 mm (Trotec measured ~0.25 mm).
export const KERF_MM = 0.2;

/**
 * Offset a polygon inward (+amount) or outward (-amount).
 * Uses vertex bisector method with spike capping.
 */
function offsetPolygon(points: Vector2[], amount: number): Vector2[] {
  const n = points.length;
  if (n < 3) return points;

  // Signed area -> winding direction
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  const sign = area2 > 0 ? -1 : 1;

  const result: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    const e1x = curr.x - prev.x,
      e1y = curr.y - prev.y;
    const e2x = next.x - curr.x,
      e2y = next.y - curr.y;
    const len1 = Math.hypot(e1x, e1y);
    const len2 = Math.hypot(e2x, e2y);

    if (len1 < 1e-10 || len2 < 1e-10) {
      result.push(curr.clone());
      continue;
    }

    const n1x = (sign * e1y) / len1,
      n1y = (-sign * e1x) / len1;
    const n2x = (sign * e2y) / len2,
      n2y = (-sign * e2x) / len2;

    const bx = n1x + n2x,
      by = n1y + n2y;
    const blen = Math.hypot(bx, by);

    if (blen < 1e-6) {
      result.push(new Vector2(curr.x + n1x * amount, curr.y + n1y * amount));
      continue;
    }

    const bnx = bx / blen,
      bny = by / blen;
    const dot = n1x * bnx + n1y * bny;
    const offset = Math.min(amount / Math.max(dot, 0.1), amount * 4);

    result.push(new Vector2(curr.x + bnx * offset, curr.y + bny * offset));
  }

  return result;
}

/** Sample points from a path, capping at 1024 to prevent excessive geometry. */
function getKerfPoints(path: Shape | Path): Vector2[] {
  const pts = path.getPoints(8);
  return pts.length > 1024 ? path.getPoints(2) : pts;
}

/**
 * Shrink each shape by half the kerf width so adjacent pieces
 * show a thin gap that matches what the laser actually removes.
 */
export function applyKerf(shapes: Shape[], halfKerfSvg: number): Shape[] {
  return shapes.map((shape) => {
    const outerPts = getKerfPoints(shape);
    const insetPts = offsetPolygon(outerPts, halfKerfSvg);

    const newShape = new Shape();
    newShape.moveTo(insetPts[0].x, insetPts[0].y);
    for (let i = 1; i < insetPts.length; i++) {
      newShape.lineTo(insetPts[i].x, insetPts[i].y);
    }
    newShape.closePath();

    // Pass through original holes without kerf outset or re-polygonization.
    // Outsetting complex holes creates self-intersecting polygons
    // that break earcut triangulation.
    for (const hole of shape.holes) {
      newShape.holes.push(hole);
    }

    return newShape;
  });
}
