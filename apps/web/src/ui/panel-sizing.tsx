import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { cx } from './cx'

// eslint-disable-next-line react-refresh/only-export-components -- shared pane sizing configuration
export const INSP = { def: 360, min: 280, max: 520 }
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const readWidth = (key: string): number => { try { return Number(localStorage.getItem(key)) } catch { return 0 } }
const writeWidth = (key: string, width: number): void => { try { localStorage.setItem(key, String(width)) } catch { /* Width is a disposable layout preference. */ } }

// eslint-disable-next-line react-refresh/only-export-components -- shared layout hook; no feature or mode state
export function useViewportW(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => { const resize = (): void => setWidth(window.innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) }, [])
  return width
}

// eslint-disable-next-line react-refresh/only-export-components -- sizing hook colocated with its separator component
export function useResizable(key: string, cfg: { def: number; min: number; max: number }): { w: number; live: (value: number) => void; commit: () => void; reset: () => void } {
  const [w, setWidth] = useState(() => { const value = readWidth(key); return value ? clamp(value, cfg.min, cfg.max) : cfg.def })
  const ref = useRef(w)
  ref.current = w
  const live = useCallback((value: number) => setWidth(clamp(value, cfg.min, cfg.max)), [cfg.min, cfg.max])
  const commit = useCallback(() => writeWidth(key, ref.current), [key])
  const reset = useCallback(() => { setWidth(cfg.def); writeWidth(key, cfg.def) }, [key, cfg.def])
  return { w, live, commit, reset }
}

export function Separator({ label, side, r, cfg }: { label: string; side: 'left' | 'right'; r: ReturnType<typeof useResizable>; cfg: { min: number; max: number } }): ReactElement {
  const [drag, setDrag] = useState(false)
  const start = useRef({ x: 0, w: 0 })
  const direction = side === 'left' ? 1 : -1
  return <div role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={r.w} aria-valuetext={`${r.w} pixels`} aria-valuemin={cfg.min} aria-valuemax={cfg.max} tabIndex={0}
    title="Drag to resize. Double-click to reset. Arrow keys also resize."
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); start.current = { x: event.clientX, w: r.w }; setDrag(true) }}
    onPointerMove={(event) => { if (drag) r.live(start.current.w + direction * (event.clientX - start.current.x)) }}
    onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); setDrag(false); r.commit() }}
    onPointerCancel={() => { setDrag(false); r.commit() }} onDoubleClick={r.reset}
    onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); r.live(r.w + direction * (event.key === 'ArrowRight' ? 16 : -16)) } else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); r.live(event.key === 'Home' ? cfg.min : cfg.max) } }}
    onKeyUp={(event) => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') r.commit() }}
    className={cx('group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none', drag ? 'bg-accent-soft' : 'hover:bg-accent-soft focus-visible:bg-accent-soft')}>
    <span aria-hidden className={cx('absolute left-1/2 top-0 h-full w-px -translate-x-1/2', drag ? 'bg-accent' : 'bg-line group-hover:bg-accent group-focus-visible:bg-accent')} />
  </div>
}
