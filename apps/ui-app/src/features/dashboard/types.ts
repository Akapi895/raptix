// Read-only projections of the Go responses used by this domain. JSON names are intentional.
// Sources: internal/handler/{monitor,notification,hitl,c2,knowledge,skills}.go,
// internal/database/{vulnerability,project_dashboard,model_token_usage,webshell}.go.
export const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = typeof severities[number];
export type Counts = Partial<Record<string, number>>;
export type SeverityStatus = '' | 'open' | 'confirmed' | 'fixed' | 'ignored' | 'false_positive';
export type FeedTab = 'vulns' | 'facts';
export type AccessTab = 'c2' | 'webshell';
export interface VulnerabilityStats { total: number; by_severity: Counts; by_status: Counts }
export interface RecentVulnerability { title: string; target: string; severity: string; status: string; created_at: string }
export interface VulnerabilityList { total: number; vulnerabilities: RecentVulnerability[] | null }
export interface ToolStats { toolName: string; totalCalls: number }
export interface MonitorStats {
  summary: { totalCalls: number; successCalls: number; failedCalls: number; blockedCalls: number; toolCount: number } | null;
  topTools: ToolStats[] | null;
}
export interface ProjectFact {
  id: string; project_id: string; project_name: string; fact_key: string; category: string;
  summary: string; confidence: string; pinned: boolean; updated_at: string;
}
export interface ProjectSummary { recent_facts: ProjectFact[] | null; totals: { active_projects: number; total_facts: number } }
export interface NotificationItem { id: string; level: string; type: string; title: string; desc: string; ts: string }
export interface NotificationSummary { items: NotificationItem[] | null }
export interface ExternalMcpStats { total: number; enabled: number; disabled: number; connected: number }
export interface WebshellConnection { id: string; url: string; remark: string; type: string; createdAt: string }
export interface TokenSummary {
  events: number; modelCalls: number; promptTokens: number; completionTokens: number;
  totalTokens: number; cacheWriteTokens: number; cachedTokens: number; reasoningTokens: number;
}
export interface TokenUsage { summary: TokenSummary | null }
export interface DashboardResponses {
  tasks: { tasks: unknown[] | null } | null;
  vulnerabilities: VulnerabilityStats | null;
  batch: { queues: { status: string }[] | null } | null;
  monitor: MonitorStats | null;
  knowledge: { enabled?: boolean; total_items: number } | null;
  skills: { total_skills: number } | null;
  recentVulnerabilities: VulnerabilityList | null;
  roles: { roles: unknown[] | null } | unknown[] | null;
  agents: { agents: unknown[] | null } | unknown[] | null;
  openCritical: Pick<VulnerabilityList, 'total'> | null;
  openHigh: Pick<VulnerabilityList, 'total'> | null;
  openMedium: Pick<VulnerabilityList, 'total'> | null;
  openLow: Pick<VulnerabilityList, 'total'> | null;
  tools: { total: number } | null;
  hitl: { items: unknown[] | null; total?: number } | unknown[] | null;
  notifications: NotificationSummary | null;
  externalMcp: ExternalMcpStats | null;
  webshell: WebshellConnection[] | { connections: WebshellConnection[] | null } | null;
  listeners: { listeners: { status: string }[] | null } | null;
  sessions: { sessions: { status: string }[] | null } | null;
  c2Tasks: { pending_queued_count: number } | null;
  projects: ProjectSummary | null;
  filteredSeverity: VulnerabilityStats | null;
  tokens: TokenUsage | null;
}
export interface AlertStats { criticalCount: number; hitlPending: number; failedTools: number; successRate: number; externalMcpDown: number }
export interface Resources { totalRunning: number; totalVulns: number; totalCalls: number; toolsConfigured: number; batchTotal: number }
export interface RecommendationStats extends Omit<AlertStats, 'criticalCount'> { openCriticalCount: number; toolsConfigured: number; totalVulns: number; totalRunning: number }
export interface AlertState { visible: boolean; level: 'danger' | 'warning' | 'info'; keys: string[]; fingerprint: string }
export interface DashboardModel {
  responses: DashboardResponses; status: SeverityStatus; updatedAt: number;
  running: number | null; batch: { pending: number; running: number; done: number; total: number } | null;
  open: Counts; severity: Counts; severityTotal: number; toolCount: number; totalCalls: number;
  successRate: number; failedTools: number; externalMcpDown: number; hitlPending: number;
  resources: Resources; recommendation: RecommendationStats; alertStats: AlertStats; alert: AlertState;
  events: NotificationItem[]; webshell: WebshellConnection[];
  risk: { score: number; level: 'safe' | 'low' | 'medium' | 'high' | 'severe' };
  resolution: { open: number; confirmed: number; fixed: number; fp: number; ignored: number; actionable: number; rate: number };
}
export interface DashboardDependencies {
  translate(key: string, options?: Record<string, string | number>): string;
  applyTranslations(root: HTMLElement): void;
  navigate(page: string): void;
  getActiveProjectId(): string;
  getLocale(): string;
  isC2Enabled(): boolean;
  openTokenUsage(): void;
  openNotifications(): void;
  initProjects(): Promise<void>;
  selectProject(id: string): Promise<void>;
  switchProjectTab(tab: 'facts'): void;
  viewProjectFact(key: string): void;
  showNewProjectModal(): void;
}
