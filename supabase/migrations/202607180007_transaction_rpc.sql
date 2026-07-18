-- Finansal hareketleri tek ve doğrulanabilir bir sunucu işlemiyle oluşturur.
create or replace function public.create_transaction(
  p_workspace_id uuid,
  p_kind public.transaction_kind,
  p_status public.transaction_status,
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
security invoker
set search_path = public
as $$
begin
  if p_amount_minor <= 0 then
    raise exception 'Tutar sıfırdan büyük olmalıdır';
  end if;
  if char_length(trim(p_description)) not between 2 and 500 then
    raise exception 'Açıklama 2 ile 500 karakter arasında olmalıdır';
  end if;

  return query
  insert into public.transactions (
    workspace_id, kind, status, transaction_date, amount_minor,
    description, category, project_id, payment_source, member_id
  ) values (
    p_workspace_id, p_kind, p_status, p_transaction_date, p_amount_minor,
    trim(p_description), nullif(trim(p_category), ''), p_project_id,
    p_payment_source, p_member_id
  )
  returning *;
end;
$$;

revoke all on function public.create_transaction(uuid, public.transaction_kind, public.transaction_status, date, bigint, text, text, uuid, public.payment_source, uuid) from public;
grant execute on function public.create_transaction(uuid, public.transaction_kind, public.transaction_status, date, bigint, text, text, uuid, public.payment_source, uuid) to authenticated;
