/**
 * Focused geometry and legibility tests for the extracted shared SVG chart
 * family (ticket 13): Donut, BarChart, LineChart and Legend. Empty/zero-value
 * and normal datasets must render without NaN/Infinity in any geometry or
 * style attribute, hover/focus information (role="img" + aria-label) stays
 * usable, theme tokens and text classes remain present for both themes, and
 * responsive sizing preserves the LineChart viewBox so labels stay inside it.
 * Imports go through the `../ui` compatibility barrel to pin the forwarding
 * surface that all screens still use; one test pins barrel/module identity.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BarChart, Donut, Legend, LineChart } from '../ui'
import { BarChart as BarChartModule, Donut as DonutModule, Legend as LegendModule, LineChart as LineChartModule } from './charts'

afterEach(cleanup)

const assertFiniteGeometry = (container: HTMLElement) => {
  for (const el of container.querySelectorAll('svg, svg *, [style]')) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.value, `${el.tagName}[${attr.name}]`).not.toMatch(/NaN|Infinity/)
    }
  }
}

describe('chart barrel forwarding (ticket 13)', () => {
  it('forwards the same chart implementations as the owning module', () => {
    expect(Donut).toBe(DonutModule)
    expect(Legend).toBe(LegendModule)
    expect(BarChart).toBe(BarChartModule)
    expect(LineChart).toBe(LineChartModule)
  })
})

describe('Donut', () => {
  it('renders the track only for empty and all-zero datasets, with no invalid geometry', () => {
    for (const data of [[], [{ label: 'Queued', value: 0, color: 'var(--c-neutral)' }]]) {
      const { container, unmount } = render(<Donut data={data} />)
      assertFiniteGeometry(container)
      const circles = container.querySelectorAll('circle')
      expect(circles).toHaveLength(1)
      expect(circles[0].getAttribute('stroke')).toBe('var(--c-hover)')
      expect(container.querySelector('[role="img"]')).not.toBeNull()
      unmount()
    }
  })

  it('renders normal slices with the documented arc geometry, colors, center slot and accessible name', () => {
    const data = [
      { label: 'High', value: 5, color: 'var(--c-bad)' },
      { label: 'Low', value: 3, color: 'var(--c-ok)' },
    ]
    const { container } = render(<Donut data={data} size={120} center={<b>8</b>} />)
    assertFiniteGeometry(container)
    const r = 120 / 2 - 12
    const c = 2 * Math.PI * r
    const lenHigh = (5 / 8) * c
    const lenLow = (3 / 8) * c
    const circles = container.querySelectorAll('circle')
    expect(circles).toHaveLength(3)
    for (const circle of circles) {
      expect(circle.getAttribute('cx')).toBe('60')
      expect(circle.getAttribute('cy')).toBe('60')
      expect(circle.getAttribute('r')).toBe(String(r))
    }
    expect(circles[1].getAttribute('stroke')).toBe('var(--c-bad)')
    expect(circles[1].getAttribute('stroke-dasharray')).toBe(`${lenHigh} ${c - lenHigh}`)
    expect(circles[1].getAttribute('stroke-dashoffset')).toBe('0')
    expect(circles[2].getAttribute('stroke')).toBe('var(--c-ok)')
    expect(circles[2].getAttribute('stroke-dasharray')).toBe(`${lenLow} ${c - lenLow}`)
    expect(circles[2].getAttribute('stroke-dashoffset')).toBe(`${-lenHigh}`)
    expect(screen.getByRole('img', { name: 'High: 5, Low: 3' })).not.toBeNull()
    expect(container.querySelector('.absolute.text-center')!.textContent).toContain('8')
  })
})

describe('Legend', () => {
  it('renders one labelled swatch row per entry for numeric and string values', () => {
    const { container } = render(<Legend data={[{ label: 'High', value: 5, color: 'var(--c-bad)' }, { label: 'Low', value: 'n/a', color: 'var(--c-ok)' }]} />)
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('High')
    expect(items[0].textContent).toContain('5')
    expect(items[1].textContent).toContain('Low')
    expect(items[1].textContent).toContain('n/a')
    for (const [item, color] of [[items[0], 'var(--c-bad)'], [items[1], 'var(--c-ok)']] as const) {
      const swatch = item.querySelector('span')
      expect(swatch!.className).toContain('h-2.5 w-2.5 rounded-sm')
      expect(swatch!.getAttribute('style')).toContain(`background: ${color}`)
      expect(item.querySelector('.text-muted')).not.toBeNull()
      expect(item.querySelector('.tabular-nums')).not.toBeNull()
    }
  })
})

describe('BarChart', () => {
  it('renders an empty labelled plot for an empty dataset with no invalid geometry', () => {
    const { container } = render(<BarChart data={[]} />)
    assertFiniteGeometry(container)
    expect(container.querySelector('[role="img"]')).not.toBeNull()
    expect((container.querySelector('[role="img"]') as HTMLElement).style.height).toBe('160px')
    expect(container.querySelectorAll('[role="img"] > div')).toHaveLength(0)
  })

  it('scales bars against the dataset max, keeps zero-value bars visible and honours the color props', () => {
    const { container } = render(<BarChart data={[{ label: 'Benign', value: 0 }, { label: 'Malicious', value: 6, color: 'var(--c-warn)' }]} />)
    assertFiniteGeometry(container)
    const columns = container.querySelectorAll('[role="img"] > div')
    expect(columns).toHaveLength(2)
    const bars = [columns[0].querySelector('.rounded-t-md')!, columns[1].querySelector('.rounded-t-md')!]
    expect(bars[0].getAttribute('style')).toContain('height: 0px')
    expect(bars[0].getAttribute('style')).toContain('min-height: 2px')
    expect(bars[0].getAttribute('style')).toContain('background: var(--c-accent)')
    expect(bars[1].getAttribute('style')).toContain('height: 116px')
    expect(bars[1].getAttribute('style')).toContain('background: var(--c-warn)')
    expect(columns[0].firstElementChild!.textContent).toBe('0')
    expect(columns[1].firstElementChild!.textContent).toBe('6')
    for (const column of columns) {
      expect(column.firstElementChild!.className).toContain('tabular-nums text-muted')
      expect(column.lastElementChild!.className).toContain('truncate')
      expect(column.lastElementChild!.className).toContain('text-muted')
    }
  })
})

describe('LineChart', () => {
  it('keeps the viewBox and gridlines for empty series/labels with no invalid geometry', () => {
    const { container } = render(<LineChart series={[]} labels={[]} />)
    assertFiniteGeometry(container)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 480 160')
    expect(svg.querySelectorAll('line')).toHaveLength(3)
    expect(svg.querySelectorAll('polyline, circle, text')).toHaveLength(0)
    expect(svg.getAttribute('role')).toBe('img')
  })

  it('guards the single-label/single-point division cases with valid finite geometry', () => {
    const { container } = render(<LineChart series={[{ name: 'Agents', values: [4], color: 'var(--c-ok)' }]} labels={['Now']} />)
    assertFiniteGeometry(container)
    expect(container.querySelector('polyline')!.getAttribute('points')).toBe('24,24')
    const circle = container.querySelector('circle')!
    expect(circle.getAttribute('cx')).toBe('24')
    expect(circle.getAttribute('cy')).toBe('24')
    expect(container.querySelector('text')!.getAttribute('x')).toBe('24')
  })

  it('renders multi-series points with the documented coordinates, colors and theme tokens', () => {
    const { container } = render(
      <LineChart
        labels={['-20m', '-10m', 'Now']}
        series={[
          { name: 'Sessions', values: [2, 8, 4], color: 'var(--c-cyan)' },
          { name: 'Findings', values: [1, 3, 6], color: 'var(--c-warn)' },
        ]}
      />,
    )
    assertFiniteGeometry(container)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 480 160')
    expect(screen.getByRole('img', { name: 'Sessions, Findings' })).not.toBeNull()
    const polylines = svg.querySelectorAll('polyline')
    expect(polylines).toHaveLength(2)
    expect(polylines[0].getAttribute('stroke')).toBe('var(--c-cyan)')
    expect(polylines[0].getAttribute('points')).toBe('24,108 240,24 456,80')
    expect(polylines[1].getAttribute('stroke')).toBe('var(--c-warn)')
    expect(polylines[1].getAttribute('points')).toBe('24,122 240,94 456,52')
    const circles = svg.querySelectorAll('circle')
    expect(circles).toHaveLength(6)
    for (const circle of circles) expect(circle.getAttribute('r')).toBe('3')
    for (const grid of svg.querySelectorAll('line')) {
      expect(grid.getAttribute('stroke')).toBe('var(--c-line)')
      expect(grid.getAttribute('stroke-dasharray')).toBe('3 4')
    }
    const texts = svg.querySelectorAll('text')
    expect(texts).toHaveLength(3)
    for (const text of texts) {
      expect(text.getAttribute('fill')).toBe('var(--c-muted)')
      expect(text.getAttribute('text-anchor')).toBe('middle')
    }
  })

  it('keeps custom heights in the viewBox so axis labels are not clipped', () => {
    const { container } = render(<LineChart labels={['A', 'B']} series={[{ name: 'S', values: [1, 2], color: 'var(--c-ok)' }]} height={140} />)
    assertFiniteGeometry(container)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 480 140')
    const texts = svg.querySelectorAll('text')
    expect(texts).toHaveLength(2)
    for (const text of texts) {
      expect(Number(text.getAttribute('y'))).toBeLessThanOrEqual(140)
      expect(Number(text.getAttribute('x'))).toBeLessThanOrEqual(480)
    }
  })
})
