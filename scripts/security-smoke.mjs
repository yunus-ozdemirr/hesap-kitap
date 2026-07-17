import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !publishableKey || !serviceRoleKey) throw new Error('Gerekli Supabase test değişkenleri eksik')

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
const password = `Test-${crypto.randomUUID()}-Aa9!`
const emails = {
  owner: `owner-${stamp}@example.com`, editor: `editor-${stamp}@example.com`,
  viewer: `viewer-${stamp}@example.com`, outsider: `outsider-${stamp}@example.com`,
}
const users = {}
const workspaceIds = []
const storagePaths = []
const results = []

function assert(condition, label) {
  if (!condition) throw new Error(`BAŞARISIZ: ${label}`)
  results.push(`✓ ${label}`)
}

async function clientFor(email) {
  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}

try {
  for (const [role, email] of Object.entries(emails)) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Security ${role}` } })
    if (error) throw error
    users[role] = data.user.id
  }

  const first = await admin.from('workspaces').insert({ name: `Security Test ${stamp}`, starting_balance_minor: 100000 }).select().single()
  const second = await admin.from('workspaces').insert({ name: `Security Other ${stamp}`, starting_balance_minor: 100000 }).select().single()
  if (first.error || second.error) throw first.error || second.error
  workspaceIds.push(first.data.id, second.data.id)
  const members = await admin.from('workspace_members').insert([
    { workspace_id: first.data.id, user_id: users.owner, display_name: 'Test Owner', role: 'owner' },
    { workspace_id: first.data.id, user_id: users.editor, display_name: 'Test Editor', role: 'editor' },
    { workspace_id: first.data.id, user_id: users.viewer, display_name: 'Test Viewer', role: 'viewer' },
  ])
  if (members.error) throw members.error
  const otherProject = await admin.from('projects').insert({ workspace_id: second.data.id, name: 'Other Project', color: '#123456', created_by: users.outsider }).select().single()
  if (otherProject.error) throw otherProject.error

  const anon = createClient(url, publishableKey, { auth: { persistSession: false } })
  const owner = await clientFor(emails.owner)
  const editor = await clientFor(emails.editor)
  const viewer = await clientFor(emails.viewer)
  const outsider = await clientFor(emails.outsider)

  const anonRead = await anon.from('workspaces').select('id').eq('id', first.data.id)
  assert(!anonRead.error && anonRead.data.length === 0, 'Anon kullanıcı kasa verisini okuyamıyor')
  const outsiderRead = await outsider.from('workspaces').select('id').eq('id', first.data.id)
  assert(!outsiderRead.error && outsiderRead.data.length === 0, 'Üye olmayan kullanıcı kasayı okuyamıyor')
  const viewerRead = await viewer.from('workspaces').select('id').eq('id', first.data.id)
  assert(!viewerRead.error && viewerRead.data.length === 1, 'Viewer kendi kasasını okuyabiliyor')

  const viewerInsert = await viewer.from('transactions').insert({ workspace_id: first.data.id, sequence_no: 0, kind: 'income', status: 'posted', amount_minor: 100, description: 'Blocked viewer write', payment_source: 'group_bank', created_by: users.viewer })
  assert(Boolean(viewerInsert.error), 'Viewer finansal kayıt oluşturamıyor')

  const posted = await editor.from('transactions').insert({ workspace_id: first.data.id, sequence_no: 0, kind: 'income', status: 'posted', amount_minor: 100, description: 'Posted security test', payment_source: 'group_bank', created_by: users.editor }).select().single()
  const draft = await editor.from('transactions').insert({ workspace_id: first.data.id, sequence_no: 0, kind: 'expense', status: 'draft', amount_minor: 100, description: 'Draft security test', payment_source: 'group_bank', created_by: users.editor }).select().single()
  assert(!posted.error && !draft.error, 'Editor finansal kayıt oluşturabiliyor')
  const deletePosted = await editor.from('transactions').delete().eq('id', posted.data.id).select('id')
  assert(!deletePosted.error && deletePosted.data.length === 0, 'Kesinleşmiş kayıt silinemiyor')
  const deleteDraft = await editor.from('transactions').delete().eq('id', draft.data.id).select('id')
  assert(!deleteDraft.error && deleteDraft.data.length === 1, 'Editor taslak kaydı silebiliyor')

  const directRoleChange = await owner.from('workspace_members').update({ role: 'owner' }).eq('workspace_id', first.data.id).eq('user_id', users.viewer)
  assert(Boolean(directRoleChange.error), 'Roller doğrudan API ile değiştirilemiyor')
  const crossTenant = await editor.from('transactions').insert({ workspace_id: first.data.id, sequence_no: 0, kind: 'expense', status: 'draft', amount_minor: 100, description: 'Cross tenant test', project_id: otherProject.data.id, payment_source: 'group_bank', created_by: users.editor })
  assert(Boolean(crossTenant.error), 'Farklı kasaya ait proje finansal kayda bağlanamıyor')

  const fakePdf = new File([new Uint8Array([0x4d,0x5a,0x90,0x00])], 'virus.pdf', { type: 'application/pdf' })
  const directStorage = await editor.storage.from('documents').upload(`${first.data.id}/direct-virus.pdf`, fakePdf)
  assert(Boolean(directStorage.error), 'İstemci Storage alanına doğrudan dosya yükleyemiyor')
  const badForm = new FormData()
  badForm.set('workspaceId', first.data.id); badForm.set('transactionId', posted.data.id); badForm.set('file', fakePdf)
  const badUpload = await editor.functions.invoke('upload-document', { body: badForm })
  assert(Boolean(badUpload.error) || Boolean(badUpload.data?.error), 'Sahte PDF sunucu tarafında engelleniyor')
  const goodPdf = new File([new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34])], 'invoice.pdf', { type: 'application/pdf' })
  const goodForm = new FormData()
  goodForm.set('workspaceId', first.data.id); goodForm.set('transactionId', posted.data.id); goodForm.set('file', goodPdf)
  const goodUpload = await editor.functions.invoke('upload-document', { body: goodForm })
  assert(!goodUpload.error && Boolean(goodUpload.data?.document), 'Geçerli PDF yetkili editor tarafından yüklenebiliyor')
  if (goodUpload.data?.document?.storage_path) storagePaths.push(goodUpload.data.document.storage_path)
  const viewerDocs = await viewer.from('documents').select('id').eq('workspace_id', first.data.id)
  assert(!viewerDocs.error && viewerDocs.data.length === 0, 'Viewer belge metadatasını okuyamıyor')

  const viewerManage = await viewer.rpc('manage_workspace_member', { target_workspace: first.data.id, target_user: users.editor, requested_action: 'remove' })
  assert(Boolean(viewerManage.error), 'Viewer üye yönetemiyor')
  const viewerInvite = await viewer.functions.invoke('invite-user', { body: { workspaceId: first.data.id, emails: [emails.outsider], role: 'viewer' } })
  assert(Boolean(viewerInvite.error) || Boolean(viewerInvite.data?.error), 'Viewer davet bağlantısı oluşturamıyor')
  const ownerInvite = await owner.functions.invoke('invite-user', { body: { workspaceId: first.data.id, emails: [emails.outsider], role: 'viewer' } })
  assert(!ownerInvite.error && ownerInvite.data?.links?.length === 1 && new URL(ownerInvite.data.links[0].actionLink).origin === new URL(url).origin, 'Owner güvenilir davet bağlantısı oluşturabiliyor')

  const removeViewer = await owner.rpc('manage_workspace_member', { target_workspace: first.data.id, target_user: users.viewer, requested_action: 'remove' })
  assert(!removeViewer.error, 'Owner üyeyi çıkarabiliyor')
  const removedRead = await viewer.from('workspaces').select('id').eq('id', first.data.id)
  assert(!removedRead.error && removedRead.data.length === 0, 'Çıkarılan üyenin erişimi anında kesiliyor')
  const transfer = await owner.rpc('manage_workspace_member', { target_workspace: first.data.id, target_user: users.editor, requested_action: 'transfer_ownership' })
  assert(!transfer.error, 'Owner sahipliği editor üyeye devredebiliyor')
  const roles = await admin.from('workspace_members').select('user_id,role').eq('workspace_id', first.data.id).in('user_id', [users.owner, users.editor])
  assert(roles.data?.find(x => x.user_id === users.owner)?.role === 'editor' && roles.data?.find(x => x.user_id === users.editor)?.role === 'owner', 'Sahiplik devrinde eski owner editor oluyor')

  console.log(results.join('\n'))
  console.log(`Güvenlik senaryoları geçti: ${results.length}/${results.length}`)
} finally {
  if (storagePaths.length) await admin.storage.from('documents').remove(storagePaths)
  for (const workspaceId of workspaceIds) await admin.from('workspaces').delete().eq('id', workspaceId)
  for (const userId of Object.values(users)) await admin.auth.admin.deleteUser(userId)
}
