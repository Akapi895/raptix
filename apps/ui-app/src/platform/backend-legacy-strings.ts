// String constants produced by the Go backend that the UI must still recognize.
// The backend (and historical rows in its database) still emits these Chinese
// literals, so matching on them is a data contract, not presentation text.
// Every literal is written with unicode escapes so no CJK characters appear in
// this repository; decode with e.g. JSON.parse('"' + literal + '"') when needed.
// Replace these matches with stable codes (error_code, role.is_default, ...)
// once the backend provides them - see ui-app/docs/english-only-plan.md.

/** Assistant placeholder persisted by the backend while a reply is streaming. */
export const BACKEND_PROCESSING_PLACEHOLDER = '\u5904\u7406\u4e2d...';

/** Prefix of the OpenAI failure messages reported by the backend. */
export const BACKEND_CALL_OPENAI_FAILED_PREFIX = '\u8c03\u7528OpenAI\u5931\u8d25:';

/** Prefix of the generic execution-failure messages reported by the backend. */
export const BACKEND_EXECUTE_FAILED_PREFIX = '\u6267\u884c\u5931\u8d25: ';

/** Marker the backend prepends to user follow-up messages after an interruption. */
export const BACKEND_INTERRUPT_CONTINUE_PREFIX = '\u3010\u7528\u6237\u8865\u5145 / \u4e2d\u65ad\u540e\u7ee7\u7eed\u3011';

/** Backend text for assistant replies where no output text was captured. */
export const BACKEND_NO_ASSISTANT_TEXT = '\u672a\u6355\u83b7\u5230\u52a9\u624b\u6587\u672c\u8f93\u51fa';

/** Fragment of the backend message confirming a task was queued (C2). */
export const BACKEND_QUEUED_FRAGMENT = '\u5165\u961f';

/** Name of the default role created by the backend. */
export const BACKEND_DEFAULT_ROLE = '\u9ed8\u8ba4';

/** Title the backend assigns to a freshly created AI channel. */
export const BACKEND_NEW_CHANNEL = '\u65b0\u901a\u9053';

/** Backend error shown when the knowledge base feature is disabled. */
export const BACKEND_KB_NOT_ENABLED = '\u77e5\u8bc6\u5e93\u529f\u80fd\u672a\u542f\u7528';
