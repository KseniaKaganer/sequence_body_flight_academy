-- Run once in the shared Sequence / Shakshuka Supabase project.
begin;
create table if not exists public.sequence_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('travel','skydive','theory','flybox','social','gear','other')),
  notes text check (char_length(notes) <= 5000),
  status text not null default 'new' check (status in ('new','in_progress','done','cancelled')),
  request_payload jsonb not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.sequence_request_participants (
  request_id uuid not null references public.sequence_requests(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  primary key (request_id, participant_id)
);
create index if not exists sequence_requests_created_idx on public.sequence_requests(created_at desc);
create index if not exists sequence_request_participants_person_idx on public.sequence_request_participants(participant_id);
alter table public.sequence_requests enable row level security;
alter table public.sequence_request_participants enable row level security;
revoke all on public.sequence_requests, public.sequence_request_participants from anon, authenticated;
grant select, insert, update, delete on public.sequence_requests, public.sequence_request_participants to authenticated;
drop policy if exists "Admins manage requests" on public.sequence_requests;
create policy "Admins manage requests" on public.sequence_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins manage request participants" on public.sequence_request_participants;
create policy "Admins manage request participants" on public.sequence_request_participants for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_create_sequence_request(
  p_request_id uuid, p_type text, p_notes text, p_participant_ids uuid[], p_new_participants jsonb
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
  if not coalesce(public.is_admin(), false) then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  if p_request_id is null or p_type is null or p_type not in ('travel','skydive','theory','flybox','social','gear','other')
    or char_length(p_notes) > 5000 then raise exception 'Choose a request type and keep notes under 5000 characters.'; end if;
  if p_new_participants is null or jsonb_typeof(p_new_participants) <> 'array' then raise exception 'Invalid participant data.'; end if;
  if coalesce(cardinality(p_participant_ids),0) + jsonb_array_length(p_new_participants) not between 1 and 500 then
    raise exception 'Choose between 1 and 500 participants.';
  end if;
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_ids
    from (select distinct unnest(coalesce(p_participant_ids,array[]::uuid[])) as id) ids;
  v_payload := jsonb_build_object('type',p_type,'notes',p_notes,'participants',v_ids,'new_participants',p_new_participants);
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

  insert into public.sequence_requests(id,request_type,notes,request_payload)
    values(p_request_id,p_type,nullif(trim(p_notes),''),v_payload);
  insert into public.sequence_request_participants(request_id,participant_id) select p_request_id,id from unnest(v_ids) ids(id);
  return p_request_id;
end;
$function$;
revoke all on function public.admin_create_sequence_request(uuid,text,text,uuid[],jsonb) from public, anon;
grant execute on function public.admin_create_sequence_request(uuid,text,text,uuid[],jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
