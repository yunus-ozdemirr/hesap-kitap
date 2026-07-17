-- Ortak Kasa: PostgreSQL şeması, roller, denetim günlüğü ve RLS politikaları
create extension if not exists pgcrypto;

create type public.app_role as enum ('owner', 'editor', 'viewer');
create type public.project_status as enum ('active', 'archived');
create type public.transaction_kind as enum ('opening', 'income', 'expense', 'reimbursement', 'transfer');
create type public.transaction_status as enum ('draft', 'posted', 'voided');
create type public.payment_source as enum ('group_cash', 'group_bank', 'member');
create type public.account_kind as enum ('cash', 'bank');
create type public.document_kind as enum ('invoice', 'earchive', 'receipt', 'freelance_receipt', 'bank_receipt', 'expense_receipt');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  currency text not null default 'TRY' check (currency = 'TRY'),
  starting_balance_minor bigint not null default 0 check (starting_balance_minor >= 0),
  created_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Ekip üyesi' check (char_length(display_name) between 2 and 80),
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.app_role not null check (role <> 'owner'),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create table public.projects (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100), color text not null default '#ef6a58' check (color ~ '^#[0-9a-fA-F]{6}$'),
  budget_minor bigint check (budget_minor is null or budget_minor >= 0), status public.project_status not null default 'active',
  created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.accounts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null, kind public.account_kind not null, is_active boolean not null default true, created_at timestamptz not null default now()
);
create table public.transactions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sequence_no bigint not null, kind public.transaction_kind not null, status public.transaction_status not null default 'draft',
  transaction_date date not null default current_date, amount_minor bigint not null check (amount_minor > 0),
  description text not null check (char_length(description) between 2 and 500), category text,
  project_id uuid references public.projects(id) on delete set null, payment_source public.payment_source not null default 'group_bank',
  member_id uuid references auth.users(id) on delete set null, source_account_id uuid references public.accounts(id) on delete set null,
  destination_account_id uuid references public.accounts(id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, sequence_no),
  check ((payment_source = 'member' and member_id is not null) or payment_source <> 'member'),
  check ((kind = 'transfer' and source_account_id is distinct from destination_account_id) or kind <> 'transfer')
);
create table public.documents (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transaction_id uuid not null unique references public.transactions(id) on delete cascade, document_type public.document_kind not null,
  document_number text, issuer text, storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  file_size integer not null check (file_size > 0 and file_size <= 10485760),
  created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now()
);
create table public.audit_logs (
  id bigint generated always as identity primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, table_name text not null, record_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')), old_data jsonb, new_data jsonb, created_at timestamptz not null default now()
);

create index transactions_workspace_date_idx on public.transactions (workspace_id, transaction_date desc);
create index transactions_project_idx on public.transactions (project_id) where project_id is not null;
create index audit_logs_workspace_idx on public.audit_logs (workspace_id, created_at desc);
create index workspace_invites_email_idx on public.workspace_invites (lower(email));

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.workspace_members m where m.workspace_id = target_workspace and m.user_id = auth.uid()) $$;
create or replace function public.has_workspace_role(target_workspace uuid, allowed_roles public.app_role[])
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.workspace_members m where m.workspace_id = target_workspace and m.user_id = auth.uid() and m.role = any(allowed_roles)) $$;
revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.has_workspace_role(uuid, public.app_role[]) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, public.app_role[]) to authenticated;

create or replace function public.assign_transaction_sequence()
returns trigger language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.workspace_id::text));
  select coalesce(max(sequence_no), 0) + 1 into new.sequence_no from public.transactions where workspace_id = new.workspace_id;
  return new;
end $$;
create trigger transactions_assign_sequence before insert on public.transactions for each row execute function public.assign_transaction_sequence();
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger projects_touch_updated_at before update on public.projects for each row execute function public.touch_updated_at();
create trigger transactions_touch_updated_at before update on public.transactions for each row execute function public.touch_updated_at();

-- Kesinleşmiş kaydın mali alanları değiştirilemez; yalnızca iptal durumuna alınabilir.
create or replace function public.protect_posted_transaction()
returns trigger language plpgsql as $$
begin
  if old.status = 'voided' then raise exception 'İptal edilmiş kayıt değiştirilemez'; end if;
  if old.status = 'posted' then
    if new.status not in ('posted', 'voided') then raise exception 'Kesinleşmiş kayıt taslağa çevrilemez'; end if;
    if (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'Kesinleşmiş kaydın mali alanları değiştirilemez; düzeltme kaydı oluşturun';
    end if;
  end if;
  return new;
end $$;
create trigger transactions_protect_posted before update on public.transactions for each row execute function public.protect_posted_transaction();

create or replace function public.write_audit_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_workspace uuid; target_id uuid;
begin
  target_workspace := coalesce(new.workspace_id, old.workspace_id); target_id := coalesce(new.id, old.id);
  insert into public.audit_logs (workspace_id, actor_id, table_name, record_id, action, old_data, new_data)
  values (target_workspace, auth.uid(), tg_table_name, target_id, tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
  return coalesce(new, old);
end $$;
create trigger projects_audit after insert or update or delete on public.projects for each row execute function public.write_audit_log();
create trigger transactions_audit after insert or update or delete on public.transactions for each row execute function public.write_audit_log();
create trigger documents_audit after insert or update or delete on public.documents for each row execute function public.write_audit_log();

create or replace function public.claim_initial_workspace(workspace_name text, initial_balance_minor bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare target uuid; caller_name text;
begin
  if auth.uid() is null then raise exception 'Oturum açmanız gerekiyor'; end if;
  if char_length(trim(workspace_name)) not between 2 and 80 then raise exception 'Kasa adı 2-80 karakter olmalı'; end if;
  if initial_balance_minor <= 0 then raise exception 'Başlangıç bakiyesi sıfırdan büyük olmalı'; end if;
  select w.id into target from public.workspaces w
  where not exists (select 1 from public.workspace_members m where m.workspace_id = w.id)
  order by w.created_at limit 1 for update;
  if target is null then raise exception 'Bu kasa daha önce sahiplenilmiş; sahibinden davet isteyin'; end if;
  update public.workspaces set name = trim(workspace_name), starting_balance_minor = initial_balance_minor where id = target;
  select coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1)) into caller_name from auth.users where id = auth.uid();
  insert into public.workspace_members (workspace_id, user_id, display_name, role) values (target, auth.uid(), caller_name, 'owner');
  insert into public.accounts (workspace_id, name, kind) values (target, 'Nakit Kasa', 'cash'), (target, 'Banka', 'bank');
  insert into public.transactions (workspace_id, sequence_no, kind, status, transaction_date, amount_minor, description, category, payment_source, created_by)
  values (target, 0, 'opening', 'posted', current_date, initial_balance_minor, 'Başlangıç bütçesi', 'Fon', 'group_bank', auth.uid());
  return target;
end $$;
revoke all on function public.claim_initial_workspace(text, bigint) from public;
grant execute on function public.claim_initial_workspace(text, bigint) to authenticated;

create or replace function public.adjust_starting_balance(target_workspace uuid, new_starting_balance_minor bigint)
returns void language plpgsql security definer set search_path = public as $$
declare old_starting bigint; difference bigint;
begin
  if not public.has_workspace_role(target_workspace, array['owner']::public.app_role[]) then raise exception 'Yalnızca kasa sahibi başlangıç bütçesini değiştirebilir'; end if;
  if new_starting_balance_minor <= 0 then raise exception 'Başlangıç bütçesi sıfırdan büyük olmalı'; end if;
  select starting_balance_minor into old_starting from public.workspaces where id = target_workspace for update;
  difference := new_starting_balance_minor - old_starting;
  if difference = 0 then return; end if;
  update public.workspaces set starting_balance_minor = new_starting_balance_minor where id = target_workspace;
  insert into public.transactions (workspace_id, sequence_no, kind, status, transaction_date, amount_minor, description, category, payment_source, created_by)
  values (target_workspace, 0, case when difference > 0 then 'income'::public.transaction_kind else 'expense'::public.transaction_kind end,
    'posted', current_date, abs(difference), 'Başlangıç bütçesi düzeltmesi', 'Başlangıç Düzeltme', 'group_bank', auth.uid());
end $$;
revoke all on function public.adjust_starting_balance(uuid, bigint) from public;
grant execute on function public.adjust_starting_balance(uuid, bigint) to authenticated;

create or replace function public.accept_preapproved_invite()
returns trigger language plpgsql security definer set search_path = public as $$
declare invitation record;
begin
  for invitation in select * from public.workspace_invites where lower(email) = lower(new.email) loop
    insert into public.workspace_members (workspace_id, user_id, display_name, role)
    values (invitation.workspace_id, new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), invitation.role)
    on conflict (workspace_id, user_id) do nothing;
    delete from public.workspace_invites where id = invitation.id;
  end loop;
  return new;
end $$;
create trigger auth_user_accept_invite after insert on auth.users for each row execute function public.accept_preapproved_invite();

insert into public.workspaces (name) values ('Yeni Kasa');

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.projects enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.documents enable row level security;
alter table public.audit_logs enable row level security;

create policy "members read workspace" on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy "owners update workspace" on public.workspaces for update to authenticated using (public.has_workspace_role(id, array['owner']::public.app_role[])) with check (public.has_workspace_role(id, array['owner']::public.app_role[]));
create policy "members read teammates" on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "owners update teammates" on public.workspace_members for update to authenticated using (public.has_workspace_role(workspace_id, array['owner']::public.app_role[])) with check (public.has_workspace_role(workspace_id, array['owner']::public.app_role[]));
create policy "owners remove teammates" on public.workspace_members for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner']::public.app_role[]) and user_id <> auth.uid());
create policy "owners read invites" on public.workspace_invites for select to authenticated using (public.has_workspace_role(workspace_id, array['owner']::public.app_role[]));
create policy "owners create invites" on public.workspace_invites for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner']::public.app_role[]) and role <> 'owner' and created_by = auth.uid());
create policy "owners delete invites" on public.workspace_invites for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner']::public.app_role[]));
create policy "members read projects" on public.projects for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "editors create projects" on public.projects for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','editor']::public.app_role[]) and created_by = auth.uid());
create policy "editors update projects" on public.projects for update to authenticated using (public.has_workspace_role(workspace_id, array['owner','editor']::public.app_role[])) with check (public.has_workspace_role(workspace_id, array['owner','editor']::public.app_role[]));
create policy "members read accounts" on public.accounts for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "owners manage accounts" on public.accounts for all to authenticated using (public.has_workspace_role(workspace_id, array['owner']::public.app_role[])) with check (public.has_workspace_role(workspace_id, array['owner']::public.app_role[]));
create policy "members read transactions" on public.transactions for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "editors create transactions" on public.transactions for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','editor']::public.app_role[]) and created_by = auth.uid());
create policy "editors update transactions" on public.transactions for update to authenticated using (public.has_workspace_role(workspace_id, array['owner','editor']::public.app_role[])) with check (public.has_workspace_role(workspace_id, array['owner','editor']::public.app_role[]));
create policy "editors delete drafts only" on public.transactions for delete to authenticated using (status = 'draft' and public.has_workspace_role(workspace_id, array['owner','editor']::public.app_role[]));
create policy "editors read documents" on public.documents for select to authenticated using (public.has_workspace_role(workspace_id, array['owner','editor']::public.app_role[]));
create policy "editors create documents" on public.documents for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','editor']::public.app_role[]) and created_by = auth.uid());
create policy "editors update documents" on public.documents for update to authenticated using (public.has_workspace_role(workspace_id, array['owner','editor']::public.app_role[])) with check (public.has_workspace_role(workspace_id, array['owner','editor']::public.app_role[]));
create policy "editors delete documents" on public.documents for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','editor']::public.app_role[]));
create policy "members read audit log" on public.audit_logs for select to authenticated using (public.is_workspace_member(workspace_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy "editors view stored documents" on storage.objects for select to authenticated
using (bucket_id = 'documents' and public.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','editor']::public.app_role[]));
create policy "editors upload stored documents" on storage.objects for insert to authenticated
with check (bucket_id = 'documents' and public.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','editor']::public.app_role[]));
create policy "editors update stored documents" on storage.objects for update to authenticated
using (bucket_id = 'documents' and public.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','editor']::public.app_role[]));
create policy "editors delete stored documents" on storage.objects for delete to authenticated
using (bucket_id = 'documents' and public.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','editor']::public.app_role[]));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.workspaces, public.workspace_members, public.workspace_invites, public.projects, public.accounts, public.transactions, public.documents to authenticated;
grant select on public.audit_logs to authenticated;
grant usage, select on sequence public.audit_logs_id_seq to authenticated;
