import React from 'react';
import katex from 'katex';
import { Brain, CheckCircle2, Sparkles, Trash2, X } from 'lucide-react';
import { db, type MistakePattern } from '../../db/schema';

interface MistakeMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  patterns: MistakePattern[];
  onDropPracticeProblem: (pattern: MistakePattern) => void;
  isDarkUi: boolean;
}

function safeLatex(s: string): string {
  try {
    return katex.renderToString(s, { throwOnError: false });
  } catch {
    return s;
  }
}

export const MistakeMemoryModal: React.FC<MistakeMemoryModalProps> = ({
  isOpen,
  onClose,
  patterns,
  onDropPracticeProblem,
  isDarkUi,
}) => {
  if (!isOpen) return null;

  const sorted = [...patterns].sort((a, b) => b.occurrences - a.occurrences);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div
        className={`thin-scroll max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-5 shadow-2xl ${
          isDarkUi
            ? 'border-slate-800 bg-[#111622] text-slate-100'
            : 'border-slate-200 bg-white text-slate-900'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-500/20 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Brain className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Mistake Memory &amp; Blind Spots</h2>
              <p className="text-xs opacity-65">
                Tracks recurring slip-ups across your notebooks so you steadily master them.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 opacity-70 hover:bg-slate-500/15 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-xs">
          {sorted.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-500/30 py-10 text-center opacity-70">
              No recurring mistakes recorded yet! Solve math or physics steps with{' '}
              <strong>Live Mentor</strong> or <strong>Lasso Check</strong> to build your personal
              skill profile.
            </div>
          ) : (
            sorted.map((pat) => {
              const latest = pat.examples[0];
              return (
                <div
                  key={pat.id}
                  className={`rounded-2xl border p-3.5 ${
                    isDarkUi
                      ? 'border-slate-800 bg-slate-900/60'
                      : 'border-slate-200 bg-slate-50/80'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-indigo-400">
                        {pat.subject}
                      </span>
                      <h3 className="text-sm font-semibold">{pat.title}</h3>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
                        Spotted {pat.occurrences}×
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        Fixed {pat.resolvedCount}×
                      </span>
                      <button
                        onClick={() => db.mistakePatterns.delete(pat.id)}
                        title="Forget pattern"
                        className="rounded p-1 text-rose-400 opacity-60 hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {latest && (
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-rose-500/20 bg-rose-500/8 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase text-rose-400">
                          Recent Slip
                        </div>
                        <div
                          className="ghost-katex mt-1"
                          dangerouslySetInnerHTML={{ __html: safeLatex(latest.wrongExpr) }}
                        />
                      </div>

                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase text-emerald-400">
                          Corrected Step
                        </div>
                        <div
                          className="ghost-katex mt-1"
                          dangerouslySetInnerHTML={{ __html: safeLatex(latest.rightLatex) }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] opacity-70">{latest?.shortWhy}</span>
                    <button
                      onClick={() => {
                        onDropPracticeProblem(pat);
                        onClose();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Drop 1 Similar Practice Problem
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
