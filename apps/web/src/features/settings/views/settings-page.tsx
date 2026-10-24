import { type ReactNode } from 'react'

import { ShieldCheck } from 'lucide-react'

import { Empty, PageHeader, Tabs } from '../../../ui/index'

import { go, useRoute } from '../../../router/navigate'

import { CapabilitiesSection, RealOrganizationSection, WorkspaceAuditSection, WorkspaceSettingsSection } from '../real-sections'

type TabId = 'org' | 'users' | 'integrations' | 'policies' | 'retention' | 'templates' | 'detection' | 'audit' | 'notifications' | 'security'

const REAL_BODY: Partial<Record<TabId, () => ReactNode>> = {
  org: () => <RealOrganizationSection />,
  integrations: () => <CapabilitiesSection />,
  policies: () => <WorkspaceSettingsSection kind="policy" />,
  retention: () => <WorkspaceSettingsSection kind="retention" />,
  audit: () => <WorkspaceAuditSection />,
}

const SECTION_IDS: TabId[] = ['org', 'users', 'integrations', 'policies', 'retention', 'templates', 'detection', 'audit', 'notifications', 'security']

const TABS: [TabId, string][] = [['org', 'Organization'], ['integrations', 'Integrations'], ['policies', 'Policies'], ['retention', 'Retention'], ['audit', 'Audit log']]

export function SettingsPage() {
  const route = useRoute()
  const tab = (route.tab || 'org') as TabId
  const body = () => {
    if (!SECTION_IDS.includes(tab)) return <Empty title="Settings section not found" />
    return REAL_BODY[tab] ? REAL_BODY[tab]!() : <Empty title="Not in this deployment">This section has no backing record here.</Empty>
  }
  const personal = tab === 'notifications' || tab === 'security'
  return (
    <>
      <PageHeader title="Organization Settings" meta={<span className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent"><ShieldCheck size={12} aria-hidden />Organization-wide</span>} sub="Settings that apply across this workspace." />
      <div role="note" className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border border-accent-line bg-accent-soft px-4 py-2.5 text-sm">
        <span className="font-semibold text-accent">Organization-wide</span>
        <span className="min-w-0 flex-1 text-fg">{personal ? 'You are in your personal preferences. They apply to you across all projects and never change organization policy. Emergency and expired-access alerts cannot be muted by quiet hours.' : 'Changes here apply to every project in this workspace, and to running operations and sessions. Project-specific settings (ROE, scope, members) live inside each project. Every change is audited.'}</span>
      </div>
      <Tabs value={tab} onChange={(t) => go('settings', { tab: t })} tabs={TABS.map(([id, label]) => ({ id, label }))} />
      {body()}
    </>
  )
}
