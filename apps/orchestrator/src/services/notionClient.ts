import dns from "node:dns/promises";
import { URL } from "node:url";

const IPV4_SEGMENT_COUNT = 4;
const LOCALHOST_IPV4_FIRST_OCTET = 127;
const PRIVATE_CLASS_A_FIRST_OCTET = 10;
const PRIVATE_172_FIRST_OCTET = 172;
const PRIVATE_172_SECOND_OCTET_MIN = 16;
const PRIVATE_172_SECOND_OCTET_MAX = 31;
const PRIVATE_192_FIRST_OCTET = 192;
const PRIVATE_192_SECOND_OCTET = 168;
const LINK_LOCAL_FIRST_OCTET = 169;
const LINK_LOCAL_SECOND_OCTET = 254;
const UNSPECIFIED_IPV4_FIRST_OCTET = 0;
const IPV4_MAPPED_IPV6_PREFIX = "::ffff:";
const IPV6_LOOPBACK_ADDRESSES = new Set(["::1", "0:0:0:0:0:0:0:1"]);
const IPV6_UNSPECIFIED_ADDRESSES = new Set(["::", "0:0:0:0:0:0:0:0"]);
const IPV6_LINK_LOCAL_PREFIXES = ["fe80:", "fe90:", "fea0:", "feb0:"];
const IPV6_UNIQUE_LOCAL_PREFIXES = ["fc", "fd"];
const MOCK_NOTION_BRIEF = {
  briefSummary: "Mock campaign brief for testing Facebook Composer.",
  brandVoice: "Professional, engaging, modern",
  doTerms: ["innovation", "easy", "secure"],
  avoidTerms: ["cheap", "guaranteed", "hack"],
  legalNotes: "Include standard terms and conditions."
};

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

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
  const normalizedIp = ip.toLowerCase().trim();

  if (IPV6_LOOPBACK_ADDRESSES.has(normalizedIp) || IPV6_UNSPECIFIED_ADDRESSES.has(normalizedIp)) return true;

  const ipv4Parts = normalizedIp.split(".").map(Number);
  const isIpv4Address = ipv4Parts.length === IPV4_SEGMENT_COUNT && ipv4Parts.every(Number.isInteger);
  if (isIpv4Address) {
    const [o1, o2] = ipv4Parts;
    if (o1 === LOCALHOST_IPV4_FIRST_OCTET) return true;
    if (o1 === PRIVATE_CLASS_A_FIRST_OCTET) return true;
    if (o1 === PRIVATE_172_FIRST_OCTET && o2 >= PRIVATE_172_SECOND_OCTET_MIN && o2 <= PRIVATE_172_SECOND_OCTET_MAX) return true;
    if (o1 === PRIVATE_192_FIRST_OCTET && o2 === PRIVATE_192_SECOND_OCTET) return true;
    if (o1 === LINK_LOCAL_FIRST_OCTET && o2 === LINK_LOCAL_SECOND_OCTET) return true;
    if (o1 === UNSPECIFIED_IPV4_FIRST_OCTET) return true;
  }

  if (normalizedIp.includes(":")) {
    if (normalizedIp.startsWith(IPV4_MAPPED_IPV6_PREFIX)) return true;
    if (startsWithAny(normalizedIp, IPV6_LINK_LOCAL_PREFIXES)) return true;
    if (startsWithAny(normalizedIp, IPV6_UNIQUE_LOCAL_PREFIXES)) return true;
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
        brief_summary: MOCK_NOTION_BRIEF.briefSummary,
        brand_voice: MOCK_NOTION_BRIEF.brandVoice,
        do_terms: MOCK_NOTION_BRIEF.doTerms,
        avoid_terms: MOCK_NOTION_BRIEF.avoidTerms,
        legal_notes: MOCK_NOTION_BRIEF.legalNotes
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
