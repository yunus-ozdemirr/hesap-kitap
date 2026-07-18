import { supabase } from './supabase'
import type { LedgerState, Project, Transaction, TransactionInput, WorkspaceOption } from '../types'

export async function listWorkspaces(): Promise<WorkspaceOption[]> {
  if (!supabase) return []
  const { data: memberships, error: memberError } = await supabase
    .from('workspace_members').select('workspace_id, role, display_name')
  if (memberError) throw memberError
  if (!memberships?.length) return []
  const ids = memberships.map(item => item.workspace_id)
  const { data: workspaces, error } = await supabase.from('workspaces').select('*').in('id', ids).order('created_at')
  if (error) throw error
  return (workspaces ?? []).map(workspace => ({
    ...workspace,
    role: memberships.find(item => item.workspace_id === workspace.id)!.role,
  })) as WorkspaceOption[]
}

export async function loadLedger(preferredWorkspaceId?: string): Promise<LedgerState | null> {
  if (!supabase) return null
  const { data: memberships, error: memberError } = await supabase
    .from('workspace_members').select('workspace_id, role, display_name')
  if (memberError) throw memberError
  if (!memberships?.length) return null
  const membership = memberships.find(item => item.workspace_id === preferredWorkspaceId) ?? memberships[0]
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
  const { data, error } = await supabase.rpc('create_workspace', {
    workspace_name: workspaceName,
    initial_balance_minor: initialBalanceMinor,
  })
  if (error) throw error
  return data as string
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
  const { data, error } = await supabase.rpc('create_transaction', {
    p_workspace_id: workspaceId,
    p_kind: input.kind,
    p_status: input.status,
    p_transaction_date: input.transaction_date,
    p_amount_minor: input.amount_minor,
    p_description: input.description,
    p_category: input.category,
    p_project_id: input.project_id,
    p_payment_source: input.payment_source,
    p_member_id: input.member_id,
  }).single()
  if (error) {
    const detail = [error.message, error.details, error.hint].filter(Boolean).join(' · ')
    throw new Error(detail || 'Hareket veritabanına kaydedilemedi')
  }
  const created = data as Transaction

  if (file) {
    const form = new FormData()
    form.set('workspaceId', workspaceId)
    form.set('transactionId', created.id)
    form.set('file', file)
    const upload = await supabase.functions.invoke('upload-document', { body: form })
    if (upload.error) throw upload.error
    if (upload.data?.error) throw new Error(upload.data.error)
  }
  return created
}

export async function amendTransaction(transactionId: string, input: TransactionInput, file?: File) {
  if (!supabase) throw new Error('Supabase bağlı değil')
  const { data, error } = await supabase.rpc('amend_transaction', {
    p_transaction_id: transactionId,
    p_kind: input.kind,
    p_transaction_date: input.transaction_date,
    p_amount_minor: input.amount_minor,
    p_description: input.description,
    p_category: input.category,
    p_project_id: input.project_id,
    p_payment_source: input.payment_source,
    p_member_id: input.member_id,
  }).single()
  if (error) throw new Error([error.message, error.details, error.hint].filter(Boolean).join(' · '))
  const amended = data as Transaction
  if (file) {
    const form = new FormData()
    form.set('workspaceId', amended.workspace_id)
    form.set('transactionId', amended.id)
    form.set('file', file)
    const upload = await supabase.functions.invoke('upload-document', { body: form })
    if (upload.error) throw upload.error
    if (upload.data?.error) throw new Error(upload.data.error)
  }
  return amended
}

export async function voidTransaction(transactionId: string) {
  if (!supabase) throw new Error('Supabase bağlı değil')
  const { error } = await supabase.rpc('void_transaction', { p_transaction_id: transactionId })
  if (error) throw new Error([error.message, error.details, error.hint].filter(Boolean).join(' · '))
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
    body: { workspaceId, emails, role },
  })
  if (error) throw error
  return data as {
    successes: string[]
    failures: Array<{ email: string; message: string }>
    links: Array<{ email: string; actionLink: string }>
  }
}

export async function manageMember(workspaceId: string, userId: string, action: 'remove' | 'transfer_ownership') {
  if (!supabase) throw new Error('Supabase bağlı değil')
  const { error } = await supabase.rpc('manage_workspace_member', {
    target_workspace: workspaceId,
    target_user: userId,
    requested_action: action,
  })
  if (error) throw error
}

export async function getDocumentUrl(path: string) {
  if (!supabase) return null
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 60, { download: true })
  if (error) throw error
  return data.signedUrl
}
