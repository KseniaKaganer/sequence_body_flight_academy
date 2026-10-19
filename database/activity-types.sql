-- Run after basic-events.sql, local-activities.sql and requests.sql.
begin;
create table if not exists public.sequence_activity_types (
 id uuid primary key default gen_random_uuid(),
 category text not null check(category in ('travel','skydive','theory','flybox','social','gear','other')),
 name text not null check(char_length(trim(name)) between 1 and 150),
 created_at timestamptz not null default now()
);
create unique index if not exists sequence_activity_types_name_idx on public.sequence_activity_types(category,lower(regexp_replace(trim(name), '\s+', ' ', 'g')));
alter table public.sequence_activity_types enable row level security;
revoke all on public.sequence_activity_types from public, anon, authenticated;
grant select,insert on public.sequence_activity_types to authenticated;
drop policy if exists "Admins manage activity types" on public.sequence_activity_types;
create policy "Admins manage activity types" on public.sequence_activity_types for all to authenticated using(public.is_admin()) with check(public.is_admin());
insert into public.sequence_activity_types(category,name) values ('theory','Exams'),('theory','Packing Course'),('theory','Water Training'),('theory','Canopy Training') on conflict do nothing;
alter table public.events add column if not exists sequence_activity_type_id uuid references public.sequence_activity_types(id);
alter table public.sequence_activities add column if not exists sequence_activity_type_id uuid references public.sequence_activity_types(id);
alter table public.sequence_requests add column if not exists sequence_activity_type_id uuid references public.sequence_activity_types(id);
create or replace function public.admin_save_activity_type(p_category text,p_name text) returns uuid
language plpgsql security invoker set search_path=public as $function$
declare v_id uuid; v_name text;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required.' using errcode='42501'; end if;
 v_name:=regexp_replace(trim(p_name),'\s+',' ','g');
 if v_name is null or char_length(v_name) not between 1 and 150 then raise exception 'Enter a type name of up to 150 characters.'; end if;
 insert into public.sequence_activity_types(category,name) values(p_category,v_name) on conflict do nothing;
 select id into strict v_id from public.sequence_activity_types where category=p_category and lower(regexp_replace(trim(name),'\s+',' ','g'))=lower(v_name);
 return v_id;
end;
$function$;
revoke all on function public.admin_save_activity_type(text,text) from public,anon;
grant execute on function public.admin_save_activity_type(text,text) to authenticated;

create or replace function public.admin_create_sequence_activity_v3(
  p_activity_id uuid, p_category text, p_title text, p_start_date date, p_end_date date,
  p_location text, p_coach_user_id uuid, p_notes text, p_participant_ids uuid[], p_new_participants jsonb, p_activity_type_id uuid
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

  if p_activity_type_id is not null and not exists(select 1 from public.sequence_activity_types where id=p_activity_type_id and category=p_category) then raise exception 'Choose a type from this category.'; end if;
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
  v_payload := jsonb_build_object('activity_type_id',p_activity_type_id,'category', p_category, 'title', trim(p_title), 'start', p_start_date, 'end', p_end_date,
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
    if v_phone is not null and (char_length(v_phone) > 40 or v_phone !~ '^[+0-9().[:space:]-]+$' or v_phone !~ '[0-9]') then
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
  insert into public.sequence_activities(id, category, title, start_date, end_date, location, coach, coach_user_id, notes, request_payload, sequence_activity_type_id)
    values(p_activity_id, p_category, trim(p_title), p_start_date, p_end_date, nullif(trim(p_location), ''), v_coach, p_coach_user_id, nullif(trim(p_notes), ''), v_payload, p_activity_type_id);
  insert into public.sequence_activity_participants(activity_id, participant_id) select p_activity_id, id from unnest(v_ids) ids(id);
  return p_activity_id;
end;
$function$;
revoke all on function public.admin_create_sequence_activity_v3(uuid,text,text,date,date,text,uuid,text,uuid[],jsonb,uuid) from public, anon;
grant execute on function public.admin_create_sequence_activity_v3(uuid,text,text,date,date,text,uuid,text,uuid[],jsonb,uuid) to authenticated;

create or replace function public.admin_create_sequence_request_v2(
  p_request_id uuid, p_type text, p_notes text, p_participant_ids uuid[], p_new_participants jsonb, p_activity_type_id uuid
) returns uuid language plpgsql security invoker set search_path = public as $function$
declare
  v_payload jsonb;
  v_previous jsonb;
  v_ids uuid[];
  v_person jsonb;
  v_name text;
  v_surname text;
  v_full text;
  v_phone text;
  v_existing_phone text;
  v_matches uuid[];
  v_id uuid;
begin

  if p_activity_type_id is not null and not exists(select 1 from public.sequence_activity_types where id=p_activity_type_id and category=p_type) then raise exception 'Choose a type from this category.'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  if p_request_id is null or p_type is null or p_type not in ('travel','skydive','theory','flybox','social','gear','other')
    or char_length(p_notes) > 5000 then raise exception 'Choose a request type and keep notes under 5000 characters.'; end if;
  if p_new_participants is null or jsonb_typeof(p_new_participants) <> 'array' then raise exception 'Invalid participant data.'; end if;
  if coalesce(cardinality(p_participant_ids),0) + jsonb_array_length(p_new_participants) > 500 then
    raise exception 'Select up to 500 participants.';
  end if;
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_ids
    from (select distinct unnest(coalesce(p_participant_ids,array[]::uuid[])) as id) ids;
  v_payload := jsonb_build_object('activity_type_id',p_activity_type_id,'type',p_type,'notes',p_notes,'participants',v_ids,'new_participants',p_new_participants);
  perform pg_advisory_xact_lock(1862026,1);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select request_payload into v_previous from public.sequence_requests where id=p_request_id;
  if found then
    if v_previous <> v_payload then raise exception 'This request was already saved with different details. Close and reopen New Request.'; end if;
    return p_request_id;
  end if;
  if exists (select 1 from unnest(v_ids) ids(id) where id is null or not exists (select 1 from public.participants p where p.id=ids.id)) then
    raise exception 'A selected participant no longer exists. Reopen New Request.';
  end if;
  for v_person in select value from jsonb_array_elements(p_new_participants) loop
    if jsonb_typeof(v_person) <> 'object' then raise exception 'Invalid participant data.'; end if;
    v_name := regexp_replace(trim(v_person->>'name'), '\s+', ' ', 'g');
    v_surname := nullif(regexp_replace(trim(v_person->>'surname'), '\s+', ' ', 'g'), '');
    v_phone := nullif(trim(v_person->>'phone'), '');
    if v_name is null or char_length(v_name) not between 1 and 150 or char_length(v_surname) > 150 then
      raise exception 'Enter a participant name; name and surname can each contain up to 150 characters.';
    end if;
    if v_phone is not null and (char_length(v_phone) > 40 or v_phone !~ '^[+0-9().[:space:]-]+$' or v_phone !~ '[0-9]') then
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

  insert into public.sequence_requests(id,request_type,notes,request_payload,sequence_activity_type_id)
    values(p_request_id,p_type,nullif(trim(p_notes),''),v_payload, p_activity_type_id);
  insert into public.sequence_request_participants(request_id,participant_id) select p_request_id,id from unnest(v_ids) ids(id);
  return p_request_id;
end;
$function$;
revoke all on function public.admin_create_sequence_request_v2(uuid,text,text,uuid[],jsonb,uuid) from public, anon;
grant execute on function public.admin_create_sequence_request_v2(uuid,text,text,uuid[],jsonb,uuid) to authenticated;

create or replace function public.admin_create_basic_event_v4(
  p_event_id uuid, p_name text, p_event_type text, p_start_date date, p_end_date date,
  p_participant_ids uuid[], p_new_names text[], p_new_phones text[], p_participant_phones jsonb, p_new_surnames text[], p_activity_type_id uuid
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
  v_surname text;
  v_full_name text;
begin

  if p_activity_type_id is not null and not exists(select 1 from public.sequence_activity_types where id=p_activity_type_id and category='travel') then raise exception 'Choose a type from this category.'; end if;
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
    or cardinality(coalesce(p_new_names, array[]::text[])) <> cardinality(coalesce(p_new_surnames, array[]::text[]))
    or p_participant_phones is null or jsonb_typeof(p_participant_phones) <> 'array' then
    raise exception 'Invalid participant phone data.';
  end if;
  v_payload := jsonb_build_object('activity_type_id',p_activity_type_id,'name', trim(p_name), 'type', p_event_type,
    'start', p_start_date, 'end', p_end_date, 'ids', p_participant_ids, 'names', p_new_names, 'new_phones', p_new_phones, 'phones', p_participant_phones, 'surnames', p_new_surnames);
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
  insert into public.events(id, name, event_type, start_date, end_date, status, sequence_activity_type_id)
  values(p_event_id, trim(p_name), p_event_type, p_start_date, p_end_date, 'draft', p_activity_type_id);
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
    v_surname := nullif(regexp_replace(trim(p_new_surnames[v_index]), '\s+', ' ', 'g'), '');
    if char_length(v_surname) > 150 then raise exception 'Surnames must contain up to 150 characters.'; end if;
    v_name := regexp_replace(trim(v_name), '\s+', ' ', 'g');
    v_full_name := concat_ws(' ', v_name, v_surname);
    if v_name is null or char_length(v_name) not between 1 and 150 then
      raise exception 'Participant names must contain 1 to 150 characters.';
    end if;
    select array_agg(id order by id) into v_matches from public.participants
    where lower(regexp_replace(trim(concat_ws(' ', display_name, nullif(trim(surname), ''))), '\s+', ' ', 'g')) = lower(v_full_name);
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
      insert into public.participants(display_name, surname, phone) values(v_name, v_surname, v_phone) returning id into v_id;
    end if;
    insert into public.event_participants(event_id, participant_id, participant_status)
      values(p_event_id, v_id, v_status) on conflict (event_id, participant_id) do nothing;
  end loop;
  insert into public.basic_event_requests(event_id, payload) values(p_event_id, v_payload);
  return p_event_id;
end;
$$;
revoke all on function public.admin_create_basic_event_v4(uuid,text,text,date,date,uuid[],text[],text[],jsonb,text[],uuid) from public, anon;
grant execute on function public.admin_create_basic_event_v4(uuid,text,text,date,date,uuid[],text[],text[],jsonb,text[],uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
