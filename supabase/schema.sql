-- Receipt Bill Splitter: run once in Supabase -> SQL Editor. (Can share a project with other apps.)
create table if not exists public.bills (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  merchant         text,
  total_paise      bigint not null,
  data             jsonb not null,    -- people, items, charges, who has paid. Receipt photos are never stored.
  edit_token_hash  text not null      -- sha256 of the payer's edit token; the token itself is never stored
);
create index if not exists bills_expires_at_idx on public.bills (expires_at);

-- Row Level Security ON with no policies: only the backend's secret (service_role) key can access it.
alter table public.bills enable row level security;
grant select, insert, update, delete on public.bills to service_role;

-- Optional nightly cleanup (enable the pg_cron extension first):
-- select cron.schedule('purge-expired-bills', '0 3 * * *', $$delete from public.bills where expires_at < now()$$);
