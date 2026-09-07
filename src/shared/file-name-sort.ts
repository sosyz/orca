type FileNameCollator = {
  compare(a: string, b: string): number
}

// Why hoisted: constructing an ICU collator per comparison is substantially slower.
export const fileNameCollator: FileNameCollator = createFileNameCollator()

export function compareFileNames(a: string, b: string): number {
  const primary = fileNameCollator.compare(a, b)
  if (primary !== 0) {
    return primary
  }
  // Why: numeric collation ties distinct names ("2" vs "02"); fall back to code
  // units so sibling order stays a total order instead of readdir order.
  return a < b ? -1 : a > b ? 1 : 0
}

/** Directories-first, then natural name order — the File Explorer listing contract. */
export function sortDirEntries<T extends { name: string; isDirectory: boolean }>(
  entries: T[]
): T[] {
  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1
    }
    return compareFileNames(a.name, b.name)
  })
}

function createFileNameCollator(): FileNameCollator {
  // Harmony's Hermes runtime can omit ECMA-402; keep the fallback local to sorting.
  if (typeof Intl !== 'undefined' && typeof Intl.Collator === 'function') {
    return new Intl.Collator('en', { numeric: true })
  }
  return { compare: compareFileNamesWithoutIntl }
}

function compareFileNamesWithoutIntl(a: string, b: string): number {
  let aIndex = 0
  let bIndex = 0

  while (aIndex < a.length && bIndex < b.length) {
    const aCode = a.charCodeAt(aIndex)
    const bCode = b.charCodeAt(bIndex)
    if (isAsciiDigit(aCode) && isAsciiDigit(bCode)) {
      const aDigitsEnd = findDigitsEnd(a, aIndex)
      const bDigitsEnd = findDigitsEnd(b, bIndex)
      const aSignificantStart = skipLeadingZeroes(a, aIndex, aDigitsEnd)
      const bSignificantStart = skipLeadingZeroes(b, bIndex, bDigitsEnd)
      const aSignificantLength = aDigitsEnd - aSignificantStart
      const bSignificantLength = bDigitsEnd - bSignificantStart

      if (aSignificantLength !== bSignificantLength) {
        return aSignificantLength - bSignificantLength
      }
      for (let offset = 0; offset < aSignificantLength; offset += 1) {
        const difference =
          a.charCodeAt(aSignificantStart + offset) - b.charCodeAt(bSignificantStart + offset)
        if (difference !== 0) {
          return difference
        }
      }
      aIndex = aDigitsEnd
      bIndex = bDigitsEnd
      continue
    }

    if (aCode !== bCode) {
      return aCode - bCode
    }
    aIndex += 1
    bIndex += 1
  }

  return aIndex < a.length ? 1 : bIndex < b.length ? -1 : 0
}

function findDigitsEnd(value: string, start: number): number {
  let end = start
  while (end < value.length && isAsciiDigit(value.charCodeAt(end))) {
    end += 1
  }
  return end
}

function skipLeadingZeroes(value: string, start: number, end: number): number {
  let significantStart = start
  while (significantStart < end && value.charCodeAt(significantStart) === 48) {
    significantStart += 1
  }
  return significantStart
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57
}
