import pg from "pg";

export type Database = {
  transaction<T>(workspaceId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
};

export function createDatabase(connectionString: string): Database {
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
    }
  };
}
