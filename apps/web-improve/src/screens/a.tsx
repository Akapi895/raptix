import type { ComponentType } from 'react'
import { Login } from './a-login'
/* Ticket 61a/61b: the auth/system slice's semantic module (src/screens/system)
   owns the error pages and the states gallery; route keys are unchanged. */
import { Forbidden, NotFound, Offline, ServerError, SessionExpired } from './system/pages'
import { StatesGallery } from './system/gallery'
import { Dashboard, MyTasks } from './a-dashboard'

export const routes: Record<string, ComponentType> = {
  login: Login,
  forbidden: Forbidden,
  notfound: NotFound,
  error: ServerError,
  offline: Offline,
  'session-expired': SessionExpired,
  states: StatesGallery,
  'command-center': Dashboard,
  tasks: MyTasks,
}
