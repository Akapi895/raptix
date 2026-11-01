export interface WorkspaceFile {
  name?: string;
  relativePath?: string;
  source?: string;
  size?: number;
  subPath?: string;
  conversationId?: string;
}

const INTERNAL = /(^|\/)(\.[^/]+|node_modules|__pycache__|venv|env|dist|build|coverage|cache|tmp|reduction)(\/|$)|\.(pyc|lock|log)$/i;
export function isWorkspaceFile(file: WorkspaceFile): boolean {
  return file.source === 'workspace' || !!file.relativePath?.startsWith('__workspace__/');
}
export function artifactGroup(file: WorkspaceFile): 'Reports' | 'Evidence' | 'Scan results' | 'Files' | null {
  const path = [file.subPath, file.name || file.relativePath?.split('/').pop()].filter(Boolean).join('/');
  if (file.source === 'reduction' || file.relativePath?.startsWith('__reduction__/') || INTERNAL.test(path)) return null;
  if (/report|findings|assessment|summary|\.pdf$|\.docx$/i.test(path)) return 'Reports';
  if (/evidence|screenshot|capture|\.png$|\.jpe?g$|\.webp$|\.pcap(?:ng)?$|\.har$/i.test(path)) return 'Evidence';
  if (/scan|nmap|nuclei|results?|\.sarif$|\.nessus$|\.xml$|\.csv$/i.test(path)) return 'Scan results';
  // Sandbox source/configuration files belong in the optional browser, not the output list.
  if (isWorkspaceFile(file) && !/\.(md|txt|json|html|zip)$/i.test(path)) return null;
  return 'Files';
}
export function canPreview(file: WorkspaceFile): boolean {
  return !!file.relativePath && (file.size == null || file.size <= 2 * 1024 * 1024) && /\.(md|txt|json|jsonl|xml|csv|tsv|yaml|yml|html|sarif|nmap|log)$/i.test(file.name || file.relativePath);
}
