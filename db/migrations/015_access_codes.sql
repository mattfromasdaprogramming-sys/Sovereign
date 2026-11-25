-- 015_access_codes.sql
-- Closed test runs: the owner mints access codes from the server and only a
-- valid, unexpired, unexhausted code can create an account.
--
-- Codes are stored as sha256 hashes, so reading this table does not hand
-- anybody a working code, and the plaintext only ever exists in the terminal
-- that generated it. Redemptions are append-only, like votes and transfers.

create table access_codes (
  id         bigint generated always as identity primary key,
  code_hash  text unique not null,
  label      text,
  max_uses   integer not null default 1 check (max_uses > 0),
  uses       integer not null default 0 check (uses >= 0 and uses <= max_uses),
  created_by bigint references players (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
create index access_codes_created on access_codes (created_at desc);

create table access_code_redemptions (
  id        bigint generated always as identity primary key,
  code_id   bigint not null references access_codes (id),
  player_id bigint not null references players (id) on delete cascade,
  at        timestamptz not null default now(),
  unique (code_id, player_id)
);
create index access_code_redemptions_code on access_code_redemptions (code_id);
