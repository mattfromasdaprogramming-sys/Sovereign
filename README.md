# Sovereign — shared world

Server-authoritative backend for the shared-world version of Sovereign. This repo
currently holds **step 1**: the database, the ledger, identity, the world clock
and a status console. The game client (the existing 13-section UI, map, laws,
armies) is not copied in yet — it is plugged in on top of this API.

## Run it locally

Requirements: Node 20+, Docker (for Postgres 16).

```bash
cp .env.example .env        # then edit if you want different credentials
npm install
npm run db:up               # starts postgres:16 on localhost:5432
npm run migrate             # applies db/migrations/*.sql in order
npm run seed                # goods + sectors (world data comes later)
npm run tick:once           # advances the world one tick (proves the clock works)
npm run dev                 # http://localhost:3000
```

In a second terminal, run the real clock:

```bash
npm run tick:worker         # ticks every 30 min, catches up after downtime
```

Check that no money was created or lost at any point:

```bash
npm run check:ledger
```

Without Docker: point `DATABASE_URL` at any PostgreSQL 16+ instance and skip
`npm run db:up`.

## What you can do in the browser

`http://localhost:3000` is a status console, not the game UI yet.

1. Register a handle (10+ character password). You receive 10,000 credits from
   the `world_issuance` account through a real ledger transaction.
2. Watch the tick counter and the `change_log` feed update every few seconds.
3. Sign out and back in — sessions are server-side rows with hashed tokens.

## Test runs are invite-only

`SIGNUP_MODE=invite` is the default: **only accounts made with an owner-issued
access code can be created**. Anyone can still sign in afterwards; the gate is
on registration, not on the session.

```bash
npm run invite                                  # 1 code, 1 account, 14 days
npm run invite -- --count 10 --uses 1 --days 7 --label "wave 1"
npm run invite -- --list                        # ids, uses, expiry (no code text)
npm run invite -- --revoke 4                    # stop a code working
```

Send one code per tester. Codes are stored only as sha256 hashes, so the
generator prints them once — there is no way to read them back. A code can be
single-use or carry N uses, expire after N days (`--forever` for none), and be
revoked at any time; redemptions are recorded per player.

Set `SIGNUP_MODE=open` in `.env` to let anyone register (the full-launch
behaviour). This changes registration only — nothing else about the world.

## Layout

```
db/migrations/      forward-only SQL, one transaction per file
db/seeds/           idempotent reference data
scripts/            migrate, seed, tick worker, ledger check
src/                server, auth, ledger, tick engine
public/             status console
data/world.json     generated from the existing world data (not committed)
legacy/             where the five existing game files go
```

Migrations applied: `001` bootstrap, `002` reference catalogues, `003` identity,
`004` accounts + ledger, `005` world/cities/tax, `014` tick + actions,
`015` access codes. Files keep the numbering from the design document, so
`006`–`013` slot in between without renumbering.

## The two rules the schema enforces itself

- **Money only moves through `ledger_entries`.** A trigger rejects any direct
  `accounts.balance` update, every entry is insert-only, and a deferred
  constraint trigger refuses to commit a transaction whose entries do not sum to
  zero.
- **One clock.** The tick worker takes `pg_try_advisory_xact_lock('world_tick')`,
  and `ticks.number` is a primary key, so two workers cannot advance the world
  twice even if they race.

## When the five game files arrive

Drop `index.html`, `style.css`, `game.js`, `worlddata.js`, `geoextra.js` into
`legacy/` unchanged. Then these still need to be written or extracted, in order:

1. `scripts/import-legacy.js` — turns `worlddata.js`/`geoextra.js` into
   `data/world.json` (176 nations, real capitals and flags, stable ids), and the
   18 laws, 8 unit types, government types and budget categories into
   `db/seeds/`. This is the step that must not guess: see the design doc's
   section 18 for the 15 exact shapes needed.
2. Elections, congress of eight, companies, market, shares and blind trusts
   (migrations `006`–`013`).
3. The game client wired to `/api` instead of its local save, with the existing
   visual design, map and modes untouched.
4. `sovereign_v3` save import, admin panel, monitoring.

Until step 1 of that list is done, the world has no nations and the console says
so — nothing is invented to fill the gap.
