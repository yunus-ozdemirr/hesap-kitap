import { createClient } from 'npm:@supabase/supabase-js@2'

const allowedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (request) => {
  const appUrl = Deno.env.get('APP_URL')!
  const appOrigin = new URL(appUrl).origin
  const requestOrigin = request.headers.get('Origin')
  const allowedOrigins = new Set([appOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'])
  const cors = {
    'Access-Control-Allow-Origin': requestOrigin && allowedOrigins.has(requestOrigin) ? requestOrigin : appOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
  if (requestOrigin && !allowedOrigins.has(requestOrigin)) return respond({ error: 'İzin verilmeyen kaynak' }, 403)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return respond({ error: 'Yalnızca POST desteklenir' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return respond({ error: 'Oturum gerekli' }, 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const caller = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } })
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: { user }, error: userError } = await caller.auth.getUser()
    if (userError || !user) return respond({ error: 'Geçersiz oturum' }, 401)

    const form = await request.formData()
    const workspaceId = String(form.get('workspaceId') ?? '')
    const transactionId = String(form.get('transactionId') ?? '')
    const file = form.get('file')
    if (!uuidPattern.test(workspaceId) || !uuidPattern.test(transactionId) || !(file instanceof File)) {
      return respond({ error: 'Geçersiz belge isteği' }, 400)
    }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024 || !allowedMimeTypes.has(file.type)) {
      return respond({ error: 'Dosya türü veya boyutu uygun değil' }, 400)
    }
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
    const isPdf = bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    const isPng = bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value)
    if (!(file.type === 'application/pdf' ? isPdf : file.type === 'image/jpeg' ? isJpeg : isPng)) {
      return respond({ error: 'Dosya içeriği bildirilen türle eşleşmiyor' }, 400)
    }

    const { data: membership } = await admin.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle()
    if (!membership || !['owner', 'editor'].includes(membership.role)) return respond({ error: 'Belge yükleme yetkiniz yok' }, 403)
    const { data: transaction } = await admin.from('transactions').select('id').eq('id', transactionId).eq('workspace_id', workspaceId).maybeSingle()
    if (!transaction) return respond({ error: 'Hareket bulunamadı' }, 404)

    const safeName = file.name.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120) || 'document'
    const path = `${workspaceId}/${transactionId}/${crypto.randomUUID()}-${safeName}`
    const upload = await admin.storage.from('documents').upload(path, file, { contentType: file.type, upsert: false })
    if (upload.error) throw upload.error
    const documentType = file.type === 'application/pdf' ? 'invoice' : 'receipt'
    const inserted = await admin.from('documents').insert({
      workspace_id: workspaceId, transaction_id: transactionId, document_type: documentType,
      storage_path: path, mime_type: file.type, file_size: file.size, created_by: user.id,
    }).select().single()
    if (inserted.error) {
      await admin.storage.from('documents').remove([path])
      throw inserted.error
    }
    return respond({ document: inserted.data })
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : 'Belge yüklenemedi' }, 500)
  }
})
