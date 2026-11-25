import React, { useRef, useState } from 'react';
import {
  Check,
  Download,
  KeyRound,
  PenTool,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { db, type AppSettings } from '../../db/schema';
import {
  exportWorkspaceBackupJSON,
  importWorkspaceBackupJSON,
} from '../../db/repositories';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  isDarkUi: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  isDarkUi,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState(settings.geminiApiKey);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const updateSetting = async (patch: Partial<AppSettings>) => {
    await db.settings.update('singleton', patch);
  };

  const handleSaveKey = async () => {
    await updateSetting({ geminiApiKey: apiKeyInput.trim() });
    setStatusMsg('Gemini API key saved locally on this device.');
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const handleExportBackup = async () => {
    const json = await exportWorkspaceBackupJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notepad-ai-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg('Full notebook & Mistake Memory backup downloaded.');
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importWorkspaceBackupJSON(text);
      setStatusMsg('Backup restored! Your notes and Mistake Memory are merged.');
    } catch (err: unknown) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to import backup.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div
        className={`thin-scroll max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-5 shadow-2xl ${
          isDarkUi
            ? 'border-slate-800 bg-[#111622] text-slate-100'
            : 'border-slate-200 bg-white text-slate-900'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-500/20 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            <h2 className="text-base font-semibold">Settings, AI Key &amp; S Pen</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 opacity-70 hover:bg-slate-500/15 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-5 text-xs">
          {/* Gemini API & $0 Strategy */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-2 font-semibold text-indigo-400">
              <KeyRound className="h-4 w-4" />
              <span>Gemini 4 Mentor Connection ($0 Setup)</span>
            </div>
            <p className="leading-relaxed opacity-75">
              Use the built-in Cloudflare `/api/mentor` serverless proxy, or paste your own key
              from <strong>Google AI Studio</strong> (backed by your Google AI Pro $10/month
              developer credit or free tier). When no key is present, local symbolic algebra check
              still works offline!
            </p>

            <div className="flex gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIzaSy... (Stored only in local IndexedDB)"
                className={`flex-1 rounded-xl border px-3 py-2 outline-none ${
                  isDarkUi
                    ? 'border-slate-700 bg-slate-900/90 text-slate-100 focus:border-indigo-500'
                    : 'border-slate-300 bg-slate-50 text-slate-900 focus:border-indigo-500'
                }`}
              />
              <button
                onClick={handleSaveKey}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 font-medium text-white hover:bg-indigo-500"
              >
                <Check className="h-3.5 w-3.5" />
                Save
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => updateSetting({ preferredModel: 'gemini-4-hydrogen' })}
                className={`rounded-xl border p-2.5 text-left transition ${
                  settings.preferredModel === 'gemini-4-hydrogen'
                    ? 'border-indigo-500 bg-indigo-500/15'
                    : 'border-slate-500/25 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="font-semibold">Gemini 4 Hydrogen</div>
                <div className="mt-0.5 text-[11px] opacity-70">
                  Recommended — ultra-fast &amp; lowest token cost
                </div>
              </button>

              <button
                onClick={() => updateSetting({ preferredModel: 'gemini-4-neon' })}
                className={`rounded-xl border p-2.5 text-left transition ${
                  settings.preferredModel === 'gemini-4-neon'
                    ? 'border-indigo-500 bg-indigo-500/15'
                    : 'border-slate-500/25 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="font-semibold">Gemini 4 Neon</div>
                <div className="mt-0.5 text-[11px] opacity-70">
                  Deep STEM reasoning &amp; multi-step proofs
                </div>
              </button>
            </div>
          </section>

          {/* S Pen & Stylus Controls */}
          <section className="space-y-2.5 border-t border-slate-500/20 pt-4">
            <div className="flex items-center gap-2 font-semibold text-emerald-400">
              <PenTool className="h-4 w-4" />
              <span>Android Tablet &amp; S Pen Ergonomics</span>
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-500/20 p-3">
              <div>
                <div className="font-medium">S Pen Only Drawing (Strict Palm Rejection)</div>
                <div className="text-[11px] opacity-70">
                  Stylus writes; fingers pan &amp; pinch-zoom without accidental marks. Auto-activates
                  on S Pen contact.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.penOnlyMode}
                onChange={(e) => updateSetting({ penOnlyMode: e.target.checked })}
                className="h-4 w-4 accent-indigo-500"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-500/20 p-3">
              <div>
                <div className="font-medium">Hold Pen Still to Snap Clean Shapes</div>
                <div className="text-[11px] opacity-70">
                  Pause for 0.45s at the end of a rough line, arrow, box, or circle to neaten it.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.holdToShapeEnabled}
                onChange={(e) => updateSetting({ holdToShapeEnabled: e.target.checked })}
                className="h-4 w-4 accent-indigo-500"
              />
            </label>
          </section>

          {/* Backup & Tablet <-> PC Transfer */}
          <section className="space-y-2.5 border-t border-slate-500/20 pt-4">
            <div className="flex items-center gap-2 font-semibold text-amber-400">
              <ShieldCheck className="h-4 w-4" />
              <span>Offline Backup &amp; Tablet ↔ PC Transfer</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleExportBackup}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-500/30 px-3 py-2 font-medium hover:bg-slate-500/10"
              >
                <Download className="h-3.5 w-3.5" />
                Export Full Backup (.json)
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-500/30 px-3 py-2 font-medium hover:bg-slate-500/10"
              >
                <Upload className="h-3.5 w-3.5" />
                Import Backup (.json)
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                onChange={handleImportBackup}
                className="hidden"
              />
            </div>
          </section>

          {statusMsg && (
            <div className="rounded-xl bg-emerald-500/15 px-3 py-2 text-emerald-300 ring-1 ring-emerald-500/30">
              {statusMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
