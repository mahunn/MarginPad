import getStroke from 'perfect-freehand';
import type {
  GhostAnnotation,
  LayoutMode,
  PaperTemplate,
  PaperTheme,
  ShapeKind,
  Stroke,
} from '../db/schema';
import { PAPER_THEMES, resolveInkColor } from '../theme/paperThemes';

export const NOTEBOOK_PAGE_WIDTH = 920;

export function computePointsBBox(points: [number, number, number][], pad = 4): [number, number, number, number] {
  if (points.length === 0) return [0, 0, 0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

export function getSvgPathFromStroke(points: number[][]): string {
  if (!points.length) return '';
  const max = points.length - 1;
  return points
    .reduce(
      (acc, point, i, arr) => {
        if (i === max) {
          acc.push(point[0].toFixed(2), point[1].toFixed(2), 'Z');
        } else {
          const next = arr[i + 1];
          acc.push(
            point[0].toFixed(2),
            point[1].toFixed(2),
            ((point[0] + next[0]) / 2).toFixed(2),
            ((point[1] + next[1]) / 2).toFixed(2)
          );
        }
        return acc;
      },
      ['M', points[0][0].toFixed(2), points[0][1].toFixed(2), 'Q']
    )
    .join(' ');
}

export function drawPaperBackground(
  ctx: CanvasRenderingContext2D,
  opts: {
    theme: PaperTheme;
    template: PaperTemplate;
    layoutMode: LayoutMode;
    pageHeight: number;
    viewBounds: { minX: number; minY: number; maxX: number; maxY: number };
    forceWhiteExport?: boolean;
  }
): void {
  const palette = opts.forceWhiteExport ? PAPER_THEMES.light : PAPER_THEMES[opts.theme];
  const { minX, minY, maxX, maxY } = opts.viewBounds;

  if (opts.layoutMode === 'vertical') {
    // Workspace backdrop outside page
    ctx.fillStyle = palette.workspaceBg;
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

    // Page sheet
    ctx.save();
    ctx.shadowColor = palette.isDark ? 'rgba(0,0,0,0.65)' : 'rgba(15,23,42,0.09)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = palette.canvasBg;
    ctx.fillRect(0, 0, NOTEBOOK_PAGE_WIDTH, opts.pageHeight);
    ctx.restore();

    drawTemplatePattern(ctx, palette.gridLine, palette.ruledMargin, opts.template, {
      left: 0,
      top: Math.max(0, minY),
      right: NOTEBOOK_PAGE_WIDTH,
      bottom: Math.min(opts.pageHeight, maxY),
      isPaged: true,
    });
  } else {
    // Infinite canvas background
    ctx.fillStyle = palette.canvasBg;
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    drawTemplatePattern(ctx, palette.gridLine, palette.ruledMargin, opts.template, {
      left: minX,
      top: minY,
      right: maxX,
      bottom: maxY,
      isPaged: false,
    });
  }
}

function drawTemplatePattern(
  ctx: CanvasRenderingContext2D,
  lineColor: string,
  marginColor: string,
  template: PaperTemplate,
  rect: { left: number; top: number; right: number; bottom: number; isPaged: boolean }
): void {
  if (template === 'blank') return;

  const step = template === 'ruled' ? 36 : 32;
  const startX = Math.floor(rect.left / step) * step;
  const startY = Math.floor(rect.top / step) * step;

  ctx.save();
  ctx.strokeStyle = lineColor;
  ctx.fillStyle = lineColor;
  ctx.lineWidth = 1;

  if (template === 'grid') {
    ctx.beginPath();
    for (let x = startX; x <= rect.right; x += step) {
      ctx.moveTo(x, rect.top);
      ctx.lineTo(x, rect.bottom);
    }
    for (let y = startY; y <= rect.bottom; y += step) {
      ctx.moveTo(rect.left, y);
      ctx.lineTo(rect.right, y);
    }
    ctx.stroke();
  } else if (template === 'ruled') {
    ctx.beginPath();
    for (let y = Math.max(step * 2, startY); y <= rect.bottom; y += step) {
      ctx.moveTo(rect.left, y);
      ctx.lineTo(rect.right, y);
    }
    ctx.stroke();

    if (rect.isPaged) {
      ctx.strokeStyle = marginColor;
      ctx.beginPath();
      ctx.moveTo(72, rect.top);
      ctx.lineTo(72, rect.bottom);
      ctx.stroke();
    }
  } else if (template === 'dotted') {
    for (let x = startX; x <= rect.right; x += step) {
      for (let y = startY; y <= rect.bottom; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

export function drawSingleStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Pick<
    Stroke,
    'tool' | 'shapeKind' | 'semanticColor' | 'width' | 'opacity' | 'points'
  >,
  theme: PaperTheme,
  opts?: {
    forceLightForExport?: boolean;
    dimmed?: boolean;
    selected?: boolean;
  }
): void {
  if (stroke.points.length === 0) return;
  const color = resolveInkColor(stroke.semanticColor, theme, opts?.forceLightForExport);

  ctx.save();
  let alpha = stroke.tool === 'highlighter' ? 0.34 : stroke.opacity;
  if (opts?.dimmed) alpha *= 0.48;
  ctx.globalAlpha = alpha;

  if (stroke.tool === 'shape' && stroke.shapeKind) {
    drawGeometricShape(ctx, stroke.shapeKind, stroke.points, color, stroke.width);
  } else {
    const outlinePoints = getStroke(stroke.points, {
      size: stroke.tool === 'highlighter' ? stroke.width * 3.4 : stroke.width,
      thinning: stroke.tool === 'highlighter' ? 0.05 : 0.42,
      smoothing: 0.58,
      streamline: 0.52,
      simulatePressure: stroke.points.every((p) => p[2] === 0.5),
    });

    const pathData = getSvgPathFromStroke(outlinePoints);
    if (pathData) {
      const path2d = new Path2D(pathData);
      ctx.fillStyle = color;
      ctx.fill(path2d);
    }
  }

  if (opts?.selected) {
    const [minX, minY, maxX, maxY] = computePointsBBox(stroke.points, 5);
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
  }

  ctx.restore();
}

function drawGeometricShape(
  ctx: CanvasRenderingContext2D,
  kind: ShapeKind,
  points: [number, number, number][],
  color: string,
  width: number
): void {
  const first = points[0];
  const last = points[points.length - 1];
  const [minX, minY, maxX, maxY] = computePointsBBox(points, 0);

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, width * 0.85);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'line' || kind === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();

    if (kind === 'arrow') {
      const angle = Math.atan2(last[1] - first[1], last[0] - first[0]);
      const headLen = Math.max(12, width * 3.8);
      ctx.beginPath();
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(
        last[0] - headLen * Math.cos(angle - Math.PI / 6),
        last[1] - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(
        last[0] - headLen * Math.cos(angle + Math.PI / 6),
        last[1] - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.stroke();
    }
  } else if (kind === 'rect') {
    const w = Math.max(8, maxX - minX);
    const h = Math.max(8, maxY - minY);
    ctx.beginPath();
    ctx.roundRect(minX, minY, w, h, 4);
    ctx.stroke();
  } else if (kind === 'ellipse') {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = Math.max(6, (maxX - minX) / 2);
    const ry = Math.max(6, (maxY - minY) / 2);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * Draws a crisp, subtle wavy underline under flawed stroke regions
 * so the user sees the exact spot of the error without cluttering their handwriting.
 */
export function drawAnnotationUnderlines(
  ctx: CanvasRenderingContext2D,
  annotations: GhostAnnotation[]
): void {
  for (const ann of annotations) {
    if (ann.status !== 'active') continue;
    const [minX, minY, maxX, maxY] = ann.anchorBBox;
    const y = maxY + 5;
    const isGhostShown = ann.revealState === 'ghost';

    ctx.save();
    // Subtle soft glow backdrop behind flawed step
    ctx.fillStyle = isGhostShown
      ? 'rgba(244, 63, 94, 0.06)'
      : 'rgba(245, 158, 11, 0.08)';
    ctx.beginPath();
    ctx.roundRect(minX - 4, minY - 3, maxX - minX + 8, maxY - minY + 8, 6);
    ctx.fill();

    // Wavy underline
    ctx.strokeStyle = isGhostShown ? '#fb7185' : '#fbbf24';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const waveLen = 8;
    const amp = 2.2;
    ctx.moveTo(minX, y);
    for (let x = minX; x < maxX; x += waveLen / 2) {
      const nextX = Math.min(maxX, x + waveLen / 2);
      const stepIndex = Math.round((x - minX) / (waveLen / 2));
      const offset = stepIndex % 2 === 0 ? -amp : amp;
      ctx.quadraticCurveTo((x + nextX) / 2, y + offset, nextX, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
