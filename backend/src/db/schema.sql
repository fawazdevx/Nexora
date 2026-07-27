create table if not exists app_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists operators (
  id uuid primary key,
  wallet_address text unique not null,
  arc_name text,
  reputation_score integer not null default 0,
  verified_builder boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists agent_wallets (
  id uuid primary key,
  operator_id uuid not null references operators(id),
  wallet_address text unique not null,
  circle_wallet_id text,
  daily_limit_usdc numeric not null,
  transaction_cap_usdc numeric not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists marketplace_services (
  id uuid primary key,
  publisher_operator_id uuid not null references operators(id),
  contract_service_id numeric,
  name text not null,
  endpoint_hash text not null,
  price_per_unit_usdc numeric not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists x402_requests (
  id uuid primary key,
  service_id uuid not null references marketplace_services(id),
  request_hash text unique not null,
  payer_wallet text not null,
  units numeric not null,
  gross_amount_usdc numeric not null,
  status text not null,
  tx_hash text,
  created_at timestamptz not null default now()
);

-- Money path (task 3): payments and payment_intents are promoted out of the
-- app_store JSONB blob into their own tables so the DB enforces the money-path
-- invariants directly, instead of relying on the global app_store row lock.
-- Promoted columns are the ones we query or constrain on; the full typed
-- record lives in `record` jsonb so no reader loses fields.
create table if not exists payments (
  id text primary key,
  request_hash text not null,
  status text not null,
  agent_id text,
  payer text not null,
  publisher_address text not null,
  service_id text not null,
  amount_usdc numeric not null,
  units numeric not null,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  record jsonb not null
);

-- Replay guard: a given request hash can hold at most one live (authorized or
-- settled) payment. Failed/policy_blocked attempts are excluded so a blocked
-- request can be legitimately retried. This is the DB-level enforcement that
-- replaces the write-time replay re-check once the global row lock is gone.
create unique index if not exists payments_request_hash_active
  on payments (request_hash)
  where status in ('authorized', 'settled');

-- Backs the daily/weekly/monthly spend-window aggregates in the policy engine.
create index if not exists payments_agent_settled
  on payments (agent_id, status, settled_at);

create table if not exists payment_intents (
  id text primary key,
  operator_address text not null,
  agent_id text,
  request_hash text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  record jsonb not null
);

create index if not exists payment_intents_operator
  on payment_intents (operator_address, created_at desc);

create table if not exists earn_opportunities (
  id uuid primary key,
  title text not null,
  category text not null,
  payout_asset text not null default 'USDC',
  expected_payout_usdc numeric,
  automation_enabled boolean not null default false,
  active boolean not null default true
);

create table if not exists reputation_events (
  id uuid primary key,
  operator_id uuid not null references operators(id),
  metric text not null,
  amount numeric not null,
  source text not null,
  tx_hash text,
  created_at timestamptz not null default now()
);
