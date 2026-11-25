import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  type MistakePattern,
  type SemanticInkColor,
  type ShapeKind,
  type Stroke,
  type ToolType,
} from './db/schema';
import {
  DEFAULT_SETTINGS,
  ensureInitialized,
  recordMistakePattern,
  uid,
  updateNote,
} from './db/repositories';
import { PAPER_THEMES } from './theme/paperThemes';
import { Sidebar } from './components/sidebar/Sidebar';
import { FloatingToolbar } from './components/toolbar/FloatingToolbar';
import { NoteCanvas } from './components/canvas/NoteCanvas';
import { SettingsModal } from './components/modals/SettingsModal';
import { MistakeMemoryModal } from './components/modals/MistakeMemoryModal';
import {
  exportNoteToPdf,
  importImageToNote,
  importPdfToNote,
} from './utils/pdfUtils';
import { buildClusteredSnapshot } from './engine/strokeClustering';
import {
  analyzeHandwrittenSteps,
  generateSimilarPracticeProblem,
} from './ai/geminiClient';
import { verifyMistakeWithCAS } from './ai/mathVerifier';

type HistoryAction =
  | { type: 'add-stroke'; stroke: Stroke }
  | { type: 'delete-strokes'; strokes: Stroke[] };

export const App: React.FC = () => {
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => window.innerWidth >= 1024);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mistakeMemoryOpen, setMistakeMemoryOpen] = useState(false);

  const [activeTool, setActiveTool] = useState<ToolType>('pen');
  const [activeShapeKind, setActiveShapeKind] = useState<ShapeKind>('line');
  const [activeColor, setActiveColor] = useState<SemanticInkColor>('ink');
  const [strokeWidth, setStrokeWidth] = useState<number>(3.4);
  const [zoom, setZoom] = useState<number>(1);

  const [undoStack, setUndoStack] = useState<HistoryAction[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryAction[]>([]);
  const [isCheckingMentor, setIsCheckingMentor] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const isPenDownRef = useRef(false);
  const pauseTimerRef = useRef<number | null>(null);
  const [userEditTick, setUserEditTick] = useState(0);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? null : curr));
    }, 4200);
  }, []);

  // Initialize DB & select latest / starter note
  useEffect(() => {
    ensureInitialized().then((initialNoteId) => {
      setActiveNoteId(initialNoteId);
    });
  }, []);

  const folders = useLiveQuery(() => db.folders.orderBy('sortOrder').toArray(), []) ?? [];
  const notes = useLiveQuery(() => db.notes.toArray(), []) ?? [];
  const settings =
    useLiveQuery(() => db.settings.get('singleton'), []) ?? DEFAULT_SETTINGS;
  const mistakePatterns =
    useLiveQuery(() => db.mistakePatterns.toArray(), []) ?? [];

  // Keep activeNoteId valid if active note was deleted
  useEffect(() => {
    if (notes.length > 0 && activeNoteId && !notes.some((n) => n.id === activeNoteId)) {
      setActiveNoteId(notes[0].id);
    }
  }, [notes, activeNoteId]);

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  const strokes =
    useLiveQuery(
      () =>
        activeNoteId
          ? db.strokes.where('noteId').equals(activeNoteId).sortBy('createdAt')
          : [],
      [activeNoteId]
    ) ?? [];

  const blocks =
    useLiveQuery(
      () =>
        activeNoteId
          ? db.blocks.where('noteId').equals(activeNoteId).sortBy('createdAt')
          : [],
      [activeNoteId]
    ) ?? [];

  const assets =
    useLiveQuery(
      () =>
        activeNoteId ? db.assets.where('noteId').equals(activeNoteId).toArray() : [],
      [activeNoteId]
    ) ?? [];

  const annotations =
    useLiveQuery(
      () =>
        activeNoteId
          ? db.ghostAnnotations.where('noteId').equals(activeNoteId).toArray()
          : [],
      [activeNoteId]
    ) ?? [];

  // Reset Undo/Redo history when switching notes
  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
    setUserEditTick(0);
  }, [activeNoteId]);

  const latestStateRef = useRef({
    activeNote,
    strokes,
    blocks,
    annotations,
    settings,
    mistakePatterns,
    isCheckingMentor,
  });
  latestStateRef.current = {
    activeNote,
    strokes,
    blocks,
    annotations,
    settings,
    mistakePatterns,
    isCheckingMentor,
  };

  // Core Mentor Inspection Runner (works for both Lasso selection & 3.5s Live Mentor pause)
  const runMentorCheck = useCallback(
    async (targetSubsetIds?: string[], isAutoPause = false) => {
      const {
        activeNote: curNote,
        strokes: curStrokes,
        blocks: curBlocks,
        annotations: curAnnotations,
        settings: curSettings,
        mistakePatterns: curPatterns,
        isCheckingMentor: busy,
      } = latestStateRef.current;

      if (!curNote || busy) return;

      const candidateStrokes =
        targetSubsetIds && targetSubsetIds.length > 0
          ? curStrokes.filter((s) => targetSubsetIds.includes(s.id))
          : curStrokes;

      const snapshot = buildClusteredSnapshot(candidateStrokes, curBlocks);
      if (!snapshot || snapshot.clusters.length === 0) {
        if (!isAutoPause) showToast('Write or lasso an equation/step first.');
        return;
      }

      setIsCheckingMentor(true);
      try {
        const analysis = await analyzeHandwrittenSteps(
          snapshot,
          curSettings,
          curPatterns
        );

        // Index transcribed equations so handwritten math is searchable from the Sidebar!
        if (analysis.transcribedSteps.length > 0) {
          const joinedLatex = analysis.transcribedSteps.map((s) => s.latex).join(' | ');
          await updateNote(curNote.id, { searchIndexText: joinedLatex });
        }

        // Clear older active annotations whose strokes overlap the freshly checked region
        const checkedStrokeSet = new Set(candidateStrokes.map((s) => s.id));
        const staleIds = curAnnotations
          .filter(
            (a) =>
              a.status === 'active' &&
              a.targetStrokeIds.some((sid) => checkedStrokeSet.has(sid))
          )
          .map((a) => a.id);
        if (staleIds.length > 0) {
          await db.ghostAnnotations.bulkDelete(staleIds);
        }

        if (!analysis.hasMistake || analysis.mistakes.length === 0) {
          if (!isAutoPause) {
            showToast('Steps look solid so far — keep going!');
          }
          return;
        }

        const clusterMap = new Map(snapshot.clusters.map((c) => [c.stepId, c]));
        let addedCount = 0;

        for (const item of analysis.mistakes) {
          const cluster =
            clusterMap.get(item.stepId) ??
            snapshot.clusters[snapshot.clusters.length - 1];
          if (!cluster) continue;

          // Deterministic symbolic verification via CortexJS Compute Engine ($0 in-browser)
          const casResult = await verifyMistakeWithCAS(
            item.wrongExpression,
            item.ghostLatex
          );
          if (!casResult.verifiedDistinct) {
            // Suppress false positive when expressions are algebraically equivalent!
            continue;
          }

          const patternTrack = await recordMistakePattern({
            categorySlug: item.categorySlug,
            title: item.categoryTitle,
            subject: item.subject,
            wrongExpr: item.wrongExpression,
            rightLatex: item.ghostLatex,
            shortWhy: item.shortExplanation,
            noteId: curNote.id,
          });

          await db.ghostAnnotations.add({
            id: uid('gho'),
            noteId: curNote.id,
            targetStrokeIds: cluster.strokeIds,
            anchorBBox: cluster.bbox,
            status: 'active',
            revealState: curNote.mentorMode, // 'hint' vs 'ghost'
            subject: item.subject,
            categorySlug: item.categorySlug,
            categoryTitle: item.categoryTitle,
            isRepeatBlindSpot: patternTrack.isRepeat,
            repeatCount: patternTrack.occurrences,
            wrongExpression: item.wrongExpression,
            socraticHint: item.socraticHint,
            shortExplanation: item.shortExplanation,
            ghostLatex: item.ghostLatex,
            verifiedByCAS: casResult.checkedByCAS,
            createdAt: Date.now(),
          });
          addedCount++;
        }

        if (analysis.usedOfflineDemoFallback && addedCount > 0) {
          showToast(
            'Demo Mentor active — open Settings to paste your free Google AI Studio key for live handwriting vision!'
          );
        } else if (!isAutoPause && addedCount === 0) {
          showToast('Steps verified algebraically equivalent — nice work!');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'NO_API_KEY') {
          if (!isAutoPause) {
            showToast(
              'Add your Gemini API key in Settings (Google AI Studio / AI Pro credits) to analyze custom handwriting.'
            );
            setSettingsOpen(true);
          }
        } else if (!isAutoPause) {
          showToast(`Mentor check error: ${msg}`);
        }
      } finally {
        setIsCheckingMentor(false);
      }
    },
    [showToast]
  );

  // Smart 3.5s Pen-Pause Watcher when Live Mentor is ON (triggers only after actual user stroke edits)
  useEffect(() => {
    if (!activeNote?.liveMentorEnabled || userEditTick === 0) {
      if (pauseTimerRef.current) window.clearTimeout(pauseTimerRef.current);
      return;
    }

    if (pauseTimerRef.current) window.clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = window.setTimeout(() => {
      if (!isPenDownRef.current) {
        runMentorCheck(undefined, true);
      }
    }, 3500);

    return () => {
      if (pauseTimerRef.current) window.clearTimeout(pauseTimerRef.current);
    };
  }, [activeNote?.liveMentorEnabled, runMentorCheck, userEditTick]);

  // Undo / Redo Handlers + Keyboard Shortcuts
  const handleUndo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, last]);

    if (last.type === 'add-stroke') {
      await db.strokes.delete(last.stroke.id);
    } else if (last.type === 'delete-strokes') {
      await db.strokes.bulkPut(last.strokes);
    }
  }, [undoStack]);

  const handleRedo = useCallback(async () => {
    const last = redoStack[redoStack.length - 1];
    if (!last) return;
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, last]);

    if (last.type === 'add-stroke') {
      await db.strokes.put(last.stroke);
    } else if (last.type === 'delete-strokes') {
      await db.strokes.bulkDelete(last.strokes.map((s) => s.id));
    }
  }, [redoStack]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRedo, handleUndo]);

  // Support Ctrl+V Screenshot / Image Paste directly onto active note
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (!activeNote || !e.clipboardData) return;
      const items = Array.from(e.clipboardData.items);
      const imgItem = items.find((it) => it.type.startsWith('image/'));
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (file) {
          await importImageToNote(file, activeNote, 180);
          showToast('Screenshot pasted onto page — write directly over it!');
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [activeNote, showToast]);

  const handleDropPracticeProblem = useCallback(
    async (pattern: MistakePattern, customY?: number) => {
      if (!activeNote) return;
      showToast(`Generating practice problem for ${pattern.title}...`);
      const meta = await generateSimilarPracticeProblem(pattern, settings);
      const maxStrokeY = strokes.reduce((m, s) => Math.max(m, s.bbox[3]), 220);
      const insertY = customY ?? maxStrokeY + 60;
      const now = Date.now();

      await db.blocks.add({
        id: uid('blk'),
        noteId: activeNote.id,
        type: 'practice-card',
        x: 72,
        y: insertY,
        width: 560,
        height: 170,
        content: meta.promptLatexOrText,
        practiceMeta: meta,
        createdAt: now,
        updatedAt: now,
      });

      if (insertY + 420 > activeNote.pageHeight) {
        await updateNote(activeNote.id, { pageHeight: insertY + 550 });
      }
    },
    [activeNote, settings, showToast, strokes]
  );

  const handlePracticeBySlug = useCallback(
    async (slug: string, anchorY: number) => {
      const existing =
        mistakePatterns.find((p) => p.categorySlug === slug) ?? {
          id: uid('mp'),
          categorySlug: slug,
          title: slug.replace(/-/g, ' '),
          subject: 'math' as const,
          occurrences: 1,
          resolvedCount: 0,
          lastSeenAt: Date.now(),
          examples: [],
        };
      await handleDropPracticeProblem(existing, anchorY);
    },
    [handleDropPracticeProblem, mistakePatterns]
  );

  if (!activeNote) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0b0d13] text-sm text-slate-400">
        Opening Notepad-AI...
      </div>
    );
  }

  const isDarkUi = PAPER_THEMES[activeNote.paperTheme].isDark;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        folders={folders}
        notes={notes}
        activeNoteId={activeNote.id}
        onSelectNote={(id) => setActiveNoteId(id)}
        mistakePatterns={mistakePatterns}
        onOpenMistakeMemory={() => setMistakeMemoryOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        isDarkUi={isDarkUi}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <FloatingToolbar
          note={activeNote}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          activeTool={activeTool}
          onChangeTool={setActiveTool}
          activeShapeKind={activeShapeKind}
          onChangeShapeKind={setActiveShapeKind}
          activeColor={activeColor}
          onChangeColor={setActiveColor}
          strokeWidth={strokeWidth}
          onChangeStrokeWidth={setStrokeWidth}
          penOnlyMode={settings.penOnlyMode}
          onTogglePenOnly={() =>
            db.settings.update('singleton', { penOnlyMode: !settings.penOnlyMode })
          }
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          onUndo={handleUndo}
          onRedo={handleRedo}
          zoom={zoom}
          onZoomIn={() => setZoom((z) => Math.min(2.6, +(z + 0.15).toFixed(2)))}
          onZoomOut={() => setZoom((z) => Math.max(0.45, +(z - 0.15).toFixed(2)))}
          onResetZoom={() => setZoom(1)}
          onAddChecklistBlock={async () => {
            const now = Date.now();
            await db.blocks.add({
              id: uid('blk'),
              noteId: activeNote.id,
              type: 'checklist',
              x: 96,
              y: 160,
              width: 340,
              height: 120,
              content: 'Checklist',
              checklistItems: [
                { id: uid('chk'), text: 'Review problem steps', checked: false },
              ],
              createdAt: now,
              updatedAt: now,
            });
          }}
          onImportImage={async (file) => {
            await importImageToNote(file, activeNote);
            showToast('Image added — write directly over it with your stylus!');
          }}
          onImportPdf={async (file) => {
            showToast('Rendering PDF pages onto notebook...');
            const count = await importPdfToNote(file, activeNote);
            showToast(`Imported ${count} PDF page(s) — ready for S Pen annotation!`);
          }}
          onExportPdf={async () => {
            showToast('Exporting clean PDF...');
            await exportNoteToPdf(activeNote, strokes, blocks);
            showToast('PDF downloaded!');
          }}
          onCheckWorkNow={() => runMentorCheck()}
          isCheckingMentor={isCheckingMentor}
        />

        <NoteCanvas
          note={activeNote}
          strokes={strokes}
          blocks={blocks}
          assets={assets}
          annotations={annotations}
          activeTool={activeTool}
          activeShapeKind={activeShapeKind}
          activeColor={activeColor}
          strokeWidth={strokeWidth}
          penOnlyMode={settings.penOnlyMode}
          holdToShapeEnabled={settings.holdToShapeEnabled}
          onAutoEnablePenOnly={() => {
            db.settings.update('singleton', { penOnlyMode: true });
            showToast('S Pen detected — Palm Rejection (Pen-Only Mode) enabled!');
          }}
          zoom={zoom}
          onChangeZoom={setZoom}
          onStrokeCommitted={(stroke) => {
            setUndoStack((prev) => [...prev.slice(-49), { type: 'add-stroke', stroke }]);
            setRedoStack([]);
            setUserEditTick((t) => t + 1);
          }}
          onStrokesDeleted={(deleted) => {
            setUndoStack((prev) => [
              ...prev.slice(-49),
              { type: 'delete-strokes', strokes: deleted },
            ]);
            setRedoStack([]);
            setUserEditTick((t) => t + 1);
          }}
          onPointerActivityChange={(down) => {
            isPenDownRef.current = down;
          }}
          onCheckSelectionWithMentor={(selectedIds) => runMentorCheck(selectedIds, false)}
          onPracticeSimilar={handlePracticeBySlug}
        />

        {/* Subtle Non-Intrusive Toast Pill */}
        {toastMsg && (
          <div className="pointer-events-none fixed top-16 left-1/2 z-50 -translate-x-1/2">
            <div className="rounded-full border border-indigo-500/35 bg-[#111726]/95 px-4 py-1.5 text-xs font-medium text-slate-100 shadow-xl backdrop-blur-md">
              {toastMsg}
            </div>
          </div>
        )}
      </main>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        isDarkUi={isDarkUi}
      />

      <MistakeMemoryModal
        isOpen={mistakeMemoryOpen}
        onClose={() => setMistakeMemoryOpen(false)}
        patterns={mistakePatterns}
        onDropPracticeProblem={(pat) => handleDropPracticeProblem(pat)}
        isDarkUi={isDarkUi}
      />
    </div>
  );
};
export default App;
