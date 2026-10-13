import type { ComponentType } from 'react'
import { Login } from './a-login'
/* Ticket 61a: the error pages own their semantic module (src/screens/system);
   the states gallery follows in 61b. */
import { Forbidden, NotFound, Offline, ServerError, SessionExpired } from './system/pages'
import { StatesGallery } from './a-system'
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
