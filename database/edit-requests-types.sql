-- Run after database/activity-types.sql in the shared Supabase project.
begin;
grant update(name) on public.sequence_activity_types to authenticated;
create or replace function public.admin_rename_activity_type(p_id uuid,p_original_name text,p_name text)
returns uuid language plpgsql security invoker set search_path=public as $function$
declare v_name text;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required.' using errcode='42501'; end if;
 v_name:=regexp_replace(trim(p_name),'\s+',' ','g');
 if v_name is null or char_length(v_name) not between 1 and 150 then raise exception 'Enter a name of up to 150 characters.'; end if;
 update public.sequence_activity_types set name=v_name where id=p_id and name=p_original_name;
 if not found then
   if exists(select 1 from public.sequence_activity_types where id=p_id and name=v_name) then return p_id; end if;
   raise exception 'This type changed elsewhere. Reopen the editor and try again.';
 end if;
 return p_id;
exception when unique_violation then raise exception 'A type with this name already exists in this category.';
end;
$function$;
revoke all on function public.admin_rename_activity_type(uuid,text,text) from public,anon;
grant execute on function public.admin_rename_activity_type(uuid,text,text) to authenticated;

create or replace function public.admin_edit_sequence_request(p_id uuid,p_original jsonb,p_type text,p_activity_type_id uuid,p_notes text,p_status text)
returns uuid language plpgsql security invoker set search_path=public as $function$
declare v_current jsonb; v_next jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required.' using errcode='42501'; end if;
 if p_type is null or p_type not in ('travel','skydive','theory','flybox','social','gear','other') or p_status is null or p_status not in ('new','in_progress','done','cancelled') or char_length(p_notes)>5000 then raise exception 'Choose a valid category and status; notes must be under 5000 characters.'; end if;
 if p_activity_type_id is not null and not exists(select 1 from public.sequence_activity_types where id=p_activity_type_id and category=p_type) then raise exception 'Choose a type from this category.'; end if;
 perform pg_advisory_xact_lock(1862026,1);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select jsonb_build_object('type',request_type,'activity_type_id',sequence_activity_type_id,'notes',notes,'status',status)
 into v_current from public.sequence_requests where id=p_id for update;
 if not found then raise exception 'This request no longer exists.'; end if;
 v_next:=jsonb_build_object('type',p_type,'activity_type_id',p_activity_type_id,'notes',nullif(trim(p_notes),''),'status',p_status);
 if v_current=v_next then return p_id; end if;
 if p_original is null or v_current<>p_original then raise exception 'This request changed elsewhere. Reopen the editor and try again.'; end if;
 update public.sequence_requests set request_type=p_type,sequence_activity_type_id=p_activity_type_id,notes=nullif(trim(p_notes),''),status=p_status where id=p_id;
 return p_id;
end;
$function$;
revoke all on function public.admin_edit_sequence_request(uuid,jsonb,text,uuid,text,text) from public,anon;
grant execute on function public.admin_edit_sequence_request(uuid,jsonb,text,uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
