/**
 * Shell compatibility barrel (ticket 08e).
 *
 * The shell monolith was extracted into `src/shell/*` across tickets 08a–08e;
 * this module remains so existing `./shell` imports keep resolving and later
 * feature tickets can import the composition pieces from one place. `Shell`
 * (with the ticket 59/60 slot props) is the mount-point export; everything
 * else is re-exported from its extraction module without reimplementation.
 */
export { Shell, type ShellSlots } from './shell/shell'
// eslint-disable-next-line react-refresh/only-export-components -- shell module: header slots and shell co-exported
export { NAV, isWide, useBadges } from './shell/nav'
export { Sidebar } from './shell/sidebar'
export { ProjectSwitcher } from './shell/project-switcher'
export { GlobalSearch } from './shell/search'
export { Topbar, type HeaderSlots } from './shell/header'
export { Pop } from './shell/pop'
export { ContextRibbon, StopBanner } from './shell/context-ribbon'
export type { Route } from './router/history'
