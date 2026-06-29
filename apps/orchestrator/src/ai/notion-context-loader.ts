export interface NotionLoaderConfig {
  timeoutMs?: number;
  maxResponseBytes?: number;
  tokenResolver: (secretRef: string) => Promise<string>;
}

export interface NotionLoaderInput {
  notionPageId: string;
  secretRef: string;
}

export interface NotionContextResult {
  success: boolean;
  content?: string;
  error?: {
    code: 'INVALID_PAGE_ID' | 'NOTION_API_ERROR' | 'TIMEOUT_EXCEEDED' | 'RESPONSE_TOO_LARGE' | 'NOT_FOUND' | 'MALFORMED_RESPONSE';
    message: string;
  };
}

interface NotionBlock {
  type?: string;
  paragraph?: {
    rich_text?: Array<{ plain_text?: string }>;
  };
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 500000;

export const NOTION_LOADER_ERRORS = {
  INVALID_PAGE_ID: 'The provided Notion Page ID is invalid or malformed.',
  NOT_FOUND: 'The requested Notion page was not found.',
  MALFORMED_RESPONSE_EMPTY: 'Response body is empty.',
  MALFORMED_RESPONSE_JSON: 'Failed to parse Notion API response as JSON.',
  MALFORMED_RESPONSE_ARRAY: 'Notion API response does not contain a valid results array.',
  UNKNOWN_NETWORK_ERROR: 'An unknown network error occurred.',
  TIMEOUT_EXCEEDED: (timeoutMs: number) => `The request timed out after ${timeoutMs}ms.`,
  RESPONSE_TOO_LARGE: (maxBytes: number) => `Response exceeded the maximum allowed size of ${maxBytes} bytes.`,
  NOTION_API_ERROR: (status: number, text: string) => `Notion API returned status ${status}: ${text}`
} as const;

async function readStreamSafe(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array[]> {
  const reader = body.getReader();
  let receivedBytes = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      receivedBytes += value.length;
      if (receivedBytes > maxBytes) {
        void reader.cancel();
        throw new Error('RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  }
  return chunks;
}

function extractTextFromRichText(richTextArray: unknown[]): string {
  let content = '';
  for (const textItem of richTextArray) {
    if (textItem && typeof textItem === 'object' && 'plain_text' in textItem) {
      const plainText = (textItem as Record<string, unknown>).plain_text;
      if (typeof plainText === 'string') {
        content += plainText;
      }
    }
  }
  return content;
}

function extractTextFromData(data: unknown): string | null {
  if (
    typeof data !== 'object' || 
    data === null || 
    !('results' in data) || 
    !Array.isArray((data as Record<string, unknown>).results)
  ) {
    return null;
  }

  let combinedContent = '';
  const results = (data as Record<string, unknown>).results as unknown[];
  
  for (const item of results) {
    const block = item as NotionBlock;
    if (block?.type === 'paragraph' && Array.isArray(block.paragraph?.rich_text)) {
      combinedContent += extractTextFromRichText(block.paragraph.rich_text);
      combinedContent += '\n\n';
    }
  }

  return combinedContent.trim();
}

function mapNetworkError(error: unknown, timeoutMs: number): NotionContextResult {
  if (error instanceof Error && error.name === 'AbortError') {
    return { success: false, error: { code: 'TIMEOUT_EXCEEDED', message: NOTION_LOADER_ERRORS.TIMEOUT_EXCEEDED(timeoutMs) } };
  }
  const message = error instanceof Error ? error.message : NOTION_LOADER_ERRORS.UNKNOWN_NETWORK_ERROR;
  return { success: false, error: { code: 'NOTION_API_ERROR', message } };
}

export async function loadNotionContext(
  input: NotionLoaderInput,
  config: NotionLoaderConfig
): Promise<NotionContextResult> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_BYTES;

  const pageIdRegex = /^[a-zA-Z0-9-]{32,36}$/;
  if (!pageIdRegex.test(input.notionPageId)) {
    return {
      success: false,
      error: { code: 'INVALID_PAGE_ID', message: NOTION_LOADER_ERRORS.INVALID_PAGE_ID }
    };
  }

  const url = `https://api.notion.com/v1/blocks/${input.notionPageId}/children`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => { controller.abort(); }, timeoutMs);

  try {
    const resolvedToken = await config.tokenResolver(input.secretRef);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${resolvedToken}`,
        'Notion-Version': '2022-06-28'
      },
      signal: controller.signal
    });

    if (response.status === 404) {
      clearTimeout(timeoutId);
      return { success: false, error: { code: 'NOT_FOUND', message: NOTION_LOADER_ERRORS.NOT_FOUND } };
    }

    if (!response.ok) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: { code: 'NOTION_API_ERROR', message: NOTION_LOADER_ERRORS.NOTION_API_ERROR(response.status, response.statusText) }
      };
    }

    if (!response.body) {
      clearTimeout(timeoutId);
      return { success: false, error: { code: 'MALFORMED_RESPONSE', message: NOTION_LOADER_ERRORS.MALFORMED_RESPONSE_EMPTY } };
    }

    let chunks: Uint8Array[];
    try {
      chunks = await readStreamSafe(response.body, maxResponseBytes);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.message === 'RESPONSE_TOO_LARGE') {
        return {
          success: false,
          error: { code: 'RESPONSE_TOO_LARGE', message: NOTION_LOADER_ERRORS.RESPONSE_TOO_LARGE(maxResponseBytes) }
        };
      }
      throw err;
    }
    
    clearTimeout(timeoutId);

    const textDecoder = new TextDecoder('utf-8');
    const rawText = chunks.map(chunk => textDecoder.decode(chunk, { stream: true })).join('') + textDecoder.decode();

    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { success: false, error: { code: 'MALFORMED_RESPONSE', message: NOTION_LOADER_ERRORS.MALFORMED_RESPONSE_JSON } };
    }

    const content = extractTextFromData(data);
    if (content === null) {
      return { success: false, error: { code: 'MALFORMED_RESPONSE', message: NOTION_LOADER_ERRORS.MALFORMED_RESPONSE_ARRAY } };
    }

    return { success: true, content };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    return mapNetworkError(error, timeoutMs);
  }
}
