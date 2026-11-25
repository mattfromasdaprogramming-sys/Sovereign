-- 001_bootstrap.sql
-- Extensions, the world clock, the revision sequence and the change feed.

create extension if not exists citext;
create extension if not exists pgcrypto;

create sequence if not exists world_revision_seq;

create table if not exists world_state (
  id                   boolean primary key default true check (id),
  current_tick         bigint not null default 0,
  revision             bigint not null default 0,
  interval_minutes     integer not null default 30 check (interval_minutes > 0),
  next_tick_at         timestamptz,
  is_paused            boolean not null default false,
  last_tick_duration_ms integer,
  world_seed           bigint not null default 0,
  created_at           timestamptz not null default now()
);

insert into world_state (id, next_tick_at)
values (true, now() + interval '30 minutes')
on conflict (id) do nothing;

-- Single ordered live-update feed. Clients poll GET /api/changes?since=<rev>.
create table if not exists change_log (
  rev         bigint primary key,
  tick        bigint not null,
  entity_type text not null,
  entity_id   bigint not null,
  change      text not null,
  at          timestamptz not null default now()
);
create index if not exists change_log_tick on change_log (tick, rev);

-- Every mutable gameplay table carries updated_tick / updated_rev / updated_at
-- and calls this trigger. It is the only writer of change_log.
create or replace function app_stamp() returns trigger
language plpgsql as $$
declare
  r bigint;
  t bigint;
begin
  r := nextval('world_revision_seq');
  select current_tick into t from world_state where id;

  new.updated_tick := coalesce(t, 0);
  new.updated_rev  := r;
  new.updated_at   := now();

  update world_state set revision = greatest(revision, r) where id;

  insert into change_log (rev, tick, entity_type, entity_id, change)
  values (r, coalesce(t, 0), tg_table_name, new.id, tg_op);

  return new;
end;
$$;
