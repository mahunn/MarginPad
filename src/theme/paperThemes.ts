import type { PaperTemplate, PaperTheme, SemanticInkColor } from '../db/schema';

export interface ThemePalette {
  id: PaperTheme;
  label: string;
  canvasBg: string;
  workspaceBg: string;
  gridLine: string;
  ruledMargin: string;
  surfaceBg: string;
  surfaceBorder: string;
  textPrimary: string;
  textMuted: string;
  isDark: boolean;
}

export const PAPER_THEMES: Record<PaperTheme, ThemePalette> = {
  'oled-dark': {
    id: 'oled-dark',
    label: 'OLED Dark',
    canvasBg: '#0b0d13',
    workspaceBg: '#06070b',
    gridLine: 'rgba(148, 163, 184, 0.11)',
    ruledMargin: 'rgba(244, 63, 94, 0.25)',
    surfaceBg: 'rgba(17, 24, 39, 0.92)',
    surfaceBorder: 'rgba(75, 85, 99, 0.45)',
    textPrimary: '#f3f4f6',
    textMuted: '#9ca3af',
    isDark: true,
  },
  light: {
    id: 'light',
    label: 'Crisp Paper',
    canvasBg: '#ffffff',
    workspaceBg: '#eef2f6',
    gridLine: 'rgba(100, 116, 139, 0.16)',
    ruledMargin: 'rgba(244, 63, 94, 0.28)',
    surfaceBg: 'rgba(255, 255, 255, 0.94)',
    surfaceBorder: 'rgba(203, 213, 225, 0.85)',
    textPrimary: '#0f172a',
    textMuted: '#64748b',
    isDark: false,
  },
  warm: {
    id: 'warm',
    label: 'Warm Notebook',
    canvasBg: '#fbf7ee',
    workspaceBg: '#efe9dc',
    gridLine: 'rgba(120, 113, 108, 0.16)',
    ruledMargin: 'rgba(225, 29, 72, 0.24)',
    surfaceBg: 'rgba(253, 250, 243, 0.95)',
    surfaceBorder: 'rgba(214, 206, 190, 0.9)',
    textPrimary: '#1c1917',
    textMuted: '#78716c',
    isDark: false,
  },
};

/**
 * Samsung Notes-style Smart Ink Auto-Inversion:
 * 'ink' strokes render crisp off-white on OLED Dark paper and deep charcoal on Light/Warm paper
 * (and automatically normalize to dark ink when exporting white-paper PDFs).
 */
export const SEMANTIC_INK_HEX: Record<
  SemanticInkColor,
  { light: string; dark: string; label: string; swatch: string }
> = {
  ink: {
    light: '#111827',
    dark: '#f3f4f6',
    label: 'Adaptive Ink',
    swatch: '#94a3b8',
  },
  blue: {
    light: '#2563eb',
    dark: '#60a5fa',
    label: 'Cobalt Blue',
    swatch: '#3b82f6',
  },
  coral: {
    light: '#e11d48',
    dark: '#fb7185',
    label: 'Coral Red',
    swatch: '#f43f5e',
  },
  emerald: {
    light: '#059669',
    dark: '#34d399',
    label: 'Emerald',
    swatch: '#10b981',
  },
  amber: {
    light: '#d97706',
    dark: '#fbbf24',
    label: 'Amber',
    swatch: '#f59e0b',
  },
  violet: {
    light: '#7c3aed',
    dark: '#a78bfa',
    label: 'Violet',
    swatch: '#8b5cf6',
  },
};

export function resolveInkColor(
  semantic: SemanticInkColor,
  theme: PaperTheme,
  forceLightForExport = false
): string {
  const entry = SEMANTIC_INK_HEX[semantic] ?? SEMANTIC_INK_HEX.ink;
  if (forceLightForExport) return entry.light;
  return PAPER_THEMES[theme].isDark ? entry.dark : entry.light;
}

export const PAPER_TEMPLATE_LABELS: Record<PaperTemplate, string> = {
  grid: 'Math Grid',
  ruled: 'Ruled Lines',
  dotted: 'Dot Matrix',
  blank: 'Blank Sheet',
};
