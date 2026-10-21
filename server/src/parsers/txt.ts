import { newId } from '../db/client.js';
import type { OutlineNode } from '../types.js';
import type { ParseResult, Parser } from './index.js';

interface HeadingLine {
  level: number;
  title: string;
}

/**
 * Heading detection for plain-text books.
 * Supported patterns (in priority order):
 *   1. Markdown headings:  #, ##, ### ...
 *   2. Numbered chapters:  "第1章 xxx", "第一章 xxx", "Chapter 1 xxx"
 *   3. Numbered sections:  "1.1 xxx", "1.2.3 xxx"
 */
const RE_MD = /^(#{1,6})\s+(.+?)\s*$/;
const RE_CHAPTER =
  /^(?:第\s*([0-9一二三四五六七八九十百千]+)\s*[章节篇部]|Chapter\s+([0-9IVXLC]+))\s*[:：.、]?\s*(.*)$/i;
const RE_SECTION = /^(\d+(?:\.\d+){1,4})\s*[:：.、]?\s*(\S.*)$/;

function detectHeading(line: string): HeadingLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const md = RE_MD.exec(trimmed);
  if (md) {
    return { level: Math.min(md[1].length, 6), title: md[2].trim() };
  }

  const chapter = RE_CHAPTER.exec(trimmed);
  if (chapter) {
    const rest = (chapter[3] ?? '').trim();
    const label = trimmed.slice(0, trimmed.length - rest.length).trim();
    const title = rest ? `${label} ${rest}` : label;
    return { level: 1, title: title.trim() };
  }

  const section = RE_SECTION.exec(trimmed);
  if (section) {
    const numbering = section[1];
    const level = Math.min(numbering.split('.').length, 6);
    return { level, title: `${numbering} ${section[2].trim()}`.trim() };
  }

  return null;
}

function makeNode(title: string, level: number): OutlineNode {
  return { id: newId('out'), title, level, children: [] };
}

/** Build a hierarchy from a flat list of headings using a stack. */
function buildHierarchy(headings: HeadingLine[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const h of headings) {
    const node = makeNode(h.title, h.level);
    while (stack.length && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }

  return roots;
}

function guessTitle(fileName: string, lines: string[]): string {
  const firstNonEmpty = lines.find((l) => l.trim().length > 0);
  if (firstNonEmpty && firstNonEmpty.trim().length <= 60) {
    const h = detectHeading(firstNonEmpty);
    if (!h) return firstNonEmpty.trim();
  }
  return fileName.replace(/\.[^.]+$/, '');
}

export const txtParser: Parser = {
  extensions: ['txt', 'md', 'markdown'],

  parse(text: string, fileName: string): ParseResult {
    const lines = text.split(/\r?\n/);
    const title = guessTitle(fileName, lines);

    const headings: HeadingLine[] = [];
    for (const line of lines) {
      const h = detectHeading(line);
      if (h) headings.push(h);
    }

    let roots = buildHierarchy(headings);

    // Fallback: no headings detected -> split by blank lines into flat level-1
    // items so the user still gets an editable outline.
    if (roots.length === 0) {
      const paragraphs = text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);

      roots = paragraphs.slice(0, 100).map((p, i) => {
        const firstLine = p.split(/\r?\n/)[0].slice(0, 80);
        return makeNode(firstLine || `Section ${i + 1}`, 1);
      });
    }

    const root: OutlineNode = {
      id: newId('out'),
      title,
      level: 0,
      children: roots,
    };

    return { title, outline: root };
  },
};
