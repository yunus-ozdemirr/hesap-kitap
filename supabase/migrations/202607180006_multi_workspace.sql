-- Her doğrulanmış kullanıcı için bağımsız ve birden fazla kasa desteği
create or replace function public.create_workspace(
  workspace_name text,
  initial_balance_minor bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  caller_name text;
  confirmed_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Oturum açmanız gerekiyor'; end if;
  select email_confirmed_at, coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
    into confirmed_at, caller_name from auth.users where id = auth.uid();
  if confirmed_at is null then raise exception 'Kasa oluşturmak için doğrulanmış hesap gerekir'; end if;
  if char_length(trim(workspace_name)) not between 2 and 80 then raise exception 'Kasa adı 2-80 karakter olmalı'; end if;
  if initial_balance_minor <= 0 then raise exception 'Başlangıç bakiyesi sıfırdan büyük olmalı'; end if;
  if (select count(*) from public.workspace_members where user_id = auth.uid() and role = 'owner') >= 20 then
    raise exception 'Bir kullanıcı en fazla 20 kasanın sahibi olabilir';
  end if;

  insert into public.workspaces (name, starting_balance_minor)
  values (trim(workspace_name), initial_balance_minor) returning id into target;
  insert into public.workspace_members (workspace_id, user_id, display_name, role)
  values (target, auth.uid(), caller_name, 'owner');
  insert into public.accounts (workspace_id, name, kind)
  values (target, 'Nakit Kasa', 'cash'), (target, 'Banka', 'bank');
  insert into public.transactions
    (workspace_id, sequence_no, kind, status, transaction_date, amount_minor, description, category, payment_source, created_by)
  values
    (target, 0, 'opening', 'posted', current_date, initial_balance_minor, 'Başlangıç bütçesi', 'Fon', 'group_bank', auth.uid());
  return target;
end;
$$;

revoke all on function public.create_workspace(text, bigint) from public;
grant execute on function public.create_workspace(text, bigint) to authenticated;
