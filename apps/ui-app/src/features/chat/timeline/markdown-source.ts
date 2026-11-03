// The source of an assistant answer, made readable for the markdown parser: the zero-width characters go, the full-width marks
// become ASCII, the emphasis is made pairs, the wrapped "thinking" blocks and the block-level HTML shells go, and the
// bullets become list markers. Fenced code blocks are kept as they are. Pure string work.

const FENCE_PRE = '\nCSAI_FENCE_';
const FENCE_SUF = '_\n';

/** The fenced code blocks, taken out of the text and replaced by placeholders, with the blocks kept for later. */
export function maskFencedCodeBlocks(md: string): { masked: string; blocks: string[] } {
  const blocks: string[] = [];
  const masked = String(md).replace(/```[\s\S]*?```/g, m => {
    const i = blocks.length;
    blocks.push(m);
    return FENCE_PRE + i + FENCE_SUF;
  });
  return { masked, blocks };
}

export function unmaskFencedCodeBlocks(s: string, blocks: string[]): string {
  let out = s;
  for (let i = 0; i < blocks.length; i++) {
    out = out.split(FENCE_PRE + i + FENCE_SUF).join(blocks[i] ?? '');
  }
  return out;
}

/** Removes the "thinking" blocks that some models wrap in XML-like tags, which would otherwise swallow the markdown after them. */
export function stripXmlReasoningWrappers(segment: string): string {
  let t = String(segment);
  for (const name of ['redacted_thinking', 'redacted_reasoning']) {
    const re = new RegExp('<\\s*' + name + '\\b[^>]*>[\\s\\S]*?<\\s*/\\s*' + name + '\\s*>', 'gi');
    t = t.replace(re, '\n\n');
  }
  return t.replace(/\n{3,}/g, '\n\n');
}

/** Takes off the block-level HTML shells (div, p, section, article, main), whose contents the markdown parser would not read. */
export function unwrapHtmlBlockWrappers(segment: string): string {
  let s = segment;
  let prev: string | undefined;
  for (let i = 0; i < 30 && s !== prev; i++) {
    prev = s;
    s = s.replace(/<div(?:\s[^>]*)?>([\s\S]*?)<\/div>/gi, (_, inner: string) => String(inner).trim() + '\n\n');
    s = s.replace(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi, (_, inner: string) => String(inner).trim() + '\n\n');
    s = s.replace(/<section(?:\s[^>]*)?>([\s\S]*?)<\/section>/gi, (_, inner: string) => String(inner).trim() + '\n\n');
    s = s.replace(/<article(?:\s[^>]*)?>([\s\S]*?)<\/article>/gi, (_, inner: string) => String(inner).trim() + '\n\n');
    s = s.replace(/<main(?:\s[^>]*)?>([\s\S]*?)<\/main>/gi, (_, inner: string) => String(inner).trim() + '\n\n');
    s = s.replace(/\n{3,}/g, '\n\n');
  }
  return s;
}

/** Turns HTML list items, and the lists around them, into markdown list lines. */
export function flattenOrphanHtmlLi(segment: string): string {
  let s = segment;
  s = s.replace(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi, (_, inner: string) => {
    const body = String(inner).trim().replace(/\s*\n\s*/g, ' ');
    return '- ' + body + '\n';
  });
  s = s.replace(/<\/?ul(?:\s[^>]*)?>/gi, '\n');
  s = s.replace(/<\/?ol(?:\s[^>]*)?>/gi, '\n');
  s = s.replace(/([0-9A-Za-z_\u4e00-\u9fff])\s*<li(?:\s[^>]*)?>\s*/g, (_, ch: string) => ch + '\n- ');
  return s.replace(/\n{3,}/g, '\n\n');
}

/** A line that starts with a bullet character becomes a markdown list line. */
export function normalizeUnicodeBullets(segment: string): string {
  return segment.replace(/^\s*•\s+/gm, '- ').replace(/^\s*·\s+/gm, '- ');
}

function maskInlineCode(input: string): { masked: string; blocks: string[] } {
  const blocks: string[] = [];
  const masked = input.replace(/`[^`\n]*`/g, m => {
    const token = '__CS_INLINE_CODE_' + blocks.length + '__';
    blocks.push(m);
    return token;
  });
  return { masked, blocks };
}

function unmaskInlineCode(input: string, blocks: string[]): string {
  let out = input;
  for (let i = 0; i < blocks.length; i++) {
    out = out.replace('__CS_INLINE_CODE_' + i + '__', blocks[i] ?? '');
  }
  return out;
}

const isWordLike = (ch: string): boolean => /[\u4e00-\u9fffA-Za-z0-9]/.test(ch || '');

function countUnescapedStrongMarkers(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text.charAt(i) === '*' && text.charAt(i + 1) === '*') {
      if (i > 0 && text.charAt(i - 1) === '\\') continue;
      count++;
      i++;
    }
  }
  return count;
}

/** Makes the strong marks of one line pairs; an empty pair is left as it is. */
function normalizeStrongLine(line: string): string {
  let lineWork = line;
  // An odd number of marks means one is stray; only the marks with blanks on both sides are dropped.
  while (countUnescapedStrongMarkers(lineWork) % 2 === 1) {
    const next = lineWork.replace(/\s\*\*\s/g, ' ');
    if (next === lineWork) break;
    lineWork = next;
  }
  let out = '';
  let cursor = 0;
  while (cursor < lineWork.length) {
    const open = lineWork.indexOf('**', cursor);
    if (open < 0) {
      out += lineWork.slice(cursor);
      break;
    }
    // An escaped pair is kept as it is: its escaped stars are not strong marks.
    if (open > 0 && lineWork.charAt(open - 1) === '\\') {
      out += lineWork.slice(cursor, open + 2);
      cursor = open + 2;
      continue;
    }
    let close = open + 2;
    while (true) {
      close = lineWork.indexOf('**', close);
      if (close < 0) break;
      if (close > 0 && lineWork.charAt(close - 1) === '\\') {
        close += 2;
        continue;
      }
      break;
    }
    if (close < 0) {
      out += lineWork.slice(cursor);
      break;
    }

    let prefix = lineWork.slice(cursor, open);
    const inner = lineWork.slice(open + 2, close).trim();
    const next = lineWork.charAt(close + 2);
    const prevTail = prefix.charAt(prefix.length - 1);

    // An empty pair is not rewritten, so that odd input such as four stars is not broken.
    if (!inner) {
      out += lineWork.slice(cursor, close + 2);
      cursor = close + 2;
      continue;
    }

    // A strong mark next to a CJK or alphanumeric character gets a space on that side, so that the parser reads it.
    if (isWordLike(prevTail) && !/\s$/.test(prefix)) prefix += ' ';
    out += prefix + '**' + inner + '**';
    if (isWordLike(next)) out += ' ';
    cursor = close + 2;
  }
  return out;
}

/** The emphasis of a segment made readable: escaped strong marks restored, pairs made, and the inline code kept out of it. */
export function normalizeEmphasisMarkers(segment: string): string {
  const raw = String(segment);
  // The escaped strong marks the model sometimes writes are restored first, then the pairs are made.
  let s = raw.replace(/\\\*\*([^\n*][^\n]*?[^\n*])\\\*\*/g, '**$1**');
  const masked = maskInlineCode(s);
  s = masked.masked.split('\n').map(normalizeStrongLine).join('\n');
  return unmaskInlineCode(s, masked.blocks);
}

/** The invisible characters the answer may carry: zero-width spaces, joiners and the byte-order mark. */
const ZERO_WIDTH = new RegExp('[' + [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0xfeff, 0x2060].map(code => String.fromCharCode(code)).join('') + ']', 'g');

/** The source of an assistant answer, ready for the markdown parser. */
export function normalizeAssistantMarkdownSource(text: unknown): string {
  if (text == null) return '';
  let s = String(text);
  s = s.replace(ZERO_WIDTH, '');
  try {
    s = s.normalize('NFKC');
  } catch {
    // The text stays as it is when it cannot be normalised.
  }
  s = normalizeEmphasisMarkers(s);
  s = stripXmlReasoningWrappers(s);
  const fb = maskFencedCodeBlocks(s);
  s = unwrapHtmlBlockWrappers(fb.masked);
  s = flattenOrphanHtmlLi(s);
  s = normalizeUnicodeBullets(s);
  return unmaskFencedCodeBlocks(s, fb.blocks);
}
