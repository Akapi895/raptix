import { useEffect, useMemo, useState } from 'react'

/* ───────────── Shared hooks ───────────── */
export function useDebounced<T>(v: T, ms = 200) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}
export const useMemoList = useMemo
