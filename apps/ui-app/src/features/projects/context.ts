import type { ProjectsService } from './service';
import type { ProjectsDependencies } from './types';
import type { ProjectsDom } from './dom';

export interface ProjectsContext {
  service: ProjectsService; deps: ProjectsDependencies; dom: ProjectsDom;
  run(work: () => void | Promise<unknown>): void;
  reload(): Promise<void>;
  select(id: string): Promise<void>;
  refreshStats(): Promise<void>;
  refreshFacts(): Promise<void>;
  refreshGraph(): Promise<void>;
  refreshVulnerabilities(): Promise<void>;
  refreshFolders(): Promise<void>;
  refreshSelector(options?: { renderFolders?: boolean; reloadFolders?: boolean }): Promise<void>;
  applyChatProject(id: string): Promise<void>;
  closeChatPanel(): void;
  showEditProject(id: string, options?: { fromChatSidebar?: boolean }): Promise<void>;
  showEditFact(key: string): Promise<void>;
  showFact(key: string): Promise<void>;
  showNewFact(): void;
  openVulnerability(id: string): void;
  renderSidebar(): void;
}
