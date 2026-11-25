import {
  db,
  type AppSettings,
  type AssetBlob,
  type CanvasBlock,
  type Folder,
  type GhostAnnotation,
  type MistakePattern,
  type Note,
  type PaperTemplate,
  type PaperTheme,
  type Stroke,
} from './schema';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'singleton',
  geminiApiKey: '',
  preferredModel: 'gemini-4-hydrogen',
  useServerProxy: true,
  penOnlyMode: false, // Auto-enables on first S Pen contact or manually in toolbar
  holdToShapeEnabled: true,
  defaultPaperTheme: 'oled-dark',
  defaultPaperTemplate: 'grid',
  defaultMentorMode: 'hint',
};

let initPromise: Promise<string> | null = null;

export function ensureInitialized(): Promise<string> {
  if (!initPromise) {
    initPromise = runEnsureInitialized();
  }
  return initPromise;
}

async function cleanupStrictModeDuplicates(): Promise<void> {
  // 1. Deduplicate folders with identical names (reassigning notes cleanly)
  const folders = await db.folders.orderBy('createdAt').toArray();
  const seenFolders = new Map<string, string>();
  for (const f of folders) {
    const existingId = seenFolders.get(f.name);
    if (existingId) {
      await db.notes.where('folderId').equals(f.id).modify({ folderId: existingId });
      await db.folders.delete(f.id);
    } else {
      seenFolders.set(f.name, f.id);
    }
  }

  // 2. If StrictMode seeded two 'Algebra Sandbox — Try AI Mentor' notes, remove only an untouched duplicate
  const sandboxNotes = await db.notes
    .filter((n) => n.title === 'Algebra Sandbox — Try AI Mentor')
    .toArray();
  if (sandboxNotes.length > 1) {
    const withCounts = await Promise.all(
      sandboxNotes.map(async (n) => ({
        note: n,
        strokeCount: await db.strokes.where('noteId').equals(n.id).count(),
      }))
    );
    // Sort so notes where the user drew extra strokes come FIRST and are preserved
    withCounts.sort((a, b) => b.strokeCount - a.strokeCount || b.note.updatedAt - a.note.updatedAt);
    for (let i = 1; i < withCounts.length; i++) {
      if (withCounts[i].strokeCount <= 22) {
        await deleteNoteCascade(withCounts[i].note.id);
      }
    }
  }

  // 3. Normalize any inflated demo pattern occurrence count from initial loop
  const patterns = await db.mistakePatterns.toArray();
  for (const p of patterns) {
    if (p.occurrences > p.examples.length && p.examples.length > 0) {
      const uniqueExamples = p.examples.filter(
        (ex, idx, arr) =>
          arr.findIndex((o) => o.wrongExpr === ex.wrongExpr && o.noteId === ex.noteId) === idx
      );
      await db.mistakePatterns.update(p.id, {
        occurrences: uniqueExamples.length,
        examples: uniqueExamples,
      });
    }
  }
}

async function runEnsureInitialized(): Promise<string> {
  const existingSettings = await db.settings.get('singleton');
  if (!existingSettings) {
    await db.settings.put(DEFAULT_SETTINGS);
  }

  const noteCount = await db.notes.count();
  if (noteCount > 0) {
    await cleanupStrictModeDuplicates();
    const latest = await db.notes.orderBy('updatedAt').reverse().first();
    return latest!.id;
  }

  // Seed starter folders + a ready-to-try demo math note so the user can test Ghost Ink right away
  const mathFolderId = uid('fld');
  const dailyFolderId = uid('fld');
  const now = Date.now();

  await db.folders.bulkAdd([
    {
      id: mathFolderId,
      name: 'Math & Physics',
      parentId: null,
      color: '#818cf8',
      sortOrder: 0,
      createdAt: now,
    },
    {
      id: dailyFolderId,
      name: 'Daily Notes',
      parentId: null,
      color: '#34d399',
      sortOrder: 1,
      createdAt: now + 1,
    },
  ]);

  const welcomeNoteId = uid('note');
  const welcomeNote: Note = {
    id: welcomeNoteId,
    folderId: mathFolderId,
    title: 'Algebra Sandbox — Try AI Mentor',
    tags: ['algebra', 'practice'],
    isPinned: true,
    layoutMode: 'vertical',
    paperTemplate: 'grid',
    paperTheme: 'oled-dark',
    liveMentorEnabled: true,
    mentorMode: 'hint',
    searchIndexText: 'Solve 3x - 2(x - 4) = 11 -> 3x - 2x - 8 = 11',
    pageHeight: 1600,
    createdAt: now,
    updatedAt: now,
  };

  await db.notes.add(welcomeNote);

  // Add a clean intro text card at top of the starter note
  const introBlock: CanvasBlock = {
    id: uid('blk'),
    noteId: welcomeNoteId,
    type: 'text',
    x: 60,
    y: 44,
    width: 680,
    height: 112,
    content:
      'Welcome to Notepad-AI!\n• Write with your S Pen or mouse anywhere below.\n• Lasso-circle equations (or toggle Live Mentor) to spot exact step mistakes with clean Ghost Ink overlays.',
    createdAt: now,
    updatedAt: now,
  };
  await db.blocks.add(introBlock);

  // Seed realistic handwritten strokes for:
  // Line 1: 2(x - 3) = 10
  // Line 2: 2x - 3 = 10   <-- subtle distribution mistake ready to inspect or erase!
  const demoStrokes = buildStarterEquationStrokes(welcomeNoteId, now);
  await db.strokes.bulkAdd(demoStrokes);

  return welcomeNoteId;
}

/**
 * Generates clean vector strokes for a starter handwritten equation:
 * Step 1: 2(x - 3) = 10
 * Step 2: 2x - 3 = 10
 */
function buildStarterEquationStrokes(noteId: string, baseTime: number): Stroke[] {
  const glyphs: Record<string, [number, number][][]> = {
    '2': [
      [
        [0, 6],
        [8, 0],
        [18, 2],
        [19, 11],
        [2, 28],
        [21, 28],
      ],
    ],
    '(': [
      [
        [12, 0],
        [4, 15],
        [12, 32],
      ],
    ],
    x: [
      [
        [2, 6],
        [18, 28],
      ],
      [
        [18, 6],
        [2, 28],
      ],
    ],
    '-': [
      [
        [2, 16],
        [18, 16],
      ],
    ],
    '3': [
      [
        [2, 4],
        [16, 2],
        [18, 11],
        [8, 15],
        [19, 20],
        [15, 29],
        [2, 27],
      ],
    ],
    ')': [
      [
        [4, 0],
        [12, 15],
        [4, 32],
      ],
    ],
    '=': [
      [
        [2, 12],
        [18, 12],
      ],
      [
        [2, 21],
        [18, 21],
      ],
    ],
    '1': [
      [
        [10, 2],
        [10, 29],
      ],
    ],
    '0': [
      [
        [10, 2],
        [2, 10],
        [2, 22],
        [10, 29],
        [18, 22],
        [18, 10],
        [10, 2],
      ],
    ],
  };

  const renderLine = (text: string, startX: number, startY: number, tOffset: number): Stroke[] => {
    const out: Stroke[] = [];
    let cursorX = startX;
    let idx = 0;
    for (const ch of text) {
      if (ch === ' ') {
        cursorX += 18;
        continue;
      }
      const parts = glyphs[ch];
      if (!parts) {
        cursorX += 20;
        continue;
      }
      for (const poly of parts) {
        const pts: [number, number, number][] = [];
        for (let i = 0; i < poly.length; i++) {
          const [px, py] = poly[i];
          if (i > 0) {
            const [prevX, prevY] = poly[i - 1];
            pts.push([cursorX + (prevX + px) / 2, startY + (prevY + py) / 2, 0.62]);
          }
          pts.push([cursorX + px, startY + py, 0.65]);
        }
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        out.push({
          id: uid('stk'),
          noteId,
          tool: 'pen',
          semanticColor: 'ink',
          width: 3.2,
          opacity: 1,
          points: pts,
          bbox: [Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3],
          createdAt: baseTime + tOffset + idx++,
        });
      }
      cursorX += 26;
    }
    return out;
  };

  return [
    ...renderLine('2(x - 3) = 10', 96, 220, 10),
    ...renderLine('2x - 3 = 10', 112, 288, 50),
  ];
}

export async function createQuickNote(
  folderId: string | null = null,
  overrides?: Partial<Pick<Note, 'title' | 'layoutMode' | 'paperTemplate' | 'paperTheme'>>
): Promise<Note> {
  const settings = (await db.settings.get('singleton')) ?? DEFAULT_SETTINGS;
  const now = Date.now();
  const note: Note = {
    id: uid('note'),
    folderId,
    title: overrides?.title ?? `Quick Note — ${new Date(now).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    tags: [],
    isPinned: false,
    layoutMode: overrides?.layoutMode ?? 'vertical',
    paperTemplate: overrides?.paperTemplate ?? settings.defaultPaperTemplate,
    paperTheme: overrides?.paperTheme ?? settings.defaultPaperTheme,
    liveMentorEnabled: false,
    mentorMode: settings.defaultMentorMode,
    searchIndexText: '',
    pageHeight: 1600,
    createdAt: now,
    updatedAt: now,
  };
  await db.notes.add(note);
  return note;
}

export async function updateNote(noteId: string, patch: Partial<Note>): Promise<void> {
  await db.notes.update(noteId, {
    ...patch,
    updatedAt: Date.now(),
  });
}

export async function deleteNoteCascade(noteId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.notes, db.strokes, db.blocks, db.assets, db.ghostAnnotations],
    async () => {
      await db.strokes.where('noteId').equals(noteId).delete();
      await db.blocks.where('noteId').equals(noteId).delete();
      await db.assets.where('noteId').equals(noteId).delete();
      await db.ghostAnnotations.where('noteId').equals(noteId).delete();
      await db.notes.delete(noteId);
    }
  );
}

export async function createFolder(name: string, color = '#818cf8'): Promise<Folder> {
  const count = await db.folders.count();
  const folder: Folder = {
    id: uid('fld'),
    name: name.trim() || 'Untitled Folder',
    parentId: null,
    color,
    sortOrder: count,
    createdAt: Date.now(),
  };
  await db.folders.add(folder);
  return folder;
}

export async function deleteFolder(folderId: string): Promise<void> {
  await db.transaction('rw', [db.folders, db.notes], async () => {
    await db.notes.where('folderId').equals(folderId).modify({ folderId: null });
    await db.folders.delete(folderId);
  });
}

export async function saveAsset(asset: Omit<AssetBlob, 'id' | 'createdAt'>): Promise<AssetBlob> {
  const full: AssetBlob = {
    ...asset,
    id: uid('ast'),
    createdAt: Date.now(),
  };
  await db.assets.add(full);
  return full;
}

export async function recordMistakePattern(params: {
  categorySlug: string;
  title: string;
  subject: 'math' | 'physics' | 'logic';
  wrongExpr: string;
  rightLatex: string;
  shortWhy: string;
  noteId: string;
}): Promise<{ isRepeat: boolean; occurrences: number }> {
  const slug = params.categorySlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'general-step-error';

  const existing = await db.mistakePatterns.where('categorySlug').equals(slug).first();
  const now = Date.now();

  if (existing) {
    const nowSameSlip =
      existing.examples[0]?.noteId === params.noteId &&
      existing.examples[0]?.wrongExpr.trim() === params.wrongExpr.trim();
    if (nowSameSlip) {
      return { isRepeat: existing.occurrences > 1, occurrences: existing.occurrences };
    }

    const nextOccurrences = existing.occurrences + 1;
    const updatedExamples = [
      {
        wrongExpr: params.wrongExpr,
        rightLatex: params.rightLatex,
        shortWhy: params.shortWhy,
        noteId: params.noteId,
        seenAt: now,
      },
      ...existing.examples,
    ].slice(0, 8);

    await db.mistakePatterns.update(existing.id, {
      occurrences: nextOccurrences,
      lastSeenAt: now,
      examples: updatedExamples,
    });
    return { isRepeat: true, occurrences: nextOccurrences };
  }

  const created: MistakePattern = {
    id: uid('mp'),
    categorySlug: slug,
    title: params.title || 'Algebraic Step Error',
    subject: params.subject,
    occurrences: 1,
    resolvedCount: 0,
    lastSeenAt: now,
    examples: [
      {
        wrongExpr: params.wrongExpr,
        rightLatex: params.rightLatex,
        shortWhy: params.shortWhy,
        noteId: params.noteId,
        seenAt: now,
      },
    ],
  };
  await db.mistakePatterns.add(created);
  return { isRepeat: false, occurrences: 1 };
}

export async function incrementPatternResolved(categorySlug: string): Promise<void> {
  const existing = await db.mistakePatterns.where('categorySlug').equals(categorySlug).first();
  if (existing) {
    await db.mistakePatterns.update(existing.id, {
      resolvedCount: existing.resolvedCount + 1,
    });
  }
}

export async function exportWorkspaceBackupJSON(): Promise<string> {
  const [folders, notes, strokes, blocks, assets, ghostAnnotations, mistakePatterns] =
    await Promise.all([
      db.folders.toArray(),
      db.notes.toArray(),
      db.strokes.toArray(),
      db.blocks.toArray(),
      db.assets.toArray(),
      db.ghostAnnotations.toArray(),
      db.mistakePatterns.toArray(),
    ]);

  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      folders,
      notes,
      strokes,
      blocks,
      assets,
      ghostAnnotations,
      mistakePatterns,
    },
    null,
    2
  );
}

export async function importWorkspaceBackupJSON(rawJson: string): Promise<void> {
  const parsed = JSON.parse(rawJson);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.notes)) {
    throw new Error('Invalid Notepad-AI backup file.');
  }

  await db.transaction(
    'rw',
    [db.folders, db.notes, db.strokes, db.blocks, db.assets, db.ghostAnnotations, db.mistakePatterns],
    async () => {
      if (Array.isArray(parsed.folders)) await db.folders.bulkPut(parsed.folders);
      if (Array.isArray(parsed.notes)) await db.notes.bulkPut(parsed.notes);
      if (Array.isArray(parsed.strokes)) await db.strokes.bulkPut(parsed.strokes);
      if (Array.isArray(parsed.blocks)) await db.blocks.bulkPut(parsed.blocks);
      if (Array.isArray(parsed.assets)) await db.assets.bulkPut(parsed.assets);
      if (Array.isArray(parsed.ghostAnnotations)) {
        await db.ghostAnnotations.bulkPut(parsed.ghostAnnotations);
      }
      if (Array.isArray(parsed.mistakePatterns)) {
        await db.mistakePatterns.bulkPut(parsed.mistakePatterns);
      }
    }
  );
}
