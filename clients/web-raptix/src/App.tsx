import { lazy, Suspense, useEffect, useState } from 'react'
import type { Project, Screen } from './types'
import { useAppRoute, navigateUrl, routePath } from './app/router'
import { dataMode } from './app/config'
import { createVisualProject, useVisualProjects } from './mocks/adapters/visual-projects'
import { useNarrowViewport } from './shared/hooks/useNarrowViewport'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Home from './screens/Home'
import NewChatModal from './components/NewChatModal'
import NewProjectModal from './components/NewProjectModal'
import HitlModal from './components/HitlModal'

const Charter = lazy(() => import('./screens/Charter'))
const ScopeBoundaries = lazy(() => import('./screens/ScopeBoundaries'))
const OperatorConsole = lazy(() => import('./screens/OperatorConsole'))
const VectorCampaigns = lazy(() => import('./screens/VectorCampaigns'))
const C2Sessions = lazy(() => import('./screens/C2Sessions'))
const InfrastructureData = lazy(() => import('./screens/InfrastructureData'))
const Findings = lazy(() => import('./screens/Findings'))
const Logs = lazy(() => import('./screens/Logs'))
const Reports = lazy(() => import('./screens/Reports'))
const Members = lazy(() => import('./screens/Members'))
const ProjectSettings = lazy(() => import('./screens/ProjectSettings'))
const RealApp = lazy(() => import('./app/RealApp'))

export default function App() {
  if (dataMode === 'real') {
    return <Suspense fallback={<p role="status" className="p-6">Loading workspace…</p>}><RealApp /></Suspense>
  }
  return <VisualApp />
}

function VisualApp() {
  const route = useAppRoute()
  const projects = useVisualProjects()
  const project = projects.find(candidate => candidate.id === route.projectId)
  const narrow = useNarrowViewport()
  const [menuOpen, setMenuOpen] = useState(false)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [hitlOpen, setHitlOpen] = useState(false)
  const [decisions, setDecisions] = useState<Record<string, 'allow' | 'deny'>>({})
  useEffect(() => { setMenuOpen(false); setHitlOpen(false); setNewChatOpen(false); setNewProjectOpen(false) }, [route.projectId, route.screen])
  const navigate = (screen: Screen) => navigateUrl(routePath(screen, project?.id))
  const enterProject = (selected: Project, screen: Screen = 'charter') => navigateUrl(routePath(screen, selected.id))
  const create = (name: string, scopeType: string, client: string) => {
    const created = createVisualProject(name, scopeType, client)
    setNewProjectOpen(false)
    enterProject(created)
  }
  if (route.notFound || (route.projectId && !project)) return <main className="p-6 max-w-2xl mx-auto"><h1 className="text-xl font-semibold mb-3">Project or page not found</h1><p className="mb-4">This preview contains only the 13 requested workspace pages.</p><button className="border rounded-lg px-4 py-2" onClick={() => navigateUrl('/projects')}>All projects</button></main>
  const hitlPending = !!project && !decisions[project.id]
  return <>
    {!project ? <Home projects={projects} onEnter={enterProject} onNewChat={() => setNewChatOpen(true)} onNewProject={() => setNewProjectOpen(true)} /> :
      <div className="flex h-dvh overflow-hidden bg-slate-50">
        <Sidebar screen={route.screen} navigate={navigate} project={project} allProjects={projects} onHitl={() => setHitlOpen(true)} hitlPending={hitlPending} onSwitchProject={selected => enterProject(selected)} open={narrow ? menuOpen : undefined} onClose={() => setMenuOpen(false)} />
        <div className="app-shell-content flex-1 min-w-0 flex flex-col overflow-hidden">
          <Header screen={route.screen} project={project} navigate={navigate} onHitl={() => setHitlOpen(true)} hitlPending={hitlPending} open={narrow ? menuOpen : undefined} onMenu={() => setMenuOpen(true)} onClose={() => setMenuOpen(false)} />
          <main className="app-shell-main flex-1 min-w-0 overflow-auto" id="main-content">
            <Suspense fallback={<p role="status" className="p-6">Loading view…</p>}>
              <div key={`${project.id}:${route.screen}`} className={`visual-page ${['operator-console', 'c2-sessions', 'infrastructure', 'assets', 'credentials', 'findings', 'logs', 'reports'].includes(route.screen) ? 'visual-page--wide' : ''}`}>
                {route.screen === 'charter' && <Charter project={project} />}
                {route.screen === 'scope-boundaries' && <ScopeBoundaries project={project} />}
                {route.screen === 'operator-console' && <OperatorConsole project={project} />}
                {route.screen === 'vector-campaigns' && <VectorCampaigns project={project} />}
                {route.screen === 'c2-sessions' && <C2Sessions project={project} />}
                {['infrastructure', 'assets', 'credentials'].includes(route.screen) && <InfrastructureData project={project} screen={route.screen} navigate={navigate} />}
                {route.screen === 'findings' && <Findings project={project} />}
                {route.screen === 'logs' && <Logs project={project} />}
                {route.screen === 'reports' && <Reports project={project} />}
                {route.screen === 'members' && <Members project={project} />}
                {route.screen === 'project-settings' && <ProjectSettings project={project} />}
              </div>
            </Suspense>
          </main>
        </div>
      </div>}
    {newChatOpen && <NewChatModal projects={projects} onClose={() => setNewChatOpen(false)} onSelectProject={selected => enterProject(selected, 'operator-console')} onOpenNewProject={() => { setNewChatOpen(false); setNewProjectOpen(true) }} />}
    {newProjectOpen && <NewProjectModal onClose={() => setNewProjectOpen(false)} onCreate={create} />}
    {hitlOpen && <HitlModal onClose={() => setHitlOpen(false)} onDecide={action => { if (project) setDecisions(previous => ({ ...previous, [project.id]: action })) }} />}
  </>
}
