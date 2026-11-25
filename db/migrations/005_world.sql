-- 005_world.sql
-- World geometry stays a static asset. The database stores only mutable state,
-- keyed by the stable nation id produced by the world generator.

create table nations (
  id                  bigint primary key,       -- stable id from world generation
  iso2                char(2) unique not null,
  iso3                char(3),
  name                text not null,
  capital             text not null,
  flag_emoji          text not null default '',
  region              text,
  government_type     text not null default 'republic',
  population          bigint not null default 0 check (population >= 0),
  stability           numeric not null default 50,
  approval            numeric not null default 50,
  gdp                 bigint not null default 0,
  treasury_account_id bigint,                   -- fk wired below, deferred
  status              text not null default 'active' check (status in ('active', 'collapsed', 'occupied')),
  is_claimed          boolean not null default false,
  created_tick        bigint not null default 0,
  updated_tick        bigint not null default 0,
  updated_rev         bigint not null default 0,
  updated_at          timestamptz not null default now()
);

create table cities (
  id                bigint generated always as identity primary key,
  nation_id         bigint not null references nations (id),
  name              text not null,
  is_capital        boolean not null default false,
  population        bigint not null default 0 check (population >= 0),
  tier              integer not null default 1 check (tier between 1 and 3),
  base_revenue      bigint not null default 0,
  steward_player_id bigint references players (id),
  revenue_account_id bigint,
  updated_tick      bigint not null default 0,
  updated_rev       bigint not null default 0,
  updated_at        timestamptz not null default now(),
  unique (nation_id, name)
);
create unique index cities_one_capital on cities (nation_id) where is_capital;

create table nation_resources (
  nation_id bigint not null references nations (id),
  good_id   bigint not null references goods (id),
  qty       numeric not null default 0,
  capacity  numeric not null default 0,
  primary key (nation_id, good_id)
);

-- One row per city per tick, so a steward skimming is visible.
create table city_revenue (
  id             bigint generated always as identity primary key,
  city_id        bigint not null references cities (id),
  tick           bigint not null,
  gross          bigint not null,
  national_share bigint not null,
  steward_share  bigint not null,
  txn_id         uuid references ledger_txns (id),
  unique (city_id, tick)
);

create table nation_tax_rates (
  nation_id      bigint not null references nations (id),
  category       text not null check (category in
                   ('personal_income', 'corporate', 'sales', 'tariff', 'property', 'capital_gains')),
  rate_bps       integer not null default 0 check (rate_bps between 0 and 10000),
  set_by_seat_id bigint,
  updated_tick   bigint not null default 0,
  primary key (nation_id, category)
);

create table office_salaries (
  nation_id       bigint not null references nations (id),
  seat_role       text not null,
  amount_per_tick bigint not null default 0,
  primary key (nation_id, seat_role)
);

-- Circular references: added here, deferred, so rows can be created in any order
-- inside one transaction.
alter table accounts
  add constraint accounts_nation_fk foreign key (nation_id) references nations (id)
  deferrable initially deferred;

alter table accounts
  add constraint accounts_city_fk foreign key (city_id) references cities (id)
  deferrable initially deferred;

alter table nations
  add constraint nations_treasury_fk foreign key (treasury_account_id) references accounts (id)
  deferrable initially deferred;

alter table cities
  add constraint cities_revenue_account_fk foreign key (revenue_account_id) references accounts (id)
  deferrable initially deferred;

alter table players
  add constraint players_nation_fk foreign key (home_nation_id) references nations (id)
  deferrable initially deferred;

alter table players
  add constraint players_personal_account_fk foreign key (personal_account_id) references accounts (id)
  deferrable initially deferred;

create trigger nations_stamp
  before insert or update on nations
  for each row execute function app_stamp();

create trigger cities_stamp
  before insert or update on cities
  for each row execute function app_stamp();
