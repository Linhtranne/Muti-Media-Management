/**
 * scripts/fb-auth-helper.mjs
 *
 * Helps administrators complete the Facebook Page OAuth flow
 * and link their real Facebook Page directly to the database.
 */
/* global fetch */

import { exec } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(".env.local") });

const ADMIN_HEADER = "U0B7QBN9A8L"; // Seeded Slack Admin ID
const BACKEND_URL = "http://127.0.0.1:3000";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

function openUrl(url) {
  const start =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
      ? "start"
      : "xdg-open";
  exec(`${start} "" "${url}"`);
}

async function main() {
  console.log("==================================================");
  console.log("   FACEBOOK PAGE AUTHENTICATION & CONNECT HELPER  ");
  console.log("==================================================");

  try {
    // Step 1: Start Auth Flow
    console.log("\n1. Gửi yêu cầu sinh URL đăng nhập từ Backend...");
    const startRes = await fetch(`${BACKEND_URL}/api/v1/admin/facebook/auth/start`, {
      method: "POST",
      headers: {
        "x-user-id": ADMIN_HEADER
      }
    });

    if (!startRes.ok) {
      const err = await startRes.json();
      throw new Error(`Backend error: ${err.error || startRes.statusText}`);
    }

    const { url } = await startRes.json();
    console.log("✅ Đã sinh URL đăng nhập thành công!");
    console.log("--------------------------------------------------");
    console.log("URL:", url);
    console.log("--------------------------------------------------");

    console.log("\n2. Mở trình duyệt để bạn đăng nhập Facebook...");
    openUrl(url);

    console.log("\n3. Hướng dẫn:");
    console.log("   - Trình duyệt sẽ yêu cầu cấp quyền truy cập các Page.");
    console.log("   - Sau khi đồng ý, trình duyệt sẽ chuyển hướng về localhost và trả về JSON.");
    console.log("   - Hãy COPY toàn bộ chuỗi JSON hiển thị trên màn hình trình duyệt.");

    console.log("\n--------------------------------------------------");
    const jsonInput = await question("👉 Hãy dán (paste) chuỗi JSON nhận được vào đây: ");
    
    let oauthData;
    try {
      oauthData = JSON.parse(jsonInput.trim());
    } catch {
      throw new Error("Chuỗi dán vào không phải JSON hợp lệ. Vui lòng thử lại.");
    }

    const { pages, connectionSessionId } = oauthData;
    if (!connectionSessionId) {
      throw new Error("Không tìm thấy connectionSessionId trong JSON.");
    }

    if (!pages || pages.length === 0) {
      console.log("\n❌ Không tìm thấy Page nào liên kết với tài khoản này.");
      console.log("Hãy chắc chắn bạn đã tick chọn Page khi đồng ý cấp quyền trên Facebook.");
      rl.close();
      return;
    }

    console.log("\nCác Page có thể kết nối:");
    pages.forEach((p, idx) => {
      const pId = p.pageId || p.id;
      const pName = p.displayName || p.name;
      console.log(`  [${idx + 1}] ID: ${pId} - Tên: ${pName}`);
    });

    const choiceIdxStr = await question(`\n👉 Chọn số thứ tự Page muốn kết nối (1-${pages.length}): `);
    const choiceIdx = parseInt(choiceIdxStr, 10) - 1;

    if (isNaN(choiceIdx) || choiceIdx < 0 || choiceIdx >= pages.length) {
      throw new Error("Lựa chọn không hợp lệ.");
    }

    const selectedPage = pages[choiceIdx];
    const targetPageId = selectedPage.pageId || selectedPage.id;
    const targetPageName = selectedPage.displayName || selectedPage.name;
    console.log(`\n4. Đang kết nối Page: "${targetPageName}" (ID: ${targetPageId})...`);

    // Step 2: Connect Page
    const connectRes = await fetch(`${BACKEND_URL}/api/v1/admin/facebook/pages/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": ADMIN_HEADER
      },
      body: JSON.stringify({
        pageId: targetPageId,
        connectionSessionId
      })
    });

    if (!connectRes.ok) {
      const err = await connectRes.json();
      throw new Error(`Kết nối Page thất bại: ${err.error || connectRes.statusText}`);
    }

    const connectData = await connectRes.json();
    console.log("\n🎉 KẾT NỐI THÀNH CÔNG!");
    console.log(`- Page ID kết nối: ${selectedPage.id}`);
    console.log(`- Channel Account ID trong DB: ${connectData.channelAccountId}`);
    console.log("\nHệ thống đã lưu token Page được mã hóa an toàn vào DB.");

  } catch (error) {
    console.error("\n❌ Lỗi:", error.message);
  } finally {
    rl.close();
  }
}

main();
