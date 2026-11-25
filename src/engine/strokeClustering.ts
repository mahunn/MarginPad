import type { CanvasBlock, Stroke } from '../db/schema';
import { drawSingleStroke } from './inkRenderer';

export interface StepCluster {
  stepId: string; // e.g., "S1", "S2"
  strokeIds: string[];
  bbox: [number, number, number, number];
}

export interface ClusteredSnapshot {
  clusters: StepCluster[];
  base64Png: string;
  cropBBox: [number, number, number, number];
  nearbyTextContext: string;
}

/**
 * Groups nearby freehand strokes into horizontal lines/steps (S1, S2, S3...)
 * and renders a high-contrast cropped PNG with [S1], [S2] margin badges so
 * Gemini 4 pinpoints the exact flawed step with zero pixel-coordinate guessing.
 */
export function buildClusteredSnapshot(
  strokes: Stroke[],
  blocks: CanvasBlock[] = []
): ClusteredSnapshot | null {
  const inkStrokes = strokes.filter((s) => s.tool !== 'highlighter' && s.points.length > 0);
  if (inkStrokes.length === 0) return null;

  // Sort strokes top-to-bottom by vertical midpoint
  const sorted = [...inkStrokes].sort((a, b) => {
    const midYa = (a.bbox[1] + a.bbox[3]) / 2;
    const midYb = (b.bbox[1] + b.bbox[3]) / 2;
    return midYa - midYb;
  });

  const rawGroups: { strokes: Stroke[]; bbox: [number, number, number, number] }[] = [];

  for (const stroke of sorted) {
    const [sMinX, sMinY, sMaxX, sMaxY] = stroke.bbox;
    const sMidY = (sMinY + sMaxY) / 2;
    const sHeight = Math.max(12, sMaxY - sMinY);

    // Find an existing line group with strong vertical overlap & reasonable horizontal proximity
    let matchedGroup: (typeof rawGroups)[number] | null = null;
    for (const grp of rawGroups) {
      const [gMinX, gMinY, gMaxX, gMaxY] = grp.bbox;
      const gMidY = (gMinY + gMaxY) / 2;
      const gHeight = Math.max(16, gMaxY - gMinY);

      const verticalDist = Math.abs(sMidY - gMidY);
      const verticalThreshold = Math.max(gHeight, sHeight) * 0.78 + 14;
      const horizontalGap = Math.max(0, sMinX - gMaxX, gMinX - sMaxX);

      if (verticalDist <= verticalThreshold && horizontalGap < 260) {
        matchedGroup = grp;
        break;
      }
    }

    if (matchedGroup) {
      matchedGroup.strokes.push(stroke);
      matchedGroup.bbox = [
        Math.min(matchedGroup.bbox[0], sMinX),
        Math.min(matchedGroup.bbox[1], sMinY),
        Math.max(matchedGroup.bbox[2], sMaxX),
        Math.max(matchedGroup.bbox[3], sMaxY),
      ];
    } else {
      rawGroups.push({
        strokes: [stroke],
        bbox: [sMinX, sMinY, sMaxX, sMaxY],
      });
    }
  }

  // Sort final groups strictly top-to-bottom, left-to-right
  rawGroups.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);

  const clusters: StepCluster[] = rawGroups.map((grp, idx) => ({
    stepId: `S${idx + 1}`,
    strokeIds: grp.strokes.map((s) => s.id),
    bbox: grp.bbox,
  }));

  // Compute overall bounding box for cropped snapshot
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of clusters) {
    minX = Math.min(minX, c.bbox[0]);
    minY = Math.min(minY, c.bbox[1]);
    maxX = Math.max(maxX, c.bbox[2]);
    maxY = Math.max(maxY, c.bbox[3]);
  }

  const leftMarginForBadges = 58;
  const pad = 28;
  const cropMinX = minX - leftMarginForBadges;
  const cropMinY = minY - pad;
  const cropMaxX = maxX + pad;
  const cropMaxY = maxY + pad;

  const rawW = Math.max(180, cropMaxX - cropMinX);
  const rawH = Math.max(120, cropMaxY - cropMinY);
  // Cap snapshot max dimension to ~1024px to keep visual token cost tiny
  const maxDim = 1024;
  const scale = Math.min(1.5, maxDim / Math.max(rawW, rawH));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(rawW * scale);
  canvas.height = Math.round(rawH * scale);
  const ctx = canvas.getContext('2d')!;

  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rawW, rawH);
  ctx.translate(-cropMinX, -cropMinY);

  // Draw subtle cluster guide boxes & [S1], [S2] badges on left margin
  for (const cluster of clusters) {
    const [bx1, by1, bx2, by2] = cluster.bbox;
    ctx.save();
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(bx1 - 4, by1 - 4, bx2 - bx1 + 8, by2 - by1 + 8);

    // Margin badge
    const badgeX = cropMinX + 8;
    const badgeY = (by1 + by2) / 2 - 10;
    ctx.setLineDash([]);
    ctx.fillStyle = '#eef2ff';
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, 36, 20, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#4338ca';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillText(cluster.stepId, badgeX + 7, badgeY + 14);
    ctx.restore();
  }

  // Render crisp dark-on-white strokes regardless of OLED Dark Mode
  const strokeMap = new Map(inkStrokes.map((s) => [s.id, s]));
  for (const cluster of clusters) {
    for (const sid of cluster.strokeIds) {
      const s = strokeMap.get(sid);
      if (s) {
        drawSingleStroke(ctx, s, 'light', { forceLightForExport: true });
      }
    }
  }

  // Gather any nearby typed problem prompt blocks above or inside the crop region
  const nearbyTextContext = blocks
    .filter(
      (b) =>
        (b.type === 'text' || b.type === 'practice-card') &&
        b.y <= cropMaxY + 80 &&
        b.y + b.height >= cropMinY - 260
    )
    .map((b) =>
      b.type === 'practice-card' && b.practiceMeta
        ? `Practice Prompt: ${b.practiceMeta.promptLatexOrText}`
        : b.content
    )
    .join('\n')
    .trim();

  const dataUrl = canvas.toDataURL('image/png');
  const base64Png = dataUrl.replace(/^data:image\/png;base64,/, '');

  return {
    clusters,
    base64Png,
    cropBBox: [cropMinX, cropMinY, cropMaxX, cropMaxY],
    nearbyTextContext,
  };
}
