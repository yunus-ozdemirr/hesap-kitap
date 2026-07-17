import type { LedgerState } from '../types'

const workspaceId = 'demo-workspace'
export const demoState: LedgerState = {
  workspace: { id: workspaceId, name: 'Örnek Proje Kasası', currency: 'TRY', starting_balance_minor: 1_000_000 },
  role: 'owner',
  members: [
    { user_id: 'u1', display_name: 'Yunus', email: 'yunus@ekip.local', role: 'owner' },
    { user_id: 'u2', display_name: 'Ece', email: 'ece@ekip.local', role: 'editor' },
    { user_id: 'u3', display_name: 'Mert', email: 'mert@ekip.local', role: 'editor' },
  ],
  projects: [
    { id: 'p1', workspace_id: workspaceId, name: 'Dernek AI', color: '#f1b84b', budget_minor: 700_000, status: 'active' },
    { id: 'p2', workspace_id: workspaceId, name: 'Web Projesi', color: '#ef6a58', budget_minor: 200_000, status: 'active' },
    { id: 'p3', workspace_id: workspaceId, name: 'Genel Gider', color: '#2f7765', budget_minor: 100_000, status: 'active' },
  ],
  transactions: [
    { id: 't4', workspace_id: workspaceId, sequence_no: 4, kind: 'expense', status: 'draft', transaction_date: '2026-07-16', amount_minor: 21_900, description: 'Sunum çıktıları ve kırtasiye', category: 'Kırtasiye', project_id: 'p2', payment_source: 'group_cash', member_id: null },
    { id: 't3', workspace_id: workspaceId, sequence_no: 3, kind: 'expense', status: 'posted', transaction_date: '2026-07-12', amount_minor: 47_500, description: 'Ekip toplantısı ulaşım gideri', category: 'Ulaşım', project_id: 'p3', payment_source: 'member', member_id: 'u2' },
    { id: 't2', workspace_id: workspaceId, sequence_no: 2, kind: 'expense', status: 'posted', transaction_date: '2026-07-08', amount_minor: 124_950, description: 'Alan adı ve yıllık araç lisansları', category: 'Yazılım', project_id: 'p1', payment_source: 'group_bank', member_id: null, document: { id: 'd1', transaction_id: 't2', document_type: 'earchive', document_number: 'EAR20260042', issuer: 'Bulut Teknoloji', storage_path: '', mime_type: 'application/pdf', file_size: 220_000 } },
    { id: 't1', workspace_id: workspaceId, sequence_no: 1, kind: 'opening', status: 'posted', transaction_date: '2026-07-01', amount_minor: 1_000_000, description: 'Başlangıç bütçesi', category: 'Fon', project_id: 'p1', payment_source: 'group_bank', member_id: null },
  ],
}
