import 'dotenv/config';
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const seedsDir = path.join(root, 'db', 'seeds');

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
  const files = (await readdir(seedsDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    process.stdout.write(`→ seed ${file} ... `);
    await client.query('begin');
    try {
      await client.query(await readFile(path.join(seedsDir, file), 'utf8'));
      await client.query('commit');
      console.log('ok');
    } catch (err) {
      await client.query('rollback');
      console.log('FAILED');
      throw err;
    }
  }

  const worldFile = path.join(root, 'data', 'world.json');

  // Only a genuinely missing file means "no world data yet". Anything else
  // (permissions, a broken path) is a real failure and must be reported.
  let hasWorld = false;
  try {
    await access(worldFile);
    hasWorld = true;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  if (!hasWorld) {
    console.log('→ world: data/world.json not found, skipped (no nations yet).');
  } else {
    process.stdout.write('→ world: importing data/world.json ... ');

    // All-or-nothing: a bad row must not leave a half-seeded world behind.
    await client.query('begin');
    try {
      const { seedWorld } = await import('./seed-world.js');
      const summary = await seedWorld(client, worldFile);
      await client.query('commit');
      console.log(`ok (${summary.nations} nations, ${summary.cities} cities).`);
    } catch (err) {
      await client.query('rollback');
      console.log('FAILED');
      throw err;
    }
  }
} catch (err) {
  console.error(`\nseed failed: ${err.message}`);
  if (err.detail) console.error(`detail: ${err.detail}`);
  if (err.hint) console.error(`hint: ${err.hint}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
