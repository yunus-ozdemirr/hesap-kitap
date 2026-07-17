export type Role = 'owner' | 'editor' | 'viewer'
export type TransactionKind = 'opening' | 'income' | 'expense' | 'reimbursement' | 'transfer'
export type TransactionStatus = 'draft' | 'posted' | 'voided'
export type PaymentSource = 'group_cash' | 'group_bank' | 'member'

export interface Workspace {
  id: string
  name: string
  currency: 'TRY'
  starting_balance_minor: number
}

export interface Member {
  user_id: string
  display_name: string
  email?: string
  role: Role
}

export interface Project {
  id: string
  workspace_id: string
  name: string
  color: string
  budget_minor: number | null
  status: 'active' | 'archived'
}

export interface Transaction {
  id: string
  workspace_id: string
  sequence_no: number
  kind: TransactionKind
  status: TransactionStatus
  transaction_date: string
  amount_minor: number
  description: string
  category: string | null
  project_id: string | null
  payment_source: PaymentSource
  member_id: string | null
  destination_account_id?: string | null
  created_by?: string
  created_at?: string
  document?: DocumentRecord | null
}

export interface DocumentRecord {
  id: string
  transaction_id: string
  document_type: 'invoice' | 'earchive' | 'receipt' | 'freelance_receipt' | 'bank_receipt' | 'expense_receipt'
  document_number: string | null
  issuer: string | null
  storage_path: string
  mime_type: string
  file_size: number
}

export interface LedgerState {
  workspace: Workspace
  role: Role
  members: Member[]
  projects: Project[]
  transactions: Transaction[]
}

export interface TransactionInput {
  kind: TransactionKind
  status: TransactionStatus
  transaction_date: string
  amount_minor: number
  description: string
  category: string | null
  project_id: string | null
  payment_source: PaymentSource
  member_id: string | null
}
