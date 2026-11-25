-- 004_accounts_ledger.sql
-- Every wallet in the world is a row in `accounts`. Money only moves through a
-- balanced ledger_txns + ledger_entries pair, so sum(entries) = 0 always holds
-- and any leak is visible in one query.

create type account_kind as enum (
  'personal',        -- a player's wallet
  'treasury',        -- a nation's budget
  'city',            -- a city's revenue fund
  'company_ops',     -- company working capital
  'company_reserve', -- company capital / facility investment
  'mu_bank',         -- military unit bank
  'blind_trust',     -- pooled proceeds of a divested holding
  'market_clearing', -- escrow during order matching
  'contract_escrow', -- state procurement funds held until delivery
  'tax_sink',        -- where collected tax lands before appropriation
  'world_issuance'   -- the only account allowed to be negative
);

create table accounts (
  id              bigint generated always as identity primary key,
  kind            account_kind not null,
  nation_id       bigint,
  player_id       bigint,
  company_id      bigint,
  city_id         bigint,
  mu_id           bigint,
  trust_id        bigint,
  balance         bigint not null default 0,
  is_frozen       boolean not null default false,
  allow_overdraft boolean not null default false,
  updated_tick    bigint not null default 0,
  updated_rev     bigint not null default 0,
  updated_at      timestamptz not null default now(),
  constraint owner_matches_kind check (
    (kind = 'personal'                          and player_id is not null) or
    (kind in ('treasury', 'tax_sink')           and nation_id is not null) or
    (kind = 'city'                              and city_id is not null) or
    (kind in ('company_ops', 'company_reserve') and company_id is not null) or
    (kind = 'mu_bank'                           and mu_id is not null) or
    (kind = 'blind_trust'                       and trust_id is not null) or
    (kind in ('market_clearing', 'contract_escrow', 'world_issuance'))
  ),
  constraint no_unauthorised_overdraft check (balance >= 0 or allow_overdraft)
);

-- One account per owner.
create unique index accounts_one_personal on accounts (player_id) where kind = 'personal';
create unique index accounts_one_treasury on accounts (nation_id) where kind = 'treasury';
create unique index accounts_one_ops      on accounts (company_id) where kind = 'company_ops';
create unique index accounts_one_bank     on accounts (mu_id)      where kind = 'mu_bank';
create unique index accounts_one_issuance on accounts (kind)       where kind = 'world_issuance';

create type ledger_reason as enum (
  'tax_personal', 'tax_corporate', 'tax_sales', 'tax_tariff', 'tax_property', 'tax_capital_gains',
  'wage', 'salary', 'procurement', 'subsidy', 'aid', 'licence_fee', 'registration_fee',
  'market_sale', 'market_purchase', 'contract_payment', 'dividend', 'share_issue', 'share_trade',
  'loan_draw', 'loan_repay', 'interest', 'upkeep', 'recruitment', 'construction', 'upgrade',
  'city_revenue', 'loot', 'box_reward', 'mu_deposit', 'mu_withdrawal', 'trust_transfer',
  'bankruptcy_writeoff', 'admin_adjust', 'world_issuance'
);

create table ledger_txns (
  id              uuid primary key default gen_random_uuid(),
  tick            bigint not null,
  reason          ledger_reason not null,
  actor_player_id bigint,
  nation_id       bigint,
  company_id      bigint,
  mu_id           bigint,
  city_id         bigint,
  memo            text,
  entry_count     integer not null default 0,
  total           bigint not null default 0,
  created_at      timestamptz not null default now()
);
create index ledger_txns_tick on ledger_txns (tick, created_at);

create table ledger_entries (
  id         bigint generated always as identity primary key,
  txn_id     uuid not null references ledger_txns (id),
  tick       bigint not null,
  account_id bigint not null references accounts (id),
  amount     bigint not null,
  reason     ledger_reason not null,
  nation_id  bigint,
  company_id bigint,
  player_id  bigint,
  ref_type   text,
  ref_id     bigint,
  created_at timestamptz not null default now(),
  constraint non_zero check (amount <> 0)
);
create index ledger_by_account on ledger_entries (account_id, id desc);
create index ledger_by_txn on ledger_entries (txn_id);
create index ledger_admin_filters on ledger_entries (nation_id, company_id, reason, tick);

-- 1. Entries are insert-only.
create or replace function ledger_entry_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'ledger_entries is append-only';
end;
$$;

create trigger ledger_entries_immutable
  before update or delete on ledger_entries
  for each row execute function ledger_entry_immutable();

-- 2. Posting an entry is the only way a balance moves.
create or replace function ledger_apply_entry() returns trigger
language plpgsql as $$
begin
  perform set_config('app.ledger_write', '1', true);

  update accounts
     set balance      = balance + new.amount,
         updated_tick = new.tick,
         updated_at   = now()
   where id = new.account_id;

  if not found then
    raise exception 'ledger entry references unknown account %', new.account_id;
  end if;

  update ledger_txns
     set entry_count = entry_count + 1,
         total       = total + new.amount
   where id = new.txn_id;

  return null;
end;
$$;

create trigger ledger_entries_apply
  after insert on ledger_entries
  for each row execute function ledger_apply_entry();

-- 3. Nothing else may touch accounts.balance.
create or replace function accounts_balance_guard() returns trigger
language plpgsql as $$
begin
  if new.balance <> old.balance
     and coalesce(current_setting('app.ledger_write', true), '') <> '1' then
    raise exception 'accounts.balance may only change through the ledger';
  end if;
  return new;
end;
$$;

create trigger accounts_balance_guard
  before update on accounts
  for each row execute function accounts_balance_guard();

-- 4. Every txn must balance to zero, checked at commit so entries can arrive in
--    any order. entry_count > 0 also rejects an empty txn.
create or replace function ledger_check_balanced() returns trigger
language plpgsql as $$
declare
  t ledger_txns;
begin
  select * into t from ledger_txns where id = new.id;

  if t.entry_count = 0 then
    raise exception 'ledger txn % has no entries', t.id;
  end if;

  if t.total <> 0 then
    raise exception 'ledger txn % is unbalanced (total %)', t.id, t.total;
  end if;

  return null;
end;
$$;

create constraint trigger ledger_txn_balanced
  after insert on ledger_txns
  deferrable initially deferred
  for each row execute function ledger_check_balanced();
