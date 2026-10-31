import { getPath, object, ROBOTS, setPath, splitList, strings, text, normalizeAIChannelProviderProfile, type AIChannel, type ConfigObject, type ModelScope, type RobotAuth } from './model';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Field = { id: string; path: string; fallback: string | number | boolean | string[]; kind: 'text' | 'int' | 'float' | 'check' | 'list' | 'comma'; min?: number; max?: number; choices?: string[] };
const s = (id: string, path: string, fallback = '', choices?: string[]): Field => ({ id, path, fallback, kind: 'text', choices });
const n = (id: string, path: string, fallback: number, min?: number, max?: number): Field => ({ id, path, fallback, kind: 'int', min, max });
const b = (id: string, path: string, fallback = false): Field => ({ id, path, fallback, kind: 'check' });
const l = (id: string, path: string, comma = false): Field => ({ id, path, fallback: [], kind: comma ? 'comma' : 'list' });

/** Exhaustive field inventory from settings.js; field paths use the public Go DTO. */
export const SETTINGS_FIELDS: readonly Field[] = [
  ...['fofa', 'zoomeye', 'quake', 'shodan'].flatMap(provider => [s(`${provider}-api-key`, `${provider}.api_key`), s(`${provider}-base-url`, `${provider}.base_url`)]),
  s('hitl-default-reviewer', 'hitl.default_reviewer', 'human', ['human', 'audit_agent']),
  s('hitl-audit-backend', 'hitl.audit_backend', 'openai', ['openai', 'typesafe']),
  s('hitl-audit-model-provider', 'hitl.audit_model.provider', '', ['', 'openai', 'claude']),
  s('hitl-audit-model-base-url', 'hitl.audit_model.base_url'), s('hitl-audit-model-api-key', 'hitl.audit_model.api_key'), s('hitl-audit-model-name', 'hitl.audit_model.model'),
  n('hitl-retention-days', 'hitl.retention_days', 90, 0), l('hitl-tool-whitelist', 'hitl.tool_whitelist'),
  s('hitl-audit-agent-prompt-settings', 'hitl.audit_agent_prompt'), s('hitl-audit-agent-prompt-review-edit-settings', 'hitl.audit_agent_prompt_review_edit'),
  n('agent-max-iterations', 'agent.max_iterations', 30, 1), n('agent-tool-wait-timeout-seconds', 'agent.tool_wait_timeout_seconds', 60, 0),
  n('agent-external-mcp-concurrency-server', 'agent.external_mcp_max_concurrent_per_server', 2, -1), n('agent-external-mcp-concurrency-total', 'agent.external_mcp_max_concurrent_total', 16, -1),
  n('agent-external-mcp-circuit-threshold', 'agent.external_mcp_circuit_failure_threshold', 3, -1), n('agent-external-mcp-circuit-cooldown', 'agent.external_mcp_circuit_cooldown_seconds', 60, 0),
  n('eino-model-retry-max-retries', 'multi_agent.model_retry_max_retries', 0, 0), n('eino-model-retry-max-backoff-sec', 'multi_agent.model_retry_max_backoff_sec', 0, 0),
  l('eino-model-failover-channels', 'multi_agent.model_failover_channels'), n('eino-model-failover-max-retries', 'multi_agent.model_failover_max_retries', 0, 0),
  n('summarization-user-ledger-max-runes', 'multi_agent.summarization_user_intent_ledger_max_runes', 96000, 0), n('summarization-user-ledger-entry-max-runes', 'multi_agent.summarization_user_intent_ledger_entry_max_runes', 16000, 0),
  n('latest-user-message-max-runes', 'multi_agent.latest_user_message_max_runes', 48000, 0), n('latest-user-message-head-runes', 'multi_agent.latest_user_message_head_runes', 24000, 0), n('latest-user-message-tail-runes', 'multi_agent.latest_user_message_tail_runes', 24000, 0),
  b('knowledge-enabled', 'knowledge.enabled', true), s('knowledge-base-path', 'knowledge.base_path', 'knowledge_base'),
  s('knowledge-embedding-provider', 'knowledge.embedding.provider', 'openai'), s('knowledge-embedding-model', 'knowledge.embedding.model'), s('knowledge-embedding-base-url', 'knowledge.embedding.base_url'), s('knowledge-embedding-api-key', 'knowledge.embedding.api_key'),
  n('knowledge-retrieval-top-k', 'knowledge.retrieval.top_k', 5, 1), { ...n('knowledge-retrieval-similarity-threshold', 'knowledge.retrieval.similarity_threshold', 0.7), kind: 'float' },
  s('knowledge-retrieval-sub-index-filter', 'knowledge.retrieval.sub_index_filter'), n('knowledge-multi-query-max-queries', 'knowledge.retrieval.multi_query.max_queries', 4, 1, 8),
  s('knowledge-rerank-provider', 'knowledge.retrieval.rerank.provider', '', ['', 'dashscope', 'cohere']), s('knowledge-rerank-model', 'knowledge.retrieval.rerank.model'), s('knowledge-rerank-base-url', 'knowledge.retrieval.rerank.base_url'), s('knowledge-rerank-api-key', 'knowledge.retrieval.rerank.api_key'),
  n('knowledge-post-retrieve-prefetch-top-k', 'knowledge.retrieval.post_retrieve.prefetch_top_k', 20, 0), n('knowledge-post-retrieve-max-chars', 'knowledge.retrieval.post_retrieve.max_context_chars', 0), n('knowledge-post-retrieve-max-tokens', 'knowledge.retrieval.post_retrieve.max_context_tokens', 0),
  s('knowledge-indexing-chunk-strategy', 'knowledge.indexing.chunk_strategy', 'markdown_then_recursive', ['markdown_then_recursive', 'recursive']),
  n('knowledge-indexing-request-timeout', 'knowledge.indexing.request_timeout_seconds', 120), n('knowledge-indexing-batch-size', 'knowledge.indexing.batch_size', 64), b('knowledge-indexing-prefer-source-file', 'knowledge.indexing.prefer_source_file'),
  l('knowledge-indexing-sub-indexes', 'knowledge.indexing.sub_indexes', true), n('knowledge-indexing-chunk-size', 'knowledge.indexing.chunk_size', 512), n('knowledge-indexing-chunk-overlap', 'knowledge.indexing.chunk_overlap', 50),
  n('knowledge-indexing-max-chunks-per-item', 'knowledge.indexing.max_chunks_per_item', 0), n('knowledge-indexing-max-rpm', 'knowledge.indexing.max_rpm', 0), n('knowledge-indexing-rate-limit-delay-ms', 'knowledge.indexing.rate_limit_delay_ms', 300),
  n('knowledge-indexing-max-retries', 'knowledge.indexing.max_retries', 3), n('knowledge-indexing-retry-delay-ms', 'knowledge.indexing.retry_delay_ms', 1000),
  b('c2-enabled', 'c2.enabled', true),
  b('vision-enabled', 'vision.enabled'), s('vision-provider', 'vision.provider'), s('vision-api-key', 'vision.api_key'), s('vision-base-url', 'vision.base_url'), s('vision-model', 'vision.model'),
  n('vision-max-image-bytes', 'vision.max_image_bytes', 5242880), n('vision-max-dimension', 'vision.max_dimension', 2048), n('vision-jpeg-quality', 'vision.jpeg_quality', 82), n('vision-max-payload-bytes', 'vision.max_payload_bytes', 524288),
  n('vision-skip-preprocess-bytes', 'vision.skip_preprocess_below_bytes', 2097152), n('vision-timeout-seconds', 'vision.timeout_seconds', 60), s('vision-detail', 'vision.detail', 'low', ['low', 'auto', 'high']),
  ...ROBOTS.map(type => b(`robot-${type}-enabled`, `robots.${type}.enabled`)),
  s('robot-wechat-base-url', 'robots.wechat.base_url', 'https://ilinkai.weixin.qq.com'), s('robot-wechat-bot-type', 'robots.wechat.bot_type', '3'), s('robot-wechat-bot-agent', 'robots.wechat.bot_agent', 'Raptix/1.0'), s('robot-wechat-ilink-bot-id', 'robots.wechat.ilink_bot_id'),
  s('robot-wecom-token', 'robots.wecom.token'), s('robot-wecom-encoding-aes-key', 'robots.wecom.encoding_aes_key'), s('robot-wecom-corp-id', 'robots.wecom.corp_id'), s('robot-wecom-secret', 'robots.wecom.secret'), n('robot-wecom-agent-id', 'robots.wecom.agent_id', 0),
  s('robot-dingtalk-client-id', 'robots.dingtalk.client_id'), s('robot-dingtalk-client-secret', 'robots.dingtalk.client_secret'),
  s('robot-lark-app-id', 'robots.lark.app_id'), s('robot-lark-app-secret', 'robots.lark.app_secret'), s('robot-lark-verify-token', 'robots.lark.verify_token'),
  s('robot-telegram-bot-token', 'robots.telegram.bot_token'), s('robot-telegram-bot-username', 'robots.telegram.bot_username'), b('robot-telegram-allow-group', 'robots.telegram.allow_group_messages'),
  s('robot-slack-bot-token', 'robots.slack.bot_token'), s('robot-slack-app-token', 'robots.slack.app_token'), s('robot-discord-bot-token', 'robots.discord.bot_token'), b('robot-discord-allow-guild', 'robots.discord.allow_guild_messages'),
  s('robot-qq-app-id', 'robots.qq.app_id'), s('robot-qq-client-secret', 'robots.qq.client_secret'), b('robot-qq-sandbox', 'robots.qq.sandbox'),
];
const channelFields: readonly Field[] = [
  s('ai-channel-name', 'name'), s('openai-provider', 'provider', 'openai_compatible'), s('openai-api-key', 'api_key'), s('openai-base-url', 'base_url'), s('openai-model', 'model'),
  n('openai-max-total-tokens', 'max_total_tokens', 120000), n('openai-max-completion-tokens', 'max_completion_tokens', 32768),
  s('openai-reasoning-mode', 'reasoning.mode', 'auto', ['auto', 'on', 'off']), s('openai-reasoning-effort', 'reasoning.effort', '', ['', 'low', 'medium', 'high', 'max', 'xhigh']),
  s('openai-reasoning-profile', 'reasoning.profile', 'auto', ['auto', 'deepseek', 'deepseek_compat', 'openai_compat', 'output_config_effort']), b('openai-reasoning-allow-client', 'reasoning.allow_client_reasoning', true),
];
export const MODEL_IDS: Record<ModelScope, { selectId: string; inputId: string; providerId: string; keyId: string; baseId: string; buttonId: string; resultId: string; hintId: string }> = {
  openai: { selectId: 'openai-model-select', inputId: 'openai-model', providerId: 'openai-provider', keyId: 'openai-api-key', baseId: 'openai-base-url', buttonId: 'fetch-openai-models-btn', resultId: 'fetch-openai-models-result', hintId: 'fetch-openai-models-hint' },
  vision: { selectId: 'vision-model-select', inputId: 'vision-model', providerId: 'vision-provider', keyId: 'vision-api-key', baseId: 'vision-base-url', buttonId: 'fetch-vision-models-btn', resultId: 'fetch-vision-models-result', hintId: 'fetch-vision-models-hint' },
  hitlAudit: { selectId: 'hitl-audit-model-select', inputId: 'hitl-audit-model-name', providerId: 'hitl-audit-model-provider', keyId: 'hitl-audit-model-api-key', baseId: 'hitl-audit-model-base-url', buttonId: 'fetch-hitl-audit-models-btn', resultId: 'fetch-hitl-audit-models-result', hintId: 'fetch-hitl-audit-models-hint' },
  knowledgeEmbedding: { selectId: 'knowledge-embedding-model-select', inputId: 'knowledge-embedding-model', providerId: 'knowledge-embedding-provider', keyId: 'knowledge-embedding-api-key', baseId: 'knowledge-embedding-base-url', buttonId: 'fetch-knowledge-embedding-models-btn', resultId: 'fetch-knowledge-embedding-models-result', hintId: 'fetch-knowledge-embedding-models-hint' },
};
export function createSettingsForms(doc: Document) {
  const control = (id: string): Control | null => { const element = doc.getElementById(id); return element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ? element : null; };
  const value = (id: string) => control(id)?.value.trim() || '';
  const checked = (id: string) => (control(id) as HTMLInputElement | null)?.checked === true;
  const writeValue = (id: string, val: unknown) => { const el = control(id); if (el) el.value = text(val); };
  function fill(fields: readonly Field[], source: ConfigObject) {
    for (const field of fields) {
      const el = control(field.id); if (!el) continue;
      let raw = getPath(source, field.path); if (raw === undefined || raw === null) raw = field.fallback;
      if (field.id === 'hitl-audit-backend' && raw === 'jev') raw = 'typesafe';
      if (field.id === 'openai-provider' && raw === 'openai') raw = 'openai_compatible';
      if (field.choices && !field.choices.includes(text(raw).toLowerCase())) raw = field.fallback;
      else if (field.choices) raw = text(raw).toLowerCase();
      if (field.kind === 'check' && el instanceof HTMLInputElement) el.checked = raw === true;
      else if (field.kind === 'list' || field.kind === 'comma') el.value = Array.isArray(raw) ? strings(raw).join(field.kind === 'comma' ? ', ' : '\n') : text(raw);
      else el.value = text(raw);
    }
  }
  function read(fields: readonly Field[], previous: ConfigObject): ConfigObject {
    const out = structuredClone(previous);
    for (const field of fields) {
      const el = control(field.id); if (!el) continue;
      let raw: unknown = el.value.trim();
      if (field.kind === 'check') raw = el instanceof HTMLInputElement && el.checked;
      else if (field.kind === 'list' || field.kind === 'comma') raw = splitList(el.value);
      else if (field.kind === 'int' || field.kind === 'float') {
        let number = field.kind === 'int' ? Number.parseInt(el.value, 10) : Number.parseFloat(el.value);
        if (!Number.isFinite(number)) number = Number(field.fallback);
        if (field.min !== undefined) number = Math.max(field.min, number);
        if (field.max !== undefined) number = Math.min(field.max, number);
        raw = number;
      } else if (!raw && field.fallback) raw = field.fallback;
      setPath(out, field.path, raw);
    }
    return out;
  }
  function collect(previous: ConfigObject) {
    const owned: ConfigObject = {};
    for (const key of ['vision', 'fofa', 'zoomeye', 'quake', 'shodan', 'hitl', 'agent', 'multi_agent', 'knowledge', 'c2', 'robots']) owned[key] = object(previous[key]);
    const result = read(SETTINGS_FIELDS, owned);
    return result;
  }
  function readAuth(): RobotAuth {
    if (value('robot-auth-mode') !== 'service_account') return { mode: 'user_binding' };
    return { mode: 'service_account', service_user_id: value('robot-service-user-id'), allowed_external_users: splitList(value('robot-allowed-external-users')) };
  }
  function fillAuth(auth: ConfigObject | RobotAuth) {
    writeValue('robot-auth-mode', auth.mode === 'service_account' ? 'service_account' : 'user_binding'); writeValue('robot-service-user-id', auth.service_user_id); writeValue('robot-allowed-external-users', strings(auth.allowed_external_users).join('\n'));
  }
  return { control, value, checked, writeValue, fill: (source: ConfigObject) => fill(SETTINGS_FIELDS, source), collect,
    fillVision: (source: ConfigObject) => fill(SETTINGS_FIELDS.filter(field => field.path.startsWith('vision.')), { vision: source }),
    readVision: () => object(collect({}).vision),
    fillChannel(channel: AIChannel, id: string) { fill(channelFields, { ...channel, name: channel.name || id }); },
    readChannel(previous: AIChannel, id: string): AIChannel { const result = read(channelFields, previous) as AIChannel; result.name ||= previous.name || id; return normalizeAIChannelProviderProfile(result); },
    readAuth, fillAuth,
    credentials(scope: ModelScope) {
      const ids = MODEL_IDS[scope]; return { provider: value(ids.providerId) || value('openai-provider') || 'openai', base_url: value(ids.baseId) || value('openai-base-url'), api_key: value(ids.keyId) || value('openai-api-key') };
    },
  };
}
export type SettingsForms = ReturnType<typeof createSettingsForms>;
