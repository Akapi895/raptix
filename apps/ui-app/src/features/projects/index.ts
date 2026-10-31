import { createProjectsService } from './service';
import { createProjectsView } from './view';
import type { ProjectsDependencies } from './types';

export type { ProjectsDependencies, ProjectTab, PickerConfig, PickerKey, Fact, FactInput, Approval, TaskSummary, Project, ProjectConversation } from './types';
export { createProjectsService, parseProjectsListResponse, matchProjectSearchQuery, sortProjectsForPicker, filterActiveProjectsLocal, type ProjectsService } from './service';
export { createProjectsApi, vulnerabilityItems, type ProjectsApi } from './client';
export { createProjectFoldersService, getProjectApprovalTiming, isHumanProjectPendingApproval, sortProjectFolderConversations } from './folder-service';
export { isSparseFactBody, requiresAttackChainFact } from './fact-body';
export function initProjects(document: Document, dependencies: ProjectsDependencies, service = createProjectsService()) {
  const view = createProjectsView(document, dependencies, service);
  return { ...view, service, getActiveProjectId: service.getActiveProjectId, setActiveProjectId: service.setActiveProjectId,
    getProjectName: service.getProjectName, ensureProjectsLoaded: service.ensureProjectsLoaded, isProjectsCacheReady: service.isProjectsCacheReady,
    ensureDefaultActiveProjectForNewChat: service.ensureDefaultActiveProjectForNewChat,
    fetchProjectsList: service.fetchProjectsList, fetchAllProjects: service.fetchAllProjects, fetchProjectSummary: service.fetchProjectSummary,
    searchActiveProjects: service.searchActiveProjects, rememberProjectsInNameMap: service.rememberProjectsInNameMap, rebuildProjectNameMap: service.rebuildProjectNameMap,
    projectNameById: service.names,
  };
}
export type ProjectsFeature = ReturnType<typeof initProjects>;
