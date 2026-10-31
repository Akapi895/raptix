import { describe, expect, it } from 'vitest';
import { shouldIgnoreLiveStreamEvent, ownsLiveStream } from '../live-stream';
import type { LiveChatStream } from '../types';
import { attachmentChipLabel, attachmentsProgress, withAttachmentNames, type ChatAttachment } from './attachments';
import { draftToStore, planDraftRestore } from './draft';
import {
  connectedExternalServers, filterMentionTools, insertMention, mentionAtCaret, mentionToolFromApi, toolKeyForMention, type MentionTool,
} from './mention-model';
import { buildChatRequestBody, isNetworkFailure, parseSseDataLine, readSseEvents } from './send';

const t = (_key: string, fallback: string) => fallback;

function attachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    id: 1, fileName: 'scan.txt', mimeType: 'text/plain', serverPath: null, uploading: false, uploadPercent: 0,
    uploadPromise: null, uploadError: null, ...overrides,
  };
}

function tool(overrides: Partial<MentionTool> & { name: string }): MentionTool {
  return { description: '', enabled: true, roleEnabled: true, isExternal: false, externalMcp: '', toolKey: overrides.name, ...overrides };
}

describe('draft', () => {
  it('stores the content as typed, but never an empty value or the placeholder', () => {
    expect(draftToStore('  hi ', '')).toBe('  hi ');
    expect(draftToStore('   ', '')).toBeNull();
    expect(draftToStore('Enter a target or command…  @ select tools', 'Enter a target or command…  @ select tools')).toBeNull();
  });

  it('restores a stored draft into an empty input, and drops a stored placeholder', () => {
    expect(planDraftRestore('', 'scan 10.0.0.1', '')).toEqual({ input: 'scan 10.0.0.1', restored: true, removeStored: false });
    expect(planDraftRestore('', 'PH', 'PH')).toEqual({ input: null, restored: false, removeStored: true });
  });

  it('keeps what the user already typed, and treats a placeholder sitting in the input as empty', () => {
    expect(planDraftRestore('typed', 'old', '')).toEqual({ input: null, restored: false, removeStored: false });
    expect(planDraftRestore('PH', null, 'PH')).toEqual({ input: '', restored: false, removeStored: false });
  });
});

describe('attachments', () => {
  it('labels a chip with its upload state', () => {
    expect(attachmentChipLabel(attachment({ uploading: true }), t)).toBe('scan.txt · Uploading…');
    expect(attachmentChipLabel(attachment({ uploadError: 'x' }), t)).toBe('scan.txt · Failed');
    expect(attachmentChipLabel(attachment(), t)).toBe('scan.txt');
  });

  it('averages the progress, counting a finished file as complete', () => {
    const list = [attachment({ uploading: true, uploadPercent: 40 }), attachment({ id: 2 })];
    expect(attachmentsProgress(list, t)).toMatchObject({ visible: true, percent: 70 });
    expect(attachmentsProgress([attachment()], t).visible).toBe(false);
  });

  it('lists the file names under the message the user sees', () => {
    expect(withAttachmentNames('look', [attachment(), attachment({ id: 2, fileName: 'b.log' })])).toBe('look\n📎 scan.txt\n📎 b.log');
    expect(withAttachmentNames('look', [])).toBe('look');
  });
});

describe('mention', () => {
  it('starts at an "@" after a boundary and follows the query up to the caret', () => {
    expect(mentionAtCaret('scan with @nm')).toEqual({ startIndex: 10, query: 'nm' });
    expect(mentionAtCaret('mail@host')).toBeNull();
    expect(mentionAtCaret('a @nm b')).toBeNull();
    expect(mentionAtCaret(`@${'x'.repeat(61)}`)).toBeNull();
  });

  it('filters by name, description and server, and puts enabled and exact matches first', () => {
    const tools = [
      tool({ name: 'nmap_scan', description: 'ports' }),
      tool({ name: 'http_probe', enabled: false, roleEnabled: false }),
      tool({ name: 'lab_lookup', isExternal: true, externalMcp: 'lab', toolKey: 'lab::lab_lookup' }),
    ];
    expect(filterMentionTools(tools, ['lab'], 'lab').map(item => item.name)).toEqual(['lab_lookup']);
    expect(filterMentionTools(tools, [], 'scan').map(item => item.name)).toEqual(['nmap_scan']);
    expect(filterMentionTools(tools, [], '').map(item => item.name)).toEqual(['lab_lookup', 'nmap_scan', 'http_probe']);
  });

  it('inserts the chosen tool and a space when nothing follows it', () => {
    expect(insertMention('scan @nm', 5, 8, 'nmap_scan')).toEqual({ value: 'scan @nmap_scan ', caret: 16 });
    expect(insertMention('@nm now', 0, 3, 'x')).toEqual({ value: '@x now', caret: 2 });
  });

  it('maps a tool from the API and keys external tools by their server', () => {
    expect(mentionToolFromApi({ name: 'lab_lookup', is_external: true, external_mcp: 'lab', enabled: true, role_enabled: false })).toMatchObject({
      toolKey: 'lab::lab_lookup', roleEnabled: false, enabled: true,
    });
    expect(mentionToolFromApi({})).toBeNull();
    expect(toolKeyForMention({ name: 'nmap' })).toBe('nmap');
  });

  it('offers only connected external servers that are turned on', () => {
    const servers = {
      lab: { status: 'connected', config: { enabled: true } },
      off: { status: 'connected', config: { enabled: true, disabled: true } },
      down: { status: 'error', config: { external_mcp_enable: true } },
      direct: { status: 'connected', config: { external_mcp_enable: true } },
    };
    expect(connectedExternalServers(servers)).toEqual(['lab', 'direct']);
  });
});

describe('sending', () => {
  const base = {
    message: 'hello', conversationId: null, role: '', activeProjectId: 'p1', aiChannelId: '',
    hitl: { mode: 'off', reviewer: 'human', sensitiveTools: '', timeoutSeconds: 300 }, attachments: [],
  };

  it('sends the project only for a new chat and the HITL block only when it is on', () => {
    expect(buildChatRequestBody(base)).toEqual({ message: 'hello', conversationId: null, role: '', projectId: 'p1' });
    const existing = buildChatRequestBody({ ...base, conversationId: 'c1' });
    expect(existing.projectId).toBeUndefined();
    const withHitl = buildChatRequestBody({ ...base, hitl: { mode: 'approval', reviewer: 'AI', sensitiveTools: 'a, b\nc', timeoutSeconds: 60 } });
    expect(withHitl.hitl).toEqual({ enabled: true, mode: 'approval', reviewer: 'audit_agent', sensitiveTools: ['a', 'b', 'c'], timeoutSeconds: 60 });
  });

  it('attaches the uploaded files by their server path', () => {
    const body = buildChatRequestBody({ ...base, attachments: [attachment({ serverPath: '/tmp/scan.txt', mimeType: '' })] });
    expect(body.attachments).toEqual([{ fileName: 'scan.txt', mimeType: '', serverPath: '/tmp/scan.txt' }]);
  });

  it('recognises a dropped connection by its message', () => {
    expect(isNetworkFailure('Failed to fetch')).toBe(true);
    expect(isNetworkFailure('\u8bf7\u6c42\u5931\u8d25: 500')).toBe(false);
  });

  it('parses data lines and ignores the rest', () => {
    expect(parseSseDataLine('data: {"type":"done"}')).toEqual({ event: { type: 'done' } });
    expect(parseSseDataLine('event: x')).toBeNull();
  });

  it('reads events across chunk boundaries, including the last unterminated line', async () => {
    const encoder = new TextEncoder();
    const chunks = ['data: {"type":"a"}\ndata: {"ty', 'pe":"b"}\n', 'data: {"type":"c"}'];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    });
    const seen: unknown[] = [];
    await readSseEvents(stream, event => { seen.push(event); });
    expect(seen).toEqual([{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
  });
});

describe('live stream ownership', () => {
  const stream = (over: Partial<LiveChatStream> = {}): LiveChatStream => ({
    active: true, conversationId: 'c1', progressId: 'p', abortController: new AbortController(), detached: false, navigationSeq: 2, ...over,
  });

  it('drops events of a stream that was replaced, ended, detached or navigated away from', () => {
    const live = stream();
    expect(shouldIgnoreLiveStreamEvent(live, live, 2)).toBe(false);
    expect(shouldIgnoreLiveStreamEvent(live, stream(), 2)).toBe(true);
    expect(shouldIgnoreLiveStreamEvent(live, live, 3)).toBe(true);
    expect(shouldIgnoreLiveStreamEvent({ ...live, detached: true }, { ...live, detached: true }, 2)).toBe(true);
    expect(ownsLiveStream(live, live)).toBe(true);
    expect(ownsLiveStream(null, null)).toBe(false);
  });
});
