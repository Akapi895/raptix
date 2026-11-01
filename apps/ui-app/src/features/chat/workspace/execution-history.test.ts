import { describe, expect, it, vi } from 'vitest';
import { createExecutionHistory } from './execution-history';

describe('execution history API reads', () => {
  it('reads every page using the payload-light process-details endpoint', async () => {
    const first = Array.from({ length: 200 }, () => ({ eventType: 'iteration' }));
    const get = vi.fn().mockResolvedValueOnce({ processDetails: first, hasMore: true }).mockResolvedValueOnce({ processDetails: [{ eventType: 'eino_agent_reply' }], hasMore: false });
    const history = createExecutionHistory(get);
    const messages = await history.hydrate('c1', [{ id: 'm1', role: 'assistant' }], true, () => true);
    expect(messages[0]?.processDetails).toHaveLength(201);
    expect(get.mock.calls.map(call => call[0])).toEqual([
      '/api/messages/m1/process-details?limit=200&offset=0',
      '/api/messages/m1/process-details?limit=200&offset=200',
    ]);
  });

  it('caches unchanged historical turns while refreshing active and changed turns', async () => {
    const get = vi.fn().mockResolvedValue({ processDetails: [], hasMore: false });
    const history = createExecutionHistory(get);
    const messages = [{ id: 'old', role: 'assistant', updatedAt: 'one' }, { id: 'latest', role: 'assistant', updatedAt: 'two' }];
    await history.hydrate('c1', messages, false, () => true);
    get.mockClear();
    await history.hydrate('c1', messages, false, () => true);
    expect(get).not.toHaveBeenCalled();
    await history.hydrate('c1', messages, true, () => true);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[0]).toContain('/latest/');
    get.mockClear();
    await history.hydrate('c1', [{ ...messages[0], updatedAt: 'changed' }], false, () => true);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
