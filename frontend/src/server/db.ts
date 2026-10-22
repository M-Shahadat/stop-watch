import { Pool, type PoolClient } from "pg";

let pool: Pool | undefined;
let schemaReady: Promise<void> | undefined;

export function postgresUrl(value: string): string {
  // SQLAlchemy accepts driver-qualified URLs; pg expects the plain scheme.
  return value.replace(/^postgresql\+(?:psycopg|psycopg2):\/\//, "postgresql://");
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  pool ??= new Pool({
    connectionString: postgresUrl(process.env.DATABASE_URL),
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  return pool;
}

async function createSchema(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('stopwatch_schema_v1'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id UUID PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        color VARCHAR(20) NOT NULL DEFAULT '#1a6cff',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'running',
        started_at TIMESTAMPTZ NOT NULL,
        segment_started_at TIMESTAMPTZ,
        accumulated_seconds INTEGER NOT NULL DEFAULT 0,
        pause_started_at TIMESTAMPTZ,
        accumulated_paused_seconds INTEGER NOT NULL DEFAULT 0,
        stopped_at TIMESTAMPTZ,
        duration_seconds INTEGER,
        duration_adjustment_seconds INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL");
    await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS accumulated_paused_seconds INTEGER NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pause_started_at TIMESTAMPTZ");
    await client.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS duration_adjustment_seconds INTEGER NOT NULL DEFAULT 0");
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_intervals (
        id UUID PRIMARY KEY,
        task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ NOT NULL,
        duration_seconds INTEGER NOT NULL
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS task_intervals_task_id_idx ON task_intervals(task_id)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS day_settings (
        id INTEGER PRIMARY KEY,
        start_time VARCHAR(5) NOT NULL DEFAULT '00:00',
        end_time VARCHAR(5) NOT NULL DEFAULT '00:00'
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS day_settings_versions (
        effective_date DATE PRIMARY KEY,
        start_time VARCHAR(5) NOT NULL,
        end_time VARCHAR(5) NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_resets (
        id UUID PRIMARY KEY,
        day DATE NOT NULL,
        timezone_name VARCHAR(100) NOT NULL,
        reset_at TIMESTAMPTZ NOT NULL,
        UNIQUE (day, timezone_name)
      )
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function db(): Promise<Pool> {
  schemaReady ??= createSchema().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  await schemaReady;
  return getPool();
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await (await db()).connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
