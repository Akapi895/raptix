import { useSyncExternalStore } from 'react'
import type { Screen } from '../types'
import { ACTIVE_NAV_ITEMS } from './navigation'

export interface AppRoute { screen: Screen; projectId?: string; notFound?: boolean }

export function parseRoute(pathname: string): AppRoute {
  if (pathname === '/' || /^\/projects\/?$/.test(pathname)) return { screen: 'projects' }
  const match = /^\/projects\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname)
  if (!match) return { screen: 'projects', notFound: true }
  let projectId: string
  try { projectId = decodeURIComponent(match[1]) } catch { return { screen: 'projects', notFound: true } }
  const path = match[2] || 'charter'
  const item = ACTIVE_NAV_ITEMS.find(entry => entry.path === path)
  return item ? { screen: item.id, projectId } : { screen: 'projects', projectId, notFound: true }
}

export function routePath(screen: Screen, projectId?: string): string {
  if (screen === 'projects' || !projectId) return '/projects'
  const item = ACTIVE_NAV_ITEMS.find(entry => entry.id === screen)
  return `/projects/${encodeURIComponent(projectId)}/${item?.path || 'not-found'}`
}

export function navigateUrl(path: string, replace = false): void {
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener)
  return () => window.removeEventListener('popstate', listener)
}

export function useAppRoute(): AppRoute {
  return parseRoute(useSyncExternalStore(subscribe, () => window.location.pathname, () => '/projects'))
}
