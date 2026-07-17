-- Rol bütünlüğü, çapraz-kasa referansları ve denetim günlüğü sertleştirmesi

-- Üyelik değişiklikleri yalnız güvenli RPC üzerinden yapılır.
revoke insert, update, delete on public.workspace_members from authenticated;
drop policy if exists "owners update teammates" on public.workspace_members;
drop policy if exists "owners remove teammates" on public.workspace_members;

-- Belge mutasyonları yalnız imza doğrulayan Edge Function tarafından service role ile yapılır.
revoke insert, update, delete on public.documents from authenticated;
drop policy if exists "editors create documents" on public.documents;
drop policy if exists "editors update documents" on public.documents;
drop policy if exists "editors delete documents" on public.documents;
drop policy if exists "editors upload stored documents" on storage.objects;
drop policy if exists "editors update stored documents" on storage.objects;
drop policy if exists "editors delete stored documents" on storage.objects;

create or replace function public.protect_tenant_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'Kayıt başka kasaya taşınamaz';
    end if;
    if to_jsonb(new) ? 'created_by' and new.created_by is distinct from old.created_by then
      raise exception 'Kaydı oluşturan kullanıcı değiştirilemez';
    end if;
  end if;
  return new;
end;
$$;

create trigger projects_protect_tenant before update on public.projects
for each row execute function public.protect_tenant_columns();
create trigger transactions_protect_tenant before update on public.transactions
for each row execute function public.protect_tenant_columns();
create trigger documents_protect_tenant before update on public.documents
for each row execute function public.protect_tenant_columns();

create or replace function public.validate_transaction_references()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id = new.project_id and p.workspace_id = new.workspace_id
  ) then raise exception 'Proje bu kasaya ait değil'; end if;

  if new.member_id is not null and not exists (
    select 1 from public.workspace_members m where m.user_id = new.member_id and m.workspace_id = new.workspace_id
  ) then raise exception 'Ödeme yapan üye bu kasaya ait değil'; end if;

  if new.source_account_id is not null and not exists (
    select 1 from public.accounts a where a.id = new.source_account_id and a.workspace_id = new.workspace_id
  ) then raise exception 'Kaynak hesap bu kasaya ait değil'; end if;

  if new.destination_account_id is not null and not exists (
    select 1 from public.accounts a where a.id = new.destination_account_id and a.workspace_id = new.workspace_id
  ) then raise exception 'Hedef hesap bu kasaya ait değil'; end if;

  return new;
end;
$$;
create trigger transactions_validate_references before insert or update on public.transactions
for each row execute function public.validate_transaction_references();

create or replace function public.validate_document_references()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.transactions t where t.id = new.transaction_id and t.workspace_id = new.workspace_id
  ) then raise exception 'Belge hareketi bu kasaya ait değil'; end if;
  if new.storage_path not like new.workspace_id::text || '/%' then
    raise exception 'Belge yolu kasa diziniyle başlamalıdır';
  end if;
  return new;
end;
$$;
create trigger documents_validate_references before insert or update on public.documents
for each row execute function public.validate_document_references();

create or replace function public.write_member_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (workspace_id, actor_id, table_name, record_id, action, old_data, new_data)
  values (
    coalesce(new.workspace_id, old.workspace_id), auth.uid(), tg_table_name,
    coalesce(new.user_id, old.user_id), tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;
create trigger workspace_members_audit after insert or update or delete on public.workspace_members
for each row execute function public.write_member_audit_log();

create or replace function public.write_workspace_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (workspace_id, actor_id, table_name, record_id, action, old_data, new_data)
  values (new.id, auth.uid(), tg_table_name, new.id, tg_op, to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;
create trigger workspaces_audit after update on public.workspaces
for each row execute function public.write_workspace_audit_log();

create or replace function public.manage_workspace_member(
  target_workspace uuid,
  target_user uuid,
  requested_action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target_role public.app_role;
begin
  if caller is null then raise exception 'Oturum gerekli'; end if;
  perform pg_advisory_xact_lock(hashtext(target_workspace::text));
  if not public.has_workspace_role(target_workspace, array['owner']::public.app_role[]) then
    raise exception 'Yalnızca kasa sahibi bu işlemi yapabilir';
  end if;
  select role into target_role from public.workspace_members
  where workspace_id = target_workspace and user_id = target_user for update;
  if target_role is null then raise exception 'Üye bulunamadı'; end if;

  if requested_action = 'remove' then
    if target_user = caller then raise exception 'Önce sahipliği devredin'; end if;
    delete from public.workspace_members where workspace_id = target_workspace and user_id = target_user;
  elsif requested_action = 'transfer_ownership' then
    if target_user = caller then raise exception 'Zaten kasa sahibisiniz'; end if;
    update public.workspace_members set role = 'owner' where workspace_id = target_workspace and user_id = target_user;
    update public.workspace_members set role = 'editor' where workspace_id = target_workspace and user_id = caller;
  else
    raise exception 'Geçersiz işlem';
  end if;
end;
$$;

revoke all on function public.manage_workspace_member(uuid, uuid, text) from public;
grant execute on function public.manage_workspace_member(uuid, uuid, text) to authenticated;
