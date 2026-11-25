import crypto from 'node:crypto';
import { q } from './db.js';

// No I, O, 0 or 1: codes get read aloud and copied by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

/** Strip dashes/spaces and uppercase, so "sov-abc de" and "SOV-ABCDE" match. */
export const normaliseCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const hashCode = (code) =>
  crypto.createHash('sha256').update(normaliseCode(code)).digest('hex');

/** Human-friendly code: SOV-XXXXX-XXXXX. */
export function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `SOV-${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/**
 * Consume one use of a code inside the caller's transaction.
 * Returns the code id, or null when it is unknown, expired, revoked or used up.
 * The conditional UPDATE is the lock: two registrations cannot both take the
 * last use.
 */
export async function consumeAccessCode(client, rawCode) {
  const hash = hashCode(rawCode);
  if (!hash) return null;

  const { rows } = await client.query(
    `update access_codes
        set uses = uses + 1
      where code_hash = $1
        and revoked_at is null
        and (expires_at is null or expires_at > now())
        and uses < max_uses
      returning id`,
    [hash],
  );

  return rows[0]?.id ?? null;
}

export async function recordRedemption(client, codeId, playerId) {
  await client.query(
    `insert into access_code_redemptions (code_id, player_id) values ($1, $2)`,
    [codeId, playerId],
  );
}

export async function createAccessCodes({ count = 1, uses = 1, days = 14, label = null, createdBy = null } = {}) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 200) {
    throw new Error('count must be between 1 and 200');
  }
  if (!Number.isSafeInteger(uses) || uses < 1 || uses > 500) {
    throw new Error('uses must be between 1 and 500');
  }
  if (days !== null && (!Number.isSafeInteger(days) || days < 1)) {
    throw new Error('days must be a positive whole number (or null for no expiry)');
  }

  const out = [];

  for (let i = 0; i < count; i += 1) {
    let inserted = null;

    // 32^10 space, but retry anyway rather than fail on the unique index.
    for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
      const code = generateCode();
      const { rows } = await q(
        `insert into access_codes (code_hash, label, max_uses, created_by, expires_at)
         values ($1, $2, $3, $4,
                 case when $5::int is null then null else now() + make_interval(days => $5::int) end)
         on conflict (code_hash) do nothing
         returning id`,
        [hashCode(code), label, uses, createdBy, days],
      );
      if (rows[0]) inserted = { id: rows[0].id, code };
    }

    if (!inserted) throw new Error('could not generate a unique access code, try again');
    out.push(inserted);
  }

  return out;
}

export async function listAccessCodes() {
  const { rows } = await q(
    `select id, label, uses, max_uses, created_at, expires_at, revoked_at
       from access_codes
      order by id desc
      limit 200`,
  );
  return rows;
}

export async function revokeAccessCode(id) {
  const { rowCount } = await q(
    `update access_codes set revoked_at = now() where id = $1 and revoked_at is null`,
    [id],
  );
  return rowCount > 0;
}
