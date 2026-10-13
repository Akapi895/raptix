import type { ComponentType } from 'react'
import { Login } from './a-login'
import { Forbidden, NotFound, Offline, ServerError, SessionExpired, StatesGallery } from './a-system'
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
