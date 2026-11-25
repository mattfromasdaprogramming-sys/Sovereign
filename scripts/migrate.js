import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'db', 'migrations');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set — copy .env.example to .env first.');
  process.exit(1);
}

const target = (() => {
  try {
    const u = new URL(connectionString);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return 'the configured database';
  }
})();

const client = new pg.Client({ connectionString });
try {
  await client.connect();
} catch (err) {
  console.error(`Cannot reach Postgres at ${target}: ${err.message}`);
  console.error('Is it running? Try `npm run db:up` (needs Docker), or point DATABASE_URL in .env at a Postgres 16+ server.');
  process.exit(1);
}

try {
  await client.query(`
    create table if not exists schema_migrations (
      filename   text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )
  `);

  // Two deploys must never migrate at the same time.
  await client.query(`select pg_advisory_lock(hashtext('sovereign_migrate'))`);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Map(
    (await client.query('select filename, checksum from schema_migrations')).rows.map((r) => [
      r.filename,
      r.checksum,
    ]),
  );

  let ran = 0;

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const previous = applied.get(file);

    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `${file} changed after it was applied. Migrations are forward-only: add a new file instead.`,
        );
      }
      continue;
    }

    process.stdout.write(`→ ${file} ... `);
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into schema_migrations (filename, checksum) values ($1, $2)', [
        file,
        checksum,
      ]);
      await client.query('commit');
      console.log('ok');
      ran += 1;
    } catch (err) {
      await client.query('rollback');
      console.log('FAILED');
      throw new Error(`${file}: ${err.message}`);
    }
  }

  console.log(ran === 0 ? 'Database already up to date.' : `Applied ${ran} migration(s).`);
} finally {
  await client.query(`select pg_advisory_unlock(hashtext('sovereign_migrate'))`).catch(() => {});
  await client.end();
}
