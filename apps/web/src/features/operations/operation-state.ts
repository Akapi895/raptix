/**
 * The labels of the operation states the runtime reports. An unknown state is shown as the runtime wrote it, so a new
 * state is never mistaken for one of these.
 */
export const OPERATION_TEXT: Record<string, string> = {
  bound: 'bound, not started',
  running: 'running',
  pause_requested: 'pause requested, not yet paused',
  paused: 'paused at a checkpoint',
  completed: 'completed',
}
