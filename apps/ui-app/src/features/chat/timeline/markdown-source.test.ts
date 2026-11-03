import { describe, expect, it } from 'vitest';
import { normalizeAssistantMarkdownSource, normalizeEmphasisMarkers, stripXmlReasoningWrappers, unwrapHtmlBlockWrappers } from './markdown-source';

describe('assistant markdown source', () => {
  it('makes the strong marks pairs, and keeps a space beside a word that touches them', () => {
    expect(normalizeEmphasisMarkers('** word **')).toBe('**word**');
    expect(normalizeEmphasisMarkers('\u7ed3\u679c\u662f**\u5173\u952e**\u5185\u5bb9')).toBe('\u7ed3\u679c\u662f **\u5173\u952e** \u5185\u5bb9');
    expect(normalizeEmphasisMarkers('\\**escaped text\\**')).toBe('**escaped text**');
  });

  it('keeps inline code as it is', () => {
    expect(normalizeEmphasisMarkers('see `** raw **` now')).toBe('see `** raw **` now');
  });

  it('drops a wrapped reasoning block, but not the answer around it', () => {
    expect(stripXmlReasoningWrappers('before <redacted_thinking>hidden</redacted_thinking> after')).toBe('before \n\n after');
  });

  it('takes off the block-level shells, so the markdown inside them is read', () => {
    expect(unwrapHtmlBlockWrappers('<div><p>**bold**</p></div>')).toBe('**bold**\n\n');
  });

  it('turns list items and bullets into markdown list lines, and leaves fenced code alone', () => {
    const source = '<ul><li>one</li><li>two</li></ul>\n• third\n```\n• not a bullet\n```';
    const out = normalizeAssistantMarkdownSource(source);
    expect(out).toContain('- one');
    expect(out).toContain('- two');
    expect(out).toContain('- third');
    expect(out).toContain('```\n• not a bullet\n```');
  });

  it('removes zero-width characters and normalises full-width marks', () => {
    expect(normalizeAssistantMarkdownSource('a​b')).toBe('ab');
    expect(normalizeAssistantMarkdownSource('\uff0a\uff0ax\uff0a\uff0a'.normalize('NFKC'))).toBe('**x**');
  });

  it('gives an empty answer as an empty source', () => {
    expect(normalizeAssistantMarkdownSource(null)).toBe('');
  });
});
