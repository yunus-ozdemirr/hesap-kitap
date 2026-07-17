import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type InviteRequest = {
  workspaceId: string
  emails: string[]
  role: 'editor' | 'viewer'
  redirectTo?: string
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Oturum gerekli' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const callerClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } })
    const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

    const { data: { user }, error: userError } = await callerClient.auth.getUser()
    if (userError || !user) return json({ error: 'Geçersiz oturum' }, 401)

    const body = await request.json() as InviteRequest
    const emails = [...new Set((body.emails ?? []).map(email => email.trim().toLowerCase()).filter(Boolean))]
    if (!body.workspaceId || !['editor', 'viewer'].includes(body.role) || !emails.length || emails.length > 50) {
      return json({ error: 'Geçersiz davet isteği' }, 400)
    }
    if (emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return json({ error: 'Geçersiz e-posta adresi' }, 400)
    }

    const { data: ownerMembership } = await adminClient.from('workspace_members').select('role').eq('workspace_id', body.workspaceId).eq('user_id', user.id).single()
    if (ownerMembership?.role !== 'owner') return json({ error: 'Yalnızca kasa sahibi davet gönderebilir' }, 403)

    const existingUsers = []
    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw error
      existingUsers.push(...data.users)
      if (data.users.length < 1000) break
    }

    const successes: string[] = []
    const failures: Array<{ email: string; message: string }> = []
    const redirectTo = Deno.env.get('APP_URL') || body.redirectTo

    for (const email of emails) {
      try {
        const existing = existingUsers.find(item => item.email?.toLowerCase() === email)
        if (existing) {
          const { error } = await adminClient.from('workspace_members').upsert({
            workspace_id: body.workspaceId, user_id: existing.id,
            display_name: existing.user_metadata?.full_name || email.split('@')[0], role: body.role,
          }, { onConflict: 'workspace_id,user_id' })
          if (error) throw error
        } else {
          const { error: allowError } = await adminClient.from('workspace_invites').upsert({
            workspace_id: body.workspaceId, email, role: body.role, created_by: user.id,
          }, { onConflict: 'workspace_id,email' })
          if (allowError) throw allowError
          const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined)
          if (inviteError) throw inviteError
        }
        successes.push(email)
      } catch (error) {
        failures.push({ email, message: error instanceof Error ? error.message : 'Davet gönderilemedi' })
      }
    }

    return json({ successes, failures })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Sunucu hatası' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
