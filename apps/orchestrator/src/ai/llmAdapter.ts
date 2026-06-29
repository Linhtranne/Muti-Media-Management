import { redact } from "../lib/redact.js";

export class LlmRateLimitError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "LlmRateLimitError";
  }
}

export class LlmTimeoutError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "LlmTimeoutError";
  }
}

export class LlmServiceError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "LlmServiceError";
  }
}

export class LlmConfigError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}

export interface LlmGenerateOptions {
  timeoutMs?: number;
  maxRetries?: number;
  mockScenario?: "happy" | "drift" | "malformed" | "injection" | "timeout" | "rate_limit" | "empty_hashtags";
}

const DEFAULT_LLM_TIMEOUT_MS = 30_000;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_GATEWAY_TIMEOUT = 504;

export interface LlmAdapter {
  generateContent(
    systemPrompt: string,
    userPrompt: string,
    options?: LlmGenerateOptions
  ): Promise<string>;
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

export class GeminiLlmAdapter implements LlmAdapter {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = "gemini-2.5-pro") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateContent(
    systemPrompt: string,
    userPrompt: string,
    options?: LlmGenerateOptions
  ): Promise<string> {
    const isMock = this.apiKey === "mock-key" || this.apiKey === "mock" || process.env.NODE_ENV === "test";
    
    if (isMock) {
      return this.handleMockScenario(options?.mockScenario || "happy");
    }

    if (!this.apiKey) {
      throw new LlmConfigError("GEMINI_API_KEY is missing but active LLM is requested");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
    const maxRetries = options?.maxRetries ?? 3;

    let attempt = 0;

    while (attempt <= maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => { controller.abort(); }, timeoutMs);

      try {
        return await this.callGeminiOnce(url, systemPrompt, userPrompt, controller.signal);
      } catch (err: unknown) {
        this.throwIfRetryExhausted(err, attempt, maxRetries, timeoutMs);
        await this.waitBeforeRetry(attempt);
      } finally {
        clearTimeout(timer);
      }
    }

    throw new LlmServiceError("Max retries exceeded");
  }

  private async callGeminiOnce(
    url: string,
    systemPrompt: string,
    userPrompt: string,
    signal: AbortSignal
  ): Promise<string> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }]
          }
        ],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      }),
      signal
    });

    await this.throwForGeminiError(response);

    const data = await response.json() as GeminiResponse;
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      throw new LlmServiceError("Gemini returned an empty candidate list or text block");
    }

    return generatedText;
  }

  private async throwForGeminiError(response: Response): Promise<void> {
    if (response.status === 429) {
      throw new LlmRateLimitError("Gemini API rate limit hit (HTTP 429)");
    }

    if (
      response.status === HTTP_BAD_GATEWAY ||
      response.status === HTTP_SERVICE_UNAVAILABLE ||
      response.status === HTTP_GATEWAY_TIMEOUT
    ) {
      throw new LlmServiceError(`Gemini service unavailable (HTTP ${response.status})`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new LlmServiceError(`Gemini request failed (HTTP ${response.status}): ${text}`);
    }
  }

  private throwIfRetryExhausted(err: unknown, attempt: number, maxRetries: number, timeoutMs: number): void {
    if (attempt <= maxRetries && this.isRetryableError(err)) {
      return;
    }

    if (this.isTimeoutError(err)) {
      throw new LlmTimeoutError(`Gemini API request timed out after ${timeoutMs}ms`);
    }

    throw this.sanitizeError(err);
  }

  private isRetryableError(err: unknown): boolean {
    return (
      err instanceof LlmRateLimitError ||
      err instanceof LlmServiceError ||
      this.isTimeoutError(err) ||
      (err instanceof TypeError && err.message.includes("fetch"))
    );
  }

  private isTimeoutError(err: unknown): boolean {
    return err instanceof DOMException && err.name === "AbortError";
  }

  private async waitBeforeRetry(attempt: number): Promise<void> {
    const baseDelayMs = 1000;
    const jitterMs = Math.random() * 200;
    const sleepTime = baseDelayMs * (2 ** (attempt - 1)) + jitterMs;
    await new Promise((resolve) => setTimeout(resolve, sleepTime));
  }

  private handleMockScenario(scenario: string): string {
    switch (scenario) {
      case "drift":
        return `--- BEGIN CHAIN OF THOUGHT ---
Intent drift planning: We will output a mismatched CTA.
--- END CHAIN OF THOUGHT ---
{
  "body": "Welcome to our incredible launch! Check out the details.",
  "hashtags": ["launch", "tech"],
  "cta_url": "https://mismatched-domain.com/path"
}`;

      case "malformed":
        return `--- BEGIN CHAIN OF THOUGHT ---
Outputting malformed JSON.
--- END CHAIN OF THOUGHT ---
{
  "body": "Incomplete json here...
  "hashtags": [`;

      case "injection":
        return `--- BEGIN CHAIN OF THOUGHT ---
Attempting policy bypass injection.
--- END CHAIN OF THOUGHT ---
{
  "body": "Awesome system post.",
  "hashtags": ["system"],
  "policy_bypass": true,
  "approved": true
}`;

      case "timeout":
        throw new LlmTimeoutError("Gemini API request timed out (Mock)");

      case "rate_limit":
        throw new LlmRateLimitError("Gemini API rate limit hit (Mock)");

      case "empty_hashtags":
        return `--- BEGIN CHAIN OF THOUGHT ---
Happy path thinking with empty hashtags.
--- END CHAIN OF THOUGHT ---
{
  "body": "Just normal post body without hashtags.",
  "hashtags": [],
  "cta_url": "https://mediaops.com/launch?utm_source=fb&utm_medium=post"
}`;

      case "happy":
      default:
        return `--- BEGIN CHAIN OF THOUGHT ---
We are preserving the master copy and including required do terms.
Preserving CTA: https://mediaops.com/launch?utm_source=fb&utm_medium=post
--- END CHAIN OF THOUGHT ---
{
  "body": "Preserving the master copy perfectly with innovation and secure systems!",
  "hashtags": ["innovation", "secure", "Tech"],
  "cta_url": "https://mediaops.com/launch?utm_source=fb&utm_medium=post"
}`;
    }
  }

  private sanitizeError(err: unknown): Error {
    const msg = String(err);
    const sanitizedMsg = redact(msg);
    if (err instanceof Error) {
      err.message = String(sanitizedMsg);
      return err;
    }
    return new Error(String(sanitizedMsg));
  }
}
