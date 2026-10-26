import type { WebShellProbeState, WebShellProfile } from '@raptix/web-contracts';

const OUTPUT_LIMIT = 196608;
const ERROR_LIMIT = 2048;
const PROBE_STATES = new Set<WebShellProbeState>(['reachable', 'reachable_no_proof', 'unreachable', 'unknown']);
const COMMAND_STATES = new Set(['delivered', 'failed', 'uncertain']);

export interface RuntimeWebShellProbeResult {
  readonly state: WebShellProbeState;
  readonly httpStatus: number | null;
  readonly matched: boolean;
  readonly output: string;
  readonly outputTruncated: boolean;
  readonly error: string | null;
  readonly durationMs: number;
}

export interface RuntimeWebShellCommandResult {
  readonly state: 'delivered' | 'failed' | 'uncertain';
  readonly httpStatus: number | null;
  readonly exitCode: number | null;
  readonly output: string;
  readonly outputTruncated: boolean;
  readonly error: string | null;
  readonly durationMs: number;
}

export class RuntimeWebShellError extends Error {
  public constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class RuntimeWebShellUnavailableError extends RuntimeWebShellError {
  public constructor(message = 'The runtime did not answer the WebShell request.') {
    super(503, message);
  }
}

interface RuntimeRawResult {
  state?: unknown;
  http_status?: unknown;
  matched?: unknown;
  output?: unknown;
  output_truncated?: unknown;
  error?: unknown;
  duration_ms?: unknown;
}

function optionalText(value: unknown, limit: number): string | null {
  return typeof value === 'string' ? value.slice(0, limit) : null;
}

function httpStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function duration(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function output(value: unknown): { text: string; truncated: boolean } {
  if (typeof value !== 'string') return { text: '', truncated: false };
  return { text: value.slice(0, OUTPUT_LIMIT), truncated: value.length > OUTPUT_LIMIT };
}

function probeResult(raw: RuntimeRawResult): RuntimeWebShellProbeResult {
  const state = raw.state;
  if (typeof state !== 'string' || !PROBE_STATES.has(state as WebShellProbeState)) {
    throw new RuntimeWebShellError(502, 'The runtime returned an invalid WebShell probe state.');
  }
  const body = output(raw.output);
  return {
    state: state as WebShellProbeState,
    httpStatus: httpStatus(raw.http_status),
    matched: raw.matched === true,
    output: body.text,
    outputTruncated: raw.output_truncated === true || body.truncated,
    error: optionalText(raw.error, ERROR_LIMIT),
    durationMs: duration(raw.duration_ms),
  };
}

function commandResult(raw: RuntimeRawResult): RuntimeWebShellCommandResult {
  const state = raw.state;
  if (typeof state !== 'string' || !COMMAND_STATES.has(state)) {
    throw new RuntimeWebShellError(502, 'The runtime returned an invalid WebShell command state.');
  }
  const body = output(raw.output);
  return {
    state: state as RuntimeWebShellCommandResult['state'],
    httpStatus: httpStatus(raw.http_status),
    exitCode: null,
    output: body.text,
    outputTruncated: raw.output_truncated === true || body.truncated,
    error: optionalText(raw.error, ERROR_LIMIT),
    durationMs: duration(raw.duration_ms),
  };
}

function responseMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const detail = (value as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail.slice(0, 500);
  if (typeof detail === 'object' && detail !== null) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string') return message.slice(0, 500);
  }
  return fallback;
}

export interface RuntimeWebShellClientOptions {
  readonly runtimeApiUrl: string;
  readonly runtimeApiToken: string;
  readonly timeoutMs?: number;
}

export interface RuntimeSandboxRef {
  readonly url: string;
  readonly token: string;
}

export class RuntimeWebShellClient {
  private readonly timeoutMs: number;

  public constructor(private readonly options: RuntimeWebShellClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  public async probe(sandbox: RuntimeSandboxRef, profile: WebShellProfile, requestId: string): Promise<RuntimeWebShellProbeResult> {
    return probeResult(await this.call('/_raptix/webshell/probe', { sandbox_url: sandbox.url, sandbox_token: sandbox.token, request_id: requestId, profile }));
  }

  public async execute(sandbox: RuntimeSandboxRef, profile: WebShellProfile, requestId: string, command: string): Promise<RuntimeWebShellCommandResult> {
    return commandResult(await this.call('/_raptix/webshell/execute', { sandbox_url: sandbox.url, sandbox_token: sandbox.token, request_id: requestId, profile, command }));
  }

  private async call(path: string, body: Record<string, unknown>): Promise<RuntimeRawResult> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.options.runtimeApiUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.runtimeApiToken}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RuntimeWebShellUnavailableError();
    }
    if (!response.ok) {
      let parsed: unknown = null;
      try { parsed = await response.json(); } catch { /* non-JSON refusal body */ }
      const message = responseMessage(parsed, `The runtime refused the WebShell request (${response.status}).`);
      if (response.status === 503) throw new RuntimeWebShellUnavailableError(message);
      throw new RuntimeWebShellError(response.status, message);
    }
    try {
      return (await response.json()) as RuntimeRawResult;
    } catch {
      throw new RuntimeWebShellError(502, 'The runtime returned an unreadable WebShell response.');
    }
  }
}
