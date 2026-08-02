export interface ImagePageSlice {
  startLine: number;
  lines: string[];
  leadingWhitespaceCount: number;
}

export interface ImagePaginationOptions {
  pageHeight: number;
  rowHeight: number;
  padding: number;
  smartSplit: boolean;
  removeLeadingWhitespace: boolean;
}

function isEmptyLine(line: string | undefined) {
  return line === undefined ? false : line.trim().length === 0;
}

function findSmartBreak(lines: string[], start: number, maximumLines: number) {
  const remaining = lines.length - start;
  if (maximumLines >= remaining) return remaining;

  const searchLimit = Math.max(1, Math.floor(maximumLines * 0.8));
  const lowerBound = Math.max(1, maximumLines - searchLimit);

  for (let count = maximumLines; count > lowerBound; count -= 1) {
    const boundary = start + count;
    if (
      isEmptyLine(lines[boundary])
      && isEmptyLine(lines[boundary - 1])
      && isEmptyLine(lines[boundary - 2])
    ) {
      const candidate = count - 1;
      if (candidate > 5) return candidate;
    }
  }
  for (let count = maximumLines; count > lowerBound; count -= 1) {
    const boundary = start + count;
    if (isEmptyLine(lines[boundary]) && isEmptyLine(lines[boundary - 1])) {
      if (count > 5) return count;
    }
  }
  for (let count = maximumLines; count > lowerBound; count -= 1) {
    if (count > 5 && isEmptyLine(lines[start + count - 1])) return count;
  }
  return maximumLines;
}

export function countCommonLeadingWhitespace(lines: string[]) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const firstContentIndex = line.search(/\S/u);
    if (firstContentIndex >= 0) minimum = Math.min(minimum, firstContentIndex);
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

export function paginateImageLines(
  lines: string[],
  options: ImagePaginationOptions,
): ImagePageSlice[] {
  if (lines.length === 0) return [];
  const availableHeight = Math.max(options.rowHeight, options.pageHeight - (options.padding * 2));
  const maximumLines = Math.max(1, Math.floor(availableHeight / options.rowHeight));
  const pages: ImagePageSlice[] = [];

  for (let start = 0; start < lines.length;) {
    const remaining = lines.length - start;
    const tentative = Math.min(maximumLines, remaining);
    const count = options.smartSplit
      ? findSmartBreak(lines, start, tentative)
      : tentative;
    const safeCount = Math.max(1, count);
    const pageLines = lines.slice(start, start + safeCount);
    pages.push({
      startLine: start,
      lines: pageLines,
      leadingWhitespaceCount: options.removeLeadingWhitespace
        ? countCommonLeadingWhitespace(pageLines)
        : 0,
    });
    start += safeCount;
  }

  return pages;
}

export function stripFileExtension(fileName: string) {
  const base = fileName.replace(/\.[^/.]+$/u, '');
  return base || 'translation';
}
