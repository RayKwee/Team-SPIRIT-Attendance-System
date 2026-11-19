-- Team SPIRIT Attendance System — Supabase Schema & RLS Policies
-- Run this entire script in your Supabase Dashboard -> SQL Editor -> New Query.

-- 1. Club Members table (with timestamped soft-delete support for conflict resolution)
create table if not exists public.club_members (
  id text primary key,
  name text not null,
  member_type text not null default 'student'
    constraint club_members_member_type_check
    check (member_type in ('student', 'teacher', 'visitor')),
  class_name text,
  class_year smallint
    constraint club_members_class_year_check
    check (class_year is null or class_year between 7 and 11),
  class_letter text
    constraint club_members_class_letter_check
    check (class_letter is null or class_letter in ('T', 'E', 'N', 'B')),
  is_legacy boolean not null default false,
  retired_at timestamptz,
  last_promoted_year smallint
    constraint club_members_last_promoted_year_check
    check (last_promoted_year is null or last_promoted_year between 2000 and 2200),
  graduation_year smallint
    constraint club_members_graduation_year_check
    check (graduation_year is null or graduation_year between 2000 and 2200),
  role text,
  email text,
  phone text,
  handle text,
  joined_date text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Idempotent column upgrades for pre-existing public.club_members tables
alter table public.club_members
  add column if not exists member_type text not null default 'student';
alter table public.club_members
  add column if not exists class_name text;
alter table public.club_members
  add column if not exists class_year smallint;
alter table public.club_members
  add column if not exists class_letter text;
alter table public.club_members
  add column if not exists is_legacy boolean not null default false;
alter table public.club_members
  add column if not exists retired_at timestamptz;
alter table public.club_members
  add column if not exists last_promoted_year smallint;
alter table public.club_members
  add column if not exists graduation_year smallint;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'club_members_member_type_check'
      and conrelid = 'public.club_members'::regclass
  ) then
    alter table public.club_members
      add constraint club_members_member_type_check
      check (member_type in ('student', 'teacher', 'visitor'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'club_members_class_year_check'
      and conrelid = 'public.club_members'::regclass
  ) then
    alter table public.club_members
      add constraint club_members_class_year_check
      check (class_year is null or class_year between 7 and 11);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'club_members_class_letter_check'
      and conrelid = 'public.club_members'::regclass
  ) then
    alter table public.club_members
      add constraint club_members_class_letter_check
      check (class_letter is null or class_letter in ('T', 'E', 'N', 'B'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'club_members_last_promoted_year_check'
      and conrelid = 'public.club_members'::regclass
  ) then
    alter table public.club_members
      add constraint club_members_last_promoted_year_check
      check (last_promoted_year is null or last_promoted_year between 2000 and 2200);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'club_members_graduation_year_check'
      and conrelid = 'public.club_members'::regclass
  ) then
    alter table public.club_members
      add constraint club_members_graduation_year_check
      check (graduation_year is null or graduation_year between 2000 and 2200);
  end if;
end $$;

-- 2. Attendance Sessions table (with timestamped soft-delete support)
create table if not exists public.attendance_sessions (
  id text primary key,
  name text not null,
  date text not null,
  time text not null,
  location text,
  description text,
  event_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 3. Session Attendance & Roster Assignment table (composite PK + soft-delete timestamps)
create table if not exists public.session_attendance (
  session_id text not null references public.attendance_sessions(id) on delete cascade,
  member_id text not null references public.club_members(id) on delete cascade,
  status text not null default 'unmarked'
    check (status in ('present', 'absent_with_reason', 'absent_without_reason', 'unmarked')),
  reason text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (session_id, member_id)
);

-- Helpful indexes for ordering and sync lookups
create index if not exists idx_club_members_updated_at on public.club_members (updated_at desc);
create index if not exists idx_club_members_is_legacy on public.club_members (is_legacy);
create index if not exists idx_attendance_sessions_date on public.attendance_sessions (date desc, time desc);
create index if not exists idx_session_attendance_updated_at on public.session_attendance (updated_at desc);

-- 4. Grant schema & table privileges to authenticated users (required alongside RLS)
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on table public.club_members to authenticated;
grant select, insert, update, delete on table public.attendance_sessions to authenticated;
grant select, insert, update, delete on table public.session_attendance to authenticated;
grant all on table public.club_members, public.attendance_sessions, public.session_attendance to service_role;

-- 5. Enable Row-Level Security (RLS) on all tables
alter table public.club_members enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.session_attendance enable row level security;

-- 6. Policies: Only authenticated users (created manually by admin) can read/write
drop policy if exists "Authenticated users can manage club_members" on public.club_members;
create policy "Authenticated users can manage club_members"
  on public.club_members
  for all
  to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "Authenticated users can manage attendance_sessions" on public.attendance_sessions;
create policy "Authenticated users can manage attendance_sessions"
  on public.attendance_sessions
  for all
  to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "Authenticated users can manage session_attendance" on public.session_attendance;
create policy "Authenticated users can manage session_attendance"
  on public.session_attendance
  for all
  to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

-- 7. Enable Realtime publication for live multi-tab / multi-device sync
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'club_members'
  ) then
    alter publication supabase_realtime add table public.club_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_sessions'
  ) then
    alter publication supabase_realtime add table public.attendance_sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_attendance'
  ) then
    alter publication supabase_realtime add table public.session_attendance;
  end if;
end $$;

-- 8. Reload PostgREST schema cache immediately
notify pgrst, 'reload schema';
