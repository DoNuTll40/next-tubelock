import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Client } from '@neondatabase/serverless';

const migrationDirectory = new URL('../migrations/', import.meta.url);
const migrationFiles = (await readdir(migrationDirectory))
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
const migrations = await Promise.all(migrationFiles.map(async (name) => {
  const sql = (await readFile(new URL(name, migrationDirectory), 'utf8')).replaceAll('\r\n', '\n');
  return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
}));

const connectionString = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
const target = URL.canParse(connectionString || '') ? new URL(connectionString) : null;
if (!target || !['postgres:', 'postgresql:'].includes(target.protocol) || !target.hostname || target.hostname.includes('-pooler')) {
  throw new Error('Set DATABASE_URL_UNPOOLED to the direct Neon connection for the database to migrate.');
}

const client = new Client({ connectionString, connectionTimeoutMillis: 15_000 });
let activeMigration;
let inTransaction = false;
try {
  await client.connect();
  await client.query('BEGIN');
  inTransaction = true;
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query('SELECT pg_advisory_xact_lock(1635020656, 5432)');
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const { rows } = await client.query('SELECT name, checksum FROM schema_migrations');
  const applied = new Map(rows.map(({ name, checksum }) => [name, checksum]));
  const appliedNow = [];
  for (const { name, sql, checksum } of migrations) {
    activeMigration = name;
    if (applied.has(name)) {
      if (applied.get(name) !== checksum) throw new Error('An applied migration has changed.');
      continue;
    }
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
    appliedNow.push(name);
  }

  await client.query('COMMIT');
  inTransaction = false;
  console.log(appliedNow.length ? `Applied: ${appliedNow.join(', ')}` : 'Database migrations are up to date.');
} catch (error) {
  if (inTransaction) await client.query('ROLLBACK').catch(() => {});
  console.error(activeMigration ? `Migration failed (${activeMigration}).` : 'Could not run migrations.', error.code || error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
