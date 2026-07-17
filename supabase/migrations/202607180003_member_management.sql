-- Güvenli üye çıkarma ve sahiplik devri
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
  if caller is null or not public.has_workspace_role(target_workspace, array['owner']::public.app_role[]) then
    raise exception 'Yalnızca kasa sahibi bu işlemi yapabilir';
  end if;

  select role into target_role
  from public.workspace_members
  where workspace_id = target_workspace and user_id = target_user;

  if target_role is null then raise exception 'Üye bulunamadı'; end if;

  if requested_action = 'remove' then
    if target_user = caller then raise exception 'Kendinizi doğrudan çıkaramazsınız; önce sahipliği devredin'; end if;
    if target_role = 'owner' and (select count(*) from public.workspace_members where workspace_id = target_workspace and role = 'owner') <= 1 then
      raise exception 'Kasada en az bir sahip bulunmalıdır';
    end if;
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
