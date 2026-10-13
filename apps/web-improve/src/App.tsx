import { Suspense, type ComponentType } from 'react'
import { StoreProvider, useStore } from './store'
import { Shell } from './shell'
import { routes as a } from './screens/a'
import { routes as b } from './screens/b'
import { routes as c } from './screens/c'
import { routes as d } from './screens/d'
import { routes as e } from './screens/e'
import { routes as f } from './screens/f'
import { routes as g } from './screens/g'
import { routes as h } from './screens/h'
import { routes as s } from './screens/scenarios'

const ROUTES: Record<string, ComponentType> = { ...a, ...b, ...c, ...d, ...e, ...f, ...g, ...h, ...s }

function Router() {
  const { route, authed } = useStore()
  const Login = ROUTES['login']
  const NotFound = ROUTES['notfound']
  if (route.page === 'scenarios' || route.page === 'workspaces') {
    const Outside = ROUTES[route.page]
    if (Outside) return <Outside />
  }
  if (!authed || route.page === 'login') return Login ? <Login /> : null
  const Page = ROUTES[route.page] || NotFound
  return (
    <Shell>
      <Suspense fallback={null}>{Page ? <Page key={route.page + (route.id || '')} /> : <div>Page not found.</div>}</Suspense>
    </Shell>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  )
}
