import React, { useMemo, useState } from 'react';
import katex from 'katex';
import {
  Check,
  Eye,
  GripHorizontal,
  Lightbulb,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  db,
  type AssetBlob,
  type CanvasBlock,
  type PaperTheme,
  type ToolType,
} from '../../db/schema';
import { uid } from '../../db/repositories';
import { PAPER_THEMES } from '../../theme/paperThemes';

interface BlocksLayerProps {
  blocks: CanvasBlock[];
  assets: AssetBlob[];
  paperTheme: PaperTheme;
  activeTool: ToolType;
}

function renderLatexSafe(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: false,
    });
  } catch {
    return latex;
  }
}

export const BlocksLayer: React.FC<BlocksLayerProps> = ({
  blocks,
  assets,
  paperTheme,
  activeTool,
}) => {
  const [draggingId, setDraggingId] = useState<{
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const isDark = PAPER_THEMES[paperTheme].isDark;

  // When pen/highlighter/eraser/shape is active, PDF & Image sheets let ink strokes pass straight through!
  const inkPassThrough =
    activeTool === 'pen' ||
    activeTool === 'highlighter' ||
    activeTool === 'eraser' ||
    activeTool === 'shape';

  const handleDragStart = (e: React.PointerEvent, block: CanvasBlock) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingId({
      id: block.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: block.x,
      origY: block.y,
    });
  };

  const handleDragMove = (e: React.PointerEvent) => {
    if (!draggingId) return;
    e.stopPropagation();
    const dx = e.clientX - draggingId.startClientX;
    const dy = e.clientY - draggingId.startClientY;
    db.blocks.update(draggingId.id, {
      x: Math.round(draggingId.origX + dx),
      y: Math.round(draggingId.origY + dy),
    });
  };

  const handleDragEnd = (e: React.PointerEvent) => {
    if (!draggingId) return;
    e.stopPropagation();
    setDraggingId(null);
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      {blocks.map((block) => {
        const isBackgroundMedia = block.type === 'image' || block.type === 'pdf-page';

        if (isBackgroundMedia) {
          const asset = block.assetId ? assetMap.get(block.assetId) : undefined;
          if (!asset) return null;
          return (
            <div
              key={block.id}
              style={{
                left: block.x,
                top: block.y,
                width: block.width,
                height: block.height,
              }}
              className={`group absolute rounded-lg shadow-sm ${
                inkPassThrough ? 'pointer-events-none' : 'pointer-events-auto ring-1 ring-indigo-500/40'
              }`}
            >
              <img
                src={asset.dataUrl}
                alt={block.content}
                draggable={false}
                className="h-full w-full rounded-lg object-contain select-none"
              />
              {!inkPassThrough && (
                <div
                  onPointerDown={(e) => handleDragStart(e, block)}
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  className="absolute -top-8 left-0 flex cursor-grab items-center gap-2 rounded-lg bg-slate-900/90 px-2.5 py-1 text-[11px] text-white shadow"
                >
                  <GripHorizontal className="h-3.5 w-3.5" />
                  <span className="max-w-[180px] truncate">{block.content}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      db.blocks.delete(block.id);
                    }}
                    className="text-rose-400 hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          );
        }

        if (block.type === 'practice-card' && block.practiceMeta) {
          const meta = block.practiceMeta;
          return (
            <div
              key={block.id}
              style={{ left: block.x, top: block.y, width: block.width }}
              onPointerDown={(e) => e.stopPropagation()}
              className={`pointer-events-auto absolute rounded-2xl border p-3.5 text-xs shadow-lg transition ${
                isDark
                  ? 'border-indigo-500/35 bg-[#121929]/95 text-slate-100'
                  : 'border-indigo-200 bg-indigo-50/95 text-slate-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2 pb-2">
                <div
                  onPointerDown={(e) => handleDragStart(e, block)}
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  className="flex cursor-grab items-center gap-1.5 font-semibold text-indigo-400"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Targeted Practice — {meta.categoryTitle}</span>
                </div>
                <button
                  onClick={() => db.blocks.delete(block.id)}
                  className="rounded p-0.5 opacity-60 hover:text-rose-400 hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div
                className="ghost-katex rounded-xl bg-black/15 px-3 py-2.5 text-sm font-medium"
                dangerouslySetInnerHTML={{
                  __html: renderLatexSafe(meta.promptLatexOrText),
                }}
              />

              <p className="mt-2 text-[11px] opacity-75">
                Solve with your S Pen right below this card — Live Mentor will watch your steps!
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] text-amber-300">
                  <Lightbulb className="h-3 w-3" />
                  {meta.hint}
                </span>

                <button
                  onClick={() =>
                    db.blocks.update(block.id, {
                      practiceMeta: { ...meta, revealedAnswer: !meta.revealedAnswer },
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-500/30 px-2 py-1 text-[11px] hover:bg-slate-500/15"
                >
                  <Eye className="h-3 w-3" />
                  {meta.revealedAnswer ? 'Hide Final Check' : 'Check Final Answer'}
                </button>
              </div>

              {meta.revealedAnswer && (
                <div
                  className="ghost-katex mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-emerald-300"
                  dangerouslySetInnerHTML={{
                    __html: renderLatexSafe(meta.answerLatex),
                  }}
                />
              )}
            </div>
          );
        }

        // Typed Text or Checklist Card
        return (
          <div
            key={block.id}
            style={{ left: block.x, top: block.y, width: block.width }}
            onPointerDown={(e) => {
              if (!inkPassThrough) e.stopPropagation();
            }}
            className={`group absolute rounded-xl border p-2.5 text-sm transition ${
              inkPassThrough ? 'pointer-events-none border-transparent' : 'pointer-events-auto'
            } ${
              isDark
                ? 'border-slate-800/80 bg-slate-900/65 text-slate-100 focus-within:border-indigo-500/60'
                : 'border-slate-200/90 bg-white/85 text-slate-900 focus-within:border-indigo-400'
            }`}
          >
            {/* Drag & Delete Handle */}
            <div className="mb-1 flex items-center justify-between opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
              <div
                onPointerDown={(e) => handleDragStart(e, block)}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                className="flex cursor-grab items-center gap-1 text-[11px] opacity-60 hover:opacity-100"
              >
                <GripHorizontal className="h-3.5 w-3.5" />
                <span>Move</span>
              </div>
              <button
                onClick={() => db.blocks.delete(block.id)}
                className="rounded p-0.5 text-rose-400 opacity-75 hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {block.type === 'text' ? (
              <textarea
                value={block.content}
                rows={Math.max(2, block.content.split('\n').length)}
                onChange={(e) =>
                  db.blocks.update(block.id, {
                    content: e.target.value,
                    updatedAt: Date.now(),
                  })
                }
                placeholder="Type notes, formulas, or headings..."
                className="w-full resize-none bg-transparent text-xs leading-relaxed outline-none sm:text-sm"
              />
            ) : (
              <div className="space-y-1.5 text-xs">
                {(block.checklistItems ?? []).map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const updated = (block.checklistItems ?? []).map((it) =>
                          it.id === item.id ? { ...it, checked: !it.checked } : it
                        );
                        db.blocks.update(block.id, { checklistItems: updated });
                      }}
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        item.checked
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-slate-500/40'
                      }`}
                    >
                      {item.checked && <Check className="h-3 w-3" />}
                    </button>
                    <input
                      type="text"
                      value={item.text}
                      onChange={(e) => {
                        const updated = (block.checklistItems ?? []).map((it) =>
                          it.id === item.id ? { ...it, text: e.target.value } : it
                        );
                        db.blocks.update(block.id, { checklistItems: updated });
                      }}
                      placeholder="To-do item..."
                      className={`flex-1 bg-transparent outline-none ${
                        item.checked ? 'line-through opacity-50' : ''
                      }`}
                    />
                  </div>
                ))}
                <button
                  onClick={() => {
                    const updated = [
                      ...(block.checklistItems ?? []),
                      { id: uid('chk'), text: '', checked: false },
                    ];
                    db.blocks.update(block.id, { checklistItems: updated });
                  }}
                  className="inline-flex items-center gap-1 pt-1 text-[11px] text-indigo-400 hover:underline"
                >
                  <Plus className="h-3 w-3" /> Add item
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
