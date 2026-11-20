-- APEX F1 Intelligence — accounts, predictions and friend leagues (points only, no money).
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run again.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 30),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1), 'Player'), 30))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- races (written only by the trusted sync job)
create table if not exists public.races (
  id integer primary key,                 -- F1DB race id
  season integer not null,
  round integer not null,
  name text not null,
  circuit text,
  starts_at timestamptz not null,         -- predictions lock at this moment
  drivers jsonb not null default '[]',    -- [{id, code, name, team, colour}]
  result jsonb,                           -- {winner, p2, p3, fastest_lap, safety_car, winner_stops}; null until the race is scored
  scored_at timestamptz
);
alter table public.races enable row level security;

-- ---------------------------------------------------------------- predictions
create table if not exists public.predictions (
  user_id uuid not null references auth.users(id) on delete cascade,
  race_id integer not null references public.races(id) on delete cascade,
  winner text not null,
  p2 text not null,
  p3 text not null,
  fastest_lap text,
  safety_car boolean,
  winner_stops integer check (winner_stops between 0 and 6),
  updated_at timestamptz not null default now(),
  primary key (user_id, race_id),
  check (winner <> p2 and winner <> p3 and p2 <> p3)
);
alter table public.predictions enable row level security;

-- ---------------------------------------------------------------- leagues
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  invite_code text not null unique,
  owner uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;

-- membership test that does not recurse through row level security
create or replace function public.is_member(l uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.league_members m where m.league_id = l and m.user_id = auth.uid());
$$;
create or replace function public.shares_league(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.league_members a join public.league_members b on a.league_id = b.league_id
                 where a.user_id = auth.uid() and b.user_id = other);
$$;

-- ---------------------------------------------------------------- policies
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_league(id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists races_read on public.races;
create policy races_read on public.races for select to anon, authenticated using (true);

-- your own prediction: always readable; writable only before lights out
drop policy if exists predictions_read on public.predictions;
create policy predictions_read on public.predictions for select to authenticated
  using (user_id = auth.uid()
         or (public.shares_league(user_id) and exists (select 1 from public.races r where r.id = race_id and now() >= r.starts_at)));
drop policy if exists predictions_insert on public.predictions;
create policy predictions_insert on public.predictions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.races r where r.id = race_id and now() < r.starts_at));
drop policy if exists predictions_update on public.predictions;
create policy predictions_update on public.predictions for update to authenticated
  using (user_id = auth.uid() and exists (select 1 from public.races r where r.id = race_id and now() < r.starts_at))
  with check (user_id = auth.uid() and exists (select 1 from public.races r where r.id = race_id and now() < r.starts_at));

drop policy if exists leagues_read on public.leagues;
create policy leagues_read on public.leagues for select to authenticated using (public.is_member(id));
drop policy if exists members_read on public.league_members;
create policy members_read on public.league_members for select to authenticated using (public.is_member(league_id));
drop policy if exists members_leave on public.league_members;
create policy members_leave on public.league_members for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- league actions (the only way to create or join)
create or replace function public.create_league(league_name text) returns public.leagues
language plpgsql security definer set search_path = public as $$
declare l public.leagues; code text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if (select count(*) from public.leagues where owner = auth.uid()) >= 10 then raise exception 'You can own at most 10 leagues'; end if;
  loop
    code := upper(substr(translate(md5(random()::text || clock_timestamp()::text), '01', ''), 1, 6));
    exit when char_length(code) = 6 and not exists (select 1 from public.leagues where invite_code = code);
  end loop;
  insert into public.leagues (name, invite_code, owner) values (trim(league_name), code, auth.uid()) returning * into l;
  insert into public.league_members (league_id, user_id) values (l.id, auth.uid());
  return l;
end $$;

create or replace function public.join_league(code text) returns public.leagues
language plpgsql security definer set search_path = public as $$
declare l public.leagues;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into l from public.leagues where invite_code = upper(trim(code));
  if not found then raise exception 'No league with that invite code'; end if;
  if (select count(*) from public.league_members where league_id = l.id) >= 200 then raise exception 'That league is full'; end if;
  insert into public.league_members (league_id, user_id) values (l.id, auth.uid()) on conflict do nothing;
  return l;
end $$;

-- ---------------------------------------------------------------- scoring
-- Winner 10 · P2 6 · P3 4 (exact slot) · 2 for a podium driver in the wrong slot · fastest lap 3 · Safety Car yes/no 3 · winner's stops 3
create or replace function public.score_prediction(p public.predictions, r jsonb) returns integer
language sql immutable as $$
  select case when r is null then null else
      (case when p.winner = r->>'winner' then 10 when p.winner in (r->>'p2', r->>'p3') then 2 else 0 end)
    + (case when p.p2 = r->>'p2' then 6 when p.p2 in (r->>'winner', r->>'p3') then 2 else 0 end)
    + (case when p.p3 = r->>'p3' then 4 when p.p3 in (r->>'winner', r->>'p2') then 2 else 0 end)
    + (case when p.fastest_lap is not null and p.fastest_lap = r->>'fastest_lap' then 3 else 0 end)
    + (case when p.safety_car is not null and r->>'safety_car' is not null and p.safety_car = (r->>'safety_car')::boolean then 3 else 0 end)
    + (case when p.winner_stops is not null and r->>'winner_stops' is not null and p.winner_stops = (r->>'winner_stops')::integer then 3 else 0 end)
  end;
$$;

-- standings for one league (members only)
create or replace function public.league_leaderboard(l uuid)
returns table (user_id uuid, display_name text, points integer, races_scored integer, last_race_points integer, has_next_pick boolean)
language sql stable security definer set search_path = public as $$
  with allowed as (select public.is_member(l) as ok),
       last_race as (select id from public.races where result is not null order by starts_at desc limit 1),
       next_race as (select id from public.races where starts_at > now() order by starts_at limit 1)
  select m.user_id, pr.display_name,
         coalesce(sum(public.score_prediction(p, r.result)) filter (where r.result is not null), 0)::integer,
         (count(*) filter (where r.result is not null))::integer,
         (sum(public.score_prediction(p, r.result)) filter (where r.id = (select id from last_race)))::integer,
         bool_or(p.race_id = (select id from next_race)) is true
  from public.league_members m
  join public.profiles pr on pr.id = m.user_id
  left join public.predictions p on p.user_id = m.user_id
  left join public.races r on r.id = p.race_id
  where m.league_id = l and (select ok from allowed)
  group by m.user_id, pr.display_name
  order by 3 desc, pr.display_name;
$$;

-- everyone's picks for one race in one league, visible only after lights out
create or replace function public.league_picks(l uuid, race integer)
returns table (user_id uuid, display_name text, winner text, p2 text, p3 text, fastest_lap text, safety_car boolean, winner_stops integer, points integer)
language sql stable security definer set search_path = public as $$
  select m.user_id, pr.display_name, p.winner, p.p2, p.p3, p.fastest_lap, p.safety_car, p.winner_stops, public.score_prediction(p, r.result)
  from public.league_members m
  join public.profiles pr on pr.id = m.user_id
  join public.races r on r.id = race
  left join public.predictions p on p.user_id = m.user_id and p.race_id = race
  where m.league_id = l and public.is_member(l) and now() >= r.starts_at
  order by 9 desc nulls last, pr.display_name;
$$;

revoke all on function public.create_league(text), public.join_league(text), public.league_leaderboard(uuid), public.league_picks(uuid, integer) from public, anon;
grant execute on function public.create_league(text), public.join_league(text), public.league_leaderboard(uuid), public.league_picks(uuid, integer) to authenticated;
grant select on public.races to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.predictions to authenticated;
grant select on public.leagues to authenticated;
grant select, delete on public.league_members to authenticated;


-- ---------------------------------------------------------------- account deletion
-- Their profile, picks and league memberships go with the account (those tables cascade from auth.users).
-- A league they created is handed to its longest-standing other member first; it is deleted only if nobody
-- else is in it, so friends do not lose a league because its creator left.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  update public.leagues l
     set owner = (select m.user_id from public.league_members m
                   where m.league_id = l.id and m.user_id <> me order by m.joined_at limit 1)
   where l.owner = me
     and exists (select 1 from public.league_members m where m.league_id = l.id and m.user_id <> me);
  delete from auth.users where id = me;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
