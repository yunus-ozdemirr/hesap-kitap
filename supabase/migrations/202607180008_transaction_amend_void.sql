-- Kesinleşmiş hareketler geçmişi bozmadan düzeltilir veya iptal edilir.
create or replace function public.amend_transaction(
  p_transaction_id uuid,
  p_kind public.transaction_kind,
  p_transaction_date date,
  p_amount_minor bigint,
  p_description text,
  p_category text,
  p_project_id uuid,
  p_payment_source public.payment_source,
  p_member_id uuid
)
returns setof public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  original public.transactions;
  replacement public.transactions;
begin
  select * into original from public.transactions where id = p_transaction_id for update;
  if original.id is null then raise exception 'Hareket bulunamadı'; end if;
  if not public.has_workspace_role(original.workspace_id, array['owner','editor']::public.app_role[]) then
    raise exception 'Bu hareketi düzenleme yetkiniz yok' using errcode = '42501';
  end if;
  if original.kind = 'opening' then raise exception 'Başlangıç kaydı düzenlenemez'; end if;
  if original.status = 'voided' then raise exception 'İptal edilmiş kayıt düzenlenemez'; end if;
  if p_amount_minor <= 0 then raise exception 'Tutar sıfırdan büyük olmalıdır'; end if;
  if char_length(trim(p_description)) not between 2 and 500 then
    raise exception 'Açıklama 2 ile 500 karakter arasında olmalıdır';
  end if;

  update public.transactions set status = 'voided' where id = original.id;
  insert into public.transactions (
    workspace_id, kind, status, transaction_date, amount_minor, description,
    category, project_id, payment_source, member_id, created_by
  ) values (
    original.workspace_id, p_kind, 'posted', p_transaction_date, p_amount_minor,
    trim(p_description), nullif(trim(p_category), ''), p_project_id,
    p_payment_source, p_member_id, auth.uid()
  ) returning * into replacement;

  -- Varsa belge yeni düzeltme kaydını takip eder.
  update public.documents set transaction_id = replacement.id
  where transaction_id = original.id;

  return next replacement;
end;
$$;

create or replace function public.void_transaction(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.transactions;
begin
  select * into target from public.transactions where id = p_transaction_id for update;
  if target.id is null then raise exception 'Hareket bulunamadı'; end if;
  if not public.has_workspace_role(target.workspace_id, array['owner','editor']::public.app_role[]) then
    raise exception 'Bu hareketi iptal etme yetkiniz yok' using errcode = '42501';
  end if;
  if target.kind = 'opening' then raise exception 'Başlangıç kaydı silinemez'; end if;
  if target.status = 'voided' then raise exception 'Hareket zaten iptal edilmiş'; end if;
  update public.transactions set status = 'voided' where id = target.id;
end;
$$;

revoke all on function public.amend_transaction(uuid, public.transaction_kind, date, bigint, text, text, uuid, public.payment_source, uuid) from public;
revoke all on function public.void_transaction(uuid) from public;
grant execute on function public.amend_transaction(uuid, public.transaction_kind, date, bigint, text, text, uuid, public.payment_source, uuid) to authenticated;
grant execute on function public.void_transaction(uuid) to authenticated;
