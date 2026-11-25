import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Trash2, X } from 'lucide-react';
import {
  db,
  type AssetBlob,
  type CanvasBlock,
  type GhostAnnotation,
  type Note,
  type SemanticInkColor,
  type ShapeKind,
  type Stroke,
  type ToolType,
} from '../../db/schema';
import { incrementPatternResolved, uid, updateNote } from '../../db/repositories';
import {
  computePointsBBox,
  drawAnnotationUnderlines,
  drawPaperBackground,
  drawSingleStroke,
  NOTEBOOK_PAGE_WIDTH,
} from '../../engine/inkRenderer';
import { detectQuickShape, isPointInPolygon } from '../../engine/quickShapes';
import { PAPER_THEMES } from '../../theme/paperThemes';
import { BlocksLayer } from './BlocksLayer';
import { GhostOverlayLayer } from './GhostOverlayLayer';

interface NoteCanvasProps {
  note: Note;
  strokes: Stroke[];
  blocks: CanvasBlock[];
  assets: AssetBlob[];
  annotations: GhostAnnotation[];
  activeTool: ToolType;
  activeShapeKind: ShapeKind;
  activeColor: SemanticInkColor;
  strokeWidth: number;
  penOnlyMode: boolean;
  holdToShapeEnabled: boolean;
  onAutoEnablePenOnly: () => void;
  zoom: number;
  onChangeZoom: (z: number) => void;
  onStrokeCommitted: (stroke: Stroke) => void;
  onStrokesDeleted: (deleted: Stroke[]) => void;
  onPointerActivityChange: (isPenDown: boolean) => void;
  onCheckSelectionWithMentor: (selectedStrokeIds: string[]) => void;
  onPracticeSimilar: (categorySlug: string, anchorY: number) => void;
}

export const NoteCanvas: React.FC<NoteCanvasProps> = ({
  note,
  strokes,
  blocks,
  assets,
  annotations,
  activeTool,
  activeShapeKind,
  activeColor,
  strokeWidth,
  penOnlyMode,
  holdToShapeEnabled,
  onAutoEnablePenOnly,
  zoom,
  onChangeZoom,
  onStrokeCommitted,
  onStrokesDeleted,
  onPointerActivityChange,
  onCheckSelectionWithMentor,
  onPracticeSimilar,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 24 });
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({
    w: 1200,
    h: 800,
  });

  // Active in-progress drawing / lasso / pan refs for 120fps responsiveness
  const activePointsRef = useRef<[number, number, number][]>([]);
  const snappedShapeRef = useRef<{
    kind: ShapeKind;
    points: [number, number, number][];
  } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const drawingModeRef = useRef<
    'none' | 'ink' | 'eraser' | 'lasso' | 'pan' | 'drag-selection'
  >('none');

  const [lassoPoly, setLassoPoly] = useState<[number, number][]>([]);
  const [selectedStrokeIds, setSelectedStrokeIds] = useState<string[]>([]);
  const dragSelectionRef = useRef<{
    lastWorldX: number;
    lastWorldY: number;
  } | null>(null);

  // Track multi-touch pointers for smooth 2-finger pinch/pan on Android Tablet
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{
    dist: number;
    midX: number;
    midY: number;
    startPanX: number;
    startPanY: number;
    startZoom: number;
  } | null>(null);

  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    origPanX: number;
    origPanY: number;
  } | null>(null);

  const [, forceRenderTick] = useState(0);

  // Center vertical notebook sheet when container resizes or note layout switches
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateRect = () => {
      const rect = el.getBoundingClientRect();
      setViewportSize({ w: rect.width, h: rect.height });
      if (note.layoutMode === 'vertical') {
        const centeredX = Math.max(16, Math.round((rect.width - NOTEBOOK_PAGE_WIDTH * zoom) / 2));
        setPan((prev) => ({ x: centeredX, y: prev.y }));
      }
    };
    updateRect();
    const ro = new ResizeObserver(updateRect);
    ro.observe(el);
    return () => ro.disconnect();
  }, [note.id, note.layoutMode, zoom]);

  // Clear lasso selection when switching notes or tools
  useEffect(() => {
    setSelectedStrokeIds([]);
    setLassoPoly([]);
  }, [note.id, activeTool]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const rect = containerRef.current?.getBoundingClientRect();
      const sx = clientX - (rect?.left ?? 0);
      const sy = clientY - (rect?.top ?? 0);
      return [(sx - pan.x) / zoom, (sy - pan.y) / zoom];
    },
    [pan.x, pan.y, zoom]
  );

  // Render Canvas Frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(viewportSize.w * dpr));
    canvas.height = Math.max(1, Math.floor(viewportSize.h * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    const viewBounds = {
      minX: -pan.x / zoom - 100,
      minY: -pan.y / zoom - 100,
      maxX: (viewportSize.w - pan.x) / zoom + 100,
      maxY: (viewportSize.h - pan.y) / zoom + 100,
    };

    drawPaperBackground(ctx, {
      theme: note.paperTheme,
      template: note.paperTemplate,
      layoutMode: note.layoutMode,
      pageHeight: note.pageHeight,
      viewBounds,
    });

    // Identify strokes dimmed because their Ghost Fix is currently revealed
    const dimmedIds = new Set<string>();
    for (const ann of annotations) {
      if (ann.status === 'active' && ann.revealState === 'ghost') {
        for (const sid of ann.targetStrokeIds) dimmedIds.add(sid);
      }
    }
    const selectedSet = new Set(selectedStrokeIds);

    for (const s of strokes) {
      if (
        s.bbox[2] < viewBounds.minX ||
        s.bbox[0] > viewBounds.maxX ||
        s.bbox[3] < viewBounds.minY ||
        s.bbox[1] > viewBounds.maxY
      ) {
        continue;
      }
      drawSingleStroke(ctx, s, note.paperTheme, {
        dimmed: dimmedIds.has(s.id),
        selected: selectedSet.has(s.id),
      });
    }

    // Active stroke in progress
    if (drawingModeRef.current === 'ink' && activePointsRef.current.length > 0) {
      if (snappedShapeRef.current) {
        drawSingleStroke(
          ctx,
          {
            tool: 'shape',
            shapeKind: snappedShapeRef.current.kind,
            semanticColor: activeColor,
            width: strokeWidth,
            opacity: 1,
            points: snappedShapeRef.current.points,
          },
          note.paperTheme
        );
      } else {
        drawSingleStroke(
          ctx,
          {
            tool:
              activeTool === 'highlighter'
                ? 'highlighter'
                : activeTool === 'shape'
                  ? 'shape'
                  : 'pen',
            shapeKind: activeTool === 'shape' ? activeShapeKind : undefined,
            semanticColor: activeColor,
            width: strokeWidth,
            opacity: 1,
            points: activePointsRef.current,
          },
          note.paperTheme
        );
      }
    }

    // Active Lasso loop preview
    if (lassoPoly.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#818cf8';
      ctx.fillStyle = 'rgba(99, 102, 241, 0.08)';
      ctx.lineWidth = 1.6 / zoom;
      ctx.setLineDash([6 / zoom, 5 / zoom]);
      ctx.beginPath();
      ctx.moveTo(lassoPoly[0][0], lassoPoly[0][1]);
      for (let i = 1; i < lassoPoly.length; i++) {
        ctx.lineTo(lassoPoly[i][0], lassoPoly[i][1]);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Subtle wavy underlines beneath active flawed steps
    drawAnnotationUnderlines(ctx, annotations);

    ctx.restore();
  });

  const eraseAtPoint = useCallback(
    async (wx: number, wy: number) => {
      const radius = 14 / zoom;
      const hitStrokes = strokes.filter((s) => {
        if (
          wx < s.bbox[0] - radius ||
          wx > s.bbox[2] + radius ||
          wy < s.bbox[1] - radius ||
          wy > s.bbox[3] + radius
        ) {
          return false;
        }
        return s.points.some((pt) => Math.hypot(pt[0] - wx, pt[1] - wy) <= radius + s.width);
      });

      if (hitStrokes.length === 0) return;

      const hitIds = hitStrokes.map((h) => h.id);
      await db.strokes.bulkDelete(hitIds);
      onStrokesDeleted(hitStrokes);

      // Auto-resolve any active GhostAnnotation whose target strokes were erased to rewrite!
      const hitSet = new Set(hitIds);
      for (const ann of annotations) {
        if (ann.status === 'active' && ann.targetStrokeIds.some((id) => hitSet.has(id))) {
          await db.ghostAnnotations.update(ann.id, { status: 'resolved' });
          await incrementPatternResolved(ann.categorySlug);
        }
      }
    },
    [annotations, onStrokesDeleted, strokes, zoom]
  );

  // Compute bounding box of currently lasso-selected strokes
  const selectionBBox = React.useMemo((): [number, number, number, number] | null => {
    if (selectedStrokeIds.length === 0) return null;
    const set = new Set(selectedStrokeIds);
    const chosen = strokes.filter((s) => set.has(s.id));
    if (chosen.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of chosen) {
      minX = Math.min(minX, s.bbox[0]);
      minY = Math.min(minY, s.bbox[1]);
      maxX = Math.max(maxX, s.bbox[2]);
      maxY = Math.max(maxY, s.bbox[3]);
    }
    return [minX, minY, maxX, maxY];
  }, [selectedStrokeIds, strokes]);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handlePointerDown = async (e: React.PointerEvent<HTMLDivElement>) => {
    // Auto-activate S Pen strict palm rejection on first real stylus touch
    if (e.pointerType === 'pen' && !penOnlyMode) {
      onAutoEnablePenOnly();
    }

    // Multi-touch tracking for 2-finger pinch/pan & palm rejection
    if (e.pointerType === 'touch') {
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointersRef.current.size === 2) {
        clearHoldTimer();
        drawingModeRef.current = 'none';
        activePointsRef.current = [];
        const pts = Array.from(touchPointersRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        pinchStateRef.current = {
          dist: Math.max(20, dist),
          midX,
          midY,
          startPanX: pan.x,
          startPanY: pan.y,
          startZoom: zoom,
        };
        return;
      }

      // In S Pen Only mode, 1-finger touch smoothly pans the page instead of leaving stray palm ink!
      if (penOnlyMode) {
        drawingModeRef.current = 'pan';
        panStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          origPanX: pan.x,
          origPanY: pan.y,
        };
        return;
      }
    }

    if (e.button === 1 || activeTool === 'pan') {
      drawingModeRef.current = 'pan';
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        origPanX: pan.x,
        origPanY: pan.y,
      };
      return;
    }

    const [wx, wy] = screenToWorld(e.clientX, e.clientY);

    // Tap to create Typed Text Block when Text tool is active
    if (activeTool === 'text') {
      const now = Date.now();
      await db.blocks.add({
        id: uid('blk'),
        noteId: note.id,
        type: 'text',
        x: Math.max(36, Math.round(wx)),
        y: Math.max(24, Math.round(wy)),
        width: 360,
        height: 84,
        content: '',
        createdAt: now,
        updatedAt: now,
      });
      return;
    }

    // S Pen side barrel button (buttons === 32 or button === 5) OR Eraser tool
    const isBarrelEraser =
      e.pointerType === 'pen' && (e.buttons === 32 || e.button === 5);
    if (activeTool === 'eraser' || isBarrelEraser) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drawingModeRef.current = 'eraser';
      onPointerActivityChange(true);
      await eraseAtPoint(wx, wy);
      return;
    }

    // Lasso Tool: Drag inside existing selection OR draw new lasso polygon
    if (activeTool === 'lasso') {
      e.currentTarget.setPointerCapture(e.pointerId);
      if (
        selectionBBox &&
        wx >= selectionBBox[0] - 10 &&
        wx <= selectionBBox[2] + 10 &&
        wy >= selectionBBox[1] - 10 &&
        wy <= selectionBBox[3] + 10
      ) {
        drawingModeRef.current = 'drag-selection';
        dragSelectionRef.current = { lastWorldX: wx, lastWorldY: wy };
      } else {
        setSelectedStrokeIds([]);
        drawingModeRef.current = 'lasso';
        setLassoPoly([[wx, wy]]);
      }
      return;
    }

    // Standard Pen / Highlighter / Shape drawing
    e.currentTarget.setPointerCapture(e.pointerId);
    onPointerActivityChange(true);
    drawingModeRef.current = 'ink';
    snappedShapeRef.current = null;
    const pressure = e.pointerType === 'pen' ? Math.max(0.15, e.pressure || 0.55) : 0.5;
    activePointsRef.current = [[wx, wy, pressure]];
    forceRenderTick((n) => n + 1);
  };

  const handlePointerMove = async (e: React.PointerEvent<HTMLDivElement>) => {
    // Handle 2-finger pinch-zoom & pan on tablet
    if (e.pointerType === 'touch' && touchPointersRef.current.has(e.pointerId)) {
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointersRef.current.size === 2 && pinchStateRef.current) {
        const pts = Array.from(touchPointersRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const ratio = dist / pinchStateRef.current.dist;
        const nextZoom = Math.min(2.6, Math.max(0.45, pinchStateRef.current.startZoom * ratio));
        onChangeZoom(nextZoom);
        setPan({
          x: pinchStateRef.current.startPanX + (midX - pinchStateRef.current.midX),
          y: pinchStateRef.current.startPanY + (midY - pinchStateRef.current.midY),
        });
        return;
      }
    }

    if (drawingModeRef.current === 'pan' && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      setPan({
        x:
          note.layoutMode === 'vertical' && zoom <= 1.05
            ? panStartRef.current.origPanX
            : panStartRef.current.origPanX + dx,
        y: Math.min(80, panStartRef.current.origPanY + dy),
      });
      return;
    }

    if (drawingModeRef.current === 'none') return;

    // Coalesced pointer events give ultra-smooth S Pen curves at 120Hz!
    const nativeEvt = e.nativeEvent as PointerEvent;
    const coalesced = nativeEvt.getCoalescedEvents?.() ?? [nativeEvt];

    if (drawingModeRef.current === 'eraser') {
      const [wx, wy] = screenToWorld(e.clientX, e.clientY);
      await eraseAtPoint(wx, wy);
      return;
    }

    if (drawingModeRef.current === 'lasso') {
      const [wx, wy] = screenToWorld(e.clientX, e.clientY);
      setLassoPoly((prev) => [...prev, [wx, wy]]);
      return;
    }

    if (drawingModeRef.current === 'drag-selection' && dragSelectionRef.current) {
      const [wx, wy] = screenToWorld(e.clientX, e.clientY);
      const dx = wx - dragSelectionRef.current.lastWorldX;
      const dy = wy - dragSelectionRef.current.lastWorldY;
      dragSelectionRef.current = { lastWorldX: wx, lastWorldY: wy };

      const selSet = new Set(selectedStrokeIds);
      const toUpdate = strokes.filter((s) => selSet.has(s.id));
      await Promise.all(
        toUpdate.map((s) =>
          db.strokes.update(s.id, {
            points: s.points.map(([px, py, pr]) => [px + dx, py + dy, pr]),
            bbox: [s.bbox[0] + dx, s.bbox[1] + dy, s.bbox[2] + dx, s.bbox[3] + dy],
          })
        )
      );
      return;
    }

    if (drawingModeRef.current === 'ink') {
      if (snappedShapeRef.current) {
        // Once snapped by holding, dragging adjusts the endpoint cleanly
        const [wx, wy] = screenToWorld(e.clientX, e.clientY);
        const startPt = snappedShapeRef.current.points[0];
        snappedShapeRef.current = {
          ...snappedShapeRef.current,
          points: [startPt, [wx, wy, 0.65]],
        };
        forceRenderTick((n) => n + 1);
        return;
      }

      let movedDist = 0;
      for (const ptEvt of coalesced) {
        const [wx, wy] = screenToWorld(ptEvt.clientX, ptEvt.clientY);
        const pr =
          ptEvt.pointerType === 'pen' ? Math.max(0.15, ptEvt.pressure || 0.55) : 0.5;
        const last = activePointsRef.current[activePointsRef.current.length - 1];
        if (last) movedDist += Math.hypot(wx - last[0], wy - last[1]);
        activePointsRef.current.push([wx, wy, pr]);
      }

      // Hold-for-Quick-Shape timer (450ms stillness snaps rough lines, boxes, or circles!)
      if (holdToShapeEnabled && activeTool === 'pen' && movedDist > 1.5) {
        clearHoldTimer();
        holdTimerRef.current = window.setTimeout(() => {
          const detected = detectQuickShape(activePointsRef.current);
          if (detected) {
            snappedShapeRef.current = {
              kind: detected.kind,
              points: detected.snappedPoints,
            };
            navigator.vibrate?.(12);
            forceRenderTick((n) => n + 1);
          }
        }, 450);
      }

      forceRenderTick((n) => n + 1);
    }
  };

  const handlePointerUpOrCancel = async (e: React.PointerEvent<HTMLDivElement>) => {
    clearHoldTimer();
    touchPointersRef.current.delete(e.pointerId);
    if (touchPointersRef.current.size < 2) {
      pinchStateRef.current = null;
    }

    const mode = drawingModeRef.current;
    drawingModeRef.current = 'none';
    panStartRef.current = null;
    dragSelectionRef.current = null;
    onPointerActivityChange(false);

    if (mode === 'lasso') {
      if (lassoPoly.length >= 3) {
        const matched = strokes
          .filter((s) =>
            s.points.some(([px, py]) => isPointInPolygon(px, py, lassoPoly))
          )
          .map((s) => s.id);
        setSelectedStrokeIds(matched);
      }
      setLassoPoly([]);
      return;
    }

    if (mode === 'ink' && activePointsRef.current.length > 0) {
      const isSnapped = snappedShapeRef.current !== null;
      const isExplicitShape = activeTool === 'shape';
      const finalPoints = isSnapped
        ? snappedShapeRef.current!.points
        : activePointsRef.current;
      const bbox = computePointsBBox(finalPoints, strokeWidth + 3);

      const newStroke: Stroke = {
        id: uid('stk'),
        noteId: note.id,
        tool: isSnapped || isExplicitShape ? 'shape' : activeTool === 'highlighter' ? 'highlighter' : 'pen',
        shapeKind: isSnapped
          ? snappedShapeRef.current!.kind
          : isExplicitShape
            ? activeShapeKind
            : undefined,
        semanticColor: activeColor,
        width: strokeWidth,
        opacity: 1,
        points: finalPoints,
        bbox,
        createdAt: Date.now(),
      };

      activePointsRef.current = [];
      snappedShapeRef.current = null;
      forceRenderTick((n) => n + 1);

      await db.strokes.add(newStroke);
      onStrokeCommitted(newStroke);

      // Auto-extend Samsung Notes continuous vertical page as user writes near bottom
      if (note.layoutMode === 'vertical' && bbox[3] > note.pageHeight - 280) {
        await updateNote(note.id, { pageHeight: Math.round(bbox[3] + 700) });
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      onChangeZoom(Math.min(2.6, Math.max(0.45, zoom * factor)));
      return;
    }
    setPan((prev) => ({
      x: note.layoutMode === 'vertical' && zoom <= 1.05 ? prev.x : prev.x - e.deltaX,
      y: Math.min(80, prev.y - e.deltaY),
    }));
  };

  const handleDeleteSelectedStrokes = async () => {
    if (selectedStrokeIds.length === 0) return;
    const set = new Set(selectedStrokeIds);
    const removed = strokes.filter((s) => set.has(s.id));
    await db.strokes.bulkDelete(selectedStrokeIds);
    onStrokesDeleted(removed);
    setSelectedStrokeIds([]);
  };

  const isDark = PAPER_THEMES[note.paperTheme].isDark;

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      onWheel={handleWheel}
      style={{ backgroundColor: PAPER_THEMES[note.paperTheme].workspaceBg }}
      className={`relative flex-1 overflow-hidden touch-none ${
        activeTool === 'pan'
          ? 'cursor-grab active:cursor-grabbing'
          : activeTool === 'text'
            ? 'cursor-text'
            : 'cursor-crosshair'
      }`}
    >
      {/* High-FPS Vector Ink & Paper Canvas */}
      <canvas ref={canvasRef} className="block h-full w-full" />

      {/* World-Space Transformed DOM Overlay for Hybrid Blocks, Ghost Ink, and Lasso Actions */}
      <div
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
        className="pointer-events-none absolute top-0 left-0"
      >
        <BlocksLayer
          blocks={blocks}
          assets={assets}
          paperTheme={note.paperTheme}
          activeTool={activeTool}
        />

        <GhostOverlayLayer
          annotations={annotations}
          paperTheme={note.paperTheme}
          onPracticeSimilar={onPracticeSimilar}
        />

        {/* Floating Lasso Selection Action Pill */}
        {selectionBBox && selectedStrokeIds.length > 0 && (
          <div
            style={{
              left: selectionBBox[0],
              top: Math.max(8, selectionBBox[1] - 46),
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`pointer-events-auto absolute z-20 flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs shadow-xl ${
              isDark
                ? 'border-indigo-500/40 bg-[#131927]/95 text-slate-100'
                : 'border-indigo-200 bg-white/95 text-slate-900'
            }`}
          >
            <button
              onClick={() => {
                onCheckSelectionWithMentor(selectedStrokeIds);
                setSelectedStrokeIds([]);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1 font-medium text-white hover:bg-indigo-500"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Check with Mentor
            </button>

            <button
              onClick={handleDeleteSelectedStrokes}
              title="Delete selected strokes"
              className="rounded-lg p-1 text-rose-400 hover:bg-rose-500/15"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>

            <button
              onClick={() => setSelectedStrokeIds([])}
              title="Clear selection"
              className="rounded-lg p-1 opacity-65 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
