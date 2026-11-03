/** Transport selection is owned by the backend configuration, never browser preferences. */
export function agentEndpoint(config: unknown, stream = true): string {
  const multi = config && typeof config === 'object' && 'multi_agent' in config ? config.multi_agent : undefined;
  const enabled = multi && typeof multi === 'object' && 'enabled' in multi && multi.enabled === true;
  return (enabled ? '/api/multi-agent' : '/api/eino-agent') + (stream ? '/stream' : '');
}

export async function resolveAgentEndpoint(request: (path: string, init?: RequestInit) => Promise<Response>, signal?: AbortSignal): Promise<string> {
  const response = await request('/api/config', { signal });
  if (!response.ok) throw new Error(`Failed to load agent configuration: HTTP ${response.status}`);
  return agentEndpoint(await response.json());
}
