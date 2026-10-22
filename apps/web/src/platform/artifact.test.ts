/** Report artifact bytes (P07): base64 PDF and DOCX decode to the exact bytes the server produced; text stays UTF-8. */
import { describe, expect, it } from 'vitest'
import { artifactBlob } from './artifact'

describe('artifactBlob', () => {
  it('decodes base64 binary artifacts to the exact bytes', async () => {
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff])
    const blob = artifactBlob({ content: Buffer.from(bytes).toString('base64'), encoding: 'base64', mediaType: 'application/pdf' })
    expect(blob.type).toBe('application/pdf')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
  })

  it('keeps text artifacts as UTF-8 text', async () => {
    const blob = artifactBlob({ content: '# Báo cáo', encoding: 'utf8', mediaType: 'text/markdown' })
    expect(await blob.text()).toBe('# Báo cáo')
  })
})
