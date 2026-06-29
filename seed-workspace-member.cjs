const path = require("node:path");
const dotenv = require("dotenv");
const pg = require("pg");

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

async function main() {
  const slackUserId = process.argv[2];
  const role = process.argv[3] || "admin";
  const workspaceId = process.env.WORKSPACE_ID;

  if (!slackUserId || !workspaceId || !process.env.DATABASE_URL) {
    throw new Error(
      "Usage: node seed-workspace-member.cjs <SLACK_USER_ID> [role]; WORKSPACE_ID and DATABASE_URL must exist in .env.local"
    );
  }

  const allowedRoles = new Set(["admin", "manager", "viewer", "creator"]);
  if (!allowedRoles.has(role)) {
    throw new Error(`Invalid role: ${role}`);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.current_workspace_id', $1, true)",
      [workspaceId]
    );
    await client.query(
      `INSERT INTO workspace_members (workspace_id, slack_user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, slack_user_id)
       DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
      [workspaceId, slackUserId, role]
    );
    await client.query("COMMIT");
    console.log(`Seeded ${slackUserId} as ${role} in ${workspaceId}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
