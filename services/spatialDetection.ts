export type DetectionConfidence = 'high' | 'ambiguous' | 'drawing';

export interface SpatialCandidateAnalysis {
  componentGlyphs: number;
  componentRows: number;
  componentWidth: number;
  componentDrawingRatio: number;
  localDrawingGlyphs: number;
  localOccupiedRows: number;
  localOccupiedSides: number;
  isConnectedToLargeDrawing: boolean;
  isDenseDrawingNeighborhood: boolean;
  isClosedDialogueContainer: boolean;
  contextSignature: string;
}

interface SpatialGlyph {
  char: string;
  normalized: string;
  stringIndex: number;
  displayStart: number;
  displayEnd: number;
  isJapanese: boolean;
  isDrawing: boolean;
}

const JAPANESE_SCRIPT = /[ぁ-ゖァ-ヶｦ-ﾟ㐀-䶿一-龯]/u;
const DRAWING_SYMBOL = /[|│┃｜/／\\＼_＿￣─━┄┅┈┉\-~～^＾<>＜＞()（）\[\]｛｝{}´｀'"`.,:;・ﾟ°=＝+＋*＊#＃vVyYwWjJiIlLfFxX]/u;
const DRAWING_JAPANESE = /[一二三七彡八人入ヌノトへヘ大イムマアくミシツテ了心ハフソィッェァォュョエ工乀乁口ロ日目回凵凹凸匚コ丁十小山ー―つっぅヽヾ丶〆丿乂爻巛川丈乃亅卜匕个丫儿厂厶ヲイニハヘトレリルロ]/u;
const LEFT_CONTAINER_BOUNDARY = /[|│┃｜>＞┌└├┏┗┣╔╚╠]/u;
const RIGHT_CONTAINER_BOUNDARY = /[|│┃｜<＜┐┘┤┓┛┫╗╝╣]/u;
const HORIZONTAL_CAP = /[─━┄┅┈┉―‐ー＿￣_=＝⌒^＾´｀\/／＼┌┐└┘╭╮╰╯]/u;

export class SpatialContextAnalyzer {
  private readonly glyphCache = new Map<number, SpatialGlyph[]>();
  private readonly componentCache = new Map<
    string,
    Array<{ line: number; glyph: SpatialGlyph }>
  >();

  constructor(private readonly lines: string[]) {}

  analyze(lineIndex: number, stringStart: number, stringEnd: number): SpatialCandidateAnalysis {
    const row = this.getGlyphs(lineIndex);
    const candidateGlyphs = row.filter((glyph) => (
      glyph.stringIndex >= stringStart
      && glyph.stringIndex < stringEnd
      && !isBlank(glyph.char)
    ));
    const displayStart = candidateGlyphs.length > 0
      ? Math.min(...candidateGlyphs.map((glyph) => glyph.displayStart))
      : displayWidth(this.lines[lineIndex]?.slice(0, stringStart) || '');
    const displayEnd = candidateGlyphs.length > 0
      ? Math.max(...candidateGlyphs.map((glyph) => glyph.displayEnd))
      : displayStart + Math.max(1, displayWidth(this.lines[lineIndex]?.slice(stringStart, stringEnd) || ''));

    const component = this.collectConnectedComponent(lineIndex, candidateGlyphs);
    const componentRows = new Set(component.map(({ line }) => line)).size;
    const componentGlyphs = component.length;
    const componentWidth = component.length > 0
      ? Math.max(...component.map(({ glyph }) => glyph.displayEnd))
        - Math.min(...component.map(({ glyph }) => glyph.displayStart))
      : 0;
    const componentDrawingGlyphs = component.filter(({ glyph }) => glyph.isDrawing).length;
    const componentDrawingRatio = componentGlyphs > 0
      ? componentDrawingGlyphs / componentGlyphs
      : 0;

    const neighborhood = this.measureNeighborhood(
      lineIndex,
      stringStart,
      stringEnd,
      displayStart,
      displayEnd,
    );
    const isConnectedToLargeDrawing = componentDrawingGlyphs >= 5
      && componentDrawingRatio >= 0.35
      && (
        (componentRows >= 3 && componentGlyphs >= 8)
        || componentWidth >= 18
        || componentGlyphs >= 16
      );
    const isDenseDrawingNeighborhood = neighborhood.drawingGlyphs >= 8
      && neighborhood.occupiedRows >= 3
      && neighborhood.drawingGlyphs >= Math.max(4, neighborhood.otherJapaneseGlyphs);
    const isClosedDialogueContainer = this.hasClosedDialogueContainer(
      lineIndex,
      displayStart,
      displayEnd,
    );

    return {
      componentGlyphs,
      componentRows,
      componentWidth,
      componentDrawingRatio,
      localDrawingGlyphs: neighborhood.drawingGlyphs,
      localOccupiedRows: neighborhood.occupiedRows,
      localOccupiedSides: neighborhood.occupiedSides,
      isConnectedToLargeDrawing,
      isDenseDrawingNeighborhood,
      isClosedDialogueContainer,
      contextSignature: this.buildContextSignature(
        lineIndex,
        displayStart,
        displayEnd,
        componentRows,
        componentWidth,
        componentDrawingRatio,
      ),
    };
  }

  private getGlyphs(lineIndex: number): SpatialGlyph[] {
    const cached = this.glyphCache.get(lineIndex);
    if (cached) return cached;
    const line = this.lines[lineIndex] || '';
    const glyphs: SpatialGlyph[] = [];
    let stringIndex = 0;
    let displayStart = 0;
    while (stringIndex < line.length) {
      const codePoint = line.codePointAt(stringIndex) ?? 0;
      const char = String.fromCodePoint(codePoint);
      const width = characterDisplayWidth(char);
      const normalized = char.normalize('NFKC');
      glyphs.push({
        char,
        normalized,
        stringIndex,
        displayStart,
        displayEnd: displayStart + width,
        isJapanese: JAPANESE_SCRIPT.test(normalized),
        isDrawing: isDrawingGlyph(normalized),
      });
      stringIndex += char.length;
      displayStart += width;
    }
    this.glyphCache.set(lineIndex, glyphs);
    return glyphs;
  }

  private collectConnectedComponent(lineIndex: number, seeds: SpatialGlyph[]) {
    const combined = new Map<string, { line: number; glyph: SpatialGlyph }>();
    for (const seed of seeds) {
      const seedKey = `${lineIndex}:${seed.stringIndex}`;
      const component = this.componentCache.get(seedKey)
        || this.traceConnectedComponent(lineIndex, seed);
      for (const item of component) {
        combined.set(`${item.line}:${item.glyph.stringIndex}`, item);
      }
    }
    return [...combined.values()];
  }

  private traceConnectedComponent(lineIndex: number, seed: SpatialGlyph) {
    const queue = [{ line: lineIndex, glyph: seed }];
    const visited = new Set([`${lineIndex}:${seed.stringIndex}`]);
    const result: Array<{ line: number; glyph: SpatialGlyph }> = [];
    const maximumGlyphs = 180;
    let cursor = 0;

    while (cursor < queue.length && result.length < maximumGlyphs) {
      const current = queue[cursor++];
      result.push(current);
      for (let neighborLine = current.line - 1; neighborLine <= current.line + 1; neighborLine += 1) {
        if (neighborLine < 0 || neighborLine >= this.lines.length) continue;
        for (const glyph of this.getGlyphs(neighborLine)) {
          if (isBlank(glyph.char)) continue;
          const key = `${neighborLine}:${glyph.stringIndex}`;
          if (visited.has(key)) continue;
          const maximumGap = neighborLine === current.line ? 0 : 1;
          if (intervalDistance(
            current.glyph.displayStart,
            current.glyph.displayEnd,
            glyph.displayStart,
            glyph.displayEnd,
          ) > maximumGap) continue;
          visited.add(key);
          queue.push({ line: neighborLine, glyph });
        }
      }
    }
    for (const item of result) {
      this.componentCache.set(`${item.line}:${item.glyph.stringIndex}`, result);
    }
    return result;
  }

  private measureNeighborhood(
    lineIndex: number,
    stringStart: number,
    stringEnd: number,
    displayStart: number,
    displayEnd: number,
  ) {
    const rowRadius = 4;
    const columnRadius = 18;
    const checkStart = Math.max(0, displayStart - columnRadius);
    const checkEnd = displayEnd + columnRadius;
    const occupiedRows = new Set<number>();
    const occupiedSides = new Set<'above' | 'below' | 'left' | 'right'>();
    let drawingGlyphs = 0;
    let otherJapaneseGlyphs = 0;

    for (let row = lineIndex - rowRadius; row <= lineIndex + rowRadius; row += 1) {
      if (row < 0 || row >= this.lines.length) continue;
      let rowOccupied = false;
      for (const glyph of this.getGlyphs(row)) {
        if (isBlank(glyph.char) || glyph.displayEnd <= checkStart || glyph.displayStart >= checkEnd) continue;
        if (
          row === lineIndex
          && glyph.stringIndex >= stringStart
          && glyph.stringIndex < stringEnd
        ) continue;
        rowOccupied = true;
        if (glyph.isDrawing) drawingGlyphs += 1;
        else if (glyph.isJapanese) otherJapaneseGlyphs += 1;
        if (row < lineIndex) occupiedSides.add('above');
        if (row > lineIndex) occupiedSides.add('below');
        if (row === lineIndex && glyph.displayEnd <= displayStart) occupiedSides.add('left');
        if (row === lineIndex && glyph.displayStart >= displayEnd) occupiedSides.add('right');
      }
      if (rowOccupied) occupiedRows.add(row);
    }

    return {
      drawingGlyphs,
      otherJapaneseGlyphs,
      occupiedRows: occupiedRows.size,
      occupiedSides: occupiedSides.size,
    };
  }

  private hasClosedDialogueContainer(lineIndex: number, displayStart: number, displayEnd: number) {
    const glyphs = this.getGlyphs(lineIndex);
    const left = [...glyphs]
      .reverse()
      .find((glyph) => (
        glyph.displayEnd <= displayStart
        && displayStart - glyph.displayEnd <= 80
        && LEFT_CONTAINER_BOUNDARY.test(glyph.normalized)
      ));
    const right = glyphs.find((glyph) => (
      glyph.displayStart >= displayEnd
      && glyph.displayStart - displayEnd <= 80
      && RIGHT_CONTAINER_BOUNDARY.test(glyph.normalized)
    ));
    if (!left || !right || right.displayStart - left.displayEnd < 4) return false;

    let continuity = 0;
    for (let offset = -3; offset <= 3; offset += 1) {
      if (offset === 0) continue;
      const row = this.getGlyphs(lineIndex + offset);
      if (
        hasBoundaryNear(row, left.displayStart, LEFT_CONTAINER_BOUNDARY)
        && hasBoundaryNear(row, right.displayStart, RIGHT_CONTAINER_BOUNDARY)
      ) continuity += 1;
    }
    if (continuity === 0) return false;

    for (let distance = 1; distance <= 12; distance += 1) {
      for (const rowIndex of [lineIndex - distance, lineIndex + distance]) {
        if (rowIndex < 0 || rowIndex >= this.lines.length) continue;
        const row = this.getGlyphs(rowIndex);
        const interior = row.filter((glyph) => (
          glyph.displayEnd >= left.displayStart - 3
          && glyph.displayStart <= right.displayStart + 3
          && !isBlank(glyph.char)
        ));
        const horizontalCount = interior.filter(({ normalized }) => HORIZONTAL_CAP.test(normalized)).length;
        const hasLeftEnd = interior.some((glyph) => Math.abs(glyph.displayStart - left.displayStart) <= 4);
        const hasRightEnd = interior.some((glyph) => Math.abs(glyph.displayStart - right.displayStart) <= 4);
        if (
          hasLeftEnd
          && hasRightEnd
          && horizontalCount >= Math.max(3, Math.floor((right.displayStart - left.displayEnd) / 8))
        ) return true;
      }
    }
    return false;
  }

  private buildContextSignature(
    lineIndex: number,
    displayStart: number,
    displayEnd: number,
    componentRows: number,
    componentWidth: number,
    componentDrawingRatio: number,
  ) {
    const center = (displayStart + displayEnd) / 2;
    const halfSpan = 20;
    const binWidth = 4;
    const rows: string[] = [];
    for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
      const row = this.getGlyphs(lineIndex + rowOffset);
      let encoded = '';
      for (let bin = 0; bin < 10; bin += 1) {
        const start = center - halfSpan + (bin * binWidth);
        const end = start + binWidth;
        const occupants = row.filter((glyph) => (
          !isBlank(glyph.char)
          && glyph.displayEnd > start
          && glyph.displayStart < end
        ));
        const isCandidateBin = rowOffset === 0 && end > displayStart && start < displayEnd;
        if (isCandidateBin) encoded += 'C';
        else if (occupants.some(({ isDrawing }) => isDrawing)) encoded += 'D';
        else if (occupants.some(({ isJapanese }) => isJapanese)) encoded += 'J';
        else if (occupants.length > 0) encoded += 'X';
        else encoded += '.';
      }
      rows.push(encoded);
    }
    return `${rows.join('/')}|r${bucket(componentRows, [1, 2, 4, 8])}`
      + `w${bucket(componentWidth, [4, 10, 20, 40])}`
      + `d${bucket(componentDrawingRatio, [0.2, 0.4, 0.65, 0.85])}`;
  }
}

export function contextSignatureSimilarity(left?: string, right?: string) {
  if (!left || !right) return 0;
  const length = Math.max(left.length, right.length);
  if (length === 0) return 0;
  let equal = 0;
  for (let index = 0; index < length; index += 1) {
    if (left[index] === right[index]) equal += 1;
  }
  return equal / length;
}

function hasBoundaryNear(glyphs: SpatialGlyph[], x: number, pattern: RegExp) {
  return glyphs.some((glyph) => (
    Math.abs(glyph.displayStart - x) <= 3
    && pattern.test(glyph.normalized)
  ));
}

function isDrawingGlyph(normalized: string) {
  return DRAWING_SYMBOL.test(normalized) || DRAWING_JAPANESE.test(normalized);
}

function intervalDistance(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  if (leftEnd < rightStart) return rightStart - leftEnd;
  if (rightEnd < leftStart) return leftStart - rightEnd;
  return 0;
}

function displayWidth(text: string) {
  let width = 0;
  for (const character of text) width += characterDisplayWidth(character);
  return width;
}

function characterDisplayWidth(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;
  if (isCombiningCodePoint(codePoint)) return 0;
  return isFullWidthCodePoint(codePoint) ? 2 : 1;
}

function isFullWidthCodePoint(codePoint: number) {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1b000 && codePoint <= 0x1b001)
    || (codePoint >= 0x1f200 && codePoint <= 0x1f251)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function isCombiningCodePoint(codePoint: number) {
  return (codePoint >= 0x0300 && codePoint <= 0x036f)
    || (codePoint >= 0x1ab0 && codePoint <= 0x1aff)
    || (codePoint >= 0x1dc0 && codePoint <= 0x1dff)
    || (codePoint >= 0x20d0 && codePoint <= 0x20ff)
    || (codePoint >= 0xfe20 && codePoint <= 0xfe2f);
}

function isBlank(character: string) {
  return /^[\s\u3000\u00a0\u2000-\u200b]$/u.test(character);
}

function bucket(value: number, thresholds: number[]) {
  return thresholds.findIndex((threshold) => value <= threshold) + 1 || thresholds.length + 1;
}
