import { useSyncExternalStore } from 'react'

const query = '(max-width: 900px)'
function subscribe(listener: () => void): () => void {
  const media = window.matchMedia(query)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}
