const REQUEST_TIMEOUT_MS = 120_000;

/** The configured model could not be reached, or no model is configured (503). */
export class LlmUnavailableError extends Error {
  public readonly statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

/** The model answered with something that is not the requested JSON (502). */
export class LlmBadResponseError extends Error {
  public readonly statusCode = 502;
  constructor(message: string) {
    super(message);
    this.name = "LlmBadResponseError";
  }
}

export interface LlmChannelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface LlmClient {
  complete(config: LlmChannelConfig, system: string, user: string, maxTokens: number): Promise<string>;
}

/**
 * OpenAI-compatible chat-completions client, same transport the config
 * routes' connection tests already use (config.routes.ts): POST
 * {base_url}/chat/completions with a bearer key. The key stays in this
 * process; it is never logged or returned.
 */
export class OpenAiCompatibleLlmClient implements LlmClient {
  public constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
  ) {}

  public async complete(config: LlmChannelConfig, system: string, user: string, maxTokens: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new LlmUnavailableError(`The configured model is unreachable: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } | string };
      const detail = typeof body.error === "string" ? body.error : body.error?.message;
      throw new LlmUnavailableError(`The configured model rejected the request (HTTP ${response.status}${detail ? `: ${detail}` : ""})`);
    }
    const parsed = (await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new LlmBadResponseError("The configured model returned no text content");
    }
    return content;
  }
}

/** Used when the "ai" config has no usable channel -- chain derivation fails 503 with a config hint instead of a fabricated chain. */
export class UnconfiguredLlmClient implements LlmClient {
  public complete(): Promise<string> {
    return Promise.reject(
      new LlmUnavailableError("No AI channel is configured (Settings > AI: base_url, api_key and model are required for chain derivation)."),
    );
  }
}
