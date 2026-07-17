import type { Transaction } from '../types'

export const formatMoney = (minor: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(minor / 100)

export const parseMoney = (value: string) => {
  const normalized = value.trim().replace(/\./g, '').replace(',', '.')
  const amount = Number(normalized)
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

export function calculateLedger(transactions: Transaction[]) {
  const active = transactions.filter((item) => item.status === 'posted')
  let balance = 0
  let totalExpenses = 0
  let totalIncome = 0
  let memberPayable = 0

  for (const item of active) {
    if (item.kind === 'opening' || item.kind === 'income') {
      balance += item.amount_minor
      if (item.kind === 'income' && item.category !== 'Başlangıç Düzeltme') totalIncome += item.amount_minor
    }
    if (item.kind === 'expense') {
      if (!['Bakiye Düzeltme', 'Başlangıç Düzeltme'].includes(item.category ?? '')) totalExpenses += item.amount_minor
      if (item.payment_source === 'member') memberPayable += item.amount_minor
      else balance -= item.amount_minor
    }
    if (item.kind === 'reimbursement') {
      balance -= item.amount_minor
      memberPayable = Math.max(0, memberPayable - item.amount_minor)
    }
  }

  return { balance, totalExpenses, totalIncome, memberPayable }
}
