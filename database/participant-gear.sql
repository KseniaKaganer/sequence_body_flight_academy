-- Run once in the shared Sequence / Shakshuka Travel Supabase project.
-- Current gear profiles supplement Travel snapshots without modifying them.
begin;
create table if not exists public.participant_gear_profiles (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  canopy_size numeric check (canopy_size > 0),
  reserve_size numeric check (reserve_size > 0),
  reserve_date date,
  reserve_rental boolean,
  notes text check (char_length(notes) <= 5000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.participant_gear_profiles enable row level security;
revoke all on public.participant_gear_profiles from anon, authenticated;
grant select, insert, update on public.participant_gear_profiles to authenticated;
drop policy if exists "Admins manage participant gear" on public.participant_gear_profiles;
create policy "Admins manage participant gear" on public.participant_gear_profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create or replace function public.admin_save_participant_gear(
  p_participant_id uuid, p_expected_updated_at timestamptz,
  p_canopy_size numeric, p_reserve_size numeric, p_reserve_date date, p_reserve_rental boolean, p_notes text
) returns timestamptz language plpgsql security invoker set search_path=public as $function$
declare
  v_previous public.participant_gear_profiles%rowtype;
  v_exists boolean;
  v_stamp timestamptz := clock_timestamp();
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if p_participant_id is null or not exists(select 1 from public.participants where id=p_participant_id) then raise exception 'Participant no longer exists.'; end if;
  if p_canopy_size <= 0 or p_reserve_size <= 0 or char_length(p_notes)>5000 then raise exception 'Use positive canopy sizes and notes under 5000 characters.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('participant-gear:' || p_participant_id::text,0));
  select * into v_previous from public.participant_gear_profiles where participant_id=p_participant_id for update;
  v_exists := found;
  if v_exists then
    -- A repeat after a lost response is harmless when the values are identical.
    if v_previous.canopy_size is not distinct from p_canopy_size and v_previous.reserve_size is not distinct from p_reserve_size
      and v_previous.reserve_date is not distinct from p_reserve_date and v_previous.reserve_rental is not distinct from p_reserve_rental
      and v_previous.notes is not distinct from nullif(trim(p_notes),'') then return v_previous.updated_at; end if;
    if v_previous.updated_at is distinct from p_expected_updated_at then raise exception 'Gear changed elsewhere. Cancel, refresh the participant, and edit again.'; end if;
    update public.participant_gear_profiles set canopy_size=p_canopy_size,reserve_size=p_reserve_size,reserve_date=p_reserve_date,
      reserve_rental=p_reserve_rental,notes=nullif(trim(p_notes),''),updated_by=auth.uid(),updated_at=v_stamp where participant_id=p_participant_id;
  else
    if p_expected_updated_at is not null then raise exception 'Gear profile changed or was removed. Refresh the participant.'; end if;
    insert into public.participant_gear_profiles(participant_id,canopy_size,reserve_size,reserve_date,reserve_rental,notes,updated_by,updated_at)
      values(p_participant_id,p_canopy_size,p_reserve_size,p_reserve_date,p_reserve_rental,nullif(trim(p_notes),''),auth.uid(),v_stamp);
  end if;
  return v_stamp;
end;
$function$;
revoke all on function public.admin_save_participant_gear(uuid,timestamptz,numeric,numeric,date,boolean,text) from public,anon;
grant execute on function public.admin_save_participant_gear(uuid,timestamptz,numeric,numeric,date,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
