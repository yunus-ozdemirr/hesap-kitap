const dangerousSpreadsheetPrefix = /^[=+\-@\t\r]/

export function safeSpreadsheetCell(value: string) {
  return dangerousSpreadsheetPrefix.test(value) ? `'${value}` : value
}

export function isTrustedInviteLink(link: string, supabaseUrl: string) {
  try {
    const candidate = new URL(link)
    const expected = new URL(supabaseUrl)
    return candidate.protocol === 'https:' && candidate.origin === expected.origin && candidate.pathname === '/auth/v1/verify'
  } catch {
    return false
  }
}

export async function validateDocumentFile(file: File): Promise<string | null> {
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) return 'Belge en fazla 10 MB olabilir.'
  const allowed = ['application/pdf', 'image/jpeg', 'image/png']
  if (!allowed.includes(file.type)) return 'Belge yalnızca PDF, JPG veya PNG olabilir.'

  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const isPdf = bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const isPng = bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value)
  const matches = file.type === 'application/pdf' ? isPdf : file.type === 'image/jpeg' ? isJpeg : isPng
  return matches ? null : 'Dosyanın içeriği uzantısı veya türüyle eşleşmiyor.'
}
