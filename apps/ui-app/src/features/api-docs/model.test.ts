import { describe, expect, it } from 'vitest';
import { buildCurl, endpointsOf, formatDescription, requestPath, tagKeyMap, withQuery } from './model';

describe('api docs paths and queries', () => {
  it('fills path parameters, prefixes /api and keeps absolute URLs', () => {
    expect(requestPath('/conversations/{id}', { id: 'a b' })).toBe('/api/conversations/a%20b');
    expect(requestPath('http://x/y', {})).toBe('http://x/y');
  });

  it('appends query pairs with the right separator', () => {
    expect(withQuery('/api/x', [['page', '2']])).toBe('/api/x?page=2');
    expect(withQuery('/api/x?a=1', [['b', '2']])).toBe('/api/x?a=1&b=2');
  });
});

describe('curl output', () => {
  it('quotes the body for the shell and uses the placeholder without a token', () => {
    const command = buildCurl('http://h', 'post', '/api/x', null, `{"name":"it's"}`);
    expect(command).toContain('curl -X POST "http://h/api/x"');
    expect(command).toContain('Bearer YOUR_TOKEN_HERE');
    expect(command).toContain(String.raw`-d '{"name":"it'\''s"}'`);
  });
});

describe('endpoint grouping', () => {
  const spec = {
    paths: {
      '/b': { get: { tags: ['Zeta'], 'x-i18n-tags': ['zeta'] } },
      '/a': { post: { tags: ['Alpha'], 'x-i18n-tags': ['alpha'] } },
    },
  };
  it('sorts by first tag then path, and maps tags to their keys', () => {
    expect(endpointsOf(spec, null).map(e => e.path)).toEqual(['/a', '/b']);
    expect(endpointsOf(spec, 'Zeta').map(e => e.path)).toEqual(['/b']);
    expect(tagKeyMap(spec)).toEqual({ Zeta: 'zeta', Alpha: 'alpha' });
  });
});

describe('description formatting', () => {
  it('protects code, converts emphasis and lists, and escapes HTML', () => {
    const html = formatDescription('# T\n\n**bold** `x<y` <script>\n- one\n- two');
    expect(html).toContain('<h4 class="md-h1">T</h4>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code class="inline-code">x&lt;y</code>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<li class="md-list-item">one</li>');
  });
});
