import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { loadNotionContext } from '../ai/notion-context-loader.js';

describe('NotionContextLoader', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  const createMockStream = (chunks: string[]) => {
    let index = 0;
    return {
      getReader: () => ({
        read: async () => {
          if (index < chunks.length) {
            return { done: false, value: new TextEncoder().encode(chunks[index++]) };
          }
          return { done: true, value: undefined };
        },
        cancel: () => {}
      })
    };
  };

  const dummyResolver = async (ref: string) => ref === 'secret_123' ? 'real_token_456' : 'invalid';

  test('should return combined text content for valid notion page ID', async () => {
    const validJson = JSON.stringify({
      results: [
        { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Hello ' }] } },
        { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'World' }] } },
        { type: 'unsupported' }
      ]
    });
    const mockResponse = {
      ok: true,
      status: 200,
      body: createMockStream([validJson])
    };
    
    mock.method(globalThis, 'fetch', async () => mockResponse);

    const result = await loadNotionContext({
      notionPageId: 'd65416c1-9dc5-46cb-84aa-8dbf84f22c55',
      secretRef: 'secret_123'
    }, { tokenResolver: dummyResolver });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.content?.trim(), 'Hello \n\nWorld');
    
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: Array<{ arguments: unknown[] }> } };
    const fetchCalls = fetchMock.mock.calls;
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].arguments[0], 'https://api.notion.com/v1/blocks/d65416c1-9dc5-46cb-84aa-8dbf84f22c55/children');
    assert.strictEqual((fetchCalls[0].arguments[1] as { headers?: Record<string, string> }).headers?.Authorization, 'Bearer real_token_456');
  });

  test('should reject malformed page ID with INVALID_PAGE_ID without fetching', async () => {
    mock.method(globalThis, 'fetch', async () => ({})); // Should not be called

    const result = await loadNotionContext({
      notionPageId: '../../../etc/passwd',
      secretRef: 'secret_123'
    }, { tokenResolver: dummyResolver });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, 'INVALID_PAGE_ID');
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: Array<{ arguments: unknown[] }> } };
    assert.strictEqual(fetchMock.mock.calls.length, 0);
  });

  test('should abort and return TIMEOUT_EXCEEDED if request takes longer than timeoutMs', async () => {
    mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
      return new Promise((resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
        setTimeout(() => { resolve({ ok: true }); }, 1000);
      });
    });

    const result = await loadNotionContext({
      notionPageId: 'd65416c1-9dc5-46cb-84aa-8dbf84f22c55',
      secretRef: 'secret_123'
    }, { timeoutMs: 10, tokenResolver: dummyResolver }); // very short timeout

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, 'TIMEOUT_EXCEEDED');
  });

  test('should return NOT_FOUND if Notion returns 404', async () => {
    mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404 }));

    const result = await loadNotionContext({
      notionPageId: 'd65416c1-9dc5-46cb-84aa-8dbf84f22c55',
      secretRef: 'secret_123'
    }, { tokenResolver: dummyResolver });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, 'NOT_FOUND');
  });

  test('should return NOTION_API_ERROR if API returns 401/403/500', async () => {
    mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' }));

    const result = await loadNotionContext({
      notionPageId: 'd65416c1-9dc5-46cb-84aa-8dbf84f22c55',
      secretRef: 'secret_123'
    }, { tokenResolver: dummyResolver });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, 'NOTION_API_ERROR');
    assert.ok(result.error?.message.includes('500'));
  });

  test('should return MALFORMED_RESPONSE if API returns invalid JSON', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      body: createMockStream(['{ invalid json '])
    }));

    const result = await loadNotionContext({
      notionPageId: 'd65416c1-9dc5-46cb-84aa-8dbf84f22c55',
      secretRef: 'secret_123'
    }, { tokenResolver: dummyResolver });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, 'MALFORMED_RESPONSE');
  });

  test('should return RESPONSE_TOO_LARGE if content exceeds threshold', async () => {
    const largeText = 'A'.repeat(600); // 600 bytes
    const validJson = JSON.stringify({
      results: [
        { type: 'paragraph', paragraph: { rich_text: [{ plain_text: largeText }] } }
      ]
    });
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      body: createMockStream([validJson])
    }));

    const result = await loadNotionContext({
      notionPageId: 'd65416c1-9dc5-46cb-84aa-8dbf84f22c55',
      secretRef: 'secret_123'
    }, { maxResponseBytes: 500, tokenResolver: dummyResolver }); // strict threshold 500 bytes

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, 'RESPONSE_TOO_LARGE');
  });
});
