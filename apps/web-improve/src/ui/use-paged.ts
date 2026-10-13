import { useState } from 'react'

/* ───────────── Pagination state ───────────── */
export function usePaged<T>(rows: T[], size = 10) {
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const p = Math.min(page, pages)
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages, setPage, total: rows.length }
}
