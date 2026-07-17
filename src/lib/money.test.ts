import { describe, expect, it } from 'vitest'
import { calculateLedger, parseMoney } from './money'
import type { Transaction } from '../types'

const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: crypto.randomUUID(), workspace_id: 'w', sequence_no: 1, kind: 'expense', status: 'posted',
  transaction_date: '2026-07-17', amount_minor: 0, description: '', category: null,
  project_id: null, payment_source: 'group_cash', member_id: null, ...overrides,
})

describe('kasa hesapları', () => {
  it('Türkçe ve para sembollü tutarları kuruşa çevirir', () => {
    expect(parseMoney('1.178₺')).toBe(117_800)
    expect(parseMoney('₺ 1.178,50')).toBe(117_850)
    expect(parseMoney('1178,50')).toBe(117_850)
    expect(parseMoney('1178.50')).toBe(117_850)
  })

  it('açılış ve grup giderini hesaplar', () => {
    const result = calculateLedger([tx({ kind: 'opening', amount_minor: 1_000_000 }), tx({ amount_minor: 50_000 })])
    expect(result.balance).toBe(950_000)
  })

  it('üye ödemesini geri ödemeye kadar kasadan düşmez', () => {
    const before = calculateLedger([tx({ kind: 'opening', amount_minor: 1_000_000 }), tx({ amount_minor: 60_000, payment_source: 'member' })])
    expect(before.balance).toBe(1_000_000)
    expect(before.memberPayable).toBe(60_000)
    const after = calculateLedger([tx({ kind: 'opening', amount_minor: 1_000_000 }), tx({ amount_minor: 60_000, payment_source: 'member' }), tx({ kind: 'reimbursement', amount_minor: 60_000 })])
    expect(after.balance).toBe(940_000)
    expect(after.totalExpenses).toBe(60_000)
  })

  it('taslak ve iptal kayıtları bakiyeye katmaz', () => {
    const result = calculateLedger([
      tx({ kind: 'opening', amount_minor: 1_000_000 }),
      tx({ amount_minor: 50_000, status: 'draft' }),
      tx({ amount_minor: 70_000, status: 'voided' }),
    ])
    expect(result.balance).toBe(1_000_000)
    expect(result.totalExpenses).toBe(0)
  })

  it('bakiye düzeltmesini gider raporuna dahil etmez', () => {
    const result = calculateLedger([
      tx({ kind: 'opening', amount_minor: 1_000_000 }),
      tx({ kind: 'expense', amount_minor: 250_000, category: 'Bakiye Düzeltme' }),
    ])
    expect(result.balance).toBe(750_000)
    expect(result.totalExpenses).toBe(0)
  })

  it('başlangıç bütçesi düzeltmesini gelir-gider raporuna katmadan kasaya uygular', () => {
    const result = calculateLedger([
      tx({ kind: 'opening', amount_minor: 1_000_000 }),
      tx({ kind: 'income', amount_minor: 500_000, category: 'Başlangıç Düzeltme' }),
    ])
    expect(result.balance).toBe(1_500_000)
    expect(result.totalIncome).toBe(0)
    expect(result.totalExpenses).toBe(0)
  })
})
