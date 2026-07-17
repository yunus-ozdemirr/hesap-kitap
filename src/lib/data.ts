import { supabase } from './supabase'
import type { LedgerState, Project, Transaction, TransactionInput } from '../types'

export async function loadLedger(): Promise<LedgerState | null> {
  if (!supabase) return null
  const { data: memberships, error: memberError } = await supabase
    .from('workspace_members').select('workspace_id, role, display_name').limit(1)
  if (memberError) throw memberError
  if (!memberships?.length) return null
  const membership = memberships[0]
  const workspaceId = membership.workspace_id

  const [workspaceResult, membersResult, projectsResult, transactionsResult] = await Promise.all([
    supabase.from('workspaces').select('*').eq('id', workspaceId).single(),
    supabase.from('workspace_members').select('user_id, display_name, role').eq('workspace_id', workspaceId),
    supabase.from('projects').select('*').eq('workspace_id', workspaceId).order('created_at'),
    supabase.from('transactions').select('*, document:documents(*)').eq('workspace_id', workspaceId).order('transaction_date', { ascending: false }).order('sequence_no', { ascending: false }),
  ])
  const error = workspaceResult.error || membersResult.error || projectsResult.error || transactionsResult.error
  if (error) throw error

  return {
    workspace: workspaceResult.data,
    role: membership.role,
    members: membersResult.data ?? [],
    projects: projectsResult.data ?? [],
    transactions: (transactionsResult.data ?? []).map((item) => ({ ...item, document: Array.isArray(item.document) ? item.document[0] : item.document })) as Transaction[],
  }
}

export async function claimWorkspace(workspaceName: string, initialBalanceMinor: number) {
  if (!supabase) throw new Error('Supabase bağlı değil')
  const { error } = await supabase.rpc('claim_initial_workspace', {
    workspace_name: workspaceName,
    initial_balance_minor: initialBalanceMinor,
  })
  if (error) throw error
}

export async function updateStartingBalance(workspaceId: string, newBalanceMinor: number) {
  if (!supabase) throw new Error('Supabase bağlı değil')
  const { error } = await supabase.rpc('adjust_starting_balance', {
    target_workspace: workspaceId,
    new_starting_balance_minor: newBalanceMinor,
  })
  if (error) throw error
}

export async function createTransaction(workspaceId: string, input: TransactionInput, file?: File) {
  if (!supabase) throw new Error('Supabase bağlı değil')
  const { data, error } = await supabase.from('transactions').insert({ workspace_id: workspaceId, ...input }).select().single()
  if (error) throw error

  if (file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
    const path = `${workspaceId}/${data.id}/${crypto.randomUUID()}-${safeName}`
    const upload = await supabase.storage.from('documents').upload(path, file, { contentType: file.type })
    if (upload.error) throw upload.error
    const documentType = file.type === 'application/pdf' ? 'invoice' : 'receipt'
    const document = await supabase.from('documents').insert({
      workspace_id: workspaceId, transaction_id: data.id, document_type: documentType,
      storage_path: path, mime_type: file.type, file_size: file.size,
    })
    if (document.error) throw document.error
  }
  return data as Transaction
}

export async function createProject(workspaceId: string, project: Pick<Project, 'name' | 'color' | 'budget_minor'>) {
  if (!supabase) throw new Error('Supabase bağlı değil')
  const { data, error } = await supabase.from('projects').insert({ workspace_id: workspaceId, ...project }).select().single()
  if (error) throw error
  return data as Project
}

export async function createInvites(workspaceId: string, emails: string[], role: 'editor' | 'viewer') {
  if (!supabase) throw new Error('Supabase bağlı değil')
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: { workspaceId, emails, role, redirectTo: window.location.origin + import.meta.env.BASE_URL },
  })
  if (error) throw error
  return data as {
    successes: string[]
    failures: Array<{ email: string; message: string }>
    links: Array<{ email: string; actionLink: string }>
  }
}

export async function getDocumentUrl(path: string) {
  if (!supabase) return null
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 60)
  if (error) throw error
  return data.signedUrl
}
