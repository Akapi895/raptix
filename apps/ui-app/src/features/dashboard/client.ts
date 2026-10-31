import { http } from '../../platform/http';
import type { DashboardResponses, SeverityStatus } from './types';

export interface DashboardClient {
  load(context: { projectId: string; locale: string; status: SeverityStatus; signal: AbortSignal }): Promise<DashboardResponses>;
}
export function createDashboardClient(transport: Pick<typeof http, 'get'> = http): DashboardClient {
  return {
    async load({ projectId, locale, status, signal }) {
      const get = async <T>(url: string): Promise<T | null> => {
        try { return await transport.get<T>(url, { signal }); } catch { return null; }
      };
      const scoped = (url: string): string => projectId ? `${url}${url.includes('?') ? '&' : '?'}project_id=${encodeURIComponent(projectId)}` : url;
      const open = (severity: string) => get<NonNullable<DashboardResponses['openCritical']>>(`/api/vulnerabilities?severity=${severity}&status=open&limit=1`);
      const [tasks, vulnerabilities, batch, monitor, knowledge, skills, recentVulnerabilities, roles, agents,
        openCritical, openHigh, openMedium, openLow, tools, hitl, notifications, externalMcp, webshell,
        listeners, sessions, c2Tasks, projects, filteredSeverity, tokens] = await Promise.all([
        get<NonNullable<DashboardResponses['tasks']>>('/api/agent-loop/tasks'),
        get<NonNullable<DashboardResponses['vulnerabilities']>>('/api/vulnerabilities/stats'),
        get<NonNullable<DashboardResponses['batch']>>('/api/batch-tasks?limit=500&page=1'),
        get<NonNullable<DashboardResponses['monitor']>>('/api/monitor/stats?top=30'),
        get<NonNullable<DashboardResponses['knowledge']>>('/api/knowledge/stats'),
        get<NonNullable<DashboardResponses['skills']>>('/api/skills/stats'),
        get<NonNullable<DashboardResponses['recentVulnerabilities']>>('/api/vulnerabilities?limit=10&page=1'),
        get<NonNullable<DashboardResponses['roles']>>('/api/roles'),
        get<NonNullable<DashboardResponses['agents']>>('/api/multi-agent/markdown-agents'),
        open('critical'), open('high'), open('medium'), open('low'),
        get<NonNullable<DashboardResponses['tools']>>('/api/config/tools?page=1&page_size=1&include_external=false'),
        get<NonNullable<DashboardResponses['hitl']>>('/api/hitl/pending'),
        get<NonNullable<DashboardResponses['notifications']>>(`/api/notifications/summary?since=0&limit=20&lang=${encodeURIComponent(locale)}`),
        get<NonNullable<DashboardResponses['externalMcp']>>('/api/external-mcp/stats'),
        get<NonNullable<DashboardResponses['webshell']>>(scoped('/api/webshell/connections')),
        get<NonNullable<DashboardResponses['listeners']>>(scoped('/api/c2/listeners')),
        get<NonNullable<DashboardResponses['sessions']>>(scoped('/api/c2/sessions?limit=500')),
        get<NonNullable<DashboardResponses['c2Tasks']>>(scoped('/api/c2/tasks?page=1&page_size=1')),
        get<NonNullable<DashboardResponses['projects']>>('/api/projects/dashboard-summary?fact_limit=10'),
        status ? get<NonNullable<DashboardResponses['filteredSeverity']>>(`/api/vulnerabilities/stats?status=${encodeURIComponent(status)}`) : Promise.resolve(null),
        get<NonNullable<DashboardResponses['tokens']>>(scoped('/api/usage/tokens?days=7&limit=20')),
      ]);
      return { tasks, vulnerabilities, batch, monitor, knowledge, skills, recentVulnerabilities, roles, agents,
        openCritical, openHigh, openMedium, openLow, tools, hitl, notifications, externalMcp, webshell,
        listeners, sessions, c2Tasks, projects, filteredSeverity, tokens };
    },
  };
}
