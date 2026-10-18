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
alter table public.sequence_activities add column if not exists coach_user_id uuid references public.admin_users(user_id) on delete set null;

-- The admin_users RLS policy exposes only the caller's row. Return the full
-- dropdown through this admin-checked function, without exposing emails.
create or replace function public.admin_list_sequence_coaches()
returns table(user_id uuid, display_name text)
language plpgsql stable security definer set search_path = public as $function$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  return query select a.user_id, left(coalesce(nullif(trim(a.display_name), ''), nullif(trim(a.email), ''), 'Admin'), 150)
    from public.admin_users a order by lower(coalesce(nullif(trim(a.display_name), ''), a.email, 'Admin')), a.user_id;
end;
$function$;
revoke all on function public.admin_list_sequence_coaches() from public, anon;
grant execute on function public.admin_list_sequence_coaches() to authenticated;

create or replace function public.admin_create_sequence_activity_v2(
  p_activity_id uuid, p_category text, p_title text, p_start_date date, p_end_date date,
  p_location text, p_coach_user_id uuid, p_notes text, p_participant_ids uuid[], p_new_participants jsonb
) returns uuid language plpgsql security invoker set search_path = public as $function$
declare
  v_payload jsonb;
  v_previous jsonb;
  v_ids uuid[];
  v_coach text;
  v_person jsonb;
  v_name text;
  v_surname text;
  v_full text;
  v_phone text;
  v_existing_phone text;
  v_matches uuid[];
  v_id uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_activity_id is null or p_category is null or p_category not in ('skydive','theory','flybox','social')
    or p_title is null or char_length(trim(p_title)) not between 1 and 150
    or p_start_date is null or p_end_date is null or p_end_date < p_start_date
    or char_length(p_location) > 150 or char_length(p_notes) > 5000 then
    raise exception 'Enter a title, category and valid dates; shorten any fields that exceed their limit.';
  end if;
  if p_new_participants is null or jsonb_typeof(p_new_participants) <> 'array' then
    raise exception 'Invalid new participant data.';
  end if;
  if coalesce(cardinality(p_participant_ids), 0) + jsonb_array_length(p_new_participants) > 500 then
    raise exception 'Select up to 500 participants.';
  end if;
  if p_coach_user_id is not null then
    select c.display_name into v_coach from public.admin_list_sequence_coaches() c where c.user_id = p_coach_user_id;
    if not found then raise exception 'Selected coach is no longer an admin. Reopen the form.'; end if;
  end if;
  select coalesce(array_agg(id order by id), array[]::uuid[]) into v_ids
    from (select distinct unnest(coalesce(p_participant_ids, array[]::uuid[])) as id) ids;
  v_payload := jsonb_build_object('category', p_category, 'title', trim(p_title), 'start', p_start_date, 'end', p_end_date,
    'location', p_location, 'coach_id', p_coach_user_id, 'notes', p_notes, 'participants', v_ids, 'new_participants', p_new_participants);
  -- Share the participant lock with Travel and quick phone editing.
  perform pg_advisory_xact_lock(1862026, 1);
  perform pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 0));
  select request_payload into v_previous from public.sequence_activities where id = p_activity_id;
  if found then
    if v_previous <> v_payload then raise exception 'This activity was already saved with different details. Cancel and reopen Add Activity.'; end if;
    return p_activity_id;
  end if;
  if exists (select 1 from unnest(v_ids) ids(id) where id is null or not exists (select 1 from public.participants p where p.id = ids.id)) then
    raise exception 'A selected participant no longer exists. Cancel and reopen Add Activity.';
  end if;
  for v_person in select value from jsonb_array_elements(p_new_participants) loop
    if jsonb_typeof(v_person) <> 'object' then raise exception 'Invalid participant data.'; end if;
    v_name := regexp_replace(trim(v_person->>'name'), '\s+', ' ', 'g');
    v_surname := nullif(regexp_replace(trim(v_person->>'surname'), '\s+', ' ', 'g'), '');
    v_phone := nullif(trim(v_person->>'phone'), '');
    if v_name is null or char_length(v_name) not between 1 and 150 or char_length(v_surname) > 150 then
      raise exception 'Enter a participant name; name and surname can each contain up to 150 characters.';
    end if;
    if v_phone is not null and (char_length(v_phone) > 40 or v_phone !~ '^[+0-9().[:space:]-]+
commit;
 or v_phone !~ '[0-9]') then
      raise exception 'Enter a valid phone number (up to 40 characters).';
    end if;
    v_full := concat_ws(' ', v_name, v_surname);
    select array_agg(id order by id) into v_matches from public.participants
      where lower(regexp_replace(trim(concat_ws(' ', display_name, nullif(trim(surname), ''))), '\s+', ' ', 'g')) = lower(v_full);
    if coalesce(cardinality(v_matches), 0) > 1 then
      raise exception 'Several records match %. Select their existing record.', v_full;
    elsif cardinality(v_matches) = 1 then
      v_id := v_matches[1];
      select phone into v_existing_phone from public.participants where id = v_id;
      if v_phone is not null and ltrim(regexp_replace(coalesce(v_existing_phone, ''), '[^0-9]', '', 'g'), '0') <> ltrim(regexp_replace(v_phone, '[^0-9]', '', 'g'), '0') then
        raise exception '% already exists. Select their existing record to edit their phone.', v_full;
      end if;
    else
      if v_phone is not null and exists (select 1 from public.participants
        where ltrim(regexp_replace(phone, '[^0-9]', '', 'g'), '0') = ltrim(regexp_replace(v_phone, '[^0-9]', '', 'g'), '0')) then
        raise exception 'Phone for % belongs to an existing participant. Select them from the list.', v_full;
      end if;
      insert into public.participants(display_name, surname, phone) values(v_name, v_surname, v_phone) returning id into v_id;
    end if;
    if not (v_id = any(v_ids)) then v_ids := array_append(v_ids, v_id); end if;
  end loop;
  insert into public.sequence_activities(id, category, title, start_date, end_date, location, coach, coach_user_id, notes, request_payload)
    values(p_activity_id, p_category, trim(p_title), p_start_date, p_end_date, nullif(trim(p_location), ''), v_coach, p_coach_user_id, nullif(trim(p_notes), ''), v_payload);
  insert into public.sequence_activity_participants(activity_id, participant_id) select p_activity_id, id from unnest(v_ids) ids(id);
  return p_activity_id;
end;
$function$;
revoke all on function public.admin_create_sequence_activity_v2(uuid,text,text,date,date,text,uuid,text,uuid[],jsonb) from public, anon;
grant execute on function public.admin_create_sequence_activity_v2(uuid,text,text,date,date,text,uuid,text,uuid[],jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
