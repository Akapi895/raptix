import { lazy, type ComponentType } from 'react'
import { Login } from './a-login'
/* Ticket 61a/61b: the auth/system slice's semantic module (src/screens/system)
   owns the error pages and the states gallery; route keys are unchanged. */
import { Forbidden, NotFound, Offline, ServerError, SessionExpired } from './system/pages'
import { Dashboard } from './a-dashboard'

/* Ticket 70: the tasks inbox and states gallery load on demand — the eager
   auth/system slice keeps only the login, command-center and crash pages. */
export const routes: Record<string, ComponentType> = {
  login: Login,
  forbidden: Forbidden,
  notfound: NotFound,
  error: ServerError,
  offline: Offline,
  'session-expired': SessionExpired,
  states: lazy(() => import('./system/gallery').then((m) => ({ default: m.StatesGallery }))),
  'command-center': Dashboard,
  tasks: lazy(() => import('./a-tasks').then((m) => ({ default: m.MyTasks }))),
}
