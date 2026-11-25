import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { q } from './db.js';
import { PORT, SESSION_COOKIE, SIGNUP_MODE, IS_PRODUCTION } from './config.js';
import {
  attachSession,
  createSession,
  loginPlayer,
  registerPlayer,
  requirePlayer,
  revokeSession,
} from './auth.js';
import { getWallet } from './wallet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(attachSession);

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const HANDLE_RE = /^[a-zA-Z0-9_]{3,24}$/;

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

app.get('/api/health', wrap(async (_req, res) => {
  await q('select 1');
  res.json({ ok: true });
}));

// --- auth -----------------------------------------------------------------

app.post('/api/auth/register', wrap(async (req, res) => {
  const handle = String(req.body?.handle ?? '').trim();
  const password = String(req.body?.password ?? '');
  const displayName = String(req.body?.display_name ?? '').trim() || handle;
  const accessCode = String(req.body?.code ?? '').trim();

  if (!HANDLE_RE.test(handle)) {
    res.status(400).json({ error: 'invalid_handle', message: '3–24 letters, numbers or underscores.' });
    return;
  }
  if (password.length < 10) {
    res.status(400).json({ error: 'weak_password', message: 'Use at least 10 characters.' });
    return;
  }

  if (SIGNUP_MODE === 'invite' && !accessCode) {
    res.status(403).json({
      error: 'invite_required',
      message: 'This test run is invite-only — enter the access code you were given.',
    });
    return;
  }

  try {
    const player = await registerPlayer({ handle, displayName, password, accessCode });
    setSessionCookie(res, await createSession(player.id));
    res.status(201).json({ player });
  } catch (err) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'handle_taken', message: 'That handle is already in use.' });
      return;
    }
    if (err.reason === 'invalid_access_code') {
      res.status(403).json({
        error: 'invalid_access_code',
        message: 'That access code is unknown, expired, revoked or already used up.',
      });
      return;
    }
    throw err;
  }
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const handle = String(req.body?.handle ?? '').trim();
  const password = String(req.body?.password ?? '');

  const player = await loginPlayer({ handle, password });

  if (!player) {
    res.status(401).json({ error: 'bad_credentials', message: 'Handle or password is wrong.' });
    return;
  }

  setSessionCookie(res, await createSession(player.id));
  res.json({
    player: { id: player.id, handle: player.handle, display_name: player.display_name },
  });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  await revokeSession(req.sessionToken);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
}));

app.get('/api/me', wrap(async (req, res) => {
  if (!req.player) {
    res.json({ player: null });
    return;
  }

  const wallet = await getWallet(req.player.id);
  res.json({
    player: req.player,
    wallet: wallet
      ? {
          balance: wallet.account.balance,
          currency: 'credits',
          minor_units_per_credit: 100,
          is_frozen: wallet.account.is_frozen,
        }
      : null,
  });
}));

// --- world ----------------------------------------------------------------

app.get('/api/world', wrap(async (_req, res) => {
  const { rows: [world] } = await q(
    `select current_tick, revision, interval_minutes, next_tick_at, is_paused,
            last_tick_duration_ms, world_seed
       from world_state where id`,
  );

  const { rows: [counts] } = await q(
    `select (select count(*) from nations)  as nations,
            (select count(*) from cities)   as cities,
            (select count(*) from players)  as players,
            (select count(*) from ticks)    as ticks`,
  );

  res.json({ world, counts, signup: { mode: SIGNUP_MODE } });
}));

app.get('/api/nations', wrap(async (_req, res) => {
  const { rows } = await q(
    `select id, iso2, iso3, name, capital, flag_emoji, region, government_type,
            population, stability, approval, status
       from nations
      order by name
      limit 200`,
  );
  res.json({ nations: rows });
}));

app.get('/api/nations/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) {
    res.status(400).json({ error: 'bad_nation_id' });
    return;
  }

  const { rows: [nation] } = await q(
    `select n.*, (select count(*) from cities c where c.nation_id = n.id) as city_count
       from nations n where n.id = $1`,
    [id],
  );

  if (!nation) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ nation });
}));

// --- live feed ------------------------------------------------------------

app.get('/api/changes', wrap(async (req, res) => {
  const since = Number(req.query.since ?? 0);
  if (!Number.isSafeInteger(since) || since < 0) {
    res.status(400).json({ error: 'bad_since' });
    return;
  }

  const [{ rows: changes }, { rows: [head] }] = await Promise.all([
    q(
      `select rev, tick, entity_type, entity_id, change, at
         from change_log
        where rev > $1
        order by rev
        limit 200`,
      [since],
    ),
    q('select revision, current_tick from world_state where id'),
  ]);

  res.json({
    revision: head.revision,
    tick: head.current_tick,
    changes,
    has_more: changes.length === 200,
  });
}));

// --- wallet ---------------------------------------------------------------

app.get('/api/wallet', requirePlayer, wrap(async (req, res) => {
  const wallet = await getWallet(req.player.id);

  if (!wallet) {
    res.status(404).json({ error: 'no_wallet' });
    return;
  }

  res.json({
    balance: wallet.account.balance,
    is_frozen: wallet.account.is_frozen,
    updated_tick: wallet.account.updated_tick,
    entries: wallet.entries,
  });
}));

// --- static status page ---------------------------------------------------

app.use(express.static(publicDir));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  if (res.headersSent) return;
  res.status(err.status ?? 500).json({ error: 'internal_error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sovereign world server listening on http://localhost:${PORT}`);
});
