-- Team SPIRIT Attendance System — Supabase Schema & RLS Policies
-- Run this entire script in your Supabase Dashboard -> SQL Editor -> New Query.

create extension if not exists pgcrypto with schema extensions;

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
    check (class_letter is null or class_letter in ('T', 'E', 'N', 'B', 'N/A')),
  is_legacy boolean not null default false,
  retired_at timestamptz,
  last_promoted_year smallint
    constraint club_members_last_promoted_year_check
    check (last_promoted_year is null or last_promoted_year between 2000 and 2200),
  graduation_year smallint
    constraint club_members_graduation_year_check
    check (graduation_year is null or graduation_year between 2000 and 2200),
  role text not null
    constraint club_members_role_check
    check (length(btrim(role)) > 0),
  email text,
  phone text,
  handle text,
  joined_date text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sync_version integer not null default 1,
  last_edited_by text
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
alter table public.club_members
  add column if not exists sync_version integer not null default 1;
alter table public.club_members
  add column if not exists last_edited_by text;
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

  alter table public.club_members
    drop constraint if exists club_members_class_letter_check;
  alter table public.club_members
    add constraint club_members_class_letter_check
    check (class_letter is null or class_letter in ('T', 'E', 'N', 'B', 'N/A'));

  update public.club_members
    set role = 'Member'
    where role is null or length(btrim(role)) = 0;

  alter table public.club_members
    alter column role set not null;

  alter table public.club_members
    drop constraint if exists club_members_role_check;
  alter table public.club_members
    add constraint club_members_role_check
    check (length(btrim(role)) > 0);

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

-- 2. Attendance Sessions table (with per-meeting visibility, creator ownership, soft-delete & CAS sync_version)
create table if not exists public.attendance_sessions (
  id text primary key,
  name text not null,
  date text not null,
  time text not null,
  location text,
  description text,
  event_type text,
  visibility text not null default 'public'
    constraint attendance_sessions_visibility_check
    check (visibility in ('public', 'admins_only', 'private')),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sync_version integer not null default 1,
  last_edited_by text
);

alter table public.attendance_sessions
  add column if not exists sync_version integer not null default 1;
alter table public.attendance_sessions
  add column if not exists last_edited_by text;
alter table public.attendance_sessions
  add column if not exists visibility text not null default 'public';
alter table public.attendance_sessions
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

do $$
begin
  update public.attendance_sessions
  set visibility = 'public'
  where visibility is null
     or visibility not in ('public', 'admins_only', 'private');

  if not exists (
    select 1
    from pg_constraint
    where conname = 'attendance_sessions_visibility_check'
      and conrelid = 'public.attendance_sessions'::regclass
  ) then
    alter table public.attendance_sessions
      add constraint attendance_sessions_visibility_check
      check (visibility in ('public', 'admins_only', 'private'));
  end if;
end $$;

-- 3. Session Attendance & Roster Assignment table (composite PK + soft-delete & CAS sync_version)
create table if not exists public.session_attendance (
  session_id text not null references public.attendance_sessions(id) on delete cascade,
  member_id text not null references public.club_members(id) on delete cascade,
  status text not null default 'unmarked'
    check (status in ('present', 'absent_with_reason', 'absent_without_reason', 'unmarked')),
  reason text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sync_version integer not null default 1,
  last_edited_by text,
  primary key (session_id, member_id)
);

alter table public.session_attendance
  add column if not exists sync_version integer not null default 1;
alter table public.session_attendance
  add column if not exists last_edited_by text;

-- Monotonic server-side version & timestamp trigger for clock-skew-proof CAS sync
create or replace function public.bump_sync_metadata()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.sync_version := greatest(coalesce(new.sync_version, 1), 1);
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;

  new.sync_version := coalesce(old.sync_version, 0) + 1;
  new.updated_at := greatest(
    now(),
    coalesce(old.updated_at, to_timestamp(0)) + interval '1 millisecond'
  );
  return new;
end;
$$;

drop trigger if exists trg_club_members_sync_metadata on public.club_members;
create trigger trg_club_members_sync_metadata
  before insert or update on public.club_members
  for each row execute function public.bump_sync_metadata();

-- Enforces server-side creator ownership and private-visibility guards on attendance_sessions
create or replace function public.enforce_attendance_session_ownership()
returns trigger
language plpgsql
as $$
declare
  acting_user_id uuid := auth.uid();
begin
  new.visibility := coalesce(nullif(btrim(new.visibility), ''), 'public');
  if new.visibility not in ('public', 'admins_only', 'private') then
    raise exception 'Invalid meeting visibility: %', new.visibility;
  end if;

  if tg_op = 'INSERT' then
    if acting_user_id is not null then
      new.created_by_user_id := acting_user_id;
    end if;
    if new.visibility = 'private' and new.created_by_user_id is null then
      raise exception 'Private meetings require an authenticated creator.';
    end if;
    return new;
  end if;

  -- Preserve original creator once assigned; allow claiming unowned legacy rows when switching to private.
  if old.created_by_user_id is not null then
    new.created_by_user_id := old.created_by_user_id;
  elsif new.visibility = 'private' and acting_user_id is not null then
    new.created_by_user_id := acting_user_id;
  else
    new.created_by_user_id := old.created_by_user_id;
  end if;

  if new.visibility = 'private' then
    if new.created_by_user_id is null then
      raise exception 'Private meetings require an authenticated creator.';
    end if;
    if acting_user_id is not null and new.created_by_user_id <> acting_user_id then
      raise exception 'Only the meeting creator can set a meeting to Private.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_attendance_sessions_ownership on public.attendance_sessions;
create trigger trg_attendance_sessions_ownership
  before insert or update on public.attendance_sessions
  for each row execute function public.enforce_attendance_session_ownership();

drop trigger if exists trg_attendance_sessions_sync_metadata on public.attendance_sessions;
create trigger trg_attendance_sessions_sync_metadata
  before insert or update on public.attendance_sessions
  for each row execute function public.bump_sync_metadata();

drop trigger if exists trg_session_attendance_sync_metadata on public.session_attendance;
create trigger trg_session_attendance_sync_metadata
  before insert or update on public.session_attendance
  for each row execute function public.bump_sync_metadata();

-- 3b. Project Ideas Board & Scoped Feedback Tables (auth profile-linked, role/visibility scoped)
create table if not exists public.project_ideas (
  id uuid primary key default gen_random_uuid(),
  submitted_by_user_id uuid references auth.users(id) on delete set null,
  linked_member_id text references public.club_members(id) on delete set null,
  author_name text not null
    constraint project_ideas_author_name_check
    check (length(btrim(author_name)) between 1 and 80),
  title text not null
    constraint project_ideas_title_check
    check (length(btrim(title)) between 2 and 120),
  description text not null
    constraint project_ideas_description_check
    check (length(btrim(description)) between 5 and 2000),
  category text
    constraint project_ideas_category_check
    check (category is null or length(btrim(category)) <= 40),
  review_status text not null default 'pending'
    constraint project_ideas_review_status_check
    check (review_status in ('pending', 'under_review', 'approved', 'archived')),
  is_highlighted boolean not null default false,
  admin_note text
    constraint project_ideas_admin_note_check
    check (admin_note is null or length(btrim(admin_note)) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_ideas
  add column if not exists submitted_by_user_id uuid references auth.users(id) on delete set null;
alter table public.project_ideas
  add column if not exists linked_member_id text references public.club_members(id) on delete set null;
alter table public.project_ideas
  add column if not exists review_status text not null default 'pending';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_ideas_review_status_check'
      and conrelid = 'public.project_ideas'::regclass
  ) then
    alter table public.project_ideas
      add constraint project_ideas_review_status_check
      check (review_status in ('pending', 'under_review', 'approved', 'archived'));
  end if;
end $$;

create or replace function public.touch_project_ideas_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_project_ideas_updated_at on public.project_ideas;
create trigger trg_project_ideas_updated_at
  before update on public.project_ideas
  for each row execute function public.touch_project_ideas_updated_at();

create table if not exists public.project_idea_feedback (
  idea_id uuid primary key references public.project_ideas(id) on delete cascade,
  feedback_text text not null
    constraint project_idea_feedback_text_check
    check (length(btrim(feedback_text)) between 1 and 1500),
  responder_user_id uuid references auth.users(id) on delete set null,
  responder_name text,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_project_idea_feedback_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_project_idea_feedback_updated_at on public.project_idea_feedback;
create trigger trg_project_idea_feedback_updated_at
  before update on public.project_idea_feedback
  for each row execute function public.touch_project_idea_feedback_updated_at();

-- Migrate any legacy public.project_ideas.admin_note values into private project_idea_feedback
do $$
begin
  insert into public.project_idea_feedback (idea_id, feedback_text, updated_at)
  select id, btrim(admin_note), updated_at
  from public.project_ideas
  where admin_note is not null
    and length(btrim(admin_note)) > 0
  on conflict (idea_id) do nothing;

  update public.project_ideas
  set admin_note = null
  where admin_note is not null;
end $$;

-- 3d. Official Club Posts & Updates Feed (admin-published, readable by everyone)
create table if not exists public.club_posts (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid references auth.users(id) on delete set null,
  author_name text not null
    constraint club_posts_author_name_check
    check (length(btrim(author_name)) between 1 and 80),
  category text not null default 'announcement'
    constraint club_posts_category_check
    check (category in ('announcement', 'meeting_reminder', 'resource_update', 'general')),
  title text not null
    constraint club_posts_title_check
    check (length(btrim(title)) between 2 and 140),
  content text not null
    constraint club_posts_content_check
    check (length(btrim(content)) between 5 and 4000),
  event_date text,
  resource_label text
    constraint club_posts_resource_label_check
    check (resource_label is null or length(btrim(resource_label)) <= 80),
  resource_url text
    constraint club_posts_resource_url_check
    check (
      resource_url is null
      or (length(btrim(resource_url)) <= 500 and resource_url ~* '^https?://')
    ),
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_club_posts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_club_posts_updated_at on public.club_posts;
create trigger trg_club_posts_updated_at
  before update on public.club_posts
  for each row execute function public.touch_club_posts_updated_at();

-- 3d-b. Comments & Replies under Club Posts (permission-gated for standard members)
create table if not exists public.club_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.club_posts(id) on delete cascade,
  parent_comment_id uuid references public.club_post_comments(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null
    constraint club_post_comments_author_name_check
    check (length(btrim(author_name)) between 1 and 80),
  author_role text not null default 'member'
    constraint club_post_comments_author_role_check
    check (author_role in ('admin', 'member')),
  content text not null
    constraint club_post_comments_content_check
    check (length(btrim(content)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_club_post_comments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_club_post_comments_updated_at on public.club_post_comments;
create trigger trg_club_post_comments_updated_at
  before update on public.club_post_comments
  for each row execute function public.touch_club_post_comments_updated_at();

-- 3e. Club-Wide Settings (Global Member Visibility, Content Deletion & Collaboration Permissions)
create table if not exists public.club_settings (
  id text primary key default 'default'
    constraint club_settings_singleton_check
    check (id = 'default'),
  member_can_view_roster boolean not null default false,
  member_can_view_attendance_rates boolean not null default false,
  member_can_view_calendar_details boolean not null default false,
  shared_idea_visibility boolean not null default false,
  member_can_comment_on_posts boolean not null default false,
  content_deletion_mode text not null default 'own_only'
    constraint club_settings_content_deletion_mode_check
    check (content_deletion_mode in ('own_only', 'any', 'disabled')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.club_settings
  add column if not exists member_can_view_roster boolean not null default false;
alter table public.club_settings
  add column if not exists member_can_view_attendance_rates boolean not null default false;
alter table public.club_settings
  add column if not exists member_can_view_calendar_details boolean not null default false;
alter table public.club_settings
  add column if not exists shared_idea_visibility boolean not null default false;
alter table public.club_settings
  add column if not exists member_can_comment_on_posts boolean not null default false;
alter table public.club_settings
  add column if not exists content_deletion_mode text not null default 'own_only';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'club_settings_content_deletion_mode_check'
      and conrelid = 'public.club_settings'::regclass
  ) then
    alter table public.club_settings
      add constraint club_settings_content_deletion_mode_check
      check (content_deletion_mode in ('own_only', 'any', 'disabled'));
  end if;
end $$;

insert into public.club_settings (
  id,
  member_can_view_roster,
  member_can_view_attendance_rates,
  member_can_view_calendar_details,
  shared_idea_visibility,
  member_can_comment_on_posts,
  content_deletion_mode
)
values ('default', false, false, false, false, false, 'own_only')
on conflict (id) do nothing;

-- Helpful indexes for ordering and sync lookups
create index if not exists idx_club_members_updated_at on public.club_members (updated_at desc);
create index if not exists idx_club_members_is_legacy on public.club_members (is_legacy);
create index if not exists idx_attendance_sessions_date on public.attendance_sessions (date desc, time desc);
create index if not exists idx_attendance_sessions_visibility_creator on public.attendance_sessions (visibility, created_by_user_id);
create index if not exists idx_session_attendance_updated_at on public.session_attendance (updated_at desc);
create index if not exists idx_project_ideas_highlighted_created on public.project_ideas (is_highlighted desc, created_at desc);
create index if not exists idx_project_ideas_submitted_by on public.project_ideas (submitted_by_user_id, created_at desc);
create index if not exists idx_club_posts_pinned_created on public.club_posts (is_pinned desc, created_at desc);
create index if not exists idx_club_post_comments_post_created on public.club_post_comments (post_id, created_at asc);

-- 3c. Admin Role Tracking & User Profiles (zero-trust server-enforced roles & member linking)
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'member'
    constraint user_profiles_role_check
    check (role in ('member', 'admin')),
  linked_member_id text references public.club_members(id) on delete set null,
  can_view_all_attendance boolean not null default false,
  is_disabled boolean not null default false,
  disabled_at timestamptz,
  disabled_by uuid references auth.users(id) on delete set null,
  promoted_by uuid references auth.users(id) on delete set null,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles
  add column if not exists linked_member_id text references public.club_members(id) on delete set null;
alter table public.user_profiles
  add column if not exists can_view_all_attendance boolean not null default false;
alter table public.user_profiles
  add column if not exists is_disabled boolean not null default false;
alter table public.user_profiles
  add column if not exists disabled_at timestamptz;
alter table public.user_profiles
  add column if not exists disabled_by uuid references auth.users(id) on delete set null;

create index if not exists idx_user_profiles_role on public.user_profiles (role, created_at asc);
create unique index if not exists idx_user_profiles_linked_member_unique
  on public.user_profiles (linked_member_id)
  where linked_member_id is not null;

-- Clear dangling user_profiles.linked_member_id references whenever a club member is soft-deleted
create or replace function public.unlink_soft_deleted_member_profiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.user_profiles
    set linked_member_id = null,
        updated_at = now()
    where linked_member_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.unlink_soft_deleted_member_profiles() from public, anon, authenticated;

drop trigger if exists trg_club_members_unlink_soft_deleted on public.club_members;
create trigger trg_club_members_unlink_soft_deleted
  after update of deleted_at on public.club_members
  for each row execute function public.unlink_soft_deleted_member_profiles();

update public.user_profiles up
set linked_member_id = null,
    updated_at = now()
where up.linked_member_id is not null
  and exists (
    select 1
    from public.club_members cm
    where cm.id = up.linked_member_id
      and cm.deleted_at is not null
  );

-- Server-side active-user, admin & visibility helpers (security definer avoids RLS recursion)
create or replace function public.is_active_user(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where user_id = check_user_id
      and is_disabled = false
      and (auth.uid() is null or check_user_id = auth.uid())
  );
$$;

create or replace function public.is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where user_id = check_user_id
      and role = 'admin'
      and is_disabled = false
      and (auth.uid() is null or check_user_id = auth.uid())
  );
$$;

create or replace function public.has_broad_visibility(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where user_id = check_user_id
      and is_disabled = false
      and (role = 'admin' or can_view_all_attendance = true)
      and (auth.uid() is null or check_user_id = auth.uid())
  );
$$;

create or replace function public.my_linked_member_id(check_user_id uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select linked_member_id
  from public.user_profiles
  where user_id = check_user_id
    and is_disabled = false
    and (auth.uid() is null or check_user_id = auth.uid())
  limit 1;
$$;

create or replace function public.is_member_in_session(
  target_session_id text,
  target_member_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.session_attendance
    where session_id = target_session_id
      and member_id = target_member_id
      and deleted_at is null
      and (
        auth.uid() is null
        or public.has_broad_visibility()
        or target_member_id = public.my_linked_member_id()
      )
  );
$$;

create or replace function public.can_read_attendance_session(target_session_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.attendance_sessions s
    where s.id = target_session_id
      and (
        auth.uid() is null
        or (
          public.is_active_user()
          and (
            s.visibility = 'public'
            or (s.visibility = 'admins_only' and public.is_admin())
            or (s.visibility = 'private' and s.created_by_user_id = (select auth.uid()))
          )
        )
      )
  );
$$;

create or replace function public.can_manage_attendance_session(target_session_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.attendance_sessions s
    where s.id = target_session_id
      and (
        auth.uid() is null
        or (
          public.is_admin()
          and (
            s.visibility <> 'private'
            or s.created_by_user_id = (select auth.uid())
          )
        )
      )
  );
$$;

revoke all on function public.is_active_user(uuid) from public, anon;
revoke all on function public.is_admin(uuid) from public, anon;
revoke all on function public.has_broad_visibility(uuid) from public, anon;
revoke all on function public.my_linked_member_id(uuid) from public, anon;
revoke all on function public.is_member_in_session(text, text) from public, anon;
revoke all on function public.can_read_attendance_session(text) from public, anon;
revoke all on function public.can_manage_attendance_session(text) from public, anon;
grant execute on function public.is_active_user(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.has_broad_visibility(uuid) to authenticated;
grant execute on function public.my_linked_member_id(uuid) to authenticated;
grant execute on function public.is_member_in_session(text, text) to authenticated;
grant execute on function public.can_read_attendance_session(text) to authenticated;
grant execute on function public.can_manage_attendance_session(text) to authenticated;

-- Finds a unique unlinked active roster member matching an email address (returns null if 0 or >1 match)
create or replace function public.find_unique_unlinked_member_by_email(target_email text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(btrim(coalesce(target_email, '')));
  matched_id text;
  match_count integer;
begin
  if length(normalized_email) = 0 then
    return null;
  end if;

  select count(*), min(cm.id)
  into match_count, matched_id
  from public.club_members cm
  where cm.deleted_at is null
    and cm.email is not null
    and lower(btrim(cm.email)) = normalized_email
    and not exists (
      select 1
      from public.user_profiles up
      where up.linked_member_id = cm.id
    );

  if match_count = 1 then
    return matched_id;
  end if;
  return null;
end;
$$;

revoke all on function public.find_unique_unlinked_member_by_email(text) from public, anon, authenticated;

-- Auto-verify newly created auth.users rows immediately without email confirmation
create or replace function public.auto_verify_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  if coalesce(new.confirmation_token, '') <> '' then
    new.confirmation_token := '';
  end if;
  return new;
end;
$$;

revoke all on function public.auto_verify_new_auth_user() from public, anon, authenticated;

drop trigger if exists trg_auth_users_auto_verify on auth.users;
create trigger trg_auth_users_auto_verify
  before insert on auth.users
  for each row execute function public.auto_verify_new_auth_user();

-- Assign role strictly by registration flow:
-- - Self-service registration (`signup_flow = 'self_service_admin'`) -> 'admin'
-- - Admin-provisioned member accounts (`signup_flow = 'admin_member_provision'`) -> 'member'
-- - Any other user creation -> safely defaults to 'member'
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  signup_flow text := lower(btrim(coalesce(new.raw_user_meta_data->>'signup_flow', '')));
  assigned_role text := case when signup_flow = 'self_service_admin' then 'admin' else 'member' end;
  auto_member_id text;
begin
  insert into public.user_profiles (user_id, email, role, promoted_at)
  values (
    new.id,
    coalesce(new.email, ''),
    assigned_role,
    case when assigned_role = 'admin' then now() else null end
  )
  on conflict (user_id) do update
    set email = coalesce(excluded.email, public.user_profiles.email),
        updated_at = now();

  -- Skip fuzzy email auto-linking for admin-provisioned accounts; the admin RPC links the exact target member.
  if signup_flow <> 'admin_member_provision' then
    auto_member_id := public.find_unique_unlinked_member_by_email(new.email);
    if auto_member_id is not null then
      update public.user_profiles
      set linked_member_id = auto_member_id,
          updated_at = now()
      where user_id = new.id
        and linked_member_id is null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auth_users_create_profile on auth.users;
create trigger trg_auth_users_create_profile
  after insert or update of email on auth.users
  for each row execute function public.handle_new_auth_user();

-- Idempotent initial bootstrap:
-- If no admin exists yet, promote the 2 earliest existing auth.users accounts as initial admins;
-- any remaining or future accounts default strictly to 'member'.
do $$
declare
  existing_admin_count integer;
begin
  select count(*) into existing_admin_count
  from public.user_profiles
  where role = 'admin';

  if existing_admin_count = 0 then
    with ordered_users as (
      select
        id,
        coalesce(email, '') as email,
        row_number() over (order by created_at asc, id asc) as rn
      from auth.users
    )
    insert into public.user_profiles (user_id, email, role, promoted_at)
    select
      id,
      email,
      case when rn <= 2 then 'admin' else 'member' end,
      case when rn <= 2 then now() else null end
    from ordered_users
    on conflict (user_id) do update
      set email = excluded.email,
          role = case
            when public.user_profiles.role = 'admin' then 'admin'
            else excluded.role
          end,
          promoted_at = coalesce(public.user_profiles.promoted_at, excluded.promoted_at),
          updated_at = now();
  else
    insert into public.user_profiles (user_id, email, role)
    select id, coalesce(email, ''), 'member'
    from auth.users
    on conflict (user_id) do update
      set email = excluded.email,
          updated_at = now();
  end if;
end $$;

-- Hardened RPC for promoting/demoting admins with last-admin protection
create or replace function public.set_user_admin_role(
  target_user_id uuid,
  make_admin boolean
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  target_row public.user_profiles;
  admin_count integer;
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can modify admin roles.'
      using errcode = '42501';
  end if;

  select * into target_row
  from public.user_profiles
  where user_id = target_user_id
  for update;

  if not found then
    raise exception 'Target account profile was not found.'
      using errcode = 'P0002';
  end if;

  if make_admin and target_row.is_disabled then
    raise exception 'Cannot promote a disabled account to Admin. Re-enable the account first.'
      using errcode = 'P0001';
  end if;

  if not make_admin and target_row.role = 'admin' and not target_row.is_disabled then
    -- Lock active admin rows to prevent concurrent last-admin demotion races
    perform 1 from public.user_profiles where role = 'admin' and is_disabled = false for update;
    select count(*) into admin_count
    from public.user_profiles
    where role = 'admin'
      and is_disabled = false;

    if admin_count <= 1 then
      if target_user_id = caller_id then
        raise exception 'You cannot remove your own admin status while you are the last remaining admin.'
          using errcode = 'P0001';
      else
        raise exception 'Cannot remove admin status from the last remaining administrator.'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  update public.user_profiles
  set
    role = case when make_admin then 'admin' else 'member' end,
    promoted_by = case when make_admin then caller_id else null end,
    promoted_at = case when make_admin then now() else null end,
    updated_at = now()
  where user_id = target_user_id
  returning * into target_row;

  return target_row;
end;
$$;

revoke all on function public.set_user_admin_role(uuid, boolean) from public, anon;
grant execute on function public.set_user_admin_role(uuid, boolean) to authenticated;

-- Allows an unlinked authenticated user to attempt exact-email auto-linking to a roster profile
create or replace function public.auto_link_my_member_profile()
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  current_profile public.user_profiles;
  matched_member_id text;
begin
  if caller_id is null then
    raise exception 'Authentication required.'
      using errcode = '42501';
  end if;

  select * into current_profile
  from public.user_profiles
  where user_id = caller_id
  for update;

  if not found then
    raise exception 'User profile not found.'
      using errcode = 'P0002';
  end if;

  if current_profile.linked_member_id is not null then
    if exists (
      select 1
      from public.club_members
      where id = current_profile.linked_member_id
        and deleted_at is null
    ) then
      return current_profile;
    end if;

    update public.user_profiles
    set linked_member_id = null,
        updated_at = now()
    where user_id = caller_id
    returning * into current_profile;
  end if;

  matched_member_id := public.find_unique_unlinked_member_by_email(current_profile.email);
  if matched_member_id is not null then
    update public.user_profiles
    set linked_member_id = matched_member_id,
        updated_at = now()
    where user_id = caller_id
    returning * into current_profile;
  end if;

  return current_profile;
end;
$$;

revoke all on function public.auto_link_my_member_profile() from public, anon;
grant execute on function public.auto_link_my_member_profile() to authenticated;

-- Admin-only RPC: link or unlink a login account to a specific club_members profile
create or replace function public.admin_link_user_to_member(
  target_user_id uuid,
  target_member_id text
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  cleaned_member_id text := nullif(btrim(coalesce(target_member_id, '')), '');
  target_row public.user_profiles;
  existing_owner_email text;
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can link member profiles.'
      using errcode = '42501';
  end if;

  select * into target_row
  from public.user_profiles
  where user_id = target_user_id
  for update;

  if not found then
    raise exception 'Target account profile was not found.'
      using errcode = 'P0002';
  end if;

  if cleaned_member_id is not null then
    if target_row.is_disabled then
      raise exception 'Cannot link a disabled account to a roster profile. Re-enable the account first.'
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from public.club_members
      where id = cleaned_member_id and deleted_at is null
    ) then
      raise exception 'Selected club member does not exist or has been deleted.'
        using errcode = 'P0002';
    end if;

    select email into existing_owner_email
    from public.user_profiles
    where linked_member_id = cleaned_member_id
      and user_id <> target_user_id
    limit 1;

    if found then
      raise exception 'This roster profile is already linked to account "%". Unlink it there first.', existing_owner_email
        using errcode = '23505';
    end if;
  end if;

  update public.user_profiles
  set
    linked_member_id = cleaned_member_id,
    updated_at = now()
  where user_id = target_user_id
  returning * into target_row;

  -- Backfill any project ideas previously submitted by this account so personal ideas stay connected
  if cleaned_member_id is not null then
    update public.project_ideas
    set linked_member_id = cleaned_member_id
    where submitted_by_user_id = target_user_id
      and linked_member_id is distinct from cleaned_member_id;
  end if;

  return target_row;
end;
$$;

revoke all on function public.admin_link_user_to_member(uuid, text) from public, anon;
grant execute on function public.admin_link_user_to_member(uuid, text) to authenticated;

-- Admin-only RPC: backfill any auth.users accounts missing from user_profiles & return updated directory
create or replace function public.admin_sync_auth_profiles()
returns setof public.user_profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can sync registered accounts.'
      using errcode = '42501';
  end if;

  insert into public.user_profiles (user_id, email, role)
  select u.id, coalesce(u.email, ''), 'member'
  from auth.users u
  on conflict (user_id) do update
    set email = coalesce(nullif(btrim(excluded.email), ''), public.user_profiles.email),
        updated_at = case
          when public.user_profiles.email is distinct from excluded.email then now()
          else public.user_profiles.updated_at
        end;

  return query
  select *
  from public.user_profiles
  order by role asc, created_at asc;
end;
$$;

revoke all on function public.admin_sync_auth_profiles() from public, anon;
grant execute on function public.admin_sync_auth_profiles() to authenticated;

-- Admin-only RPC: sync an existing auth.users account by user_id or email and link it to a club_members profile
create or replace function public.admin_sync_and_link_member_account(
  target_member_id text,
  target_email text default null,
  target_user_id uuid default null
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller_id uuid := auth.uid();
  cleaned_member_id text := nullif(btrim(coalesce(target_member_id, '')), '');
  normalized_email text := lower(btrim(coalesce(target_email, '')));
  resolved_user_id uuid := target_user_id;
  resolved_user_email text;
  existing_member_owner text;
  other_linked_member_name text;
  target_row public.user_profiles;
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can sync and link member accounts.'
      using errcode = '42501';
  end if;

  if cleaned_member_id is null then
    raise exception 'A target club member profile is required.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.club_members
    where id = cleaned_member_id
      and deleted_at is null
  ) then
    raise exception 'Selected club member does not exist in Supabase yet or has been deleted.'
      using errcode = 'P0002';
  end if;

  if resolved_user_id is not null then
    select u.id, coalesce(u.email, '')
    into resolved_user_id, resolved_user_email
    from auth.users u
    where u.id = target_user_id
    limit 1;
  elsif length(normalized_email) > 0 then
    select u.id, coalesce(u.email, '')
    into resolved_user_id, resolved_user_email
    from auth.users u
    where lower(btrim(coalesce(u.email, ''))) = normalized_email
    order by u.created_at asc
    limit 1;
  else
    raise exception 'Provide either an account email address or user ID to link.'
      using errcode = '22023';
  end if;

  if resolved_user_id is null then
    raise exception 'No Supabase login account found for "%". Create the account first or verify the email address.',
      coalesce(nullif(normalized_email, ''), target_user_id::text)
      using errcode = 'P0002';
  end if;

  -- Ensure the linked auth account is verified immediately without email confirmation steps
  update auth.users
  set email_confirmed_at = coalesce(email_confirmed_at, now()),
      confirmation_token = ''
  where id = resolved_user_id
    and email_confirmed_at is null;

  -- Ensure the auth user exists in public.user_profiles with its current email
  insert into public.user_profiles (user_id, email, role)
  values (resolved_user_id, coalesce(resolved_user_email, ''), 'member')
  on conflict (user_id) do update
    set email = coalesce(nullif(btrim(excluded.email), ''), public.user_profiles.email),
        updated_at = now();

  select * into target_row
  from public.user_profiles
  where user_id = resolved_user_id
  for update;

  if target_row.is_disabled then
    raise exception 'Account "%" is currently disabled. Re-enable it in the Accounts panel before linking.',
      coalesce(nullif(target_row.email, ''), resolved_user_id::text)
      using errcode = 'P0001';
  end if;

  -- Ensure this roster member is not already linked to a different login account
  select up.email into existing_member_owner
  from public.user_profiles up
  where up.linked_member_id = cleaned_member_id
    and up.user_id <> resolved_user_id
  limit 1;

  if found then
    raise exception 'This roster profile is already linked to account "%". Unlink it first before switching accounts.', existing_member_owner
      using errcode = '23505';
  end if;

  -- Ensure the target login account is not already linked to a different active roster member
  if target_row.linked_member_id is not null and target_row.linked_member_id <> cleaned_member_id then
    select cm.name into other_linked_member_name
    from public.club_members cm
    where cm.id = target_row.linked_member_id
      and cm.deleted_at is null
    limit 1;

    if found then
      raise exception 'Account "%" is already linked to "%". Unlink it from that member first.',
        coalesce(nullif(target_row.email, ''), resolved_user_id::text),
        other_linked_member_name
        using errcode = '23505';
    end if;
  end if;

  update public.user_profiles
  set
    linked_member_id = cleaned_member_id,
    updated_at = now()
  where user_id = resolved_user_id
  returning * into target_row;

  -- Backfill any project ideas previously submitted by this account so personal ideas stay connected
  update public.project_ideas
  set linked_member_id = cleaned_member_id
  where submitted_by_user_id = resolved_user_id
    and linked_member_id is distinct from cleaned_member_id;

  return target_row;
end;
$$;

revoke all on function public.admin_sync_and_link_member_account(text, text, uuid) from public, anon;
grant execute on function public.admin_sync_and_link_member_account(text, text, uuid) to authenticated;

-- Admin-only RPC: finalize a standalone (unlinked) newly created member account & guarantee verification
create or replace function public.admin_sync_unlinked_member_account(
  target_user_id uuid default null,
  target_email text default null
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller_id uuid := auth.uid();
  normalized_email text := lower(btrim(coalesce(target_email, '')));
  resolved_user_id uuid := target_user_id;
  resolved_user_email text;
  target_row public.user_profiles;
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can finalize new member accounts.'
      using errcode = '42501';
  end if;

  if resolved_user_id is not null then
    select u.id, coalesce(u.email, '')
    into resolved_user_id, resolved_user_email
    from auth.users u
    where u.id = target_user_id
    limit 1;
  elsif length(normalized_email) > 0 then
    select u.id, coalesce(u.email, '')
    into resolved_user_id, resolved_user_email
    from auth.users u
    where lower(btrim(coalesce(u.email, ''))) = normalized_email
    order by u.created_at asc
    limit 1;
  else
    raise exception 'Provide either a user ID or email address.'
      using errcode = '22023';
  end if;

  if resolved_user_id is null then
    raise exception 'No Supabase login account found for "%".',
      coalesce(nullif(normalized_email, ''), target_user_id::text)
      using errcode = 'P0002';
  end if;

  update auth.users
  set email_confirmed_at = coalesce(email_confirmed_at, now()),
      confirmation_token = ''
  where id = resolved_user_id
    and email_confirmed_at is null;

  insert into public.user_profiles (user_id, email, role)
  values (resolved_user_id, coalesce(resolved_user_email, ''), 'member')
  on conflict (user_id) do update
    set email = coalesce(nullif(btrim(excluded.email), ''), public.user_profiles.email),
        updated_at = now()
  returning * into target_row;

  return target_row;
end;
$$;

revoke all on function public.admin_sync_unlinked_member_account(uuid, text) from public, anon;
grant execute on function public.admin_sync_unlinked_member_account(uuid, text) to authenticated;

-- Admin-only RPC: disable or re-enable an account (revokes all RLS access & clears roster link when disabled)
create or replace function public.admin_set_user_disabled(
  target_user_id uuid,
  disable_account boolean
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  target_row public.user_profiles;
  active_admin_count integer;
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can disable or re-enable accounts.'
      using errcode = '42501';
  end if;

  if disable_account and target_user_id = caller_id then
    raise exception 'You cannot disable your own currently signed-in administrator account.'
      using errcode = 'P0001';
  end if;

  select * into target_row
  from public.user_profiles
  where user_id = target_user_id
  for update;

  if not found then
    raise exception 'Target account profile was not found.'
      using errcode = 'P0002';
  end if;

  if disable_account and target_row.role = 'admin' and not target_row.is_disabled then
    perform 1 from public.user_profiles where role = 'admin' and is_disabled = false for update;
    select count(*) into active_admin_count
    from public.user_profiles
    where role = 'admin'
      and is_disabled = false;

    if active_admin_count <= 1 then
      raise exception 'Cannot disable the last remaining active administrator.'
        using errcode = 'P0001';
    end if;
  end if;

  if disable_account then
    update public.user_profiles
    set
      is_disabled = true,
      disabled_at = now(),
      disabled_by = caller_id,
      role = 'member',
      can_view_all_attendance = false,
      linked_member_id = null,
      promoted_by = null,
      promoted_at = null,
      updated_at = now()
    where user_id = target_user_id
    returning * into target_row;
  else
    update public.user_profiles
    set
      is_disabled = false,
      disabled_at = null,
      disabled_by = null,
      updated_at = now()
    where user_id = target_user_id
    returning * into target_row;
  end if;

  return target_row;
end;
$$;

revoke all on function public.admin_set_user_disabled(uuid, boolean) from public, anon;
grant execute on function public.admin_set_user_disabled(uuid, boolean) to authenticated;

-- Admin-only RPC: remove an account permanently (deletes from auth.users when permitted, or revokes access permanently)
create or replace function public.admin_remove_user_account(
  target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller_id uuid := auth.uid();
  target_row public.user_profiles;
  active_admin_count integer;
  removal_mode text := 'deleted';
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can remove user accounts.'
      using errcode = '42501';
  end if;

  if target_user_id = caller_id then
    raise exception 'You cannot remove your own currently signed-in administrator account.'
      using errcode = 'P0001';
  end if;

  select * into target_row
  from public.user_profiles
  where user_id = target_user_id
  for update;

  if not found then
    raise exception 'Target account profile was not found.'
      using errcode = 'P0002';
  end if;

  if target_row.role = 'admin' and not target_row.is_disabled then
    perform 1 from public.user_profiles where role = 'admin' and is_disabled = false for update;
    select count(*) into active_admin_count
    from public.user_profiles
    where role = 'admin'
      and is_disabled = false;

    if active_admin_count <= 1 then
      raise exception 'Cannot remove the last remaining active administrator.'
        using errcode = 'P0001';
    end if;
  end if;

  -- Strip permissions & roster link immediately before attempting auth deletion
  update public.user_profiles
  set
    is_disabled = true,
    disabled_at = now(),
    disabled_by = caller_id,
    role = 'member',
    can_view_all_attendance = false,
    linked_member_id = null,
    promoted_by = null,
    promoted_at = null,
    updated_at = now()
  where user_id = target_user_id;

  begin
    delete from auth.users
    where id = target_user_id;
  exception
    when insufficient_privilege then
      removal_mode := 'disabled_only';
  end;

  return jsonb_build_object(
    'user_id', target_user_id,
    'mode', removal_mode,
    'removed', true
  );
end;
$$;

revoke all on function public.admin_remove_user_account(uuid) from public, anon;
grant execute on function public.admin_remove_user_account(uuid) to authenticated;

-- Admin-only RPC: grant or revoke broader club-wide read visibility for a member account
create or replace function public.set_user_visibility_scope(
  target_user_id uuid,
  allow_broad_view boolean
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  target_row public.user_profiles;
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can modify visibility permissions.'
      using errcode = '42501';
  end if;

  update public.user_profiles
  set
    can_view_all_attendance = coalesce(allow_broad_view, false),
    updated_at = now()
  where user_id = target_user_id
  returning * into target_row;

  if not found then
    raise exception 'Target account profile was not found.'
      using errcode = 'P0002';
  end if;

  return target_row;
end;
$$;

revoke all on function public.set_user_visibility_scope(uuid, boolean) from public, anon;
grant execute on function public.set_user_visibility_scope(uuid, boolean) to authenticated;

-- Reads whether global Member Visibility toggles are currently enabled club-wide
create or replace function public.can_member_view_roster()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select member_can_view_roster from public.club_settings where id = 'default' limit 1),
    false
  );
$$;

create or replace function public.can_member_view_attendance_rates()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select member_can_view_attendance_rates from public.club_settings where id = 'default' limit 1),
    false
  );
$$;

create or replace function public.can_member_view_calendar_details()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select member_can_view_calendar_details from public.club_settings where id = 'default' limit 1),
    false
  );
$$;

create or replace function public.is_shared_idea_visibility_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select shared_idea_visibility from public.club_settings where id = 'default' limit 1),
    false
  );
$$;

create or replace function public.can_member_comment_on_posts()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select member_can_comment_on_posts from public.club_settings where id = 'default' limit 1),
    false
  );
$$;

create or replace function public.get_content_deletion_mode()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select content_deletion_mode from public.club_settings where id = 'default' limit 1),
    'own_only'
  );
$$;

create or replace function public.can_current_user_delete_content(target_author_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  deletion_mode text;
begin
  if caller_id is null or not public.is_active_user(caller_id) then
    return false;
  end if;

  if public.is_admin(caller_id) then
    return true;
  end if;

  deletion_mode := public.get_content_deletion_mode();

  if deletion_mode = 'disabled' then
    return false;
  elsif deletion_mode = 'any' then
    return true;
  else
    return target_author_user_id is not null and target_author_user_id = caller_id;
  end if;
end;
$$;

grant execute on function public.can_member_view_roster() to anon, authenticated;
grant execute on function public.can_member_view_attendance_rates() to anon, authenticated;
grant execute on function public.can_member_view_calendar_details() to anon, authenticated;
grant execute on function public.is_shared_idea_visibility_enabled() to anon, authenticated;
grant execute on function public.can_member_comment_on_posts() to anon, authenticated;
grant execute on function public.get_content_deletion_mode() to anon, authenticated;
grant execute on function public.can_current_user_delete_content(uuid) to anon, authenticated;

-- Admin-only RPC: update all global Member Visibility Permissions switches atomically
create or replace function public.update_member_visibility_permissions(
  p_member_can_view_roster boolean,
  p_member_can_view_attendance_rates boolean,
  p_member_can_view_calendar_details boolean,
  p_shared_idea_visibility boolean,
  p_member_can_comment_on_posts boolean
)
returns public.club_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  updated_row public.club_settings;
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can update member visibility permissions.'
      using errcode = '42501';
  end if;

  insert into public.club_settings (
    id,
    member_can_view_roster,
    member_can_view_attendance_rates,
    member_can_view_calendar_details,
    shared_idea_visibility,
    member_can_comment_on_posts,
    updated_by,
    updated_at
  )
  values (
    'default',
    coalesce(p_member_can_view_roster, false),
    coalesce(p_member_can_view_attendance_rates, false),
    coalesce(p_member_can_view_calendar_details, false),
    coalesce(p_shared_idea_visibility, false),
    coalesce(p_member_can_comment_on_posts, false),
    caller_id,
    now()
  )
  on conflict (id) do update
    set member_can_view_roster = coalesce(p_member_can_view_roster, false),
        member_can_view_attendance_rates = coalesce(p_member_can_view_attendance_rates, false),
        member_can_view_calendar_details = coalesce(p_member_can_view_calendar_details, false),
        shared_idea_visibility = coalesce(p_shared_idea_visibility, false),
        member_can_comment_on_posts = coalesce(p_member_can_comment_on_posts, false),
        updated_by = caller_id,
        updated_at = now()
  returning * into updated_row;

  return updated_row;
end;
$$;

revoke all on function public.update_member_visibility_permissions(boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.update_member_visibility_permissions(boolean, boolean, boolean, boolean, boolean) to authenticated;

-- Admin-only RPC: toggle whether standard members can browse all club project ideas
create or replace function public.set_shared_idea_visibility(allow_shared boolean)
returns public.club_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  updated_row public.club_settings;
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can update shared idea visibility settings.'
      using errcode = '42501';
  end if;

  insert into public.club_settings (id, shared_idea_visibility, updated_by, updated_at)
  values ('default', coalesce(allow_shared, false), caller_id, now())
  on conflict (id) do update
    set shared_idea_visibility = coalesce(allow_shared, false),
        updated_by = caller_id,
        updated_at = now()
  returning * into updated_row;

  return updated_row;
end;
$$;

revoke all on function public.set_shared_idea_visibility(boolean) from public, anon;
grant execute on function public.set_shared_idea_visibility(boolean) to authenticated;

-- Admin-only RPC: update the global content deletion policy for regular users
create or replace function public.set_content_deletion_mode(p_mode text)
returns public.club_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  normalized_mode text := lower(btrim(coalesce(p_mode, '')));
  updated_row public.club_settings;
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can update content deletion settings.'
      using errcode = '42501';
  end if;

  if normalized_mode not in ('own_only', 'any', 'disabled') then
    raise exception 'Invalid content deletion mode. Expected own_only, any, or disabled.'
      using errcode = '22023';
  end if;

  insert into public.club_settings (id, content_deletion_mode, updated_by, updated_at)
  values ('default', normalized_mode, caller_id, now())
  on conflict (id) do update
    set content_deletion_mode = normalized_mode,
        updated_by = caller_id,
        updated_at = now()
  returning * into updated_row;

  return updated_row;
end;
$$;

revoke all on function public.set_content_deletion_mode(text) from public, anon;
grant execute on function public.set_content_deletion_mode(text) to authenticated;

-- Server-enforced profile ownership for new project ideas (prevents impersonation)
create or replace function public.enforce_project_idea_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  resolved_member_id text;
  resolved_name text;
  caller_email text;
begin
  if caller_id is null then
    raise exception 'Authentication is required to submit a project idea.'
      using errcode = '42501';
  end if;

  resolved_member_id := public.my_linked_member_id(caller_id);

  if resolved_member_id is not null then
    select nullif(btrim(name), '')
    into resolved_name
    from public.club_members
    where id = resolved_member_id
      and deleted_at is null
    limit 1;
  end if;

  if resolved_name is null then
    select email
    into caller_email
    from public.user_profiles
    where user_id = caller_id
    limit 1;

    resolved_name := coalesce(
      nullif(btrim(new.author_name), ''),
      nullif(btrim(split_part(coalesce(caller_email, ''), '@', 1)), ''),
      'Club Member'
    );
  end if;

  new.submitted_by_user_id := caller_id;
  new.linked_member_id := resolved_member_id;
  new.author_name := left(resolved_name, 80);
  new.is_highlighted := false;
  new.admin_note := null;
  new.review_status := 'pending';

  return new;
end;
$$;

drop trigger if exists trg_project_ideas_enforce_ownership on public.project_ideas;
create trigger trg_project_ideas_enforce_ownership
  before insert on public.project_ideas
  for each row execute function public.enforce_project_idea_ownership();

-- Server-enforced author stamping for admin club posts
create or replace function public.enforce_club_post_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  resolved_member_id text;
  resolved_name text;
  caller_email text;
begin
  if caller_id is null then
    raise exception 'Authentication is required to publish updates.'
      using errcode = '42501';
  end if;

  resolved_member_id := public.my_linked_member_id(caller_id);
  if resolved_member_id is not null then
    select nullif(btrim(name), '')
    into resolved_name
    from public.club_members
    where id = resolved_member_id
      and deleted_at is null
    limit 1;
  end if;

  if resolved_name is null then
    select email
    into caller_email
    from public.user_profiles
    where user_id = caller_id
    limit 1;

    resolved_name := coalesce(
      nullif(btrim(new.author_name), ''),
      nullif(btrim(split_part(coalesce(caller_email, ''), '@', 1)), ''),
      'Club Admin'
    );
  end if;

  new.author_user_id := caller_id;
  new.author_name := left(coalesce(nullif(btrim(new.author_name), ''), resolved_name), 80);
  return new;
end;
$$;

drop trigger if exists trg_club_posts_enforce_author on public.club_posts;
create trigger trg_club_posts_enforce_author
  before insert on public.club_posts
  for each row execute function public.enforce_club_post_author();

-- Server-enforced identity & role badge for post comments & replies
create or replace function public.enforce_club_post_comment_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  resolved_member_id text;
  resolved_name text;
  caller_email text;
begin
  if caller_id is null then
    raise exception 'Authentication is required to comment on posts.'
      using errcode = '42501';
  end if;

  resolved_member_id := public.my_linked_member_id(caller_id);
  if resolved_member_id is not null then
    select nullif(btrim(name), '')
    into resolved_name
    from public.club_members
    where id = resolved_member_id
      and deleted_at is null
    limit 1;
  end if;

  if resolved_name is null then
    select email
    into caller_email
    from public.user_profiles
    where user_id = caller_id
    limit 1;

    resolved_name := coalesce(
      nullif(btrim(split_part(coalesce(caller_email, ''), '@', 1)), ''),
      'Club Member'
    );
  end if;

  new.author_user_id := caller_id;
  new.author_role := case when public.is_admin(caller_id) then 'admin' else 'member' end;
  new.author_name := left(resolved_name, 80);
  return new;
end;
$$;

drop trigger if exists trg_club_post_comments_enforce_author on public.club_post_comments;
create trigger trg_club_post_comments_enforce_author
  before insert on public.club_post_comments
  for each row execute function public.enforce_club_post_comment_author();

-- 3c-b. Member-Only Credential Vault (strictly restricted to standard 'member' accounts; admin passwords NEVER stored or viewable)
create table if not exists public.member_account_credentials (
  user_id uuid primary key references public.user_profiles(user_id) on delete cascade,
  login_password text not null
    constraint member_account_credentials_password_check
    check (length(login_password) >= 1 and length(login_password) <= 256),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Automatically purge any stored credential whenever a user becomes an Admin
create or replace function public.purge_admin_credentials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'admin' then
    delete from public.member_account_credentials
    where user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.purge_admin_credentials() from public, anon, authenticated;

drop trigger if exists trg_user_profiles_purge_admin_credentials on public.user_profiles;
create trigger trg_user_profiles_purge_admin_credentials
  after insert or update of role on public.user_profiles
  for each row execute function public.purge_admin_credentials();

-- Clean up any pre-existing credential rows belonging to admin accounts
delete from public.member_account_credentials mac
where exists (
  select 1
  from public.user_profiles up
  where up.user_id = mac.user_id
    and up.role = 'admin'
);

-- Admin-only RPC: store or update a standard member's password (strictly rejects Admin targets)
create or replace function public.admin_store_member_credential(
  target_user_id uuid,
  plain_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  target_role text;
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can store member credentials.'
      using errcode = '42501';
  end if;

  if plain_password is null or length(plain_password) < 6 or length(plain_password) > 256 then
    raise exception 'Member password must be between 6 and 256 characters.'
      using errcode = '22023';
  end if;

  select role into target_role
  from public.user_profiles
  where user_id = target_user_id
  for update;

  if not found then
    raise exception 'Target user profile was not found.'
      using errcode = 'P0002';
  end if;

  if target_role <> 'member' then
    raise exception 'Admin account passwords cannot be stored or viewed.'
      using errcode = '42501';
  end if;

  insert into public.member_account_credentials (user_id, login_password, updated_by, updated_at)
  values (target_user_id, plain_password, caller_id, now())
  on conflict (user_id) do update
    set login_password = excluded.login_password,
        updated_by = caller_id,
        updated_at = now();
end;
$$;

revoke all on function public.admin_store_member_credential(uuid, text) from public, anon;
grant execute on function public.admin_store_member_credential(uuid, text) to authenticated;

-- Member self-service password sync: updates member_account_credentials ONLY if caller is a standard 'member' (strictly ignores admins)
create or replace function public.sync_my_member_credential(
  new_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  caller_role text;
begin
  if caller_id is null or not public.is_active_user(caller_id) then
    return;
  end if;

  if new_password is null or length(new_password) < 6 or length(new_password) > 256 then
    return;
  end if;

  select role into caller_role
  from public.user_profiles
  where user_id = caller_id;

  -- Strictly never store passwords for Admin accounts
  if caller_role <> 'member' then
    return;
  end if;

  insert into public.member_account_credentials (user_id, login_password, updated_by, updated_at)
  values (caller_id, new_password, caller_id, now())
  on conflict (user_id) do update
    set login_password = excluded.login_password,
        updated_by = caller_id,
        updated_at = now();
end;
$$;

revoke all on function public.sync_my_member_credential(text) from public, anon;
grant execute on function public.sync_my_member_credential(text) to authenticated;

-- Admin-only RPC: reset/change the password of a standard 'member' account ONLY (strictly blocks Admin targets)
create or replace function public.admin_reset_member_password(
  target_user_id uuid,
  new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  caller_id uuid := auth.uid();
  target_row public.user_profiles;
begin
  if caller_id is null or not public.is_admin(caller_id) then
    raise exception 'Only administrators can reset member passwords.'
      using errcode = '42501';
  end if;

  if new_password is null or length(new_password) < 6 or length(new_password) > 256 then
    raise exception 'New password must be between 6 and 256 characters.'
      using errcode = '22023';
  end if;

  select * into target_row
  from public.user_profiles
  where user_id = target_user_id
  for update;

  if not found then
    raise exception 'Target user profile was not found.'
      using errcode = 'P0002';
  end if;

  if target_user_id = caller_id or target_row.role <> 'member' then
    raise exception 'Administrators cannot view or modify the passwords of admin accounts.'
      using errcode = '42501';
  end if;

  if target_row.is_disabled then
    raise exception 'Cannot reset password for a disabled account. Re-enable the account first.'
      using errcode = 'P0001';
  end if;

  update auth.users
  set
    encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf', 10)),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    updated_at = now()
  where id = target_user_id;

  if not found then
    raise exception 'Target Supabase Auth account was not found.'
      using errcode = 'P0002';
  end if;

  -- Revoke existing sessions so old refresh tokens cannot persist after an admin password reset.
  begin
    delete from auth.sessions
    where user_id = target_user_id;
  exception
    when others then
      null;
  end;

  insert into public.member_account_credentials (user_id, login_password, updated_by, updated_at)
  values (target_user_id, new_password, caller_id, now())
  on conflict (user_id) do update
    set login_password = excluded.login_password,
        updated_by = caller_id,
        updated_at = now();

  return jsonb_build_object(
    'user_id', target_user_id,
    'updated', true
  );
end;
$$;

revoke all on function public.admin_reset_member_password(uuid, text) from public, anon;
grant execute on function public.admin_reset_member_password(uuid, text) to authenticated;

-- 4. Grant schema & table privileges
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on table public.club_members to authenticated;
grant select, insert, update, delete on table public.attendance_sessions to authenticated;
grant select, insert, update, delete on table public.session_attendance to authenticated;
grant select on table public.club_posts to anon, authenticated;
grant insert, update, delete on table public.club_posts to authenticated;
grant select on table public.club_post_comments to anon, authenticated;
grant insert, delete on table public.club_post_comments to authenticated;
grant select on table public.club_settings to anon, authenticated;
revoke all on table public.project_ideas from anon;
grant select, insert, update, delete on table public.project_ideas to authenticated;
revoke all on table public.project_idea_feedback from anon;
grant select, insert, update, delete on table public.project_idea_feedback to authenticated;
grant select on table public.user_profiles to authenticated;
revoke all on table public.member_account_credentials from public, anon;
grant select on table public.member_account_credentials to authenticated;
grant all on table public.club_members, public.attendance_sessions, public.session_attendance, public.project_ideas, public.project_idea_feedback, public.club_posts, public.club_post_comments, public.club_settings, public.user_profiles, public.member_account_credentials to service_role;

-- 5. Enable Row-Level Security (RLS) on all tables
alter table public.club_members enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.session_attendance enable row level security;
alter table public.project_ideas enable row level security;
alter table public.project_idea_feedback enable row level security;
alter table public.club_posts enable row level security;
alter table public.club_post_comments enable row level security;
alter table public.club_settings enable row level security;
alter table public.user_profiles enable row level security;
alter table public.member_account_credentials enable row level security;

-- 6. Policies: Education-style privacy & role-enforced access across attendance, project ideas, and user profiles
drop policy if exists "Authenticated users can manage club_members" on public.club_members;
drop policy if exists "Authenticated users can read club_members" on public.club_members;
drop policy if exists "Authenticated users can insert club_members" on public.club_members;
drop policy if exists "Authenticated users can update active club_members" on public.club_members;
drop policy if exists "Admins can delete club_members" on public.club_members;

create policy "Authenticated users can read club_members"
  on public.club_members
  for select
  to authenticated
  using (
    public.is_active_user()
    and (
      public.has_broad_visibility()
      or id = public.my_linked_member_id()
      or public.can_member_view_roster()
      or public.can_member_view_attendance_rates()
    )
  );

create policy "Authenticated users can insert club_members"
  on public.club_members
  for insert
  to authenticated
  with check (public.is_admin());

create policy "Authenticated users can update active club_members"
  on public.club_members
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete club_members"
  on public.club_members
  for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "Authenticated users can manage attendance_sessions" on public.attendance_sessions;
drop policy if exists "Authenticated users can read attendance_sessions" on public.attendance_sessions;
drop policy if exists "Authenticated users can insert attendance_sessions" on public.attendance_sessions;
drop policy if exists "Authenticated users can update active attendance_sessions" on public.attendance_sessions;
drop policy if exists "Admins can delete attendance_sessions" on public.attendance_sessions;

create policy "Authenticated users can read attendance_sessions"
  on public.attendance_sessions
  for select
  to authenticated
  using (
    public.is_active_user()
    and (
      visibility = 'public'
      or (visibility = 'admins_only' and public.is_admin())
      or (visibility = 'private' and created_by_user_id = (select auth.uid()))
    )
  );

create policy "Authenticated users can insert attendance_sessions"
  on public.attendance_sessions
  for insert
  to authenticated
  with check (
    public.is_admin()
    and visibility in ('public', 'admins_only', 'private')
    and (
      visibility <> 'private'
      or created_by_user_id = (select auth.uid())
    )
  );

create policy "Authenticated users can update active attendance_sessions"
  on public.attendance_sessions
  for update
  to authenticated
  using (
    public.is_admin()
    and (
      visibility <> 'private'
      or created_by_user_id = (select auth.uid())
    )
  )
  with check (
    public.is_admin()
    and visibility in ('public', 'admins_only', 'private')
    and (
      visibility <> 'private'
      or created_by_user_id = (select auth.uid())
    )
  );

create policy "Admins can delete attendance_sessions"
  on public.attendance_sessions
  for delete
  to authenticated
  using (
    public.is_admin()
    and (
      visibility <> 'private'
      or created_by_user_id = (select auth.uid())
    )
  );

drop policy if exists "Authenticated users can manage session_attendance" on public.session_attendance;
drop policy if exists "Authenticated users can read session_attendance" on public.session_attendance;
drop policy if exists "Admins can insert session_attendance" on public.session_attendance;
drop policy if exists "Admins can update session_attendance" on public.session_attendance;
drop policy if exists "Admins can delete session_attendance" on public.session_attendance;

create policy "Authenticated users can read session_attendance"
  on public.session_attendance
  for select
  to authenticated
  using (
    public.is_active_user()
    and public.can_read_attendance_session(session_id)
    and (
      public.has_broad_visibility()
      or public.can_member_view_attendance_rates()
      or member_id = public.my_linked_member_id()
    )
  );

create policy "Admins can insert session_attendance"
  on public.session_attendance
  for insert
  to authenticated
  with check (public.can_manage_attendance_session(session_id));

create policy "Admins can update session_attendance"
  on public.session_attendance
  for update
  to authenticated
  using (public.can_manage_attendance_session(session_id))
  with check (public.can_manage_attendance_session(session_id));

create policy "Admins can delete session_attendance"
  on public.session_attendance
  for delete
  to authenticated
  using (public.can_manage_attendance_session(session_id));

-- User profiles policies: users see own role; verified admins see all registered accounts
drop policy if exists "Users can view own profile" on public.user_profiles;
create policy "Users can view own profile"
  on public.user_profiles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Admins can view all profiles" on public.user_profiles;
create policy "Admins can view all profiles"
  on public.user_profiles
  for select
  to authenticated
  using (public.is_admin());

-- Member credentials policy: ONLY active admins can read, and STRICTLY ONLY for accounts with role = 'member'
drop policy if exists "Admins can view member-only credentials" on public.member_account_credentials;
create policy "Admins can view member-only credentials"
  on public.member_account_credentials
  for select
  to authenticated
  using (
    public.is_admin()
    and exists (
      select 1
      from public.user_profiles up
      where up.user_id = member_account_credentials.user_id
        and up.role = 'member'
    )
  );

-- Project Ideas policies: owner/admin-scoped or shared club-wide toggle; admin-only moderation
drop policy if exists "Anyone can read project_ideas" on public.project_ideas;
drop policy if exists "Authenticated users can read scoped project_ideas" on public.project_ideas;
create policy "Authenticated users can read scoped project_ideas"
  on public.project_ideas
  for select
  to authenticated
  using (
    public.is_active_user()
    and (
      public.is_admin()
      or submitted_by_user_id = (select auth.uid())
      or public.is_shared_idea_visibility_enabled()
    )
  );

drop policy if exists "Anyone can submit project_ideas" on public.project_ideas;
drop policy if exists "Authenticated users can submit own project_ideas" on public.project_ideas;
create policy "Authenticated users can submit own project_ideas"
  on public.project_ideas
  for insert
  to authenticated
  with check (
    public.is_active_user()
    and submitted_by_user_id = (select auth.uid())
    and length(btrim(author_name)) between 1 and 80
    and length(btrim(title)) between 2 and 120
    and length(btrim(description)) between 5 and 2000
    and (category is null or length(btrim(category)) <= 40)
    and review_status = 'pending'
    and is_highlighted = false
    and admin_note is null
  );

drop policy if exists "Authenticated admins can update project_ideas" on public.project_ideas;
create policy "Authenticated admins can update project_ideas"
  on public.project_ideas
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated admins can delete project_ideas" on public.project_ideas;
drop policy if exists "Permitted users can delete project_ideas" on public.project_ideas;
create policy "Permitted users can delete project_ideas"
  on public.project_ideas
  for delete
  to authenticated
  using (public.can_current_user_delete_content(submitted_by_user_id));

-- Personal Project Idea Feedback policies: strictly visible only to Admins & the idea's author
drop policy if exists "Author and admins can read project_idea_feedback" on public.project_idea_feedback;
create policy "Author and admins can read project_idea_feedback"
  on public.project_idea_feedback
  for select
  to authenticated
  using (
    public.is_active_user()
    and (
      public.is_admin()
      or exists (
        select 1
        from public.project_ideas pi
        where pi.id = idea_id
          and pi.submitted_by_user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Admins can insert project_idea_feedback" on public.project_idea_feedback;
create policy "Admins can insert project_idea_feedback"
  on public.project_idea_feedback
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update project_idea_feedback" on public.project_idea_feedback;
create policy "Admins can update project_idea_feedback"
  on public.project_idea_feedback
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete project_idea_feedback" on public.project_idea_feedback;
create policy "Admins can delete project_idea_feedback"
  on public.project_idea_feedback
  for delete
  to authenticated
  using (public.is_admin());

-- Club Posts & Updates policies: public announcements readable by everyone; admin-only publish/edit/delete
drop policy if exists "Anyone can read club_posts" on public.club_posts;
create policy "Anyone can read club_posts"
  on public.club_posts
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins can insert club_posts" on public.club_posts;
create policy "Admins can insert club_posts"
  on public.club_posts
  for insert
  to authenticated
  with check (
    public.is_admin()
    and author_user_id = (select auth.uid())
    and length(btrim(author_name)) between 1 and 80
    and length(btrim(title)) between 2 and 140
    and length(btrim(content)) between 5 and 4000
    and category in ('announcement', 'meeting_reminder', 'resource_update', 'general')
  );

drop policy if exists "Admins can update club_posts" on public.club_posts;
create policy "Admins can update club_posts"
  on public.club_posts
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete club_posts" on public.club_posts;
drop policy if exists "Permitted users can delete club_posts" on public.club_posts;
create policy "Permitted users can delete club_posts"
  on public.club_posts
  for delete
  to authenticated
  using (public.can_current_user_delete_content(author_user_id));

-- Club Post Comments policies: public read alongside posts; admins always reply, deletion governed by global policy
drop policy if exists "Anyone can read club_post_comments" on public.club_post_comments;
create policy "Anyone can read club_post_comments"
  on public.club_post_comments
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins or permitted members can comment on club_posts" on public.club_post_comments;
create policy "Admins or permitted members can comment on club_posts"
  on public.club_post_comments
  for insert
  to authenticated
  with check (
    public.is_active_user()
    and (public.is_admin() or public.can_member_comment_on_posts())
    and author_user_id = (select auth.uid())
    and length(btrim(content)) between 1 and 1000
  );

drop policy if exists "Admins or permitted comment authors can delete comments" on public.club_post_comments;
drop policy if exists "Permitted users can delete club_post_comments" on public.club_post_comments;
create policy "Permitted users can delete club_post_comments"
  on public.club_post_comments
  for delete
  to authenticated
  using (public.can_current_user_delete_content(author_user_id));

-- Club Settings policies: readable by all clients; updated only via admin RPC
drop policy if exists "Anyone can read club_settings" on public.club_settings;
create policy "Anyone can read club_settings"
  on public.club_settings
  for select
  to anon, authenticated
  using (true);

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

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_ideas'
  ) then
    alter publication supabase_realtime add table public.project_ideas;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_idea_feedback'
  ) then
    alter publication supabase_realtime add table public.project_idea_feedback;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'club_posts'
  ) then
    alter publication supabase_realtime add table public.club_posts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'club_post_comments'
  ) then
    alter publication supabase_realtime add table public.club_post_comments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'club_settings'
  ) then
    alter publication supabase_realtime add table public.club_settings;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_profiles'
  ) then
    alter publication supabase_realtime add table public.user_profiles;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'member_account_credentials'
  ) then
    alter publication supabase_realtime add table public.member_account_credentials;
  end if;
end $$;

-- 8. Reload PostgREST schema cache immediately
notify pgrst, 'reload schema';
