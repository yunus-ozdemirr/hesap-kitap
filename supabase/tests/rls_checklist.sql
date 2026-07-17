-- Supabase SQL Editor'da farklı test JWT'leriyle doğrulanacak kabul listesi.
-- 1. Anon kullanıcı: aşağıdaki sorgular 0 satır dönmeli.
select * from public.workspaces;
select * from public.transactions;
-- 2. Viewer: SELECT başarılı, transaction INSERT reddedilmeli.
-- 3. Editor: transaction INSERT başarılı, workspace_members UPDATE reddedilmeli.
-- 4. Owner: workspace_invites INSERT başarılı.
-- 5. Viewer: private Storage signed URL üretimi reddedilmeli.
-- 6. Posted transaction DELETE reddedilmeli; draft DELETE başarılı olmalı.
