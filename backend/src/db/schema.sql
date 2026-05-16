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
