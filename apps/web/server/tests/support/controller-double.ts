import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ControllerContainer { deploymentId: string; projectId: string; environmentId: string; role: string; generation: number; running: boolean }

export interface ControllerDouble {
  url: string;
  containers: Map<string, ControllerContainer>;
  /** Container keys that the double reports as still running after a stop. */
  stuck: Set<string>;
  /** Failures to return once, keyed by `op:role`. */
  injected: Map<string, { status: number; body: unknown }>;
  close(): Promise<void>;
}

/**
 * A stateful double of the host controller's six operations, on loopback. It answers with the same refusal codes
 * as apps/launcher/internal/environments and starts no containers.
 */
export async function startControllerDouble(token: string): Promise<ControllerDouble> {
  const containers = new Map<string, ControllerContainer>();
  const stuck = new Set<string>();
  const injected = new Map<string, { status: number; body: unknown }>();

  const reply = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  const handle = (request: IncomingMessage, response: ServerResponse, raw: string): void => {
    const op = (request.url ?? '').split('/').pop() ?? '';
    if (request.headers.authorization !== `Bearer ${token}`) return reply(response, 401, { error: 'unauthorized' });
    const { identity: id } = JSON.parse(raw) as { identity: ControllerContainer };
    const key = `${id.environmentId}:${id.role}`;
    const planned = injected.get(`${op}:${id.role}`);
    if (planned !== undefined) {
      injected.delete(`${op}:${id.role}`);
      return reply(response, planned.status, planned.body);
    }
    const existing = containers.get(key);
    const observation = (c: ControllerContainer | undefined) => c
      ? { name: key, exists: true, running: c.running, generation: c.generation }
      : { name: key, exists: false, running: false, generation: 0 };
    if (op === 'observe') return reply(response, 200, { status: 'ok', observation: observation(existing) });
    if (op === 'ensure') {
      if (existing) {
        if (existing.deploymentId !== id.deploymentId || existing.projectId !== id.projectId || existing.role !== id.role) return reply(response, 409, { error: 'foreign_resource' });
        if (existing.generation !== id.generation) return reply(response, 409, { error: 'generation_mismatch' });
        return reply(response, 200, { status: 'ok', observation: observation(existing) });
      }
      containers.set(key, { ...id, running: false });
      return reply(response, 200, { status: 'ok', observation: observation(containers.get(key)) });
    }
    if (existing === undefined) return reply(response, 404, { error: 'not_found' });
    if (op === 'start') {
      existing.running = true;
      return reply(response, 200, { status: 'ok', observation: observation(existing) });
    }
    if (op === 'stop') {
      if (stuck.has(key)) return reply(response, 409, { error: 'stop_uncertain' });
      existing.running = false;
      return reply(response, 200, { status: 'ok', observation: observation(existing) });
    }
    return reply(response, 422, { error: 'invalid_request' });
  };

  const server: Server = createServer((request, response) => {
    let raw = '';
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => handle(request, response, raw));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    containers,
    stuck,
    injected,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
