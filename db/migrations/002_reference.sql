-- 002_reference.sql
-- Catalogs that content designers edit. Laws and unit types are loaded from the
-- existing game data (never retyped); goods, sectors and boxes are new content.

create table law_definitions (
  code                text primary key,
  name                text not null,
  category            text not null default 'civil',
  effect              jsonb not null default '{}',
  bill_kind           text not null default 'law' check (bill_kind in ('law', 'constitutional')),
  aye_threshold_bps   integer not null default 5000 check (aye_threshold_bps between 0 and 10000),
  proposable_by       text not null default 'congress' check (proposable_by in ('congress', 'minister', 'hog')),
  is_active           boolean not null default true
);

create table unit_types (
  code                    text primary key,
  name                    text not null,
  cost                    bigint not null default 0,
  upkeep_per_tick         bigint not null default 0,
  attack                  numeric not null default 0,
  defence                 numeric not null default 0,
  requires_goods          jsonb not null default '{}',
  tiers_unlocked_at_level integer not null default 0
);

create table goods (
  id           bigint generated always as identity primary key,
  code         text unique not null,
  name         text not null,
  category     text not null check (category in ('raw', 'intermediate', 'consumer', 'military', 'service')),
  unit         text not null default 'unit',
  is_strategic boolean not null default false,
  base_price   bigint not null check (base_price >= 0)
);

create table sectors (
  code             text primary key,
  name             text not null,
  inputs           jsonb not null default '{}',
  outputs          jsonb not null default '{}',
  labour_per_unit  numeric not null default 1,
  capital_per_unit bigint not null default 0,
  needs_licence    boolean not null default true
);

create table box_definitions (
  code       text primary key,
  name       text not null,
  drop_table jsonb not null default '[]',
  is_active  boolean not null default true
);

create table items (
  id       bigint generated always as identity primary key,
  code     text unique not null,
  name     text not null,
  category text not null default 'misc',
  rarity   text not null default 'common' check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  effects  jsonb not null default '{}'
);
