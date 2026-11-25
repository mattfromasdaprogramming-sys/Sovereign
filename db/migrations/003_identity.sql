-- 003_identity.sql
-- Accounts are server-side rows; the browser only ever holds an opaque token
-- whose sha256 is stored here, so a ban or "sign out everywhere" is immediate.

create type player_status as enum ('active', 'restricted', 'banned', 'anonymised');

create table players (
  id                  bigint generated always as identity primary key,
  handle              citext unique not null check (handle ~ '^[a-zA-Z0-9_]{3,24}$'),
  display_name        text not null,
  email               citext unique,
  password_hash       text,                       -- scrypt$salt$hash; null with external auth
  auth_issuer         text,
  auth_subject        text,
  status              player_status not null default 'active',
  home_nation_id      bigint,                     -- fk added in 005
  personal_account_id bigint,                     -- fk added in 005
  grace_ends_tick     bigint,
  tutorial_done_at    timestamptz,
  created_at          timestamptz not null default now(),
  last_seen_at        timestamptz,
  anonymised_at       timestamptz,
  unique (auth_issuer, auth_subject)
);
create index players_status on players (status) where status <> 'active';

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  player_id    bigint not null references players (id) on delete cascade,
  token_hash   text unique not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  ip_hash      text,
  ua_hash      text
);
create index sessions_player_live on sessions (player_id) where revoked_at is null;

create table bans (
  id          bigint generated always as identity primary key,
  player_id   bigint not null references players (id),
  reason      text not null,
  issued_by   bigint not null references players (id),
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz,
  lifted_at   timestamptz
);
create index bans_live on bans (player_id) where lifted_at is null;

create table login_attempts (
  id              bigint generated always as identity primary key,
  identifier_hash text not null,
  ip_hash         text,
  ok              boolean not null,
  at              timestamptz not null default now()
);
create index login_attempts_throttle on login_attempts (identifier_hash, at desc);
