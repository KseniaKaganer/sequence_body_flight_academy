-- Run once in the SAME Supabase project as Sequence and Shakshuka Travel.
-- Local activities stay separate from Travel events and reuse participant identities.
begin;
create table if not exists public.sequence_activities (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('skydive','theory','flybox','social')),
  title text not null check (char_length(trim(title)) between 1 and 150),
  start_date date not null,
  end_date date not null,
  location text check (char_length(location) <= 150),
  coach text check (char_length(coach) <= 150),
  notes text check (char_length(notes) <= 5000),
  request_payload jsonb not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create table if not exists public.sequence_activity_participants (
  activity_id uuid not null references public.sequence_activities(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  primary key (activity_id, participant_id)
);
create index if not exists sequence_activities_category_date_idx on public.sequence_activities(category, start_date);
create index if not exists sequence_activity_participants_person_idx on public.sequence_activity_participants(participant_id);
alter table public.sequence_activities enable row level security;
alter table public.sequence_activity_participants enable row level security;
revoke all on public.sequence_activities, public.sequence_activity_participants from anon, authenticated;
grant select, insert, update, delete on public.sequence_activities, public.sequence_activity_participants to authenticated;
drop policy if exists "Admins manage local activities" on public.sequence_activities;
create policy "Admins manage local activities" on public.sequence_activities for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins manage local activity participants" on public.sequence_activity_participants;
create policy "Admins manage local activity participants" on public.sequence_activity_participants for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_create_sequence_activity(
  p_activity_id uuid, p_category text, p_title text, p_start_date date, p_end_date date,
  p_location text, p_coach text, p_notes text, p_participant_ids uuid[]
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_payload jsonb;
  v_previous jsonb;
  v_ids uuid[];
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_activity_id is null or p_category is null or p_category not in ('skydive','theory','flybox','social')
    or p_title is null or char_length(trim(p_title)) not between 1 and 150
    or p_start_date is null or p_end_date is null or p_end_date < p_start_date
    or char_length(p_location) > 150 or char_length(p_coach) > 150 or char_length(p_notes) > 5000 then
    raise exception 'Enter a title, category and valid dates; shorten any fields that exceed their limit.';
  end if;
  if coalesce(cardinality(p_participant_ids), 0) > 500 then raise exception 'Select up to 500 participants.'; end if;
  select coalesce(array_agg(id order by id), array[]::uuid[]) into v_ids
    from (select distinct unnest(coalesce(p_participant_ids, array[]::uuid[])) as id) ids;
  v_payload := jsonb_build_object('category', p_category, 'title', trim(p_title), 'start', p_start_date, 'end', p_end_date,
    'location', p_location, 'coach', p_coach, 'notes', p_notes, 'participants', v_ids);
  perform pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 0));
  select request_payload into v_previous from public.sequence_activities where id = p_activity_id;
  if found then
    if v_previous <> v_payload then raise exception 'This activity was already saved with different details. Close and reopen Add Activity.'; end if;
    return p_activity_id;
  end if;
  if exists (select 1 from unnest(v_ids) ids(id) where id is null or not exists (select 1 from public.participants p where p.id = ids.id)) then
    raise exception 'A selected participant no longer exists. Close and reopen Add Activity.';
  end if;
  insert into public.sequence_activities(id, category, title, start_date, end_date, location, coach, notes, request_payload)
    values(p_activity_id, p_category, trim(p_title), p_start_date, p_end_date, nullif(trim(p_location), ''), nullif(trim(p_coach), ''), nullif(trim(p_notes), ''), v_payload);
  insert into public.sequence_activity_participants(activity_id, participant_id) select p_activity_id, id from unnest(v_ids) ids(id);
  return p_activity_id;
end;
$$;
revoke all on function public.admin_create_sequence_activity(uuid,text,text,date,date,text,text,text,uuid[]) from public, anon;
grant execute on function public.admin_create_sequence_activity(uuid,text,text,date,date,text,text,text,uuid[]) to authenticated;
notify pgrst, 'reload schema';
commit;
