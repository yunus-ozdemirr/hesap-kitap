-- Önceki kurulumlardaki sabit açılış tutarını kullanıcı tanımlı hale getirir.
drop function if exists public.claim_initial_workspace();

alter table public.workspaces add column if not exists starting_balance_minor bigint;
update public.workspaces w set starting_balance_minor = coalesce(
  (select t.amount_minor from public.transactions t where t.workspace_id = w.id and t.kind = 'opening' and t.status = 'posted' order by t.sequence_no limit 1), 0
) where starting_balance_minor is null;
alter table public.workspaces alter column starting_balance_minor set default 0;
alter table public.workspaces alter column starting_balance_minor set not null;

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
  select coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1)) into caller_name
  from auth.users where id = auth.uid();
  insert into public.workspace_members (workspace_id, user_id, display_name, role)
  values (target, auth.uid(), caller_name, 'owner');
  insert into public.accounts (workspace_id, name, kind)
  values (target, 'Nakit Kasa', 'cash'), (target, 'Banka', 'bank');
  insert into public.transactions
    (workspace_id, sequence_no, kind, status, transaction_date, amount_minor, description, category, payment_source, created_by)
  values
    (target, 0, 'opening', 'posted', current_date, initial_balance_minor, 'Başlangıç bütçesi', 'Fon', 'group_bank', auth.uid());
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

update public.workspaces set name = 'Yeni Kasa'
where name = 'Üçlü Kasa'
  and not exists (select 1 from public.workspace_members where workspace_id = workspaces.id);
