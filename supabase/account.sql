-- APEX F1 Intelligence — let a signed-in player delete their own account. Run once in Supabase → SQL Editor.
-- Safe to run again. (Also included at the end of schema.sql.)
--
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
