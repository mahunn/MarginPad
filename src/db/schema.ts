import Dexie, { type EntityTable } from 'dexie';

export type LayoutMode = 'vertical' | 'infinite';
export type PaperTemplate = 'blank' | 'ruled' | 'grid' | 'dotted';
export type PaperTheme = 'light' | 'warm' | 'oled-dark';
export type MentorMode = 'hint' | 'ghost';
export type ToolType = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shape' | 'text' | 'pan';
export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'arrow';
export type SemanticInkColor = 'ink' | 'blue' | 'coral' | 'emerald' | 'amber' | 'violet';
export type SubjectDomain = 'math' | 'physics' | 'logic';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  sortOrder: number;
  createdAt: number;
}

export interface Note {
  id: string;
  folderId: string | null;
  title: string;
  tags: string[];
  isPinned: boolean;
  layoutMode: LayoutMode;
  paperTemplate: PaperTemplate;
  paperTheme: PaperTheme;
  liveMentorEnabled: boolean;
  mentorMode: MentorMode;
  searchIndexText: string;
  pageHeight: number;
  createdAt: number;
  updatedAt: number;
}

export interface Stroke {
  id: string;
  noteId: string;
  tool: 'pen' | 'highlighter' | 'shape';
  shapeKind?: ShapeKind;
  semanticColor: SemanticInkColor;
  width: number;
  opacity: number;
  /** [x, y, pressure] points in note world coordinates */
  points: [number, number, number][];
  /** [minX, minY, maxX, maxY] */
  bbox: [number, number, number, number];
  createdAt: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface PracticeMeta {
  categorySlug: string;
  categoryTitle: string;
  promptLatexOrText: string;
  hint: string;
  answerLatex: string;
  revealedAnswer?: boolean;
}

export interface CanvasBlock {
  id: string;
  noteId: string;
  type: 'text' | 'checklist' | 'image' | 'pdf-page' | 'practice-card';
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  checklistItems?: ChecklistItem[];
  assetId?: string;
  practiceMeta?: PracticeMeta;
  createdAt: number;
  updatedAt: number;
}

export interface AssetBlob {
  id: string;
  noteId: string;
  mimeType: string;
  dataUrl: string;
  width: number;
  height: number;
  pageNumber?: number;
  createdAt: number;
}

export interface GhostAnnotation {
  id: string;
  noteId: string;
  targetStrokeIds: string[];
  /** [minX, minY, maxX, maxY] in note world coordinates */
  anchorBBox: [number, number, number, number];
  status: 'active' | 'resolved' | 'dismissed';
  revealState: 'hint' | 'ghost';
  subject: SubjectDomain;
  categorySlug: string;
  categoryTitle: string;
  isRepeatBlindSpot: boolean;
  repeatCount: number;
  wrongExpression: string;
  socraticHint: string;
  shortExplanation: string;
  ghostLatex: string;
  verifiedByCAS: boolean;
  createdAt: number;
}

export interface MistakeExample {
  wrongExpr: string;
  rightLatex: string;
  shortWhy: string;
  noteId: string;
  seenAt: number;
}

export interface MistakePattern {
  id: string;
  categorySlug: string;
  title: string;
  subject: SubjectDomain;
  occurrences: number;
  resolvedCount: number;
  lastSeenAt: number;
  examples: MistakeExample[];
}

export interface AppSettings {
  id: string; // 'singleton'
  geminiApiKey: string;
  preferredModel: 'gemini-4-hydrogen' | 'gemini-4-neon';
  useServerProxy: boolean;
  penOnlyMode: boolean;
  holdToShapeEnabled: boolean;
  defaultPaperTheme: PaperTheme;
  defaultPaperTemplate: PaperTemplate;
  defaultMentorMode: MentorMode;
}

export class NotepadAIDB extends Dexie {
  folders!: EntityTable<Folder, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  strokes!: EntityTable<Stroke, 'id'>;
  blocks!: EntityTable<CanvasBlock, 'id'>;
  assets!: EntityTable<AssetBlob, 'id'>;
  ghostAnnotations!: EntityTable<GhostAnnotation, 'id'>;
  mistakePatterns!: EntityTable<MistakePattern, 'id'>;
  settings!: EntityTable<AppSettings, 'id'>;

  constructor() {
    super('NotepadAIDB_v1');
    this.version(1).stores({
      folders: 'id, parentId, sortOrder, createdAt',
      notes: 'id, folderId, isPinned, updatedAt, *tags',
      strokes: 'id, noteId, createdAt',
      blocks: 'id, noteId, type, createdAt',
      assets: 'id, noteId, createdAt',
      ghostAnnotations: 'id, noteId, status, categorySlug, createdAt',
      mistakePatterns: 'id, &categorySlug, subject, occurrences, lastSeenAt',
      settings: 'id',
    });
  }
}

export const db = new NotepadAIDB();
