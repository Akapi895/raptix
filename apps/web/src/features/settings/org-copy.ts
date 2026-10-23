/**
 * Organization settings copy that differs by data mode. The values are fixed for one app load (the mode is resolved
 * once), so they are computed here. The view takes them as text and never reads the mode itself.
 */
import { isRealMode } from '../../state/mode'

/** Subtitle of the organization settings header. The demo organization and the simulation notice are demo-only. */
export const ORG_SETTINGS_SUB = isRealMode()
  ? 'Settings that apply across this workspace.'
  : 'Acme Security (Demo) · Raptix Workspace — Test Lab. This is a simulation: the backend enforces every control.'

/** The demo project IDs named in the organization scope note. Real mode names no project. */
export const ORG_SCOPE_DEMO_PROJECTS = isRealMode() ? '' : ', including RT-2026-014 and RT-2026-017'
