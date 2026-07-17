import type { Transaction } from '../types'

export const formatMoney = (minor: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(minor / 100)

export const parseMoney = (value: string) => {
  const raw = value.trim().replace(/[^\d,.-]/g, '')
  if (!raw) return 0
  const lastComma = raw.lastIndexOf(',')
  const lastDot = raw.lastIndexOf('.')
  let normalized = raw
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.'
    const groupingSeparator = decimalSeparator === ',' ? '.' : ','
    normalized = raw.replaceAll(groupingSeparator, '').replace(decimalSeparator, '.')
  } else if (lastComma >= 0) {
    normalized = raw.replace(/\./g, '').replace(',', '.')
  } else if (lastDot >= 0) {
    const fractionLength = raw.length - lastDot - 1
    normalized = fractionLength === 3 ? raw.replace(/\./g, '') : raw
  }
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
