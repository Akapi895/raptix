import type { ComponentType } from 'react'
import { Detail, Operations, OperationNew, Preflight, Schedule } from './views/operation-pages'

/** The operation route group, mounted by the router registry for the mock console. */
export const routes: Record<string, ComponentType> = {
  operations: Operations,
  'operation-new': OperationNew,
  preflight: Preflight,
  'operation-schedule': Schedule,
  operation: Detail,
}
