/**
 * seed-tiktok-account-token.cjs
 *
 * Seeds a TikTok Account Access Token into:
 *   1. secret_references  (encrypted, AES-256-GCM)
 *   2. channel_accounts   (upsert with secret_ref + active status)
 *
 * Usage:
 *   node seed-tiktok-account-token.cjs <CREATOR_OPEN_ID> <ACCESS_TOKEN> [CREATOR_NAME]
 *
 * Example:
 *   node seed-tiktok-account-token.cjs "act_tiktok_123" "act_token_xyz..." "My TikTok Channel"
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
  const creatorOpenId = process.argv[2];
  const accessToken   = process.argv[3];
  const creatorName   = process.argv[4] || "TikTok Channel";

  if (!creatorOpenId || !accessToken) {
    console.error("Usage: node seed-tiktok-account-token.cjs <CREATOR_OPEN_ID> <ACCESS_TOKEN> [CREATOR_NAME]");
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

    // 1. Encrypt & store the Access Token
    const ciphertext = encrypt(accessToken, encKey);
    const secretResult = await client.query(
      `INSERT INTO secret_references (workspace_id, provider, purpose, ciphertext, status)
       VALUES ($1, 'dbsecret', $2, $3, 'active')
       RETURNING id`,
      [workspaceId, `tiktok_account_token_${creatorOpenId}`, ciphertext]
    );

    const secretId  = secretResult.rows[0].id;
    const secretRef = `dbsecret:${workspaceId}:${secretId}`;
    console.log(`✅ Secret stored → ${secretRef}`);

    // 2. Upsert channel_accounts
    await client.query(
      `INSERT INTO channel_accounts
         (workspace_id, platform, external_account_id, account_name,
          secret_ref, status, token_status, permission_status)
       VALUES ($1, 'tiktok', $2, $3, $4, 'active', 'valid', 'valid')
       ON CONFLICT (workspace_id, platform, external_account_id)
       DO UPDATE SET
         secret_ref        = EXCLUDED.secret_ref,
         account_name      = EXCLUDED.account_name,
         status            = 'active',
         token_status      = 'valid',
         permission_status = 'valid',
         updated_at        = NOW()`,
      [workspaceId, creatorOpenId, creatorName, secretRef]
    );
    console.log(`✅ channel_accounts upserted → platform=tiktok, external_account_id=${creatorOpenId}`);

    await client.query("COMMIT");

    // 3. Summary
    console.log("\n──────────────────────────────────────────");
    console.log("Seed complete. Values to remember:");
    console.log(`  CREATOR_OPEN_ID : ${creatorOpenId}`);
    console.log(`  CREATOR_NAME    : ${creatorName}`);
    console.log(`  SECRET_REF      : ${secretRef}`);
    console.log("──────────────────────────────────────────");
    console.log("\nNext steps:");
    console.log("  1. Set TIKTOK_MOCK_MODE=false in .env.local (if testing real APIs)");
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
