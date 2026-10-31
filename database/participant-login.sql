-- Sequence participant sessions are separate from Supabase/admin authentication.
-- Phone is a shared secret in this requested login flow, not SMS-verified identity.
create schema if not exists sequence_private;
revoke all on schema sequence_private from public, anon, authenticated;
create table if not exists sequence_private.participant_sessions (
 token_hash text primary key,
 participant_id uuid not null references public.participants(id) on delete cascade,
 expires_at timestamptz not null default (now()+interval '12 hours')
);
create table if not exists sequence_private.login_attempts (
 phone_hash text primary key, started_at timestamptz not null, attempts integer not null
);
alter table sequence_private.participant_sessions enable row level security;
alter table sequence_private.login_attempts enable row level security;
revoke all on all tables in schema sequence_private from public, anon, authenticated;

-- These narrow endpoints intentionally accept unauthenticated callers. No table
-- access is granted. Only a name/phone match can mint a token; other calls require it.
create or replace function public.sequence_participant_login(p_name text,p_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_phone text; v_name text; v_hash text; v_attempts integer;
 v_ids uuid[]; v_id uuid; v_display text; v_token text; v_expires timestamptz;
begin
 if p_name is null or p_phone is null or length(p_name)>200 or length(p_phone)>40 then return jsonb_build_object('ok',false); end if;
 v_name:=lower(regexp_replace(trim(p_name),'\s+',' ','g'));
 v_phone:=public.normalize_travel_phone(p_phone);
 if length(v_name)<2 or length(v_phone)<7 then return jsonb_build_object('ok',false); end if;
 v_hash:=encode(extensions.digest(v_phone,'sha256'),'hex');
 insert into sequence_private.login_attempts as a values(v_hash,now(),1)
 on conflict(phone_hash) do update set
 attempts=case when a.started_at<now()-interval '15 minutes' then 1 else a.attempts+1 end,
 started_at=case when a.started_at<now()-interval '15 minutes' then now() else a.started_at end
 returning attempts into v_attempts;
 if v_attempts>10 then return jsonb_build_object('ok',false); end if;
 select array_agg(p.id order by p.created_at,p.id) into v_ids from public.participants p
 where p.active and not coalesce(p.is_admin_participant,false)
 and public.normalize_travel_phone(p.phone)=v_phone
 and lower(regexp_replace(trim(concat_ws(' ',p.display_name,nullif(trim(p.surname),''))),'\s+',' ','g'))=v_name;
 if coalesce(cardinality(v_ids),0)=0 then return jsonb_build_object('ok',false); end if;
 -- Duplicate event records with the same full name and phone share one identity.
 v_id:=v_ids[1];
 select trim(concat_ws(' ',p.display_name,nullif(trim(p.surname),''))) into v_display from public.participants p where p.id=v_id;
 v_token:=encode(extensions.gen_random_bytes(32),'hex');v_expires:=now()+interval '12 hours';
 delete from sequence_private.participant_sessions where expires_at<now();
 delete from sequence_private.login_attempts where started_at<now()-interval '1 day';
 insert into sequence_private.participant_sessions values(encode(extensions.digest(v_token,'sha256'),'hex'),v_id,v_expires);
 return jsonb_build_object('ok',true,'token',v_token,'participant_id',v_id,'display_name',v_display,'expires_at',v_expires);
end $$;
create or replace function public.sequence_participant_session(p_token text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('ok',true,'participant_id',p.id,'display_name',trim(concat_ws(' ',p.display_name,nullif(trim(p.surname),''))),'expires_at',s.expires_at)
 from sequence_private.participant_sessions s join public.participants p on p.id=s.participant_id
 where length(p_token)=64 and s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
 and s.expires_at>now() and p.active and not coalesce(p.is_admin_participant,false)),jsonb_build_object('ok',false));
$$;
create or replace function public.sequence_participant_logout(p_token text)
returns void language sql security definer set search_path='' as $$
 delete from sequence_private.participant_sessions where length(p_token)=64 and token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
$$;
revoke all on function public.sequence_participant_login(text,text),public.sequence_participant_session(text),public.sequence_participant_logout(text) from public,anon,authenticated;
grant execute on function public.sequence_participant_login(text,text),public.sequence_participant_session(text),public.sequence_participant_logout(text) to anon,authenticated;
