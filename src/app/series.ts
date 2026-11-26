export interface Range {
  from: number;
  to: number;
}

const FIRST = 50000;
const SIZE = 100;

/** The ranges of a server's series text, for example "50000–50099, 50200–50299". */
export function parseSeries(text: string): Range[] {
  return [...text.matchAll(/(\d+)\D+?(\d+)/g)].map((match) => ({
    from: Number(match[1]),
    to: Number(match[2]),
  }));
}

/** The first block of 100 numbers from 50000 that no used range touches. */
export function freeSeries(used: readonly Range[]): Range {
  let from = FIRST;
  while (used.some((range) => range.from <= from + SIZE - 1 && from <= range.to)) {
    from += SIZE;
  }
  return { from, to: from + SIZE - 1 };
}
