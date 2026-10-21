import type { OutlineNode } from '../types.js';

export interface ParseResult {
  title: string;
  outline: OutlineNode;
}

export interface Parser {
  /** File extensions this parser handles, e.g. ['txt'] */
  extensions: string[];
  parse(text: string, fileName: string): ParseResult;
}

import { txtParser } from './txt.js';

const parsers: Parser[] = [txtParser];

export function getParser(fileName: string): Parser | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return parsers.find((p) => p.extensions.includes(ext)) ?? null;
}

export { txtParser };
