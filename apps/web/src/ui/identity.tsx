import type { ReactNode } from 'react'
import { cx } from './cx'

export const Mono = ({ children, className }: { children: ReactNode; className?: string }) => <span className={cx('font-mono text-[13px]', className)}>{children}</span>
export const IdLink = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={(e) => { e.stopPropagation(); onClick() }} className="font-mono text-[13px] text-accent hover:underline">{children}</button>
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const ini = name.split(' ').slice(-2).map((x) => x[0]).join('').toUpperCase()
  return <span style={{ width: size, height: size, fontSize: size * 0.4 }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent" aria-hidden>{ini}</span>
}
export const Person = ({ name }: { name: string }) => <span className="inline-flex items-center gap-2"><Avatar name={name} size={24} />{name}</span>
