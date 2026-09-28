-- Case View shares. Run this once in the Supabase SQL editor.
-- The PIN is not a column. salt/iv/ciphertext are an AES-GCM blob produced
-- after PBKDF2 stretches the PIN for 50,000 iterations.

create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  title text not null default '',
  slug text,
  salt text not null,
  iv text not null,
  ciphertext text not null,
  expires_at timestamptz not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  constraint shares_title_len check (char_length(title) <= 120),
  constraint shares_payload_len check (char_length(ciphertext) < 200000),
  constraint shares_attempts_nonneg check (failed_attempts >= 0)
);

-- Existing projects created this column as a required account id. The local tool has no account.
alter table public.shares drop constraint if exists shares_owner_id_fkey;
alter table public.shares alter column owner_id drop not null;
alter table public.shares add column if not exists slug text;

create unique index if not exists shares_slug_unique
  on public.shares (slug);

create index if not exists shares_owner_created
  on public.shares (owner_id, created_at desc);

alter table public.shares enable row level security;

revoke all on table public.shares from anon, authenticated;
grant select, insert, delete on table public.shares to authenticated;

drop policy if exists "shares_select_own" on public.shares;
create policy "shares_select_own"
  on public.shares for select
  to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "shares_insert_own" on public.shares;
create policy "shares_insert_own"
  on public.shares for insert
  to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "shares_delete_own" on public.shares;
create policy "shares_delete_own"
  on public.shares for delete
  to authenticated
  using (auth.uid() = owner_id);

-- One private bucket. Each case is a folder: cases/{case-name}/Upper_Jaw.stl
insert into storage.buckets (id, name, public, file_size_limit)
values ('cases', 'cases', false, 83886080)
on conflict (id) do update set public = false;

drop policy if exists "cases_auth_insert" on storage.objects;
create policy "cases_auth_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'cases'
    and coalesce((storage.foldername(name))[1], '') <> ''
  );

drop policy if exists "cases_auth_select" on storage.objects;
create policy "cases_auth_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'cases');

drop policy if exists "cases_auth_update" on storage.objects;
create policy "cases_auth_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'cases')
  with check (bucket_id = 'cases');

drop policy if exists "cases_auth_delete" on storage.objects;
create policy "cases_auth_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'cases');
