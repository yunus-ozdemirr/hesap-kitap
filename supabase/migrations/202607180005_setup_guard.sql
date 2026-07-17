-- Kurulum ekranını yalnız gerçekten sahiplenilmemiş kasa varken gösterir.
create or replace function public.workspace_setup_available()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspaces w
    where not exists (select 1 from public.workspace_members m where m.workspace_id = w.id)
  );
$$;

revoke all on function public.workspace_setup_available() from public;
grant execute on function public.workspace_setup_available() to authenticated;
