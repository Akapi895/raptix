import type { GraphNode } from './types';

export function resolveGraphNodeType(node: GraphNode): string {
  const key = (node.fact_key || node.id).toLowerCase();
  if (key.startsWith('vuln:')) return 'vulnerability';
  const category = node.category.toLowerCase();
  if (category) return category === 'vuln' ? 'vulnerability' : category;
  const type = node.type.toLowerCase();
  if (type) return type === 'vuln' ? 'vulnerability' : type;
  for (const prefix of ['target', 'exploit', 'poc', 'chain', 'finding', 'auth']) {
    if (key.startsWith(`${prefix}/`)) return prefix;
  }
  if (key.startsWith('evidence/')) return 'exploit';
  if (key.startsWith('infra/') || key.startsWith('business/')) return 'infra';
  return 'note';
}

export function pathGraphNodeLayer(type: string, factKey: string): string {
  if (factKey.toLowerCase().startsWith('vuln:')) return '4';
  if (type === 'target') return '0';
  if (['infra', 'auth', 'business'].includes(type)) return '1';
  if (['exploit', 'poc', 'vulnerability', 'vuln'].includes(type)) return '3';
  return '2';
}
