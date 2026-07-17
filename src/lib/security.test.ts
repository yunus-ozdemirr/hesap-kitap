import { describe, expect, it } from 'vitest'
import { isTrustedInviteLink, safeSpreadsheetCell, validateDocumentFile } from './security'

describe('security helpers', () => {
  it('spreadsheet formulas are neutralized', () => {
    expect(safeSpreadsheetCell('=HYPERLINK("https://evil.test")')).toBe("'=HYPERLINK(\"https://evil.test\")")
    expect(safeSpreadsheetCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)")
    expect(safeSpreadsheetCell('Normal açıklama')).toBe('Normal açıklama')
  })

  it('accepts only project auth verification links', () => {
    const base = 'https://project.supabase.co'
    expect(isTrustedInviteLink('https://project.supabase.co/auth/v1/verify?token=x', base)).toBe(true)
    expect(isTrustedInviteLink('http://project.supabase.co/auth/v1/verify?token=x', base)).toBe(false)
    expect(isTrustedInviteLink('https://evil.test/auth/v1/verify?token=x', base)).toBe(false)
    expect(isTrustedInviteLink('javascript:alert(1)', base)).toBe(false)
  })

  it('checks real file signatures', async () => {
    const pdf = new File([new Uint8Array([0x25,0x50,0x44,0x46,0x2d])], 'safe.pdf', { type: 'application/pdf' })
    const disguised = new File([new Uint8Array([0x4d,0x5a,0x90,0x00])], 'fake.pdf', { type: 'application/pdf' })
    expect(await validateDocumentFile(pdf)).toBeNull()
    expect(await validateDocumentFile(disguised)).toContain('eşleşmiyor')
  })
})
