const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const pg = require("pg");

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

async function main() {
  const migrationArg = process.argv[2];
  if (!migrationArg) {
    throw new Error("Usage: node apply-migration.cjs <migration.sql>");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing from .env.local");
  }

  const migrationPath = path.resolve(__dirname, migrationArg);
  const migrationsRoot = path.resolve(__dirname, "db", "migrations");
  const relativePath = path.relative(migrationsRoot, migrationPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Migration must be inside db/migrations");
  }

  const sql = fs.readFileSync(migrationPath, "utf8");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(sql);
    console.log(`Applied ${path.basename(migrationPath)}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
