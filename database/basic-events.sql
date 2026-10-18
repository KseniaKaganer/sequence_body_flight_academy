-- Run once in the shared Sequence / SHAKSHUKA Travel Supabase SQL Editor.
-- Uses the existing events, participants and event_participants tables.
begin;
create table if not exists public.basic_event_requests (
  event_id uuid primary key references public.events(id) on delete cascade,
  payload jsonb not null
);
alter table public.basic_event_requests enable row level security;
revoke all on public.basic_event_requests from anon, authenticated;
grant select, insert on public.basic_event_requests to authenticated;
drop policy if exists "Admins manage basic event requests" on public.basic_event_requests;
create policy "Admins manage basic event requests" on public.basic_event_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_create_basic_event(
  p_event_id uuid, p_name text, p_event_type text, p_start_date date, p_end_date date,
  p_participant_ids uuid[], p_new_names text[]
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_payload jsonb;
  v_previous jsonb;
  v_name text;
  v_id uuid;
  v_matches uuid[];
  v_status text;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_event_id is null or p_name is null or char_length(trim(p_name)) not between 1 and 150
    or p_event_type is null or p_event_type not in ('skydive', 'tunnel')
    or p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Enter an event name, type and valid start/end dates.';
  end if;
  if coalesce(cardinality(p_participant_ids), 0) + coalesce(cardinality(p_new_names), 0) not between 1 and 500 then
    raise exception 'Choose between 1 and 500 participants.';
  end if;
  v_payload := jsonb_build_object('name', trim(p_name), 'type', p_event_type,
    'start', p_start_date, 'end', p_end_date, 'ids', p_participant_ids, 'names', p_new_names);
  -- Serialize retries and name-only participant creation from this form.
  perform pg_advisory_xact_lock(1862026, 1);
  select payload into v_previous from public.basic_event_requests where event_id = p_event_id;
  if found then
    if v_previous <> v_payload then
      raise exception 'This event was already saved with different details. Reload Events and open it in SHAKSHUKA Travel to edit.';
    end if;
    return p_event_id;
  end if;
  if exists (select 1 from unnest(p_participant_ids) as ids(id)
    where id is null or not exists (select 1 from public.participants p where p.id = ids.id)) then
    raise exception 'A selected participant no longer exists. Reload Events and try again.';
  end if;
  -- Draft events remain available to admins for later editing without publishing.
  insert into public.events(id, name, event_type, start_date, end_date, status)
  values(p_event_id, trim(p_name), p_event_type, p_start_date, p_end_date, 'draft');
  v_status := case when p_end_date < (now() at time zone 'Asia/Jerusalem')::date
    then 'completed' else 'active' end;
  insert into public.event_participants(event_id, participant_id, participant_status)
  select p_event_id, id, v_status from (select distinct unnest(p_participant_ids) as id) ids;
  foreach v_name in array coalesce(p_new_names, array[]::text[]) loop
    v_name := regexp_replace(trim(v_name), '\s+', ' ', 'g');
    if v_name is null or char_length(v_name) not between 1 and 150 then
      raise exception 'Participant names must contain 1 to 150 characters.';
    end if;
    select array_agg(id order by id) into v_matches from public.participants
    where lower(regexp_replace(trim(concat_ws(' ', display_name, nullif(trim(surname), ''))), '\s+', ' ', 'g')) = lower(v_name);
    if coalesce(cardinality(v_matches), 0) > 1 then
      raise exception 'Several records match %. Select the existing participant instead.', v_name;
    elsif cardinality(v_matches) = 1 then
      v_id := v_matches[1];
    else
      insert into public.participants(display_name) values(v_name) returning id into v_id;
    end if;
    insert into public.event_participants(event_id, participant_id, participant_status)
      values(p_event_id, v_id, v_status) on conflict (event_id, participant_id) do nothing;
  end loop;
  insert into public.basic_event_requests(event_id, payload) values(p_event_id, v_payload);
  return p_event_id;
end;
$$;
revoke all on function public.admin_create_basic_event(uuid,text,text,date,date,uuid[],text[]) from public, anon;
grant execute on function public.admin_create_basic_event(uuid,text,text,date,date,uuid[],text[]) to authenticated;
-- Phone-enabled version; the original endpoint stays available for older open tabs.
create or replace function public.admin_create_basic_event_v2(
  p_event_id uuid, p_name text, p_event_type text, p_start_date date, p_end_date date,
  p_participant_ids uuid[], p_new_names text[], p_new_phones text[], p_participant_phones jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_payload jsonb;
  v_previous jsonb;
  v_name text;
  v_id uuid;
  v_matches uuid[];
  v_status text;
  v_phone text;
  v_change jsonb;
  v_index integer := 0;
  v_original text;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_event_id is null or p_name is null or char_length(trim(p_name)) not between 1 and 150
    or p_event_type is null or p_event_type not in ('skydive', 'tunnel')
    or p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Enter an event name, type and valid start/end dates.';
  end if;
  if coalesce(cardinality(p_participant_ids), 0) + coalesce(cardinality(p_new_names), 0) not between 1 and 500 then
    raise exception 'Choose between 1 and 500 participants.';
  end if;
  if cardinality(coalesce(p_new_names, array[]::text[])) <> cardinality(coalesce(p_new_phones, array[]::text[]))
    or p_participant_phones is null or jsonb_typeof(p_participant_phones) <> 'array' then
    raise exception 'Invalid participant phone data.';
  end if;
  v_payload := jsonb_build_object('name', trim(p_name), 'type', p_event_type,
    'start', p_start_date, 'end', p_end_date, 'ids', p_participant_ids, 'names', p_new_names, 'new_phones', p_new_phones, 'phones', p_participant_phones);
  -- Serialize retries and name-only participant creation from this form.
  perform pg_advisory_xact_lock(1862026, 1);
  select payload into v_previous from public.basic_event_requests where event_id = p_event_id;
  if found then
    if v_previous <> v_payload then
      raise exception 'This event was already saved with different details. Reload Events and open it in SHAKSHUKA Travel to edit.';
    end if;
    return p_event_id;
  end if;
  if exists (select 1 from unnest(p_participant_ids) as ids(id)
    where id is null or not exists (select 1 from public.participants p where p.id = ids.id)) then
    raise exception 'A selected participant no longer exists. Reload Events and try again.';
  end if;
  for v_change in select value from jsonb_array_elements(p_participant_phones) loop
    v_id := (v_change->>'id')::uuid;
    if v_id is null or not (v_id = any(coalesce(p_participant_ids, array[]::uuid[]))) then
      raise exception 'Phone updates must belong to selected participants.';
    end if;
    v_phone := nullif(trim(v_change->>'phone'), '');
    if v_phone is not null and (char_length(v_phone) > 40 or v_phone !~ '^[+0-9().[:space:]-]+$' or v_phone !~ '[0-9]') then
      raise exception 'Enter a valid phone number (up to 40 characters).';
    end if;
    select phone into v_original from public.participants where id = v_id for update;
    if v_original is distinct from (v_change->>'original_phone') then
      raise exception 'A participant phone changed. Reload Events before saving.';
    end if;
    -- Keep duplicate records grouped by their previous normalized phone.
    if v_phone is not null and exists (select 1 from public.participants p
      where ltrim(regexp_replace(p.phone, '[^0-9]', '', 'g'), '0') = ltrim(regexp_replace(v_phone, '[^0-9]', '', 'g'), '0')
      and p.id <> v_id
      and (nullif(ltrim(regexp_replace(v_original, '[^0-9]', '', 'g'), '0'), '') is null
        or ltrim(regexp_replace(p.phone, '[^0-9]', '', 'g'), '0') <> ltrim(regexp_replace(v_original, '[^0-9]', '', 'g'), '0'))) then
      raise exception 'That phone belongs to another participant. Select their existing record instead.';
    end if;
    update public.participants set phone = v_phone where id = v_id
      or (nullif(ltrim(regexp_replace(v_original, '[^0-9]', '', 'g'), '0'), '') is not null
        and ltrim(regexp_replace(phone, '[^0-9]', '', 'g'), '0') = ltrim(regexp_replace(v_original, '[^0-9]', '', 'g'), '0'));
  end loop;
  -- Draft events remain available to admins for later editing without publishing.
  insert into public.events(id, name, event_type, start_date, end_date, status)
  values(p_event_id, trim(p_name), p_event_type, p_start_date, p_end_date, 'draft');
  v_status := case when p_end_date < (now() at time zone 'Asia/Jerusalem')::date
    then 'completed' else 'active' end;
  insert into public.event_participants(event_id, participant_id, participant_status)
  select p_event_id, id, v_status from (select distinct unnest(p_participant_ids) as id) ids;
  foreach v_name in array coalesce(p_new_names, array[]::text[]) loop
    v_index := v_index + 1;
    v_phone := nullif(trim(p_new_phones[v_index]), '');
    if v_phone is not null and (char_length(v_phone) > 40 or v_phone !~ '^[+0-9().[:space:]-]+$' or v_phone !~ '[0-9]') then
      raise exception 'Enter a valid phone number (up to 40 characters).';
    end if;
    v_name := regexp_replace(trim(v_name), '\s+', ' ', 'g');
    if v_name is null or char_length(v_name) not between 1 and 150 then
      raise exception 'Participant names must contain 1 to 150 characters.';
    end if;
    select array_agg(id order by id) into v_matches from public.participants
    where lower(regexp_replace(trim(concat_ws(' ', display_name, nullif(trim(surname), ''))), '\s+', ' ', 'g')) = lower(v_name);
    if coalesce(cardinality(v_matches), 0) > 1 then
      raise exception 'Several records match %. Select the existing participant instead.', v_name;
    elsif cardinality(v_matches) = 1 then
      v_id := v_matches[1];
      if v_phone is not null then
        select phone into v_original from public.participants where id = v_id;
        if v_original is distinct from v_phone then
          raise exception '% already exists. Select them from the list to edit their phone.', v_name;
        end if;
      end if;
    else
      if v_phone is not null and exists (select 1 from public.participants
        where ltrim(regexp_replace(phone, '[^0-9]', '', 'g'), '0') = ltrim(regexp_replace(v_phone, '[^0-9]', '', 'g'), '0')) then
        raise exception 'Phone for % matches an existing participant. Select them from the list.', v_name;
      end if;
      insert into public.participants(display_name, phone) values(v_name, v_phone) returning id into v_id;
    end if;
    insert into public.event_participants(event_id, participant_id, participant_status)
      values(p_event_id, v_id, v_status) on conflict (event_id, participant_id) do nothing;
  end loop;
  insert into public.basic_event_requests(event_id, payload) values(p_event_id, v_payload);
  return p_event_id;
end;
$$;
revoke all on function public.admin_create_basic_event_v2(uuid,text,text,date,date,uuid[],text[],text[],jsonb) from public, anon;
grant execute on function public.admin_create_basic_event_v2(uuid,text,text,date,date,uuid[],text[],text[],jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
