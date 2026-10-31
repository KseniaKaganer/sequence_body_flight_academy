-- Run after database/participant-login.sql. All fixture/session changes roll back.
begin;
do $$
declare p uuid; result jsonb; session_token text; i integer;
begin
 insert into public.participants(display_name,surname,phone,active,is_admin_participant)
 values('Sequence Login','Fixture','+19995550123',true,false) returning id into p;
 result:=public.sequence_participant_login('sequence   login fixture','+1 (999) 555-0123');
 assert (result->>'ok')::boolean, 'normalized name/phone should log in';
 assert result->>'participant_id'=p::text, 'wrong participant';
 session_token:=result->>'token';
 assert length(session_token)=64, 'invalid token';
 assert (public.sequence_participant_session(session_token)->>'ok')::boolean, 'restore failed';
 assert not (public.sequence_participant_login('Wrong Name','+19995550123')->>'ok')::boolean, 'wrong name accepted';
 assert not (public.sequence_participant_login('Sequence Login Fixture','+19995550124')->>'ok')::boolean, 'wrong phone accepted';
 assert not (public.sequence_participant_session('invalid')->>'ok')::boolean, 'invalid token accepted';
 perform public.sequence_participant_logout(session_token);
 assert not (public.sequence_participant_session(session_token)->>'ok')::boolean, 'logout did not revoke token';
 result:=public.sequence_participant_login('Sequence Login Fixture','+19995550123');
 session_token:=result->>'token';
 update sequence_private.participant_sessions set expires_at=now()-interval '1 second' where participant_id=p;
 assert not (public.sequence_participant_session(session_token)->>'ok')::boolean, 'expired token accepted';
 update public.participants set active=false where id=p;
 assert not (public.sequence_participant_login('Sequence Login Fixture','+19995550123')->>'ok')::boolean, 'inactive participant accepted';
 update public.participants set active=true,is_admin_participant=true where id=p;
 assert not (public.sequence_participant_login('Sequence Login Fixture','+19995550123')->>'ok')::boolean, 'admin identity accepted';
 update public.participants set is_admin_participant=false where id=p;
 for i in 1..11 loop result:=public.sequence_participant_login('Sequence Login Fixture','+19995550123'); end loop;
 assert not (result->>'ok')::boolean, 'rate limit failed';
 assert not has_table_privilege('anon','sequence_private.participant_sessions','select'), 'anon can read sessions';
 assert not has_table_privilege('authenticated','sequence_private.participant_sessions','select'), 'authenticated can read sessions';
end $$;
rollback;
