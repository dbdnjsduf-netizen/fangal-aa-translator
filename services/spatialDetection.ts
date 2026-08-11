import type { VisualWidthProfile } from './visualTextMetrics';

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
const HORIZONTAL_CAP = /[─━┄┅┈┉―‐ー＿￣_=＝⌒^＾´｀\/／＼┌┐└┘╭╮╰╯\-]/u;
const LEFT_CAP_END = /[|│┃｜>＞┌└├┏┗┣╔╚╠╭╰乂（(fF]/u;
const RIGHT_CAP_END = /[|│┃｜<＜┐┘┤┓┛┫╗╝╣╮╯ノヽ、）)]/u;
const SPIKED_CAP_FILL = /[人从_＿YyWw⌒]/u;
const DOTTED_CONTAINER_WALL = /[:：]/u;
const DOTTED_CONTAINER_CAP = /[.:：．]/u;

export class SpatialContextAnalyzer {
  private readonly glyphCache = new Map<number, SpatialGlyph[]>();
  private readonly visualUnitWidths?: Map<string, number>;
  private readonly componentCache = new Map<
    string,
    Array<{ line: number; glyph: SpatialGlyph }>
  >();

  constructor(
    private readonly lines: string[],
    visualWidthProfile?: VisualWidthProfile,
  ) {
    if (visualWidthProfile?.version === 1) {
      this.visualUnitWidths = new Map(visualWidthProfile.unitWidths);
    }
  }

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
      const measuredWidth = this.visualUnitWidths?.get(char);
      const width = measuredWidth !== undefined
        ? measuredWidth
        : characterDisplayWidth(char);
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
    if (this.hasDottedDialogueContainer(lineIndex, displayStart, displayEnd)) {
      return true;
    }
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
    if (!left || !right) return false;
    const innerWidth = right.displayStart - left.displayEnd;
    if (innerWidth < 4 || innerWidth > 120) return false;

    // The candidate row must really look like "wall + blank + text + blank +
    // wall". Dense AA often has unrelated lines on both sides; those must not
    // be combined into an imaginary dialogue box.
    const hasGapContent = glyphs.some((glyph) => (
      !isBlank(glyph.char)
      && (
        (
          glyph.displayStart >= left.displayEnd
          && glyph.displayEnd <= displayStart
        )
        || (
          glyph.displayStart >= displayEnd
          && glyph.displayEnd <= right.displayStart
        )
      )
    ));
    if (hasGapContent) return false;

    const hasWallPair = (rowIndex: number, tolerance = 4) => {
      const row = this.getGlyphs(rowIndex);
      return hasBoundaryNear(row, left.displayStart, LEFT_CONTAINER_BOUNDARY, tolerance)
        && hasBoundaryNear(row, right.displayStart, RIGHT_CONTAINER_BOUNDARY, tolerance);
    };
    const hasUpperWallContinuity = [1, 2, 3]
      .some((distance) => hasWallPair(lineIndex - distance));
    const hasLowerWallContinuity = [1, 2, 3]
      .some((distance) => hasWallPair(lineIndex + distance));
    const hasFlexibleUpperWallContinuity = [1, 2, 3]
      .some((distance) => hasWallPair(lineIndex - distance, 12));
    const hasFlexibleLowerWallContinuity = [1, 2, 3]
      .some((distance) => hasWallPair(lineIndex + distance, 12));
    // Saitamaar's proportional spaces can shift the source/display estimate
    // by more than twenty cells even while the rendered f-ヽ / 乂-ノ walls
    // remain visually aligned. This wider tolerance is used only when both
    // characteristic rounded caps are independently confirmed below.
    const hasRoundedUpperWallContinuity = [1, 2, 3]
      .some((distance) => hasWallPair(lineIndex - distance, 24));
    const hasRoundedLowerWallContinuity = [1, 2, 3]
      .some((distance) => hasWallPair(lineIndex + distance, 24));

    const hasCap = (direction: -1 | 1) => {
      for (let distance = 1; distance <= 12; distance += 1) {
        const rowIndex = lineIndex + (distance * direction);
        if (rowIndex < 0 || rowIndex >= this.lines.length) break;
        const row = this.getGlyphs(rowIndex);
        const interior = row.filter((glyph) => (
          glyph.displayEnd >= left.displayStart - 3
          && glyph.displayStart <= right.displayStart + 3
          && !isBlank(glyph.char)
        ));
        const horizontalCount = interior.filter(({ char, normalized }) => (
          HORIZONTAL_CAP.test(char) || HORIZONTAL_CAP.test(normalized)
        )).length;
        const leftEnds = interior.filter((glyph) => (
          Math.abs(glyph.displayStart - left.displayStart) <= 4
          && LEFT_CAP_END.test(glyph.normalized)
        ));
        const rightEnds = interior.filter((glyph) => RIGHT_CAP_END.test(glyph.normalized));
        for (const leftEnd of leftEnds) {
          for (const rightEnd of rightEnds) {
            const isNormallyAligned = Math.abs(
              rightEnd.displayStart - right.displayStart
            ) <= 4;
            // Shift-JIS AA bubbles often use proportional thin spaces. Their
            // source columns can make the right cap appear 5-16 cells away
            // even though Saitamaar renders it directly over the wall. Allow
            // that drift only for the characteristic paired rounded caps.
            const isRoundedPair = (
              ((/[fF]/u.test(leftEnd.normalized) && rightEnd.normalized === 'ヽ')
                || (leftEnd.normalized === '乂' && rightEnd.normalized === 'ノ'))
              && rightEnd.displayStart > leftEnd.displayEnd
              && Math.abs(rightEnd.displayStart - right.displayStart) <= 16
            );
            if (!isNormallyAligned && !isRoundedPair) continue;
            const capSpan = rightEnd.displayStart - leftEnd.displayEnd;
            const minimumCapGlyphs = Math.max(4, Math.ceil(capSpan * 0.45));
            if (horizontalCount >= minimumCapGlyphs) return true;
          }
        }
      }
      return false;
    };

    const hasRoundedCap = (
      direction: -1 | 1,
      leftPattern: RegExp,
      rightPattern: RegExp,
    ) => {
      for (let distance = 1; distance <= 12; distance += 1) {
        const rowIndex = lineIndex + (distance * direction);
        if (rowIndex < 0 || rowIndex >= this.lines.length) break;
        const row = this.getGlyphs(rowIndex).filter(({ char }) => !isBlank(char));
        const leftEnds = row.filter((glyph) => (
          leftPattern.test(glyph.normalized)
          && Math.abs(glyph.displayStart - left.displayStart) <= 24
        ));
        const rightEnds = row.filter((glyph) => (
          rightPattern.test(glyph.normalized)
          && Math.abs(glyph.displayStart - right.displayStart) <= 36
        ));
        for (const leftEnd of leftEnds) {
          for (const rightEnd of rightEnds) {
            const span = rightEnd.displayStart - leftEnd.displayEnd;
            if (span < 8) continue;
            const horizontalCount = row.filter(({ char, normalized, displayStart }) => (
              displayStart > leftEnd.displayStart
              && displayStart < rightEnd.displayStart
              && (HORIZONTAL_CAP.test(char) || HORIZONTAL_CAP.test(normalized))
            )).length;
            if (horizontalCount >= Math.max(4, Math.ceil(span * 0.35))) return true;
          }
        }
      }
      return false;
    };

    const hasSpikedCap = (
      direction: -1 | 1,
      leftPattern: RegExp,
      rightPattern: RegExp,
    ) => {
      for (let distance = 1; distance <= 12; distance += 1) {
        const rowIndex = lineIndex + (distance * direction);
        if (rowIndex < 0 || rowIndex >= this.lines.length) break;
        const row = this.getGlyphs(rowIndex).filter(({ char }) => !isBlank(char));
        const leftEnds = row.filter((glyph) => (
          leftPattern.test(glyph.char)
          && Math.abs(glyph.displayStart - left.displayStart) <= 20
        ));
        const rightEnds = row.filter((glyph) => (
          rightPattern.test(glyph.char)
          && Math.abs(glyph.displayStart - right.displayStart) <= 24
        ));
        for (const leftEnd of leftEnds) {
          for (const rightEnd of rightEnds) {
            const span = rightEnd.displayStart - leftEnd.displayEnd;
            if (span < 12) continue;
            const capInterior = row.filter(({ displayStart }) => (
              displayStart > leftEnd.displayStart
              && displayStart < rightEnd.displayStart
            ));
            const fillCount = capInterior.filter(({ char, normalized }) => (
              SPIKED_CAP_FILL.test(char) || SPIKED_CAP_FILL.test(normalized)
            )).length;
            // Jagged shout bubbles have a very characteristic continuous
            // 人/从/_ or Y/W/⌒ ridge. Requiring a long, dense ridge on both
            // caps keeps unrelated face and body strokes from becoming boxes.
            if (
              fillCount >= 6
              && fillCount >= Math.ceil(capInterior.length * 0.6)
            ) return true;
          }
        }
      }
      return false;
    };

    // A real closed box needs independent top and bottom caps. The previous
    // one-sided test was the main source of body/face AA being learned as a
    // speech bubble.
    const hasStrictClosedBox = hasUpperWallContinuity
      && hasLowerWallContinuity
      && hasCap(-1)
      && hasCap(1);
    const hasProportionalRoundedBox = hasRoundedUpperWallContinuity
      && hasRoundedLowerWallContinuity
      && hasRoundedCap(-1, /^[fF]$/u, /^ヽ$/u)
      && hasRoundedCap(1, /^乂$/u, /^ノ$/u);
    const hasSpikedShoutBox = hasFlexibleUpperWallContinuity
      && hasFlexibleLowerWallContinuity
      && hasSpikedCap(-1, /^＼$/u, /^／$/u)
      && hasSpikedCap(1, /^／$/u, /^＼$/u);
    return hasStrictClosedBox || hasProportionalRoundedBox || hasSpikedShoutBox;
  }

  private hasDottedDialogueContainer(
    lineIndex: number,
    displayStart: number,
    displayEnd: number,
  ) {
    const glyphs = this.getGlyphs(lineIndex);
    const left = [...glyphs].reverse().find((glyph) => (
      glyph.displayEnd <= displayStart
      && displayStart - glyph.displayEnd <= 40
      && DOTTED_CONTAINER_WALL.test(glyph.normalized)
    ));
    const right = glyphs.find((glyph) => (
      glyph.displayStart >= displayEnd
      && glyph.displayStart - displayEnd <= 40
      && DOTTED_CONTAINER_WALL.test(glyph.normalized)
    ));
    if (!left || !right) return false;

    const innerWidth = right.displayStart - left.displayEnd;
    if (innerWidth < 6 || innerWidth > 120) return false;

    // This AA box uses an unmistakable double wall on both sides:
    // ": :    dialogue    : : .". Requiring the paired colons prevents an
    // ordinary prose colon or dotted face shading from becoming a boundary.
    const hasLeftPartner = glyphs.some((glyph) => (
      glyph.displayEnd <= left.displayStart
      && left.displayStart - glyph.displayEnd <= 6
      && DOTTED_CONTAINER_WALL.test(glyph.normalized)
    ));
    const hasRightPartner = glyphs.some((glyph) => (
      glyph.displayStart >= right.displayEnd
      && glyph.displayStart - right.displayEnd <= 6
      && DOTTED_CONTAINER_WALL.test(glyph.normalized)
    ));
    if (!hasLeftPartner || !hasRightPartner) return false;

    const gapContainsGlyph = glyphs.some((glyph) => (
      !isBlank(glyph.char)
      && (
        (
          glyph.displayStart >= left.displayEnd
          && glyph.displayEnd <= displayStart
        )
        || (
          glyph.displayStart >= displayEnd
          && glyph.displayEnd <= right.displayStart
        )
      )
    ));
    if (gapContainsGlyph) return false;

    const hasWallPair = (rowIndex: number) => {
      const row = this.getGlyphs(rowIndex);
      // Proportional full-width and thin spaces make these decorative walls
      // wander more than pipe boxes even though they render as one frame.
      return hasBoundaryNear(row, left.displayStart, DOTTED_CONTAINER_WALL, 14)
        && hasBoundaryNear(row, right.displayStart, DOTTED_CONTAINER_WALL, 14);
    };
    const upperWallRows = [1, 2, 3]
      .filter((distance) => hasWallPair(lineIndex - distance)).length;
    const lowerWallRows = [1, 2, 3]
      .filter((distance) => hasWallPair(lineIndex + distance)).length;
    if (upperWallRows < 2 || lowerWallRows < 2) return false;

    const hasDottedCap = (direction: -1 | 1) => {
      for (let distance = 1; distance <= 8; distance += 1) {
        const rowIndex = lineIndex + (distance * direction);
        if (rowIndex < 0 || rowIndex >= this.lines.length) break;
        const capGlyphs = this.getGlyphs(rowIndex).filter((glyph) => (
          !isBlank(glyph.char)
          && glyph.displayEnd >= left.displayStart - 8
          && glyph.displayStart <= right.displayStart + 12
        ));
        const dottedGlyphs = capGlyphs.filter(({ normalized }) => (
          DOTTED_CONTAINER_CAP.test(normalized)
        ));
        if (dottedGlyphs.length < 8) continue;
        if (dottedGlyphs.length < Math.ceil(capGlyphs.length * 0.8)) continue;
        const capStart = Math.min(...dottedGlyphs.map(({ displayStart: start }) => start));
        const capEnd = Math.max(...dottedGlyphs.map(({ displayEnd: end }) => end));
        if (Math.abs(capStart - left.displayStart) > 16) continue;
        // A decorative dotted cap may intentionally overhang the side wall.
        // It must cover the right wall, but does not need to end on it.
        if (capEnd < right.displayEnd - 12) continue;
        if (capEnd - capStart < innerWidth * 0.75) continue;
        return true;
      }
      return false;
    };

    return hasDottedCap(-1) && hasDottedCap(1);
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
    // Local learning should describe the candidate's immediate AA context,
    // not memorize a large part of the surrounding illustration. Keep five
    // rows (two above/below), but narrow the horizontal window from +/-20 to
    // +/-8 display columns and encode it at two-column precision. Dialogue-box
    // membership is stored separately in the learning layout signature.
    const halfSpan = 8;
    const binWidth = 2;
    const binCount = (halfSpan * 2) / binWidth;
    const rows: string[] = [];
    for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
      const row = this.getGlyphs(lineIndex + rowOffset);
      let encoded = '';
      for (let bin = 0; bin < binCount; bin += 1) {
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
    return `s2:${rows.join('/')}|r${bucket(componentRows, [1, 2, 4, 8])}`
      + `w${bucket(componentWidth, [4, 10, 20, 40])}`
      + `d${bucket(componentDrawingRatio, [0.2, 0.4, 0.65, 0.85])}`;
  }
}

export function contextSignatureSimilarity(left?: string, right?: string) {
  if (!left || !right) return 0;
  return positionalSimilarity(left, right);
}

function positionalSimilarity(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  if (length === 0) return 0;
  let equal = 0;
  for (let index = 0; index < length; index += 1) {
    if (left[index] === right[index]) equal += 1;
  }
  return equal / length;
}

function hasBoundaryNear(
  glyphs: SpatialGlyph[],
  x: number,
  pattern: RegExp,
  tolerance = 4,
) {
  return glyphs.some((glyph) => (
    Math.abs(glyph.displayStart - x) <= tolerance
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
