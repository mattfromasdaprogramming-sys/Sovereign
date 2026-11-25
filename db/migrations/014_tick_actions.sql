-- 014_tick_actions.sql
-- One authoritative clock. The worker holds a Postgres advisory lock and the
-- ticks primary key makes a duplicate tick impossible even if two workers race.

create table ticks (
  number         bigint primary key,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'abandoned')),
  revision_start bigint not null,
  revision_end   bigint,
  duration_ms    integer,
  locked_by      text
);

-- Resumability ledger: a crashed phase is re-run, not the whole world.
create table tick_phases (
  tick        bigint not null references ticks (number),
  phase       text not null,
  status      text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  error       text,
  primary key (tick, phase)
);

create table tick_errors (
  id          bigint generated always as identity primary key,
  tick        bigint not null,
  phase       text not null,
  entity_type text,
  entity_id   bigint,
  message     text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index tick_errors_recent on tick_errors (tick desc, id desc);

create table ledger_checkpoints (
  tick           bigint primary key,
  total_balances bigint not null,
  total_entries  bigint not null,
  is_balanced    boolean not null,
  delta          bigint not null,
  checked_at     timestamptz not null default now()
);

-- Every mutating request carries an idempotency key unique per player, so a
-- retried request replays the stored result instead of applying twice.
create table actions (
  id              bigint generated always as identity primary key,
  player_id       bigint not null references players (id),
  idempotency_key text not null,
  action_type     text not null,
  payload_hash    text not null,
  tick            bigint not null,
  status          text not null check (status in ('applied', 'rejected')),
  result          jsonb,
  error_code      text,
  error_message   text,
  created_at      timestamptz not null default now(),
  unique (player_id, idempotency_key)
);

create table action_budgets (
  player_id bigint not null references players (id),
  tick      bigint not null,
  "limit"   integer not null,
  used      integer not null default 0,
  primary key (player_id, tick)
);

-- Admin "force tick" requests are written here and consumed by the worker,
-- never called directly from the web process.
create table pending_ticks (
  id          bigint generated always as identity primary key,
  requested_by bigint references players (id),
  requested_at timestamptz not null default now(),
  consumed_at timestamptz,
  reason      text
);
