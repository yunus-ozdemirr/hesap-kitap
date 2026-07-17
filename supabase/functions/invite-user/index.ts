import { createClient } from 'npm:@supabase/supabase-js@2'

type InviteRequest = {
  workspaceId: string
  emails: string[]
  role: 'editor' | 'viewer'
}

Deno.serve(async (request) => {
  const appUrl = Deno.env.get('APP_URL')!
  const appOrigin = new URL(appUrl).origin
  const requestOrigin = request.headers.get('Origin')
  const allowedOrigins = new Set([appOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'])
  const corsHeaders = {
    'Access-Control-Allow-Origin': requestOrigin && allowedOrigins.has(requestOrigin) ? requestOrigin : appOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  const respond = (body: unknown, status = 200) => json(body, status, corsHeaders)
  if (requestOrigin && !allowedOrigins.has(requestOrigin)) return respond({ error: 'İzin verilmeyen kaynak' }, 403)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return respond({ error: 'Yalnızca POST desteklenir' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return respond({ error: 'Oturum gerekli' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const callerClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } })
    const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

    const { data: { user }, error: userError } = await callerClient.auth.getUser()
    if (userError || !user) return respond({ error: 'Geçersiz oturum' }, 401)

    const rawBody = await request.text()
    if (rawBody.length > 20_000) return respond({ error: 'İstek çok büyük' }, 413)
    const body = JSON.parse(rawBody) as InviteRequest
    const emails = [...new Set((body.emails ?? []).map(email => email.trim().toLowerCase()).filter(Boolean))]
    if (!body.workspaceId || !['editor', 'viewer'].includes(body.role) || !emails.length || emails.length > 50) {
      return respond({ error: 'Geçersiz davet isteği' }, 400)
    }
    if (emails.some(email => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return respond({ error: 'Geçersiz e-posta adresi' }, 400)
    }

    const { data: ownerMembership } = await adminClient.from('workspace_members').select('role').eq('workspace_id', body.workspaceId).eq('user_id', user.id).single()
    if (ownerMembership?.role !== 'owner') return respond({ error: 'Yalnızca kasa sahibi davet gönderebilir' }, 403)

    const existingUsers = []
    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw error
      existingUsers.push(...data.users)
      if (data.users.length < 1000) break
    }

    const successes: string[] = []
    const failures: Array<{ email: string; message: string }> = []
    const links: Array<{ email: string; actionLink: string }> = []
    const redirectTo = appUrl

    for (const email of emails) {
      try {
        const existing = existingUsers.find(item => item.email?.toLowerCase() === email)
        if (existing) {
          const { data: currentMembership } = await adminClient.from('workspace_members').select('role').eq('workspace_id', body.workspaceId).eq('user_id', existing.id).maybeSingle()
          const { error } = await adminClient.from('workspace_members').upsert({
            workspace_id: body.workspaceId, user_id: existing.id,
            display_name: existing.user_metadata?.full_name || email.split('@')[0], role: currentMembership?.role === 'owner' ? 'owner' : body.role,
          }, { onConflict: 'workspace_id,user_id' })
          if (error) throw error
          const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
            type: 'magiclink', email, options: redirectTo ? { redirectTo } : undefined,
          })
          if (linkError) throw linkError
          links.push({ email, actionLink: trustedActionLink(linkData.properties.action_link, supabaseUrl) })
        } else {
          const { error: allowError } = await adminClient.from('workspace_invites').upsert({
            workspace_id: body.workspaceId, email, role: body.role, created_by: user.id,
          }, { onConflict: 'workspace_id,email' })
          if (allowError) throw allowError
          const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
            type: 'invite', email, options: { ...(redirectTo ? { redirectTo } : {}), data: { has_password: false } },
          })
          if (linkError) throw linkError
          links.push({ email, actionLink: trustedActionLink(linkData.properties.action_link, supabaseUrl) })
        }
        successes.push(email)
      } catch (error) {
        failures.push({ email, message: error instanceof Error ? error.message : 'Davet gönderilemedi' })
      }
    }

    return respond({ successes, failures, links })
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : 'Sunucu hatası' }, 500)
  }
})

function trustedActionLink(actionLink: string, supabaseUrl: string) {
  const link = new URL(actionLink)
  const expected = new URL(supabaseUrl)
  if (link.protocol !== 'https:' || link.origin !== expected.origin || link.pathname !== '/auth/v1/verify') {
    throw new Error('Güvenilmeyen davet bağlantısı engellendi')
  }
  return link.toString()
}

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
