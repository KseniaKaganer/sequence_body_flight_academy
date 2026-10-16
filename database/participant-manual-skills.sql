-- Run once in the SAME Supabase project used by Shakshuka and Sequence.
begin;
create table if not exists public.participant_manual_skills (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  skill_name text not null check (char_length(trim(skill_name)) between 1 and 150),
  skill_date date,
  notes text check (notes is null or char_length(notes) <= 5000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists participant_manual_skills_participant_idx
  on public.participant_manual_skills(participant_id);
alter table public.participant_manual_skills enable row level security;
revoke all on public.participant_manual_skills from anon, authenticated;
grant select, insert on public.participant_manual_skills to authenticated;
drop policy if exists "Admins read manual skills" on public.participant_manual_skills;
create policy "Admins read manual skills" on public.participant_manual_skills
  for select to authenticated using (public.is_admin());
drop policy if exists "Admins add manual skills" on public.participant_manual_skills;
create policy "Admins add manual skills" on public.participant_manual_skills
  for insert to authenticated with check (public.is_admin() and created_by = auth.uid());
notify pgrst, 'reload schema';
commit;
