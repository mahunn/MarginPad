import type { ShapeKind } from '../db/schema';
import { computePointsBBox } from './inkRenderer';

/**
 * Detects whether a held freehand stroke resembles a straight line, rectangle, or ellipse/circle,
 * and returns normalized shape points + ShapeKind so rough hand-drawn math axes/boxes snap cleanly.
 */
export function detectQuickShape(
  points: [number, number, number][]
): { kind: ShapeKind; snappedPoints: [number, number, number][] } | null {
  if (points.length < 6) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const [minX, minY, maxX, maxY] = computePointsBBox(points, 0);
  const width = maxX - minX;
  const height = maxY - minY;
  const diag = Math.hypot(width, height);
  if (diag < 24) return null;

  let pathLength = 0;
  for (let i = 1; i < points.length; i++) {
    pathLength += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1]
    );
  }

  const endDist = Math.hypot(last[0] - first[0], last[1] - first[1]);

  // 1. Straight Line Check
  if (endDist / Math.max(1, pathLength) > 0.88) {
    let x2 = last[0];
    let y2 = last[1];
    const angleDeg = (Math.atan2(y2 - first[1], x2 - first[0]) * 180) / Math.PI;
    // Snap near-horizontal or near-vertical lines within 7 degrees
    if (Math.abs(angleDeg) < 7 || Math.abs(Math.abs(angleDeg) - 180) < 7) {
      y2 = first[1];
    } else if (Math.abs(Math.abs(angleDeg) - 90) < 7) {
      x2 = first[0];
    }
    return {
      kind: 'line',
      snappedPoints: [
        [first[0], first[1], 0.65],
        [x2, y2, 0.65],
      ],
    };
  }

  // 2. Closed Loop Check (Circle/Ellipse vs Rectangle)
  if (endDist < diag * 0.36 && width > 18 && height > 18) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = width / 2;
    const ry = height / 2;

    // Measure normalized radial variance against ideal ellipse
    let ellipseErrSum = 0;
    for (const [px, py] of points) {
      const normDist = Math.hypot((px - cx) / rx, (py - cy) / ry);
      ellipseErrSum += Math.abs(normDist - 1);
    }
    const meanEllipseErr = ellipseErrSum / points.length;

    if (meanEllipseErr < 0.2) {
      // If nearly square, snap to clean circle
      const aspect = width / height;
      if (aspect > 0.82 && aspect < 1.22) {
        const r = (rx + ry) / 2;
        return {
          kind: 'ellipse',
          snappedPoints: [
            [cx - r, cy - r, 0.65],
            [cx + r, cy + r, 0.65],
          ],
        };
      }
      return {
        kind: 'ellipse',
        snappedPoints: [
          [minX, minY, 0.65],
          [maxX, maxY, 0.65],
        ],
      };
    }

    return {
      kind: 'rect',
      snappedPoints: [
        [minX, minY, 0.65],
        [maxX, maxY, 0.65],
      ],
    };
  }

  return null;
}

/**
 * Ray-casting point-in-polygon check for Lasso selection.
 */
export function isPointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
