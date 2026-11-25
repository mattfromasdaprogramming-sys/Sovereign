import 'dotenv/config';
import { createAccessCodes, listAccessCodes, revokeAccessCode } from '../src/access-codes.js';
import { pool, q } from '../src/db.js';

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const int = (name, fallback) => {
  const raw = value(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) {
    console.error(`--${name} must be a whole number (got "${raw}")`);
    process.exit(1);
  }
  return n;
};

const usage = `
Sovereign access codes — only a valid code can register while SIGNUP_MODE=invite.

  npm run invite                              one single-use code, valid 14 days
  npm run invite -- --count 5 --uses 1 --days 7 --label "wave 1"
  npm run invite -- --list                    list codes (no plaintext, by design)
  npm run invite -- --revoke 12               stop a code working

Flags: --count N (1–200), --uses N (accounts per code), --days N (omit days
with --forever for no expiry), --label TEXT, --created-by HANDLE.
`;

async function main() {
  if (has('help') || has('h')) {
    console.log(usage);
    return;
  }

  if (has('list')) {
    const codes = await listAccessCodes();
    if (codes.length === 0) {
      console.log('No access codes yet. Mint one with: npm run invite');
      return;
    }
    console.log('id   uses      expires                     label');
    for (const c of codes) {
      const uses = `${c.uses}/${c.max_uses}`;
      const expires = c.revoked_at ? 'revoked' : c.expires_at ? new Date(c.expires_at).toISOString() : 'never';
      console.log(
        `${String(c.id).padEnd(4)} ${uses.padEnd(9)} ${expires.padEnd(27)} ${c.label ?? ''}`.trimEnd(),
      );
    }
    return;
  }

  if (has('revoke')) {
    const id = int('revoke', NaN);
    if (!Number.isSafeInteger(id) || id < 1) {
      console.error('Usage: npm run invite -- --revoke <id>   (see --list for ids)');
      process.exit(1);
    }
    const done = await revokeAccessCode(id);
    console.log(done ? `Code ${id} revoked.` : `Code ${id} was already revoked or does not exist.`);
    return;
  }

  const createdByHandle = value('created-by');
  let createdBy = null;
  if (createdByHandle) {
    const { rows } = await q('select id from players where handle = $1', [createdByHandle]);
    if (!rows[0]) {
      console.error(`No player with handle "${createdByHandle}" — omit --created-by to skip attribution.`);
      process.exit(1);
    }
    createdBy = rows[0].id;
  }

  const days = has('forever') ? null : int('days', 14);
  const codes = await createAccessCodes({
    count: int('count', 1),
    uses: int('uses', 1),
    days,
    label: value('label') ?? null,
    createdBy,
  });

  console.log(days === null ? 'Access codes (no expiry):' : `Access codes (valid ${days} days):`);
  for (const c of codes) console.log(`  ${c.code}`);
  console.log('\nSend each person one code. It is stored hashed: this is the only time it is shown.');
  console.log('Registration needs it; signing in afterwards does not.');
}

main()
  .catch((err) => {
    console.error(`invite failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
