/**
 * seed-facebook-page-token.cjs
 *
 * Seeds a real Facebook Page Access Token into:
 *   1. secret_references  (encrypted, AES-256-GCM)
 *   2. channel_accounts   (upsert with secret_ref + active status)
 *
 * Usage:
 *   node seed-facebook-page-token.cjs <PAGE_ID> <PAGE_ACCESS_TOKEN> [PAGE_NAME]
 *
 * Example:
 *   node seed-facebook-page-token.cjs 123456789 EAABwzLixnjYBO... "My Brand Page"
 */

const path = require("node:path");
const crypto = require("node:crypto");
const dotenv = require("dotenv");
const pg = require("pg");

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

// ── AES-256-GCM helpers (mirrors databaseSecretStore.ts) ─────────────────────

function encrypt(text, keyBase64) {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("SECRET_ENCRYPTION_KEY must be 32-byte base64");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");

  return `${iv.toString("base64")}:${authTag}:${encrypted}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pageId        = process.argv[2];
  const pageToken     = process.argv[3];
  const pageName      = process.argv[4] || "Facebook Page";

  if (!pageId || !pageToken) {
    console.error("Usage: node seed-facebook-page-token.cjs <PAGE_ID> <PAGE_ACCESS_TOKEN> [PAGE_NAME]");
    process.exit(1);
  }

  const encKey       = process.env.SECRET_ENCRYPTION_KEY;
  const workspaceId  = process.env.WORKSPACE_ID;
  const databaseUrl  = process.env.DATABASE_URL;

  if (!encKey || !workspaceId || !databaseUrl) {
    console.error("Missing required env vars: SECRET_ENCRYPTION_KEY, WORKSPACE_ID, DATABASE_URL");
    process.exit(1);
  }

  const pool   = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // RLS context
    await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);

    // 1. Encrypt & store the Page Access Token
    const ciphertext = encrypt(pageToken, encKey);
    const secretResult = await client.query(
      `INSERT INTO secret_references (workspace_id, provider, purpose, ciphertext, status)
       VALUES ($1, 'dbsecret', $2, $3, 'active')
       RETURNING id`,
      [workspaceId, `facebook_page_token_${pageId}`, ciphertext]
    );

    const secretId  = secretResult.rows[0].id;
    const secretRef = `dbsecret:${workspaceId}:${secretId}`;
    console.log(`✅ Secret stored → ${secretRef}`);

    // 2. Upsert channel_accounts
    await client.query(
      `INSERT INTO channel_accounts
         (workspace_id, platform, external_account_id, account_name,
          secret_ref, status, token_status, permission_status)
       VALUES ($1, 'facebook', $2, $3, $4, 'active', 'valid', 'valid')
       ON CONFLICT (workspace_id, platform, external_account_id)
       DO UPDATE SET
         secret_ref        = EXCLUDED.secret_ref,
         account_name      = EXCLUDED.account_name,
         status            = 'active',
         token_status      = 'valid',
         permission_status = 'valid',
         updated_at        = NOW()`,
      [workspaceId, pageId, pageName, secretRef]
    );
    console.log(`✅ channel_accounts upserted → platform=facebook, external_account_id=${pageId}`);

    await client.query("COMMIT");

    // 3. Summary
    console.log("\n──────────────────────────────────────────");
    console.log("Seed complete. Values to remember:");
    console.log(`  PAGE_ID    : ${pageId}`);
    console.log(`  PAGE_NAME  : ${pageName}`);
    console.log(`  SECRET_REF : ${secretRef}`);
    console.log("──────────────────────────────────────────");
    console.log("\nNext steps:");
    console.log("  1. Set FACEBOOK_MOCK_MODE=false in .env.local");
    console.log("  2. Restart the server");
    console.log("  3. Trigger the Airtable → publish flow");

  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("❌ Seed failed:", error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
