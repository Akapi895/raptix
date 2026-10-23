/**
 * Contrast validation for the theme tokens (quick win UX-19). Each text and fill pair the app uses must reach the WCAG AA
 * ratio of 4.5:1 in its theme. The values are read from index.css, so a token change that breaks a pair fails here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')

/** The body of one theme block, from its opening selector to the closing brace at column 0. */
function themeBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`Theme block ${selector} not found`)
  return css.slice(start, css.indexOf('\n}', start))
}

function token(scope: string, name: string): string {
  if (name === 'white') return '#FFFFFF'
  const match = new RegExp(`--c-${name}:\\s*(#[0-9A-Fa-f]{6});`).exec(scope)
  if (!match) throw new Error(`Token --c-${name} not found`)
  return match[1]
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

const LIGHT = themeBlock(':root')
const DARK = themeBlock(':root.dark')

/** [theme, what the pair is used for, foreground token, background token]. `white` is the literal #FFFFFF. */
const PAIRS: [string, string, string, string][] = [
  ['light', 'primary text on panel', 'primary', 'panel'],
  ['light', 'primary text on background', 'primary', 'bg'],
  ['light', 'neutral text on panel', 'neutral', 'panel'],
  ['light', 'neutral text on background', 'neutral', 'bg'],
  ['light', 'neutral text on hover row', 'neutral', 'hover'],
  ['light', 'neutral text on subtle surface', 'neutral', 'subtle'],
  ['light', 'accent text on panel', 'accent', 'panel'],
  ['light', 'ok text on panel', 'ok', 'panel'],
  ['light', 'warn text on panel', 'warn', 'panel'],
  ['light', 'bad text on panel', 'bad', 'panel'],
  ['light', 'primary fill with its text', 'primary-fg', 'primary'],
  ['light', 'primary hover fill with its text', 'primary-fg', 'primary-hover'],
  ['light', 'danger fill with white text', 'white', 'danger-fill'],
  ['dark', 'primary text on panel', 'primary', 'panel'],
  ['dark', 'primary text on hover row', 'primary', 'hover'],
  ['dark', 'neutral text on panel', 'neutral', 'panel'],
  ['dark', 'neutral text on hover row', 'neutral', 'hover'],
  ['dark', 'accent text on panel', 'accent', 'panel'],
  ['dark', 'ok text on panel', 'ok', 'panel'],
  ['dark', 'warn text on panel', 'warn', 'panel'],
  ['dark', 'bad text on panel', 'bad', 'panel'],
  ['dark', 'primary fill with its text', 'primary-fg', 'primary'],
  ['dark', 'primary hover fill with its text', 'primary-fg', 'primary-hover'],
  ['dark', 'primary press fill with its text', 'primary-fg', 'primary-press'],
  ['dark', 'danger fill with white text', 'white', 'danger-fill'],
]

describe('theme contrast', () => {
  it('computes WCAG ratios from the formula', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5)
  })

  it.each(PAIRS)('%s theme: %s meets 4.5:1', (theme, _use, fg, bg) => {
    const scope = theme === 'light' ? LIGHT : DARK
    const ratio = contrast(token(scope, fg), token(scope, bg))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})
