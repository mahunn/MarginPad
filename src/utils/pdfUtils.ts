import { db, type CanvasBlock, type Note, type Stroke } from '../db/schema';
import { saveAsset, uid, updateNote } from '../db/repositories';
import {
  drawPaperBackground,
  drawSingleStroke,
  NOTEBOOK_PAGE_WIDTH,
} from '../engine/inkRenderer';

/**
 * Imports an image file (PNG/JPG/WebP) onto the active note page.
 */
export async function importImageToNote(
  file: File,
  note: Note,
  insertY = 140
): Promise<void> {
  const dataUrl = await readFileAsDataUrl(file);
  const dims = await measureImageDimensions(dataUrl);
  const maxWidth = Math.min(640, NOTEBOOK_PAGE_WIDTH - 120);
  const scale = dims.width > maxWidth ? maxWidth / dims.width : 1;
  const w = Math.round(dims.width * scale);
  const h = Math.round(dims.height * scale);

  const asset = await saveAsset({
    noteId: note.id,
    mimeType: file.type || 'image/png',
    dataUrl,
    width: w,
    height: h,
  });

  const now = Date.now();
  const block: CanvasBlock = {
    id: uid('blk'),
    noteId: note.id,
    type: 'image',
    x: 80,
    y: insertY,
    width: w,
    height: h,
    content: file.name,
    assetId: asset.id,
    createdAt: now,
    updatedAt: now,
  };

  await db.blocks.add(block);
  if (insertY + h + 300 > note.pageHeight) {
    await updateNote(note.id, { pageHeight: insertY + h + 400 });
  }
}

/**
 * Imports a PDF (up to 10 pages at a time) as crisp background sheets so the user can write math/notes directly over slides or worksheets.
 */
export async function importPdfToNote(
  file: File,
  note: Note,
  startY = 120
): Promise<number> {
  const pdfjs = await import('pdfjs-dist');
  // Use CDN worker matching installed pdfjs version or inline fallback
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pageCount = Math.min(pdf.numPages, 10);
  let cursorY = startY;

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = NOTEBOOK_PAGE_WIDTH - 80;
    const renderScale = (targetWidth / baseViewport.width) * 1.5;
    const viewport = page.getViewport({ scale: renderScale });

    const offscreen = document.createElement('canvas');
    offscreen.width = viewport.width;
    offscreen.height = viewport.height;
    const ctx = offscreen.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const dataUrl = offscreen.toDataURL('image/jpeg', 0.88);
    const displayHeight = Math.round(
      baseViewport.height * (targetWidth / baseViewport.width)
    );

    const asset = await saveAsset({
      noteId: note.id,
      mimeType: 'image/jpeg',
      dataUrl,
      width: targetWidth,
      height: displayHeight,
      pageNumber: pageNum,
    });

    const now = Date.now();
    await db.blocks.add({
      id: uid('blk'),
      noteId: note.id,
      type: 'pdf-page',
      x: 40,
      y: cursorY,
      width: targetWidth,
      height: displayHeight,
      content: `${file.name} — Page ${pageNum}`,
      assetId: asset.id,
      createdAt: now,
      updatedAt: now,
    });

    cursorY += displayHeight + 36;
  }

  if (cursorY + 300 > note.pageHeight) {
    await updateNote(note.id, { pageHeight: cursorY + 400 });
  }
  return pageCount;
}

/**
 * Exports the current note to a crisp, multi-page white-paper PDF (automatically inverting OLED Dark adaptive ink to crisp dark ink).
 */
export async function exportNoteToPdf(
  note: Note,
  strokes: Stroke[],
  blocks: CanvasBlock[]
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const assets = await db.assets.where('noteId').equals(note.id).toArray();
  const assetMap = new Map(assets.map((a) => [a.id, a]));

  // Compute vertical extent
  let maxBottom = 1100;
  for (const s of strokes) {
    if (s.bbox[3] + 80 > maxBottom) maxBottom = s.bbox[3] + 80;
  }
  for (const b of blocks) {
    if (b.y + b.height + 80 > maxBottom) maxBottom = b.y + b.height + 80;
  }

  const sliceHeight = 1260;
  const totalSlices = Math.max(1, Math.ceil(maxBottom / sliceHeight));
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: [NOTEBOOK_PAGE_WIDTH * 0.65, sliceHeight * 0.65],
  });

  // Preload asset images
  const loadedImages = new Map<string, HTMLImageElement>();
  for (const [id, asset] of assetMap.entries()) {
    try {
      const img = await loadHtmlImage(asset.dataUrl);
      loadedImages.set(id, img);
    } catch {
      // Ignore broken asset
    }
  }

  for (let i = 0; i < totalSlices; i++) {
    if (i > 0) pdf.addPage();
    const topY = i * sliceHeight;

    const canvas = document.createElement('canvas');
    const scale = 1.6;
    canvas.width = NOTEBOOK_PAGE_WIDTH * scale;
    canvas.height = sliceHeight * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.translate(0, -topY);

    drawPaperBackground(ctx, {
      theme: 'light',
      template: note.paperTemplate,
      layoutMode: 'vertical',
      pageHeight: totalSlices * sliceHeight,
      viewBounds: {
        minX: 0,
        minY: topY,
        maxX: NOTEBOOK_PAGE_WIDTH,
        maxY: topY + sliceHeight,
      },
      forceWhiteExport: true,
    });

    // Draw image/pdf/text blocks
    for (const block of blocks) {
      if (block.y + block.height < topY || block.y > topY + sliceHeight) continue;
      if ((block.type === 'image' || block.type === 'pdf-page') && block.assetId) {
        const img = loadedImages.get(block.assetId);
        if (img) {
          ctx.drawImage(img, block.x, block.y, block.width, block.height);
        }
      } else if (block.type === 'text' || block.type === 'checklist') {
        ctx.save();
        ctx.fillStyle = '#0f172a';
        ctx.font = '15px Inter, sans-serif';
        const lines =
          block.type === 'checklist'
            ? (block.checklistItems ?? []).map(
                (it) => `${it.checked ? '[x]' : '[ ]'} ${it.text}`
              )
            : block.content.split('\n');
        lines.forEach((line, idx) => {
          ctx.fillText(line, block.x + 10, block.y + 24 + idx * 22);
        });
        ctx.restore();
      }
    }

    // Draw vector strokes with forceLightForExport = true so white OLED ink becomes dark charcoal
    for (const s of strokes) {
      if (s.bbox[3] < topY || s.bbox[1] > topY + sliceHeight) continue;
      drawSingleStroke(ctx, s, 'light', { forceLightForExport: true });
    }

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(
      imgData,
      'JPEG',
      0,
      0,
      NOTEBOOK_PAGE_WIDTH * 0.65,
      sliceHeight * 0.65
    );
  }

  const safeTitle = note.title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 48) || 'note';
  pdf.save(`${safeTitle}.pdf`);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function measureImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  const img = await loadHtmlImage(dataUrl);
  return { width: img.naturalWidth || 400, height: img.naturalHeight || 300 };
}
