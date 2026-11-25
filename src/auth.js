import crypto from 'node:crypto';
import { q, tx } from './db.js';
import { postTxn, getIssuanceAccount } from './ledger.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  SIGNUP_MODE,
  STARTING_CAPITAL,
} from './config.js';
import { consumeAccessCode, recordRedemption } from './access-codes.js';

const SCRYPT_KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [algorithm, salt, expectedHex] = String(stored ?? '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export async function registerPlayer({ handle, displayName, password, accessCode = null }) {
  return tx(async (client) => {
    // Closed test run: take one use of the code in the same transaction that
    // creates the account, so a failure rolls the use back too.
    let codeId = null;
    if (SIGNUP_MODE === 'invite') {
      codeId = await consumeAccessCode(client, accessCode);
      if (!codeId) {
        throw Object.assign(new Error('invalid_access_code'), {
          status: 403,
          reason: 'invalid_access_code',
        });
      }
    }

    const { rows: [player] } = await client.query(
      `insert into players (handle, display_name, password_hash)
       values ($1, $2, $3)
       returning id, handle, display_name`,
      [handle, displayName || handle, hashPassword(password)],
    );

    const { rows: [wallet] } = await client.query(
      `insert into accounts (kind, player_id) values ('personal', $1) returning id`,
      [player.id],
    );

    await client.query(`update players set personal_account_id = $1 where id = $2`, [wallet.id, player.id]);

    if (codeId) await recordRedemption(client, codeId, player.id);

    if (STARTING_CAPITAL > 0) {
      const issuanceId = await getIssuanceAccount(client);
      await postTxn(client, {
        reason: 'world_issuance',
        memo: 'new player starting capital',
        actorPlayerId: player.id,
        entries: [
          { accountId: wallet.id, amount: STARTING_CAPITAL, playerId: player.id },
          { accountId: issuanceId, amount: -STARTING_CAPITAL, playerId: player.id },
        ],
      });
    }

    return player;
  });
}

export async function createSession(playerId, { ipHash = null, uaHash = null } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');

  await q(
    `insert into sessions (player_id, token_hash, expires_at, ip_hash, ua_hash)
     values ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [playerId, tokenHash(token), SESSION_TTL_DAYS, ipHash, uaHash],
  );

  return token;
}

export async function loadSession(token) {
  if (!token) return null;

  const { rows } = await q(
    `select p.id, p.handle, p.display_name, p.status, p.home_nation_id, p.personal_account_id
       from sessions s
       join players p on p.id = s.player_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
        and p.status = 'active'`,
    [tokenHash(token)],
  );

  return rows[0] ?? null;
}

export async function revokeSession(token) {
  if (!token) return;
  await q(`update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`, [
    tokenHash(token),
  ]);
}

export async function loginPlayer({ handle, password }) {
  const { rows } = await q(
    `select id, handle, display_name, password_hash, status
       from players where handle = $1`,
    [handle],
  );

  const player = rows[0];
  const ok = Boolean(player) && verifyPassword(password, player.password_hash);

  await q(
    `insert into login_attempts (identifier_hash, ok)
     values ($1, $2)`,
    [crypto.createHash('sha256').update(String(handle).toLowerCase()).digest('hex'), ok],
  );

  if (!ok || player.status !== 'active') return null;
  return player;
}

/** Express middleware: attaches req.player when a valid session cookie is present. */
export async function attachSession(req, _res, next) {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    req.sessionToken = token;
    req.player = token ? await loadSession(token) : null;
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePlayer(req, res, next) {
  if (!req.player) {
    res.status(401).json({ error: 'not_signed_in' });
    return;
  }
  next();
}
