-- Result cache for the API server (optional). Run once in the Supabase SQL editor.
-- Only the server writes and reads it, using the service_role key set on Render — never put that key in
-- Vercel or the browser. Row-level security is on with no policies, so the public (anon) key sees nothing.
create table if not exists public.api_cache (
  key        text primary key,
  version    text not null,
  name       text,
  value      jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists api_cache_version_idx on public.api_cache (version);
alter table public.api_cache enable row level security;
