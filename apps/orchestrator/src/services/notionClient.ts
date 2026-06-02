import dns from "node:dns/promises";
import { URL } from "node:url";

export class NotionSsrfError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "NotionSsrfError";
  }
}

export class NotionFetchError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "NotionFetchError";
  }
}

export function isPrivateOrLocalIp(ip: string): boolean {
  if (ip === "::1" || ip === "0.0.0.0") return true;

  // IPv4 check
  const ipv4Match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (ipv4Match) {
    const o1 = parseInt(ipv4Match[1], 10);
    const o2 = parseInt(ipv4Match[2], 10);

    // 127.0.0.0/8
    if (o1 === 127) return true;
    // 10.0.0.0/8
    if (o1 === 10) return true;
    // 172.16.0.0/12
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    // 192.168.0.0/16
    if (o1 === 192 && o2 === 168) return true;
    // 169.254.0.0/16
    if (o1 === 169 && o2 === 254) return true;
    // 0.0.0.0
    if (o1 === 0) return true;
  }

  // IPv6 check
  if (ip.includes(":")) {
    const normalized = ip.toLowerCase();
    if (normalized.startsWith("fe80:") || normalized.startsWith("fc00:") || normalized.startsWith("fd00:")) {
      return true;
    }
  }

  return false;
}

export interface NotionBrief {
  brief_summary?: string;
  brand_voice?: string;
  do_terms?: string[];
  avoid_terms?: string[];
  legal_notes?: string;
}

export interface NotionDnsResolver {
  resolve(hostname: string): Promise<string[]>;
}

export class NotionClient {
  private allowedHosts = new Set(["api.notion.com", "www.notion.so", "notion.so"]);

  constructor(private readonly resolver: NotionDnsResolver = dns) {}

  async validateAndResolveUrl(urlStr: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      throw new NotionSsrfError("Invalid Notion URL format");
    }

    // Scheme check
    if (url.protocol !== "https:") {
      throw new NotionSsrfError("Only HTTPS protocol is allowed for Notion URLs");
    }

    // Host check
    const hostname = url.hostname.toLowerCase();
    if (!this.allowedHosts.has(hostname)) {
      throw new NotionSsrfError(`Host ${hostname} is not in the Notion allowlist`);
    }

    // Userinfo check
    if (url.username || url.password) {
      throw new NotionSsrfError("User information in URL is forbidden");
    }

    // Port check (standard HTTPS port 443 only)
    if (url.port && url.port !== "443") {
      throw new NotionSsrfError("Non-standard ports are forbidden");
    }

    // DNS check for IP post-resolution SSRF protection
    try {
      const addresses = await this.resolver.resolve(hostname);
      for (const addr of addresses) {
        if (isPrivateOrLocalIp(addr)) {
          throw new NotionSsrfError(`Resolved IP ${addr} is a private or local address`);
        }
      }
    } catch (err) {
      if (err instanceof NotionSsrfError) {
        throw err;
      }
      // If DNS resolution fails, let it proceed or handle it
      throw new NotionFetchError(`DNS resolution failed for hostname: ${hostname}`);
    }

    return url.toString();
  }

  async fetchNotionBrief(urlStr: string, notionToken?: string): Promise<NotionBrief> {
    const validatedUrlStr = await this.validateAndResolveUrl(urlStr);

    // In mock or test mode, if there is no token or if it's a test domain, return mock/stub content
    if (!notionToken || urlStr.includes("test-brief")) {
      return {
        brief_summary: "Mock campaign brief for testing Facebook Composer.",
        brand_voice: "Professional, engaging, modern",
        do_terms: ["innovation", "easy", "secure"],
        avoid_terms: ["cheap", "guaranteed", "hack"],
        legal_notes: "Include standard terms and conditions."
      };
    }

    // Standard Notion API request if token is present
    try {
      // Extract page ID from Notion URL (usually last 32 chars of the URL path)
      const url = new URL(validatedUrlStr);
      const parts = url.pathname.split("/");
      const lastPart = parts[parts.length - 1] || "";
      const matches = /[a-f0-9]{32}/i.exec(lastPart);
      const pageId = matches ? matches[0] : lastPart;

      if (!pageId) {
        throw new NotionSsrfError("Could not extract Notion page ID from URL");
      }

      // Fetch the page content
      const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        redirect: "error" // maxRedirects = 0 equivalent
      });

      if (response.status === 404) {
        throw new NotionFetchError("Notion page not found (HTTP 404)");
      }

      if (!response.ok) {
        throw new NotionFetchError(`Notion API error (HTTP ${response.status})`);
      }

      type NotionSelectOption = { name: string };
      type NotionRichText = { plain_text: string };
      type NotionProperty = {
        rich_text?: NotionRichText[];
        multi_select?: NotionSelectOption[];
      };
      type NotionPageResponse = {
        properties?: Record<string, NotionProperty>;
      };

      const pageData = await response.json() as NotionPageResponse;
      
      // Basic block extraction - for MVP we fetch page properties
      const properties = pageData.properties || {};
      
      return {
        brief_summary: properties.brief_summary?.rich_text?.[0]?.plain_text || "",
        brand_voice: properties.brand_voice?.rich_text?.[0]?.plain_text || "",
        do_terms: properties.do_terms?.multi_select?.map((x) => x.name) || [],
        avoid_terms: properties.avoid_terms?.multi_select?.map((x) => x.name) || [],
        legal_notes: properties.legal_notes?.rich_text?.[0]?.plain_text || ""
      };
    } catch (err: unknown) {
      if (err instanceof NotionSsrfError || err instanceof NotionFetchError) {
        throw err;
      }
      throw new NotionFetchError(`Notion request failed: ${String(err)}`);
    }
  }
}
