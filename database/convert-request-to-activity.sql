-- Run in the shared Supabase SQL Editor after the existing activity/request migrations.
begin;
alter table public.sequence_requests add column if not exists converted_activity_id uuid;
alter table public.sequence_requests add column if not exists converted_category text;

create or replace function public.admin_convert_sequence_request(
 p_request_id uuid, p_category text, p_title text, p_start_date date,
 p_end_date date, p_location text, p_notes text, p_event_type text
) returns uuid language plpgsql security invoker set search_path=public as $$
declare r public.sequence_requests%rowtype; v_id uuid := gen_random_uuid(); v_type uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required.' using errcode='42501'; end if;
 if p_category is null or p_category not in ('travel','skydive','theory','flybox','social')
 or p_title is null or char_length(trim(p_title)) not between 1 and 150
 or p_start_date is null or p_end_date is null or p_end_date<p_start_date
 or char_length(p_location)>150 or char_length(p_notes)>5000 then
 raise exception 'Enter a title, category and valid dates.'; end if;
 if p_category='travel' and (p_event_type is null or p_event_type not in ('skydive','tunnel')) then raise exception 'Choose a travel event type.'; end if;
 -- Match the locks used by request edits and participant additions.
 perform pg_advisory_xact_lock(1862026,1);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into r from public.sequence_requests where id=p_request_id for update;
 if not found then raise exception 'Request no longer exists.'; end if;
 if r.converted_activity_id is not null then return r.converted_activity_id; end if;
 if r.status='cancelled' then raise exception 'Reopen the cancelled request before converting it.'; end if;
 if r.request_type=p_category then v_type:=r.sequence_activity_type_id; end if;
 if p_category='travel' then
   insert into public.events(id,name,event_type,start_date,end_date,status,venue,description,sequence_activity_type_id)
   values(v_id,trim(p_title),p_event_type,p_start_date,p_end_date,'draft',nullif(trim(p_location),''),nullif(trim(p_notes),''),v_type);
   insert into public.event_participants(event_id,participant_id,participant_status)
   select v_id,participant_id,case when p_end_date<(now() at time zone 'Asia/Jerusalem')::date then 'completed' else 'active' end
   from public.sequence_request_participants where request_id=p_request_id;
 else
   insert into public.sequence_activities(id,category,title,start_date,end_date,location,notes,sequence_activity_type_id,request_payload)
   values(v_id,p_category,trim(p_title),p_start_date,p_end_date,nullif(trim(p_location),''),nullif(trim(p_notes),''),v_type,jsonb_build_object('source_request_id',p_request_id));
   insert into public.sequence_activity_participants(activity_id,participant_id)
   select v_id,participant_id from public.sequence_request_participants where request_id=p_request_id;
 end if;
 update public.sequence_requests set status='done',converted_activity_id=v_id,converted_category=p_category where id=p_request_id;
 return v_id;
end;
$$;
revoke all on function public.admin_convert_sequence_request(uuid,text,text,date,date,text,text,text) from public,anon;
grant execute on function public.admin_convert_sequence_request(uuid,text,text,date,date,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
