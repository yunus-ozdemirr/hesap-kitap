-- Ortak kasa değişikliklerini açık cihazlara anlık iletir.
alter publication supabase_realtime add table
  public.transactions,
  public.projects,
  public.workspace_members,
  public.workspaces;
