export interface VisualWidthProfile {
  version: 1;
  unitWidths: Array<[string, number]>;
}

const AA_FONT = '16px Saitamaar, "MS PGothic", "TextAA", "IPAMonaPGothic", Monapo, Mona, monospace';
const MAX_PROFILE_CHARACTERS = 4096;
const FONT_WAIT_MS = 1200;
const MAX_PORTABLE_CORRECTION_CELLS = 2;

let fontReadyPromise: Promise<boolean> | undefined;
let activeContext: CanvasRenderingContext2D | undefined;
let activeUnitWidth = 0;
const cachedUnitWidths = new Map<string, number>();

function waitForSaitamaar() {
  if (fontReadyPromise) return fontReadyPromise;
  fontReadyPromise = (async () => {
    if (typeof document === 'undefined' || !document.fonts) return false;
    try {
      await Promise.race([
        document.fonts.load(AA_FONT),
        new Promise<void>((resolve) => window.setTimeout(resolve, FONT_WAIT_MS)),
      ]);
      return document.fonts.check(AA_FONT);
    } catch {
      return false;
    }
  })();
  return fontReadyPromise;
}

function prepareContext() {
  if (activeContext && activeUnitWidth > 0) return activeContext;
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d') || undefined;
  if (!context) return undefined;
  context.font = AA_FONT;
  context.textBaseline = 'alphabetic';
  const fullWidthAnchorWidth = Math.max(
    context.measureText('あ').width,
    context.measureText('漢').width,
    context.measureText('！').width,
    context.measureText('￣').width,
    context.measureText('＿').width,
  );
  const ideographicSpaceWidth = context.measureText('　').width;
  const asciiSpaceWidth = context.measureText(' ').width;
  // Saitamaar intentionally renders U+3000 narrower than ordinary Japanese
  // full-width glyphs. Using that space as the two-cell reference inflates all
  // visual coordinates and makes continuous caps look too sparse. Anchor the
  // AA cell to visible Japanese/border glyphs and keep spaces at their actual
  // proportional widths.
  activeUnitWidth = fullWidthAnchorWidth > 0
    ? fullWidthAnchorWidth / 2
    : ideographicSpaceWidth > 0
      ? ideographicSpaceWidth / 2
      : asciiSpaceWidth;
  if (!Number.isFinite(activeUnitWidth) || activeUnitWidth <= 0) return undefined;
  activeContext = context;
  return context;
}

function measureCharacterUnitWidth(context: CanvasRenderingContext2D, character: string) {
  const cached = cachedUnitWidths.get(character);
  if (cached !== undefined) return cached;
  const measured = context.measureText(character).width / activeUnitWidth;
  const width = Number.isFinite(measured) && measured >= 0 ? measured : 0;
  cachedUnitWidths.set(character, width);
  return width;
}

/**
 * Builds a compact, font-normalized character width table for the worker.
 * Only unique source glyphs are measured, so a large AA episode does not
 * trigger one canvas call per source character.
 */
export async function createVisualWidthProfile(
  content: string,
): Promise<VisualWidthProfile | undefined> {
  const fontReady = await waitForSaitamaar();
  if (!fontReady) return undefined;
  const context = prepareContext();
  if (!context) return undefined;

  const uniqueCharacters = new Set<string>();
  for (const character of content) {
    uniqueCharacters.add(character);
    if (uniqueCharacters.size >= MAX_PROFILE_CHARACTERS) break;
  }
  const unitWidths: Array<[string, number]> = [];
  for (const character of uniqueCharacters) {
    unitWidths.push([character, measureCharacterUnitWidth(context, character)]);
  }
  return { version: 1, unitWidths };
}

export function calculatePortableVisualOverflow(
  originalVisualWidth: number,
  replacementVisualWidth: number,
  cellOverflow: number,
  unitWidth = 1,
) {
  if (
    !Number.isFinite(originalVisualWidth)
    || !Number.isFinite(replacementVisualWidth)
    || !Number.isFinite(unitWidth)
    || unitWidth <= 0
  ) return cellOverflow;
  const visualDifference = (replacementVisualWidth - originalVisualWidth) / unitWidth;
  // Ignore sub-pixel/font-rasterization noise and never let a renderer-specific
  // correction alter more than two extra AA cells in the portable text file.
  const visualOverflow = visualDifference > 0.25
    ? Math.ceil(visualDifference - 0.25)
    : 0;
  return Math.max(
    cellOverflow,
    Math.min(cellOverflow + MAX_PORTABLE_CORRECTION_CELLS, visualOverflow),
  );
}

/**
 * Returns a conservative visual overflow in AA cells. Undefined means the
 * exact viewer font was not available, so callers should keep legacy logic.
 */
export function getActiveVisualOverflowCells(
  original: string,
  replacement: string,
  cellOverflow: number,
) {
  const context = activeContext;
  if (!context || activeUnitWidth <= 0) return undefined;
  return calculatePortableVisualOverflow(
    context.measureText(original).width,
    context.measureText(replacement).width,
    cellOverflow,
    activeUnitWidth,
  );
}
