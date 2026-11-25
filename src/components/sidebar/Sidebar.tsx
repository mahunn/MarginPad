import React, { useMemo, useState } from 'react';
import {
  Brain,
  ChevronLeft,
  FileText,
  FolderIcon,
  FolderPlus,
  Pin,
  Plus,
  Search,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { Folder, MistakePattern, Note } from '../../db/schema';
import {
  createFolder,
  createQuickNote,
  deleteFolder,
  deleteNoteCascade,
  updateNote,
} from '../../db/repositories';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  folders: Folder[];
  notes: Note[];
  activeNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  mistakePatterns: MistakePattern[];
  onOpenMistakeMemory: () => void;
  onOpenSettings: () => void;
  isDarkUi: boolean;
}

const FOLDER_COLORS = ['#818cf8', '#34d399', '#fbbf24', '#fb7185', '#38bdf8', '#a78bfa'];

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  folders,
  notes,
  activeNoteId,
  onSelectNote,
  mistakePatterns,
  onOpenMistakeMemory,
  onOpenSettings,
  isDarkUi,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<
    { kind: 'all' } | { kind: 'pinned' } | { kind: 'folder'; id: string } | { kind: 'tag'; tag: string }
  >({ kind: 'all' });
  const [searchQuery, setSearchQuery] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) {
      for (const t of n.tags) set.add(t);
    }
    return Array.from(set).sort();
  }, [notes]);

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notes
      .filter((note) => {
        if (selectedFilter.kind === 'pinned' && !note.isPinned) return false;
        if (selectedFilter.kind === 'folder' && note.folderId !== selectedFilter.id) return false;
        if (selectedFilter.kind === 'tag' && !note.tags.includes(selectedFilter.tag)) return false;

        if (!q) return true;
        return (
          note.title.toLowerCase().includes(q) ||
          note.searchIndexText.toLowerCase().includes(q) ||
          note.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
  }, [notes, selectedFilter, searchQuery]);

  const handleQuickNote = async () => {
    const folderId = selectedFilter.kind === 'folder' ? selectedFilter.id : null;
    const created = await createQuickNote(folderId);
    onSelectNote(created.id);
    if (window.innerWidth < 1024) onClose();
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const folder = await createFolder(newFolderName, newFolderColor);
    setNewFolderName('');
    setCreatingFolder(false);
    setSelectedFilter({ kind: 'folder', id: folder.id });
  };

  const totalBlindSpots = mistakePatterns.reduce((acc, p) => acc + p.occurrences, 0);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop for tablet overlay */}
      <div
        className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] lg:hidden"
        onClick={onClose}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-76 flex-col border-r transition-colors lg:static ${
          isDarkUi
            ? 'border-slate-800/80 bg-[#0e121b] text-slate-100'
            : 'border-slate-200 bg-slate-50/95 text-slate-900'
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-500/30">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">Notepad-AI</h1>
              <p className={`text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-slate-500'}`}>
                Everyday Notes &amp; Mentor
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            title="Collapse Sidebar"
            className={`rounded-lg p-1.5 transition ${
              isDarkUi ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-200 text-slate-600'
            }`}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {/* Instant Quick Note CTA */}
        <div className="px-3 pb-3">
          <button
            onClick={handleQuickNote}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-sm font-medium text-white shadow-sm shadow-indigo-950/30 transition hover:bg-indigo-500 active:scale-[0.99]"
          >
            <Plus className="h-4 w-4" />
            Quick Note
          </button>
        </div>

        {/* Search Input */}
        <div className="px-3 pb-2">
          <div
            className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs ${
              isDarkUi
                ? 'border-slate-800 bg-slate-900/80 text-slate-200'
                : 'border-slate-200 bg-white text-slate-800'
            }`}
          >
            <Search className="h-3.5 w-3.5 opacity-50" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes, tags, equations..."
              className="w-full bg-transparent outline-none placeholder:opacity-50"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="opacity-60 hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation & Notes List */}
        <div className="thin-scroll flex-1 space-y-4 overflow-y-auto px-3 py-2">
          {/* Quick Filters */}
          <div className="space-y-0.5 text-xs">
            <button
              onClick={() => setSelectedFilter({ kind: 'all' })}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 font-medium transition ${
                selectedFilter.kind === 'all'
                  ? isDarkUi
                    ? 'bg-indigo-500/15 text-indigo-300'
                    : 'bg-indigo-50 text-indigo-700'
                  : isDarkUi
                    ? 'text-slate-300 hover:bg-slate-800/70'
                    : 'text-slate-700 hover:bg-slate-200/60'
              }`}
            >
              <span className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                All Notes
              </span>
              <span className="opacity-60">{notes.length}</span>
            </button>

            <button
              onClick={() => setSelectedFilter({ kind: 'pinned' })}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 font-medium transition ${
                selectedFilter.kind === 'pinned'
                  ? isDarkUi
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-amber-50 text-amber-700'
                  : isDarkUi
                    ? 'text-slate-300 hover:bg-slate-800/70'
                    : 'text-slate-700 hover:bg-slate-200/60'
              }`}
            >
              <span className="flex items-center gap-2">
                <Pin className="h-3.5 w-3.5" />
                Pinned
              </span>
              <span className="opacity-60">{notes.filter((n) => n.isPinned).length}</span>
            </button>
          </div>

          {/* Folders Section */}
          <div>
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="text-[11px] font-semibold tracking-wider uppercase opacity-50">
                Folders
              </span>
              <button
                onClick={() => setCreatingFolder((v) => !v)}
                title="New Folder"
                className="rounded p-0.5 opacity-60 hover:opacity-100"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            </div>

            {creatingFolder && (
              <form
                onSubmit={handleCreateFolder}
                className={`mb-2 space-y-2 rounded-xl border p-2.5 text-xs ${
                  isDarkUi ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
                }`}
              >
                <input
                  type="text"
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name..."
                  className="w-full bg-transparent outline-none"
                />
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {FOLDER_COLORS.map((c) => (
                      <button
                        type="button"
                        key={c}
                        onClick={() => setNewFolderColor(c)}
                        className={`h-4 w-4 rounded-full transition ${
                          newFolderColor === c ? 'scale-110 ring-2 ring-white/80' : 'opacity-70'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <button
                    type="submit"
                    className="rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white"
                  >
                    Add
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-0.5 text-xs">
              {folders.map((folder) => {
                const isSelected =
                  selectedFilter.kind === 'folder' && selectedFilter.id === folder.id;
                const folderCount = notes.filter((n) => n.folderId === folder.id).length;
                return (
                  <div
                    key={folder.id}
                    className={`group flex items-center justify-between rounded-lg px-2.5 py-1.5 transition ${
                      isSelected
                        ? isDarkUi
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-200/80 text-slate-900'
                        : isDarkUi
                          ? 'text-slate-300 hover:bg-slate-800/60'
                          : 'text-slate-700 hover:bg-slate-200/50'
                    }`}
                  >
                    <button
                      onClick={() => setSelectedFilter({ kind: 'folder', id: folder.id })}
                      className="flex flex-1 items-center gap-2 truncate text-left"
                    >
                      <FolderIcon className="h-3.5 w-3.5 shrink-0" style={{ color: folder.color }} />
                      <span className="truncate">{folder.name}</span>
                    </button>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] opacity-50">{folderCount}</span>
                      <button
                        onClick={() => deleteFolder(folder.id)}
                        title="Delete Folder (keeps notes)"
                        className="hidden rounded p-0.5 text-rose-400 opacity-70 hover:opacity-100 group-hover:inline-flex"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div>
              <div className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider uppercase opacity-50">
                Tags
              </div>
              <div className="flex flex-wrap gap-1.5 px-1">
                {allTags.map((tag) => {
                  const active = selectedFilter.kind === 'tag' && selectedFilter.tag === tag;
                  return (
                    <button
                      key={tag}
                      onClick={() =>
                        setSelectedFilter(active ? { kind: 'all' } : { kind: 'tag', tag })
                      }
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] transition ${
                        active
                          ? 'bg-indigo-600 text-white'
                          : isDarkUi
                            ? 'bg-slate-800/90 text-slate-300 hover:bg-slate-700'
                            : 'bg-slate-200/80 text-slate-700 hover:bg-slate-300/70'
                      }`}
                    >
                      <Tag className="h-2.5 w-2.5" />
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Notes List */}
          <div>
            <div className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider uppercase opacity-50">
              Notes ({filteredNotes.length})
            </div>
            <div className="space-y-1">
              {filteredNotes.map((note) => {
                const isActive = note.id === activeNoteId;
                return (
                  <div
                    key={note.id}
                    onClick={() => {
                      onSelectNote(note.id);
                      if (window.innerWidth < 1024) onClose();
                    }}
                    className={`group cursor-pointer rounded-xl border p-2.5 transition ${
                      isActive
                        ? isDarkUi
                          ? 'border-indigo-500/50 bg-indigo-500/12 text-white'
                          : 'border-indigo-300 bg-indigo-50/90 text-slate-900'
                        : isDarkUi
                          ? 'border-transparent bg-slate-900/40 hover:border-slate-800 hover:bg-slate-800/50'
                          : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-1 text-xs font-medium">{note.title}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateNote(note.id, { isPinned: !note.isPinned });
                          }}
                          title={note.isPinned ? 'Unpin' : 'Pin'}
                          className={`rounded p-0.5 transition ${
                            note.isPinned
                              ? 'text-amber-400 opacity-100'
                              : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
                          }`}
                        >
                          <Pin className="h-3 w-3" />
                        </button>
                        {notes.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteNoteCascade(note.id);
                            }}
                            title="Delete note"
                            className="rounded p-0.5 text-rose-400 opacity-0 transition group-hover:opacity-60 hover:!opacity-100"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-[10px] opacity-60">
                      <span>
                        {new Date(note.updatedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="capitalize">{note.layoutMode}</span>
                    </div>
                  </div>
                );
              })}

              {filteredNotes.length === 0 && (
                <p className="px-2 py-6 text-center text-xs opacity-50">
                  No matching notes found.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Footer: Mistake Memory + Settings */}
        <div
          className={`space-y-1.5 border-t p-3 ${
            isDarkUi ? 'border-slate-800/80' : 'border-slate-200'
          }`}
        >
          <button
            onClick={onOpenMistakeMemory}
            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-xs font-medium transition ${
              isDarkUi
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100/80'
            }`}
          >
            <span className="flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Mistake Memory
            </span>
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold">
              {mistakePatterns.length} patterns ({totalBlindSpots})
            </span>
          </button>

          <button
            onClick={onOpenSettings}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition ${
              isDarkUi
                ? 'text-slate-300 hover:bg-slate-800'
                : 'text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            <Settings className="h-4 w-4 opacity-75" />
            Settings, S Pen &amp; Backup
          </button>
        </div>
      </aside>
    </>
  );
};
