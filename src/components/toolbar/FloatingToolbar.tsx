import React, { useRef, useState } from 'react';
import {
  CheckSquare,
  Download,
  Eraser,
  Eye,
  FileUp,
  Hand,
  Highlighter,
  ImagePlus,
  Infinity as InfinityIcon,
  Lasso,
  Lightbulb,
  Menu,
  Moon,
  PenTool,
  Redo2,
  Shapes,
  Sparkles,
  Square,
  Sun,
  Tag,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  MentorMode,
  Note,
  PaperTemplate,
  PaperTheme,
  SemanticInkColor,
  ShapeKind,
  ToolType,
} from '../../db/schema';
import {
  PAPER_TEMPLATE_LABELS,
  PAPER_THEMES,
  SEMANTIC_INK_HEX,
} from '../../theme/paperThemes';
import { updateNote } from '../../db/repositories';

interface FloatingToolbarProps {
  note: Note;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  activeTool: ToolType;
  onChangeTool: (tool: ToolType) => void;
  activeShapeKind: ShapeKind;
  onChangeShapeKind: (kind: ShapeKind) => void;
  activeColor: SemanticInkColor;
  onChangeColor: (color: SemanticInkColor) => void;
  strokeWidth: number;
  onChangeStrokeWidth: (w: number) => void;
  penOnlyMode: boolean;
  onTogglePenOnly: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onAddChecklistBlock: () => void;
  onImportImage: (file: File) => void;
  onImportPdf: (file: File) => void;
  onExportPdf: () => void;
  onCheckWorkNow: () => void;
  isCheckingMentor: boolean;
}

export const FloatingToolbar: React.FC<FloatingToolbarProps> = ({
  note,
  sidebarOpen,
  onToggleSidebar,
  activeTool,
  onChangeTool,
  activeShapeKind,
  onChangeShapeKind,
  activeColor,
  onChangeColor,
  strokeWidth,
  onChangeStrokeWidth,
  penOnlyMode,
  onTogglePenOnly,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onAddChecklistBlock,
  onImportImage,
  onImportPdf,
  onExportPdf,
  onCheckWorkNow,
  isCheckingMentor,
}) => {
  const [showPageMenu, setShowPageMenu] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const isDark = PAPER_THEMES[note.paperTheme].isDark;

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = tagDraft.trim().toLowerCase();
    if (clean && !note.tags.includes(clean)) {
      await updateNote(note.id, { tags: [...note.tags, clean] });
    }
    setTagDraft('');
    setAddingTag(false);
  };

  const handleRemoveTag = async (tag: string) => {
    await updateNote(note.id, { tags: note.tags.filter((t) => t !== tag) });
  };

  const cycleTheme = async () => {
    const order: PaperTheme[] = ['oled-dark', 'warm', 'light'];
    const next = order[(order.indexOf(note.paperTheme) + 1) % order.length];
    await updateNote(note.id, { paperTheme: next });
  };

  const toggleMentorMode = async (mode: MentorMode) => {
    await updateNote(note.id, { mentorMode: mode });
  };

  return (
    <>
      {/* Top Header Bar */}
      <header
        className={`relative z-20 flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 backdrop-blur-md transition-colors ${
          isDark
            ? 'border-slate-800/80 bg-[#0d111a]/90 text-slate-100'
            : 'border-slate-200/90 bg-white/90 text-slate-900'
        }`}
      >
        {/* Left: Sidebar toggle + Note Title + Tags */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {!sidebarOpen && (
            <button
              onClick={onToggleSidebar}
              title="Open Notebooks"
              className="rounded-xl p-2 hover:bg-slate-500/15"
            >
              <Menu className="h-4 w-4" />
            </button>
          )}

          <input
            type="text"
            value={note.title}
            onChange={(e) => updateNote(note.id, { title: e.target.value })}
            className="min-w-[140px] max-w-[260px] truncate rounded-lg bg-transparent px-1.5 py-1 text-sm font-semibold outline-none focus:ring-1 focus:ring-indigo-500/60"
            placeholder="Untitled Note"
          />

          {/* Compact Tags */}
          <div className="hidden items-center gap-1 sm:flex">
            {note.tags.map((t) => (
              <button
                key={t}
                onClick={() => handleRemoveTag(t)}
                title="Click to remove tag"
                className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-400 hover:bg-rose-500/20 hover:text-rose-300"
              >
                #{t}
              </button>
            ))}
            {addingTag ? (
              <form onSubmit={handleAddTag}>
                <input
                  type="text"
                  autoFocus
                  onBlur={() => setAddingTag(false)}
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="tag..."
                  className="w-20 rounded-md border border-indigo-500/40 bg-transparent px-1.5 py-0.5 text-[11px] outline-none"
                />
              </form>
            ) : (
              <button
                onClick={() => setAddingTag(true)}
                title="Add tag"
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] opacity-55 hover:bg-slate-500/15 hover:opacity-100"
              >
                <Tag className="h-3 w-3" />+
              </button>
            )}
          </div>
        </div>

        {/* Center/Right: AI Mentor Controls + Page Actions */}
        <div className="flex items-center gap-1.5">
          {/* AI Live Mentor Toggle + Hint/Ghost Mode Switch */}
          <div
            className={`flex items-center gap-1 rounded-xl border p-1 text-xs ${
              isDark
                ? 'border-slate-800 bg-slate-900/90'
                : 'border-slate-200 bg-slate-100/90'
            }`}
          >
            <button
              onClick={() =>
                updateNote(note.id, { liveMentorEnabled: !note.liveMentorEnabled })
              }
              title="When ON, quietly checks your active math/logic steps 3.5s after your pen pauses"
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
                note.liveMentorEnabled
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              <Sparkles
                className={`h-3.5 w-3.5 ${isCheckingMentor ? 'animate-spin' : ''}`}
              />
              <span className="hidden md:inline">Live Mentor</span>
              <span className="text-[10px] font-bold uppercase">
                {note.liveMentorEnabled ? 'ON' : 'OFF'}
              </span>
            </button>

            <div className="h-4 w-px bg-slate-500/25" />

            <button
              onClick={() => toggleMentorMode('hint')}
              title="Hint First: Show 1-line Socratic nudge first so you think critically; tap once to reveal Ghost Fix"
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                note.mentorMode === 'hint'
                  ? isDark
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-amber-100 text-amber-800'
                  : 'opacity-60 hover:opacity-100'
              }`}
            >
              <Lightbulb className="h-3 w-3" />
              <span className="hidden sm:inline">Hint First</span>
            </button>

            <button
              onClick={() => toggleMentorMode('ghost')}
              title="Ghost Fix: Immediately place clean Ghost Ink correction + 1-line explanation beside errors"
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                note.mentorMode === 'ghost'
                  ? isDark
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-emerald-100 text-emerald-800'
                  : 'opacity-60 hover:opacity-100'
              }`}
            >
              <Eye className="h-3 w-3" />
              <span className="hidden sm:inline">Ghost Fix</span>
            </button>

            <button
              onClick={onCheckWorkNow}
              disabled={isCheckingMentor}
              title="Check visible steps right now"
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                isDark
                  ? 'bg-slate-800 text-indigo-300 hover:bg-slate-700'
                  : 'bg-white text-indigo-700 shadow-2xs hover:bg-indigo-50'
              } disabled:opacity-50`}
            >
              {isCheckingMentor ? 'Checking...' : 'Check Now'}
            </button>
          </div>

          {/* Undo / Redo */}
          <div className="flex items-center">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              className="rounded-lg p-1.5 hover:bg-slate-500/15 disabled:opacity-30"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Y)"
              className="rounded-lg p-1.5 hover:bg-slate-500/15 disabled:opacity-30"
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>

          {/* Theme Quick Switch */}
          <button
            onClick={cycleTheme}
            title={`Paper Theme: ${PAPER_THEMES[note.paperTheme].label} (Smart Ink Auto-Inversion)`}
            className="rounded-lg p-1.5 hover:bg-slate-500/15"
          >
            {isDark ? <Moon className="h-4 w-4 text-indigo-300" /> : <Sun className="h-4 w-4 text-amber-500" />}
          </button>

          {/* Page Setup & Import/Export Menu */}
          <div className="relative">
            <button
              onClick={() => setShowPageMenu((v) => !v)}
              className="rounded-xl border border-slate-500/25 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-500/10"
            >
              Page &amp; PDF
            </button>

            {showPageMenu && (
              <div
                onMouseLeave={() => setShowPageMenu(false)}
                className={`absolute right-0 mt-2 w-60 space-y-3 rounded-2xl border p-3 text-xs shadow-xl ${
                  isDark
                    ? 'border-slate-800 bg-[#121826] text-slate-100'
                    : 'border-slate-200 bg-white text-slate-900'
                }`}
              >
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase opacity-55">
                    Canvas Mode
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => updateNote(note.id, { layoutMode: 'vertical' })}
                      className={`rounded-lg border px-2 py-1.5 font-medium ${
                        note.layoutMode === 'vertical'
                          ? 'border-indigo-500 bg-indigo-500/15 text-indigo-400'
                          : 'border-slate-500/20 opacity-75'
                      }`}
                    >
                      Notebook Page
                    </button>
                    <button
                      onClick={() => updateNote(note.id, { layoutMode: 'infinite' })}
                      className={`inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 font-medium ${
                        note.layoutMode === 'infinite'
                          ? 'border-indigo-500 bg-indigo-500/15 text-indigo-400'
                          : 'border-slate-500/20 opacity-75'
                      }`}
                    >
                      <InfinityIcon className="h-3.5 w-3.5" />
                      Infinite
                    </button>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase opacity-55">
                    Paper Template
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(PAPER_TEMPLATE_LABELS) as PaperTemplate[]).map((tpl) => (
                      <button
                        key={tpl}
                        onClick={() => updateNote(note.id, { paperTemplate: tpl })}
                        className={`rounded-lg border px-2 py-1 text-left ${
                          note.paperTemplate === tpl
                            ? 'border-indigo-500 bg-indigo-500/15 text-indigo-400'
                            : 'border-slate-500/20 opacity-75'
                        }`}
                      >
                        {PAPER_TEMPLATE_LABELS[tpl]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1 border-t border-slate-500/20 pt-2">
                  <button
                    onClick={() => {
                      setShowPageMenu(false);
                      imageInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-500/15"
                  >
                    <ImagePlus className="h-3.5 w-3.5 text-sky-400" />
                    Insert Screenshot / Image
                  </button>
                  <button
                    onClick={() => {
                      setShowPageMenu(false);
                      pdfInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-500/15"
                  >
                    <FileUp className="h-3.5 w-3.5 text-indigo-400" />
                    Import PDF Worksheet / Slides
                  </button>
                  <button
                    onClick={() => {
                      setShowPageMenu(false);
                      onExportPdf();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-500/15"
                  >
                    <Download className="h-3.5 w-3.5 text-emerald-400" />
                    Export Clean PDF
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Hidden File Inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImportImage(f);
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImportPdf(f);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Bottom Floating S Pen & Note Dock (Minimal 6-Core-Tools Layout) */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex justify-center px-3">
        <div
          className={`pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-2xl border px-3 py-2 shadow-2xl backdrop-blur-md ${
            isDark
              ? 'border-slate-700/70 bg-[#121826]/92 text-slate-100'
              : 'border-slate-300/90 bg-white/95 text-slate-900'
          }`}
        >
          {/* Core 6 Tools + Pan */}
          {(
            [
              { id: 'pen', icon: PenTool, label: 'Pen' },
              { id: 'highlighter', icon: Highlighter, label: 'Highlighter' },
              { id: 'eraser', icon: Eraser, label: 'Stroke Eraser' },
              { id: 'lasso', icon: Lasso, label: 'Lasso (Select / Ask AI)' },
              { id: 'shape', icon: Shapes, label: 'Quick Shape' },
              { id: 'text', icon: Type, label: 'Tap to Add Text' },
              { id: 'pan', icon: Hand, label: 'Pan Canvas' },
            ] as const
          ).map(({ id, icon: Icon, label }) => {
            const active = activeTool === id;
            return (
              <button
                key={id}
                onClick={() => onChangeTool(id)}
                title={label}
                className={`rounded-xl p-2.5 transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'opacity-75 hover:bg-slate-500/15 hover:opacity-100'
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}

          {/* Checklist Quick Insert */}
          <button
            onClick={onAddChecklistBlock}
            title="Insert Checklist Card"
            className="rounded-xl p-2.5 opacity-75 hover:bg-slate-500/15 hover:opacity-100"
          >
            <CheckSquare className="h-4 w-4" />
          </button>

          {/* Sub-options when Shape tool is selected */}
          {activeTool === 'shape' && (
            <>
              <div className="mx-0.5 h-5 w-px bg-slate-500/25" />
              {(['line', 'arrow', 'rect', 'ellipse'] as ShapeKind[]).map((kind) => (
                <button
                  key={kind}
                  onClick={() => onChangeShapeKind(kind)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-medium capitalize ${
                    activeShapeKind === kind
                      ? 'bg-indigo-500/20 text-indigo-400'
                      : 'opacity-65 hover:opacity-100'
                  }`}
                >
                  {kind}
                </button>
              ))}
            </>
          )}

          <div className="mx-0.5 h-5 w-px bg-slate-500/25" />

          {/* Semantic Ink Colors (Auto-Inverting 'ink' first) */}
          <div className="flex items-center gap-1.5 px-1">
            {(Object.keys(SEMANTIC_INK_HEX) as SemanticInkColor[]).map((colorKey) => {
              const entry = SEMANTIC_INK_HEX[colorKey];
              const displayHex = isDark ? entry.dark : entry.light;
              const selected = activeColor === colorKey;
              return (
                <button
                  key={colorKey}
                  onClick={() => onChangeColor(colorKey)}
                  title={entry.label}
                  className={`h-5 w-5 rounded-full border transition ${
                    selected
                      ? 'scale-115 ring-2 ring-indigo-500 ring-offset-1 ring-offset-transparent'
                      : 'opacity-80 hover:scale-105'
                  }`}
                  style={{
                    backgroundColor: displayHex,
                    borderColor: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
                  }}
                />
              );
            })}
          </div>

          {/* Stroke Width Pills */}
          <div className="hidden items-center gap-1 pl-1 sm:flex">
            {[2.2, 3.4, 5.2].map((w) => (
              <button
                key={w}
                onClick={() => onChangeStrokeWidth(w)}
                title={`Thickness ${w}`}
                className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                  Math.abs(strokeWidth - w) < 0.3
                    ? 'bg-indigo-500/20 text-indigo-400'
                    : 'opacity-60 hover:opacity-100'
                }`}
              >
                <span
                  className="rounded-full bg-current"
                  style={{ width: w * 1.8, height: w * 1.8 }}
                />
              </button>
            ))}
          </div>

          <div className="mx-0.5 hidden h-5 w-px bg-slate-500/25 md:block" />

          {/* S Pen Palm Rejection Quick Pill + Zoom */}
          <button
            onClick={onTogglePenOnly}
            title="Toggle S Pen Only Drawing (Fingers pan/zoom)"
            className={`hidden items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-medium transition md:inline-flex ${
              penOnlyMode
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                : 'opacity-60 hover:bg-slate-500/15 hover:opacity-100'
            }`}
          >
            <Square className="h-3 w-3" />
            S Pen Mode
          </button>

          <div className="hidden items-center gap-0.5 lg:flex">
            <button onClick={onZoomOut} className="rounded-lg p-1.5 opacity-70 hover:opacity-100">
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onResetZoom}
              className="min-w-[44px] text-center text-[11px] font-medium opacity-75 hover:opacity-100"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={onZoomIn} className="rounded-lg p-1.5 opacity-70 hover:opacity-100">
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
