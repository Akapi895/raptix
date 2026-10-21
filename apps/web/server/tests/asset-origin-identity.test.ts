import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { webOriginKey } from '../src/services/asset-map-service.js';

// The same vectors drive packages/raptix/tests/unit/knowledge/test_asset_identity.py, so the web origin
// canonicalization and the runtime's web_origin_ref cannot drift apart without a failing test.
const VECTORS: Array<{ input: string; origin: string | null }> = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../tests/fixtures/asset-map/origin-identity-vectors.json', import.meta.url)), 'utf8'),
);

describe('web origin identity parity with the runtime', () => {
  it.each(VECTORS)('canonicalizes $input the way asset_identity.web_origin_ref does', vector => {
    expect(webOriginKey(vector.input)).toBe(vector.origin);
  });

  it('refuses spellings the URL parser would rewrite, so they stay unlinked instead of matching by accident', () => {
    for (const input of ['http://[0:0::1]:8080/', 'http://0x7f.0.0.1/', 'http://999.1.1.1/', 'https://exa mple.com/']) {
      expect(webOriginKey(input)).toBeNull();
    }
  });
});
