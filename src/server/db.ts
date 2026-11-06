import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { config } from "./config";

let pool: Pool | undefined;
export function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: config().DATABASE_URL, max: 12, idleTimeoutMillis: 30000 });
  return pool;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
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
export async function one<T extends QueryResultRow = QueryResultRow>(query: string, values: unknown[] = []): Promise<T | null> {
  const result = await db().query<T>(query, values);
  return result.rows[0] ?? null;
}
