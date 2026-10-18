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
notify pgrst, 'reload schema';
commit;
