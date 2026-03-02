import { Shape, ShapeUtils, Vector2 } from "three";

/** Ray-casting point-in-polygon test. */
function isPointInPolygon(px: number, py: number, polygon: Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * When multiple CUT shapes tile together (e.g. puzzle pieces), the gaps
 * between them form implicit interior shapes. Detect these by finding
 * vertices shared between 2+ shapes (within tolerance), then checking
 * if the centroid of those shared vertices falls outside all shapes.
 */
function findImplicitInteriorShapes(shapes: Shape[], shapePoints: Vector2[][]): Shape[] {
  if (shapes.length < 3) return [];

  const TOLERANCE = 3;

  // Spatial grid for O(1) neighbor lookups instead of O(n*m) brute force
  const cellSize = TOLERANCE;
  const grid = new Map<string, { pt: Vector2; shapeIdx: number }[]>();

  function cellKey(x: number, y: number): string {
    return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  }

  // Index all points by grid cell
  for (let i = 0; i < shapePoints.length; i++) {
    for (const pt of shapePoints[i]) {
      const key = cellKey(pt.x, pt.y);
      const bucket = grid.get(key);
      if (bucket) {
        bucket.push({ pt, shapeIdx: i });
      } else {
        grid.set(key, [{ pt, shapeIdx: i }]);
      }
    }
  }

  // Find shared vertices by checking neighboring cells
  const shared: Vector2[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < shapePoints.length; i++) {
    for (const pt of shapePoints[i]) {
      const cx = Math.floor(pt.x / cellSize);
      const cy = Math.floor(pt.y / cellSize);
      // Check 3x3 neighborhood
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(`${cx + dx},${cy + dy}`);
          if (!bucket) continue;
          for (const { pt: pt2, shapeIdx } of bucket) {
            if (shapeIdx <= i) continue;
            if (Math.abs(pt.x - pt2.x) < TOLERANCE && Math.abs(pt.y - pt2.y) < TOLERANCE) {
              const avg = new Vector2((pt.x + pt2.x) / 2, (pt.y + pt2.y) / 2);
              const key = `${Math.round(avg.x)},${Math.round(avg.y)}`;
              if (!seen.has(key)) {
                seen.add(key);
                shared.push(avg);
              }
            }
          }
        }
      }
    }
  }

  if (shared.length < 3) return [];

  const allCx = shared.reduce((s, p) => s + p.x, 0) / shared.length;
  const allCy = shared.reduce((s, p) => s + p.y, 0) / shared.length;

  // Cluster shared vertices by distance from centroid — inner vertices
  // (forming the gap boundary) are closer than outer shared edges.
  const distances = shared.map((p) => Math.hypot(p.x - allCx, p.y - allCy));
  distances.sort((a, b) => a - b);

  // Look for a natural gap in distances to separate inner from outer
  let splitDist = Infinity;
  for (let i = 1; i < distances.length; i++) {
    if (distances[i] > distances[i - 1] * 1.5 && i >= 3) {
      splitDist = (distances[i - 1] + distances[i]) / 2;
      break;
    }
  }

  const innerVerts = shared.filter((p) => Math.hypot(p.x - allCx, p.y - allCy) < splitDist);
  if (innerVerts.length < 3) return [];

  // Verify the centroid of inner verts is NOT inside any existing shape
  const cx = innerVerts.reduce((s, p) => s + p.x, 0) / innerVerts.length;
  const cy = innerVerts.reduce((s, p) => s + p.y, 0) / innerVerts.length;
  for (const pts of shapePoints) {
    if (isPointInPolygon(cx, cy, pts)) return [];
  }

  // Sort inner vertices by angle from centroid to form a polygon
  innerVerts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

  const interior = new Shape();
  interior.moveTo(innerVerts[0].x, innerVerts[0].y);
  for (let i = 1; i < innerVerts.length; i++) {
    interior.lineTo(innerVerts[i].x, innerVerts[i].y);
  }
  interior.closePath();

  return [interior];
}

/**
 * Assemble CUT shapes into body geometry.
 *
 * Shapes whose centroid lies inside a larger shape are treated as holes
 * (inner cuts). All other shapes are independent pieces (e.g. puzzle tiles).
 * Gaps between tiling shapes are detected as implicit interior pieces.
 */
export function buildBodyWithHoles(shapes: Shape[]): Shape[] {
  if (shapes.length <= 1) return shapes;

  const entries = shapes.map((shape) => {
    const pts = shape.getPoints(64);
    const area = Math.abs(ShapeUtils.area(pts));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return { shape, area, points: pts, cx, cy };
  });
  entries.sort((a, b) => b.area - a.area);

  // Filter out degenerate shapes (< 0.1% of the largest shape's area).
  const maxArea = entries[0].area;
  const minArea = maxArea * 0.001;
  const filtered = entries.filter((e) => e.area >= minArea);
  if (filtered.length === 0) return shapes;
  entries.length = 0;
  entries.push(...filtered);

  const assigned = new Set<number>();
  const result: Shape[] = [];

  for (let i = 0; i < entries.length; i++) {
    if (assigned.has(i)) continue;

    const parent = entries[i];
    for (let j = i + 1; j < entries.length; j++) {
      if (assigned.has(j)) continue;
      const child = entries[j];
      if (isPointInPolygon(child.cx, child.cy, parent.points)) {
        parent.shape.holes.push(child.shape);
        assigned.add(j);
      }
    }

    result.push(parent.shape);
  }

  // Detect implicit interior shapes (e.g. center piece of a puzzle)
  const allPoints = entries.map((e) => e.points);
  const implicit = findImplicitInteriorShapes(shapes, allPoints);
  result.push(...implicit);

  return result;
}
