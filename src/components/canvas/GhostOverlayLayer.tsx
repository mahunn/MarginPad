import React from 'react';
import katex from 'katex';
import {
  Check,
  Eye,
  Lightbulb,
  Repeat,
  Sparkles,
  X,
} from 'lucide-react';
import {
  db,
  type GhostAnnotation,
  type PaperTheme,
} from '../../db/schema';
import { incrementPatternResolved } from '../../db/repositories';
import { PAPER_THEMES } from '../../theme/paperThemes';

interface GhostOverlayLayerProps {
  annotations: GhostAnnotation[];
  paperTheme: PaperTheme;
  onPracticeSimilar: (categorySlug: string, anchorY: number) => void;
}

function renderGhostMath(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: false,
    });
  } catch {
    return latex;
  }
}

/**
 * Clean, non-clunky Ghost Ink & Socratic Nudge layer.
 * - Positions Ghost Ink cleanly to the RIGHT of the flawed step (with a subtle connector)
 *   so the user's handwriting and the AI's corrected writing never overlap messily.
 * - Supports both 'hint' (critical thinking first) and 'ghost' (clean corrected expression + 1-line why).
 */
export const GhostOverlayLayer: React.FC<GhostOverlayLayerProps> = ({
  annotations,
  paperTheme,
  onPracticeSimilar,
}) => {
  const isDark = PAPER_THEMES[paperTheme].isDark;
  const activeList = annotations.filter((a) => a.status === 'active');

  if (activeList.length === 0) return null;

  const handleRevealGhost = async (id: string) => {
    await db.ghostAnnotations.update(id, { revealState: 'ghost' });
  };

  const handleResolve = async (ann: GhostAnnotation) => {
    await db.ghostAnnotations.update(ann.id, { status: 'resolved' });
    await incrementPatternResolved(ann.categorySlug);
  };

  const handleDismiss = async (id: string) => {
    await db.ghostAnnotations.update(id, { status: 'dismissed' });
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      {activeList.map((ann) => {
        const [, minY, maxX, maxY] = ann.anchorBBox;
        const midY = (minY + maxY) / 2;
        const placeLeft = maxX + 28;
        const isGhost = ann.revealState === 'ghost';

        return (
          <div
            key={ann.id}
            style={{
              left: placeLeft,
              top: Math.max(12, midY - 22),
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="pointer-events-auto absolute z-10 flex items-start gap-2"
          >
            {/* Subtle horizontal leader line connecting the flawed step to Ghost Ink */}
            <div
              className={`mt-5 h-[1.5px] w-5 shrink-0 rounded-full ${
                isGhost ? 'bg-emerald-400/60' : 'bg-amber-400/60'
              }`}
            />

            {!isGhost ? (
              /* MODE 1: Compact Critical-Thinking Hint Pill (Zero Spoiler) */
              <div
                className={`max-w-[320px] rounded-2xl border px-3 py-2 text-xs shadow-lg backdrop-blur-md transition ${
                  isDark
                    ? 'border-amber-500/35 bg-[#161b28]/92 text-slate-100'
                    : 'border-amber-300 bg-amber-50/95 text-slate-900'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-400">
                    <Lightbulb className="h-3.5 w-3.5 shrink-0" />
                    <span>{ann.categoryTitle}</span>
                    {ann.isRepeatBlindSpot && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-500/20 px-1.5 py-0.2 text-[10px] text-rose-300">
                        <Repeat className="h-2.5 w-2.5" />
                        {ann.repeatCount}x
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDismiss(ann.id)}
                    title="Dismiss"
                    className="rounded p-0.5 opacity-55 hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                <p className="mt-1 leading-snug opacity-90">{ann.socraticHint}</p>

                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => handleRevealGhost(ann.id)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                      isDark
                        ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                        : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200/80'
                    }`}
                  >
                    <Eye className="h-3 w-3" />
                    Show Ghost Fix
                  </button>

                  <button
                    onClick={() => handleResolve(ann)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] opacity-70 hover:bg-slate-500/15 hover:opacity-100"
                  >
                    <Check className="h-3 w-3" />
                    Got it
                  </button>
                </div>
              </div>
            ) : (
              /* MODE 2: Clean Ghost Ink Correction + Tiny 1-Line Why Caption */
              <div className="max-w-[350px] space-y-1">
                {/* Distinct Translucent Ghost Ink Expression */}
                <div className="flex items-center gap-2">
                  <div
                    className={`ghost-katex rounded-xl border border-dashed px-3 py-1.5 tracking-wide backdrop-blur-xs transition ${
                      isDark
                        ? 'border-emerald-400/45 bg-emerald-500/10 text-emerald-300/92'
                        : 'border-emerald-500/50 bg-emerald-50/90 text-emerald-800'
                    }`}
                    dangerouslySetInnerHTML={{
                      __html: renderGhostMath(ann.ghostLatex),
                    }}
                  />

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleResolve(ann)}
                      title="Mark fixed"
                      className="rounded-lg bg-emerald-500/20 p-1.5 text-emerald-400 hover:bg-emerald-500/30"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDismiss(ann.id)}
                      title="Dismiss"
                      className="rounded-lg p-1.5 opacity-55 hover:bg-slate-500/15 hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Minimal 1-Line Explanation Tag */}
                <div
                  className={`rounded-xl border px-2.5 py-1.5 text-[11px] leading-snug shadow-sm ${
                    isDark
                      ? 'border-slate-800 bg-[#121723]/92 text-slate-300'
                      : 'border-slate-200 bg-white/95 text-slate-700'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-emerald-400">Why:</span>
                    <span>{ann.shortExplanation}</span>
                    {ann.isRepeatBlindSpot && (
                      <span className="rounded-full bg-rose-500/20 px-1.5 py-0.2 text-[10px] font-medium text-rose-300">
                        Repeat ({ann.repeatCount}x)
                      </span>
                    )}
                  </div>

                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      onClick={() => onPracticeSimilar(ann.categorySlug, maxY + 48)}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-400 hover:underline"
                    >
                      <Sparkles className="h-2.5 w-2.5" />
                      Try 1 similar problem
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
