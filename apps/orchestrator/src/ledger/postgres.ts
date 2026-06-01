import pg from "pg";

export type Database = {
  transaction<T>(workspaceId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
  query<R extends pg.QueryResultRow = Record<string, unknown>>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
  getPool(): pg.Pool;
};

export function assertRlsGovernedConnectionString(connectionString: string): void {
  let decoded = connectionString;
  try {
    const url = new URL(connectionString);
    decoded = `${url.username}:${url.password}:${url.pathname}:${url.search}`;
  } catch {
    // Non-URL connection strings are still checked as plain text below.
  }

  if (/(service[_-]?role|supabase[_-]?service|bypassrls|rls[_-]?bypass)/i.test(decoded)) {
    throw new Error("DATABASE_URL appears to use a service-role or RLS-bypass credential; US-003 workers require an RLS-governed database role");
  }
}

export function createDatabase(connectionString: string): Database {
  assertRlsGovernedConnectionString(connectionString);
  const pool = new pg.Pool({ connectionString });

  return {
    async transaction<T>(workspaceId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async query<R extends pg.QueryResultRow = Record<string, unknown>>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>> {
      return pool.query<R>(text, values);
    },

    getPool(): pg.Pool {
      return pool;
    }
  };
}
