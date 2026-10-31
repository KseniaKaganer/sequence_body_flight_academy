-- Shared Sequence / Shakshuka participant info. Existing admin-only RLS applies.
alter table public.participants
  add column if not exists shakshuka_points integer not null default 0
  check (shakshuka_points >= 0);
