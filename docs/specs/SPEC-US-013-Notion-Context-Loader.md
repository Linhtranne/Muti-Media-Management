# SPEC-US-013: Notion Campaign Brief Context Loader

**Status:** Approved
**Owner:** AI Orchestrator
**Target:** Pilot AI-SDLC

## 1. Goal
Xây dựng một module `NotionContextLoader` đóng vai trò nạp ngữ cảnh (campaign guidelines/briefs) từ Notion một cách an toàn. Module này cung cấp đầu vào chuẩn hóa cho AI Composer (US-003) và tuân thủ nghiêm ngặt các quy tắc bảo mật của hệ thống.

## 2. In Scope / Out of Scope

**In Scope:**
- Nhận đầu vào là Notion Page ID chuẩn.
- Giao tiếp với API chính thức của Notion qua `api.notion.com`.
- Áp dụng timeout và giới hạn dung lượng tải về (max response size).
- Xử lý lỗi HTTP (404, 5xx), timeouts, response bị lỗi định dạng (malformed) và trả về error metadata chuẩn hóa.

**Out of Scope:**
- Không nhận URL tự do để tránh hoàn toàn rủi ro SSRF / Open Redirect.
- Không tích hợp với Database (Ledger) ở tầng này.
- Không chịu trách nhiệm fallback nếu file Notion lỗi (do layer khác xử lý).
- Không tự giải quyết việc phân giải DNS vì domain được fix cứng là `api.notion.com`.

## 3. API / Function Contract

**Interface Input:**
```typescript
export interface NotionLoaderConfig {
  tokenResolver: (secretRef: string) => Promise<string>; // required injected resolver
  timeoutMs?: number; // default: 5000
  maxResponseBytes?: number; // default: 500000 (500KB)
}

export interface NotionLoaderInput {
  notionPageId: string; // Bắt buộc là định dạng UUID (có hoặc không có dấu gạch ngang)
  secretRef: string;    // Bắt buộc để authenticate với Notion API
}
```

**Interface Output:**
```typescript
export interface NotionContextResult {
  success: boolean;
  content?: string; // Text content if success
  error?: {
    code: 'INVALID_PAGE_ID' | 'NOTION_API_ERROR' | 'TIMEOUT_EXCEEDED' | 'RESPONSE_TOO_LARGE' | 'NOT_FOUND' | 'MALFORMED_RESPONSE';
    message: string;
  };
}
```

**Function Signature:**
```typescript
export async function loadNotionContext(input: NotionLoaderInput, config: NotionLoaderConfig): Promise<NotionContextResult>;
```

## 4. Security Rules
- **No Free URL / Anti-SSRF:** Không cho phép truyền URL từ bên ngoài. Mọi request phải được hardcode ghép chuỗi bắt đầu bằng `https://api.notion.com/v1/blocks/${pageId}/children`.
- **Page ID Validation:** `notionPageId` phải được validate qua Regex để đảm bảo chỉ chứa ký tự alphanumeric/dash (chống path traversal injection).
- **Timeout:** Bắt buộc áp dụng timeout để tránh treo (hang) process của worker.
- **Max Response Size:** Giới hạn body size đọc về (ví dụ 500KB) bằng streaming/buffer chunk để chống tấn công DoS/OOM.
- **No Credentials in Logs:** Tuyệt đối không được log raw `secretRef` hoặc Header chứa token ra stdout / file log.

## 5. Error Cases
- `INVALID_PAGE_ID`: `notionPageId` truyền vào không đúng định dạng an toàn.
- `TIMEOUT_EXCEEDED`: Việc fetch hoặc đọc dữ liệu vượt quá thời gian timeout.
- `RESPONSE_TOO_LARGE`: Tổng dữ liệu vượt ngưỡng `maxResponseBytes`.
- `NOT_FOUND`: HTTP 404 từ Notion API.
- `NOTION_API_ERROR`: Các lỗi 401, 403, 5xx từ máy chủ Notion.
- `MALFORMED_RESPONSE`: API trả về HTTP 200 nhưng không thể parse JSON hoặc sai cấu trúc API của Notion.

## 6. Acceptance Criteria (Given/When/Then)

**AC1: Chặn đầu vào không hợp lệ**
- *Given* một `notionPageId` chứa ký tự lạ (e.g. `../../../etc/passwd`)
- *When* hàm `loadNotionContext` được gọi
- *Then* hàm trả về `success: false` với error code `INVALID_PAGE_ID` và không có request nào được gửi.

**AC2: Giới hạn dung lượng tải về**
- *Given* một Page ID hợp lệ nhưng response body từ API cực lớn (> 500KB)
- *When* module bắt đầu nhận stream data
- *Then* tiến trình bị ngắt ngay khi nhận chunk vượt ngưỡng, trả về lỗi `RESPONSE_TOO_LARGE`.

**AC3: Giới hạn thời gian tải**
- *Given* một Page ID hợp lệ nhưng `api.notion.com` bị treo không phản hồi trong 5 giây
- *When* hàm `loadNotionContext` được gọi
- *Then* request bị abort, hàm trả về lỗi `TIMEOUT_EXCEEDED`.

**AC4: Xử lý dữ liệu rác (Malformed)**
- *Given* một Page ID hợp lệ nhưng server trả về một trang HTML thay vì JSON
- *When* hàm `loadNotionContext` được gọi
- *Then* hàm catch lỗi parse và trả về `MALFORMED_RESPONSE`.

**AC5: Nạp thành công trang hợp lệ**
- *Given* một Page ID hợp lệ và `secretRef` có quyền truy cập
- *When* hàm `loadNotionContext` được gọi (Notion API trả về JSON chứa block text)
- *Then* hàm bóc tách text và trả về `success: true` với trường `content` chứa text.

## 7. Test Cases (L2 Validation)
1. `should return combined text content for valid notion page ID`
2. `should reject malformed page ID with INVALID_PAGE_ID without fetching`
3. `should abort and return TIMEOUT_EXCEEDED if request takes longer than timeoutMs`
4. `should abort and return RESPONSE_TOO_LARGE if content streams beyond maxResponseBytes`
5. `should return NOT_FOUND if Notion returns 404`
6. `should return MALFORMED_RESPONSE if API returns invalid JSON/HTML`
7. `should return NOTION_API_ERROR if API returns 401/403/500`

## 8. Open Questions
*Không còn câu hỏi mở. Kiến trúc đã chốt: Sử dụng Notion API (`api.notion.com`) và hardcode Base URL để loại bỏ hoàn toàn rủi ro SSRF IP/DNS.*
