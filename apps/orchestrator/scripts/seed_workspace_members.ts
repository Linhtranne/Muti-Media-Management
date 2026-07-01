import "dotenv/config";
import { loadEnv } from "../src/config/env.js";
import { createDatabase } from "../src/ledger/postgres.js";

async function run() {
  const env = loadEnv();
  const db = createDatabase(env.DATABASE_URL);
  
  const slackUserId = process.argv[2];
  if (!slackUserId) {
    console.error("Usage: npx tsx seed_workspace_members.ts <slack_user_id> [role]");
    process.exit(1);
  }
  
  const role = process.argv[3] || "manager";
  
  try {
    const result = await db.query(
      `INSERT INTO workspace_members (workspace_id, slack_user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, slack_user_id) 
       DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
      [env.WORKSPACE_ID, slackUserId, role]
    );
    console.log(`Successfully seeded member ${slackUserId} with role ${role} in workspace ${env.WORKSPACE_ID}`);
  } catch (error) {
    console.error("Failed to seed workspace member:", error);
  } finally {
    await db.getPool().end();
  }
}

run().catch(console.error);
