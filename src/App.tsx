import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Banknote, BarChart3, Check, ChevronDown,
  CircleAlert, Download, FileText, FolderKanban, LayoutDashboard, LogOut, Menu, Plus,
  ReceiptText, Search, ShieldCheck, Sparkles, Users, WalletCards, X,
} from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isConfigured } from './lib/supabase'
import { demoState } from './lib/demo'
import { calculateLedger, formatMoney, parseMoney } from './lib/money'
import { isTrustedInviteLink, safeSpreadsheetCell, validateDocumentFile } from './lib/security'
import { claimWorkspace, createInvites, createProject, createTransaction, getDocumentUrl, loadLedger, manageMember, updateStartingBalance } from './lib/data'
import type { LedgerState, Project, Transaction, TransactionInput, TransactionKind } from './types'

type View = 'dashboard' | 'transactions' | 'projects' | 'reports' | 'team'

const kindLabel: Record<TransactionKind, string> = {
  opening: 'Açılış', income: 'Gelir', expense: 'Gider', reimbursement: 'Geri ödeme', transfer: 'Transfer',
}
const sourceLabel = { group_cash: 'Grup kasası', group_bank: 'Grup bankası', member: 'Üye ödedi' }
const roleLabel = { owner: 'Sahip', editor: 'Düzenleyici', viewer: 'Görüntüleyici' }

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!isConfigured)
  const [ledger, setLedger] = useState<LedgerState | null>(isConfigured ? null : demoState)
  const [needsClaim, setNeedsClaim] = useState(false)
  const [loading, setLoading] = useState(isConfigured)
  const [error, setError] = useState('')

  const refresh = async () => {
    if (!isConfigured) return
    setLoading(true)
    try {
      const next = await loadLedger()
      setLedger(next)
      setNeedsClaim(!next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Veriler yüklenemedi')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
      if (data.session) refresh()
      else setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (next) setTimeout(refresh, 0)
      else setLedger(null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!authReady || loading) return <LoadingScreen />
  if (isConfigured && !session) return <LoginScreen onError={setError} error={error} />
  if (needsClaim) return <ClaimScreen onClaim={async (name, amount) => { await claimWorkspace(name, amount); await refresh() }} onError={setError} error={error} />
  if (!ledger) return <LoadingScreen />

  return <LedgerApp ledger={ledger} setLedger={setLedger} refresh={refresh} session={session} />
}

function LedgerApp({ ledger, setLedger, refresh, session }: {
  ledger: LedgerState
  setLedger: (state: LedgerState) => void
  refresh: () => Promise<void>
  session: Session | null
}) {
  const [view, setView] = useState<View>('dashboard')
  const [mobileNav, setMobileNav] = useState(false)
  const [modal, setModal] = useState<'transaction' | 'project' | 'invite' | 'balance' | 'starting' | 'password' | null>(null)
  const [toast, setToast] = useState('')
  const [search, setSearch] = useState('')
  const metrics = useMemo(() => calculateLedger(ledger.transactions), [ledger.transactions])
  const canEdit = ledger.role === 'owner' || ledger.role === 'editor'

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }

  const addTransaction = async (input: TransactionInput, file?: File) => {
    if (!isConfigured) {
      const transaction: Transaction = {
        id: crypto.randomUUID(), workspace_id: ledger.workspace.id,
        sequence_no: Math.max(...ledger.transactions.map((t) => t.sequence_no), 0) + 1,
        ...input,
        document: file ? { id: crypto.randomUUID(), transaction_id: '', document_type: 'receipt', document_number: null, issuer: null, storage_path: '', mime_type: file.type, file_size: file.size } : null,
      }
      setLedger({ ...ledger, transactions: [transaction, ...ledger.transactions] })
    } else {
      await createTransaction(ledger.workspace.id, input, file)
      await refresh()
    }
    setModal(null)
    notify('Kayıt kasaya işlendi')
  }

  const addProject = async (project: Pick<Project, 'name' | 'color' | 'budget_minor'>) => {
    if (!isConfigured) {
      setLedger({ ...ledger, projects: [...ledger.projects, { id: crypto.randomUUID(), workspace_id: ledger.workspace.id, status: 'active', ...project }] })
    } else { await createProject(ledger.workspace.id, project); await refresh() }
    setModal(null); notify('Proje oluşturuldu')
  }

  const adjustBalance = async (targetMinor: number, note: string) => {
    const difference = targetMinor - metrics.balance
    if (difference === 0) { setModal(null); notify('Kasa bakiyesi zaten bu tutarda'); return }
    const input: TransactionInput = {
      kind: difference > 0 ? 'income' : 'expense', status: 'posted',
      transaction_date: new Date().toISOString().slice(0, 10), amount_minor: Math.abs(difference),
      description: note.trim() || 'Kasa bakiyesi düzeltmesi', category: 'Bakiye Düzeltme',
      project_id: null, payment_source: 'group_bank', member_id: null,
    }
    await addTransaction(input)
    notify(`Kasa bakiyesi ${formatMoney(targetMinor)} olarak düzeltildi`)
  }

  const changeStartingBalance = async (targetMinor: number, note: string) => {
    const oldStarting = ledger.workspace.starting_balance_minor
    const difference = targetMinor - oldStarting
    if (difference === 0) { setModal(null); notify('Başlangıç bütçesi zaten bu tutarda'); return }
    if (!isConfigured) {
      const transaction: Transaction = {
        id: crypto.randomUUID(), workspace_id: ledger.workspace.id,
        sequence_no: Math.max(...ledger.transactions.map(t => t.sequence_no), 0) + 1,
        kind: difference > 0 ? 'income' : 'expense', status: 'posted', transaction_date: new Date().toISOString().slice(0, 10),
        amount_minor: Math.abs(difference), description: note.trim() || 'Başlangıç bütçesi düzeltmesi',
        category: 'Başlangıç Düzeltme', project_id: null, payment_source: 'group_bank', member_id: null,
      }
      setLedger({ ...ledger, workspace: { ...ledger.workspace, starting_balance_minor: targetMinor }, transactions: [transaction, ...ledger.transactions] })
    } else {
      await updateStartingBalance(ledger.workspace.id, targetMinor)
      await refresh()
    }
    setModal(null); notify(`Başlangıç bütçesi ${formatMoney(targetMinor)} olarak güncellendi`)
  }

  const completeInvites = (emails: string[], role: 'editor' | 'viewer') => {
    if (!isConfigured) {
      const newMembers = emails.map((email) => ({ user_id: crypto.randomUUID(), display_name: email.split('@')[0], email, role }))
      setLedger({ ...ledger, members: [...ledger.members, ...newMembers] })
    } else void refresh()
    setModal(null); notify(`${emails.length} kişiye davet gönderildi`)
  }

  const memberAction = async (userId: string, action: 'remove' | 'transfer_ownership') => {
    if (!isConfigured) return
    await manageMember(ledger.workspace.id, userId, action)
    await refresh()
    notify(action === 'remove' ? 'Üye ekipten çıkarıldı' : 'Kasa sahipliği devredildi')
  }

  const nav = [
    { id: 'dashboard' as View, label: 'Genel bakış', icon: LayoutDashboard },
    { id: 'transactions' as View, label: 'Hareketler', icon: ReceiptText },
    { id: 'projects' as View, label: 'Projeler', icon: FolderKanban },
    { id: 'reports' as View, label: 'Raporlar', icon: BarChart3 },
    { id: 'team' as View, label: 'Ekip', icon: Users },
  ]

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Menüyü kapat"><X /></button>
        <div className="brand">
          <div className="brand-mark"><span>₺</span></div>
          <div><strong>ORTAK KASA</strong><small>ekibin para defteri</small></div>
        </div>
        <div className="workspace-chip"><span className="live-dot" />{ledger.workspace.name}<ChevronDown size={14} /></div>
        <nav>
          <span className="nav-caption">KASA DEFTERİ</span>
          {nav.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => { setView(item.id); setMobileNav(false) }}><item.icon size={19} />{item.label}</button>)}
        </nav>
        <div className="sidebar-note"><ShieldCheck size={22} /><div><strong>Veriler korumalı</strong><span>{isConfigured ? 'Supabase RLS aktif' : 'Önizleme modu aktif'}</span></div></div>
        <div className="profile">
          <div className="avatar">{(session?.user.email ?? 'YK').slice(0, 2).toUpperCase()}</div>
          <div><strong>{session?.user.email?.split('@')[0] ?? 'Yunus'}</strong><span>{roleLabel[ledger.role]}</span></div>
          {isConfigured && <button onClick={() => supabase?.auth.signOut()} aria-label="Çıkış yap"><LogOut size={17} /></button>}
        </div>
      </aside>

      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Menüyü aç"><Menu /></button>
          <div className="page-title"><span>17 Temmuz 2026</span><h1>{nav.find((item) => item.id === view)?.label}</h1></div>
          <div className="top-actions">
            {!isConfigured && <span className="demo-badge"><Sparkles size={14} /> Demo</span>}
            {canEdit && <button className="primary-button" onClick={() => setModal('transaction')}><Plus size={18} /> Yeni hareket</button>}
          </div>
        </header>

        <div className="page-content">
          {view === 'dashboard' && <Dashboard ledger={ledger} metrics={metrics} canEdit={canEdit} canChangeStart={ledger.role === 'owner'} onAdjust={() => setModal('balance')} onChangeStart={() => setModal('starting')} onAll={() => setView('transactions')} />}
          {view === 'transactions' && <Transactions ledger={ledger} search={search} setSearch={setSearch} />}
          {view === 'projects' && <Projects ledger={ledger} canEdit={canEdit} onNew={() => setModal('project')} />}
          {view === 'reports' && <Reports ledger={ledger} />}
          {view === 'team' && <Team ledger={ledger} currentUserId={session?.user.id ?? ''} onInvite={() => setModal('invite')} onPassword={() => setModal('password')} onMemberAction={memberAction} />}
        </div>
      </main>

      {modal === 'transaction' && <TransactionModal ledger={ledger} onClose={() => setModal(null)} onSave={addTransaction} />}
      {modal === 'project' && <ProjectModal onClose={() => setModal(null)} onSave={addProject} />}
      {modal === 'balance' && <BalanceModal mode="current" currentBalance={metrics.balance} onClose={() => setModal(null)} onSave={adjustBalance} />}
      {modal === 'starting' && <BalanceModal mode="starting" currentBalance={ledger.workspace.starting_balance_minor} onClose={() => setModal(null)} onSave={changeStartingBalance} />}
      {modal === 'invite' && <InviteModal workspaceId={ledger.workspace.id} onClose={() => setModal(null)} onDone={completeInvites} />}
      {modal === 'password' && <PasswordModal onClose={() => setModal(null)} onDone={() => { setModal(null); notify('Şifreniz kaydedildi') }} />}
      {toast && <div className="toast"><Check size={18} />{toast}</div>}
    </div>
  )
}

function Dashboard({ ledger, metrics, canEdit, canChangeStart, onAdjust, onChangeStart, onAll }: { ledger: LedgerState; metrics: ReturnType<typeof calculateLedger>; canEdit: boolean; canChangeStart: boolean; onAdjust: () => void; onChangeStart: () => void; onAll: () => void }) {
  const recent = ledger.transactions.slice(0, 5)
  const missing = ledger.transactions.filter((t) => t.kind === 'expense' && !t.document && t.status !== 'voided').length
  const openingBalance = ledger.workspace.starting_balance_minor || ledger.transactions.find((item) => item.kind === 'opening' && item.status === 'posted')?.amount_minor || 0
  const balanceRatio = openingBalance > 0 ? Math.max(0, Math.round(metrics.balance / openingBalance * 100)) : 0
  const ringRatio = Math.min(100, balanceRatio)
  return <div className="dashboard-stack">
    <section className="hero-card reveal">
      <div className="hero-copy"><span className="eyebrow">KULLANILABİLİR BAKİYE</span><strong>{formatMoney(metrics.balance)}</strong><p>{openingBalance > 0 ? <><b>{formatMoney(openingBalance)}</b> başlangıç bütçesinin <b>%{balanceRatio}'i</b> kasada.</> : 'Başlangıç bakiyesi tanımlı değil.'}</p><div className="balance-actions">{canEdit && <button className="balance-edit" onClick={onAdjust}>Bakiyeyi düzelt <ArrowUpRight size={13} /></button>}{canChangeStart && <button className="balance-edit" onClick={onChangeStart}>Başlangıcı değiştir <ArrowUpRight size={13} /></button>}</div></div>
      <div className="hero-orbit"><div className="orbit-ring" style={{ '--progress': `${ringRatio}%` } as React.CSSProperties}><span>%{balanceRatio}<small>kalan</small></span></div></div>
      <div className="hero-meta"><div><span>Bu ay harcanan</span><b>{formatMoney(metrics.totalExpenses)}</b></div><div><span>Son kayıt</span><b>{recent[0] ? formatDate(recent[0].transaction_date) : '—'}</b></div></div>
    </section>

    <section className="metric-grid">
      <Metric icon={ArrowUpRight} tone="coral" label="Toplam gider" value={formatMoney(metrics.totalExpenses)} note={`${ledger.transactions.filter(t => t.kind === 'expense').length} hareket`} />
      <Metric icon={ArrowDownLeft} tone="green" label="Ek gelir" value={formatMoney(metrics.totalIncome)} note="Açılış hariç" />
      <Metric icon={WalletCards} tone="yellow" label="Üyelere borç" value={formatMoney(metrics.memberPayable)} note="Kişisel ödemeler" />
      <Metric icon={CircleAlert} tone="ink" label="Eksik belge" value={String(missing).padStart(2, '0')} note={missing ? 'Tamamlanması gerek' : 'Her şey tamam'} />
    </section>

    <section className="dashboard-grid">
      <div className="panel transactions-panel"><PanelHead title="Son hareketler" action="Tümünü gör" onAction={onAll} />
        <TransactionList transactions={recent} projects={ledger.projects} />
      </div>
      <div className="panel project-panel"><PanelHead title="Proje bütçeleri" />
        <div className="project-bars">{ledger.projects.map((project) => {
          const spent = ledger.transactions.filter(t => t.project_id === project.id && t.kind === 'expense' && t.status === 'posted').reduce((sum, t) => sum + t.amount_minor, 0)
          const ratio = project.budget_minor ? Math.min(100, Math.round(spent / project.budget_minor * 100)) : 0
          return <div className="project-bar" key={project.id}><div><span><i style={{ background: project.color }} />{project.name}</span><b>{formatMoney(spent)}</b></div><div className="track"><i style={{ width: `${ratio}%`, background: project.color }} /></div><small>{project.budget_minor ? `${formatMoney(project.budget_minor)} bütçenin %${ratio}'i` : 'Bütçe tanımlanmamış'}</small></div>
        })}</div>
      </div>
    </section>
  </div>
}

function Metric({ icon: Icon, tone, label, value, note }: { icon: typeof Banknote; tone: string; label: string; value: string; note: string }) {
  return <article className={`metric-card tone-${tone} reveal`}><div className="metric-icon"><Icon size={20} /></div><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}

function PanelHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <div className="panel-head"><h2>{title}</h2>{action && <button onClick={onAction}>{action} <ArrowUpRight size={15} /></button>}</div>
}

function TransactionList({ transactions, projects }: { transactions: Transaction[]; projects: Project[] }) {
  if (!transactions.length) return <div className="empty-state"><ReceiptText /><p>Henüz bir hareket yok.</p></div>
  return <div className="transaction-list">{transactions.map((item) => {
    const project = projects.find((p) => p.id === item.project_id)
    const positive = item.kind === 'opening' || item.kind === 'income'
    return <div className="transaction-row" key={item.id}>
      <div className={`transaction-symbol ${positive ? 'positive' : item.kind === 'transfer' ? 'neutral' : 'negative'}`}>{positive ? <ArrowDownLeft /> : item.kind === 'transfer' ? <ArrowRightLeft /> : <ArrowUpRight />}</div>
      <div className="transaction-main"><strong>{item.description}</strong><span>{formatDate(item.transaction_date)} · {item.category ?? kindLabel[item.kind]}</span></div>
      <div className="project-tag">{project && <><i style={{ background: project.color }} />{project.name}</>}</div>
      <div className="document-state">{item.document ? <button className="has-doc" onClick={async () => { if (!item.document?.storage_path) return; const url = await getDocumentUrl(item.document.storage_path); if (url) window.open(url, '_blank', 'noopener,noreferrer') }}><FileText size={14} /> Belgeyi aç</button> : item.kind === 'expense' ? <span className="no-doc"><CircleAlert size={14} /> Belge yok</span> : null}</div>
      <div className={`transaction-amount ${positive ? 'plus' : ''}`}><strong>{positive ? '+' : item.kind === 'transfer' ? '' : '−'}{formatMoney(item.amount_minor)}</strong><span>{item.status === 'draft' ? 'Taslak' : sourceLabel[item.payment_source]}</span></div>
    </div>
  })}</div>
}

function Transactions({ ledger, search, setSearch }: { ledger: LedgerState; search: string; setSearch: (s: string) => void }) {
  const [type, setType] = useState('all')
  const filtered = ledger.transactions.filter((t) => (type === 'all' || t.kind === type) && `${t.description} ${t.category}`.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr')))
  return <section className="panel page-panel reveal"><div className="filterbar"><div className="search-box"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Hareketlerde ara..." /></div><select value={type} onChange={(e) => setType(e.target.value)}><option value="all">Tüm hareketler</option><option value="expense">Giderler</option><option value="income">Gelirler</option><option value="reimbursement">Geri ödemeler</option></select></div><TransactionList transactions={filtered} projects={ledger.projects} /></section>
}

function Projects({ ledger, canEdit, onNew }: { ledger: LedgerState; canEdit: boolean; onNew: () => void }) {
  return <><div className="section-intro"><div><span className="eyebrow">BÜTÇE DAĞILIMI</span><h2>Her projenin nabzı, tek bakışta.</h2></div>{canEdit && <button className="secondary-button" onClick={onNew}><Plus size={17} /> Proje oluştur</button>}</div><div className="project-card-grid">{ledger.projects.map(project => {
    const expenses = ledger.transactions.filter(t => t.project_id === project.id && t.kind === 'expense' && t.status === 'posted')
    const spent = expenses.reduce((s, t) => s + t.amount_minor, 0)
    const ratio = project.budget_minor ? Math.min(100, Math.round(spent / project.budget_minor * 100)) : 0
    return <article className="big-project-card reveal" key={project.id} style={{ '--project': project.color } as React.CSSProperties}><div className="project-number">{String(ledger.projects.indexOf(project) + 1).padStart(2, '0')}</div><div className="project-card-head"><i /><span>{project.status === 'active' ? 'Aktif proje' : 'Arşiv'}</span></div><h3>{project.name}</h3><div className="project-stat"><strong>{formatMoney(spent)}</strong><span>harcandı</span></div><div className="track"><i style={{ width: `${ratio}%` }} /></div><footer><span>{expenses.length} gider</span><b>%{ratio} kullanıldı</b></footer></article>
  })}</div></>
}

function Reports({ ledger }: { ledger: LedgerState }) {
  const metrics = calculateLedger(ledger.transactions)
  const exportCsv = () => {
    const rows = [['Sıra','Tarih','Tür','Açıklama','Kategori','Proje','Tutar (TL)','Durum','Belge']]
    ledger.transactions.forEach(t => rows.push([String(t.sequence_no), t.transaction_date, kindLabel[t.kind], t.description, t.category ?? '', ledger.projects.find(p => p.id === t.project_id)?.name ?? '', (t.amount_minor / 100).toFixed(2), t.status, t.document ? 'Var' : 'Yok']))
    const csv = '\ufeff' + rows.map(row => row.map(cell => `"${safeSpreadsheetCell(cell).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `kasa-raporu-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
  const exportBackup = () => {
    const payload = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), ...ledger }, null, 2)
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' })); a.download = `kasa-yedegi-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href)
  }
  return <div className="reports-layout"><section className="report-paper"><div className="report-brand"><span>ORTAK KASA</span><small>AYLIK MALİ ÖZET · TEMMUZ 2026</small></div><div className="report-total"><span>Ay sonu kullanılabilir bakiye</span><strong>{formatMoney(metrics.balance)}</strong></div><div className="report-columns"><div><span>Toplam gider</span><b>{formatMoney(metrics.totalExpenses)}</b></div><div><span>Üyelere borç</span><b>{formatMoney(metrics.memberPayable)}</b></div><div><span>Eksik belge</span><b>{ledger.transactions.filter(t => t.kind === 'expense' && !t.document).length}</b></div></div><div className="report-rule" /><p>Bu rapor ekip içi takip amacıyla hazırlanmıştır; resmî muhasebe defteri yerine geçmez.</p></section><aside className="report-actions"><h2>Raporunu hazırla</h2><p>Hareketleri mali müşavirinle veya ekip arkadaşlarınla düzenli bir dosya olarak paylaş.</p><button className="primary-button wide" onClick={exportCsv}><Download size={18} /> CSV olarak indir</button><button className="secondary-button wide" onClick={exportBackup}><Download size={18} /> JSON yedeği indir</button><button className="secondary-button wide" onClick={() => window.print()}><FileText size={18} /> PDF / Yazdır</button></aside></div>
}

function Team({ ledger, currentUserId, onInvite, onPassword, onMemberAction }: { ledger: LedgerState; currentUserId: string; onInvite: () => void; onPassword: () => void; onMemberAction: (userId: string, action: 'remove' | 'transfer_ownership') => Promise<void> }) {
  const [busy, setBusy] = useState('')
  const act = async (memberId: string, action: 'remove' | 'transfer_ownership', name: string) => {
    const message = action === 'remove' ? `${name} ekipten çıkarılsın mı?` : `Kasa sahipliği ${name} adlı üyeye devredilsin mi? Siz düzenleyici olacaksınız.`
    if (!window.confirm(message)) return
    setBusy(memberId)
    try { await onMemberAction(memberId, action) } finally { setBusy('') }
  }
  return <section className="panel page-panel reveal"><div className="team-head"><div><span className="eyebrow">ERİŞİM KONTROLÜ</span><h2>Kasanın anahtarları kimde?</h2></div><div className="team-head-actions"><button className="secondary-button" onClick={onPassword}>Şifre belirle / değiştir</button>{ledger.role === 'owner' && <button className="secondary-button" onClick={onInvite}><Plus size={17} /> Kişi davet et</button>}</div></div><div className="member-list">{ledger.members.map(member => <div className="member-row" key={member.user_id}><div className="avatar large">{member.display_name.slice(0,2).toUpperCase()}</div><div><strong>{member.display_name}{member.user_id === currentUserId ? ' (siz)' : ''}</strong><span>{member.email ?? 'Ekip üyesi'}</span></div><div className="member-controls"><span className={`role-pill role-${member.role}`}>{roleLabel[member.role]}</span>{ledger.role === 'owner' && member.user_id !== currentUserId && <><button disabled={busy === member.user_id} onClick={() => act(member.user_id, 'transfer_ownership', member.display_name)}>Sahipliği devret</button><button className="danger-link" disabled={busy === member.user_id} onClick={() => act(member.user_id, 'remove', member.display_name)}>Çıkar</button></>}</div></div>)}</div><div className="team-info"><ShieldCheck /><div><strong>Çıkış yapmak kasayı kapatmaz</strong><p>Kasa Supabase'te çalışmaya devam eder. Şifrenizle yeniden girebilirsiniz; ekipten ayrılmak isteyen owner önce sahipliği başka üyeye devretmelidir.</p></div></div></section>
}

function TransactionModal({ ledger, onClose, onSave }: { ledger: LedgerState; onClose: () => void; onSave: (input: TransactionInput, file?: File) => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [file, setFile] = useState<File>()
  const [form, setForm] = useState({ kind: 'expense' as TransactionKind, amount: '', description: '', category: 'Yazılım', project_id: ledger.projects[0]?.id ?? '', payment_source: 'group_bank' as TransactionInput['payment_source'], member_id: '', status: 'posted' as TransactionInput['status'], transaction_date: new Date().toISOString().slice(0, 10) })
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    if (file) { const fileError = await validateDocumentFile(file); if (fileError) { setError(fileError); return } }
    if (!parseMoney(form.amount) || !form.description.trim()) { setError('Tutar ve açıklama zorunludur.'); return }
    setSaving(true)
    try { await onSave({ ...form, amount_minor: parseMoney(form.amount), project_id: form.project_id || null, category: form.category || null, member_id: form.payment_source === 'member' ? form.member_id || ledger.members[0]?.user_id : null }, file) }
    catch (err) { setError(err instanceof Error ? err.message : 'Kayıt oluşturulamadı') }
    finally { setSaving(false) }
  }
  return <Modal title="Kasaya hareket ekle" subtitle="Her kayıt, paranın hikâyesini tamamlar." onClose={onClose}><form onSubmit={submit} className="form-stack"><div className="type-picker">{(['expense','income','reimbursement','transfer'] as TransactionKind[]).map(kind => <button type="button" className={form.kind === kind ? 'selected' : ''} onClick={() => setForm({...form, kind})} key={kind}>{kindLabel[kind]}</button>)}</div><div className="amount-field"><label>Tutar</label><div><span>₺</span><input autoFocus inputMode="decimal" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} placeholder="0,00" /></div></div><label className="field">Açıklama<input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Örn. alan adı yenilemesi" /></label><div className="form-grid"><label className="field">Tarih<input type="date" value={form.transaction_date} onChange={e => setForm({...form, transaction_date: e.target.value})} /></label><label className="field">Kategori<input value={form.category} onChange={e => setForm({...form, category: e.target.value})} /></label><label className="field">Proje<select value={form.project_id} onChange={e => setForm({...form, project_id: e.target.value})}><option value="">Projesiz</option>{ledger.projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label className="field">Ödeme kaynağı<select value={form.payment_source} onChange={e => setForm({...form, payment_source: e.target.value as TransactionInput['payment_source']})}><option value="group_bank">Grup bankası</option><option value="group_cash">Grup kasası</option><option value="member">Üye ödedi</option></select></label></div>{form.payment_source === 'member' && <label className="field">Ödeyen üye<select value={form.member_id} onChange={e => setForm({...form, member_id: e.target.value})}>{ledger.members.map(m => <option value={m.user_id} key={m.user_id}>{m.display_name}</option>)}</select></label>}<label className="upload-field"><FileText /><div><strong>{file ? file.name : 'Fatura veya fiş ekle'}</strong><span>PDF, JPG veya PNG · en fazla 10 MB</span></div><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={e => setFile(e.target.files?.[0])} /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>Vazgeç</button><button className="primary-button" disabled={saving}>{saving ? 'Kaydediliyor…' : 'Hareketi kaydet'}</button></div></form></Modal>
}

function ProjectModal({ onClose, onSave }: { onClose: () => void; onSave: (p: Pick<Project, 'name' | 'color' | 'budget_minor'>) => Promise<void> }) {
  const [name, setName] = useState(''); const [budget, setBudget] = useState(''); const [color, setColor] = useState('#ef6a58')
  return <Modal title="Yeni proje" subtitle="Bütçeyi bir hedefe bağla." onClose={onClose}><form className="form-stack" onSubmit={async e => { e.preventDefault(); await onSave({ name, color, budget_minor: budget ? parseMoney(budget) : null }) }}><label className="field">Proje adı<input required value={name} onChange={e => setName(e.target.value)} placeholder="Örn. Mobil uygulama" /></label><label className="field">Planlanan bütçe<input inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} placeholder="0,00" /></label><label className="field">Proje rengi<input className="color-input" type="color" value={color} onChange={e => setColor(e.target.value)} /></label><div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>Vazgeç</button><button className="primary-button">Projeyi oluştur</button></div></form></Modal>
}

function BalanceModal({ mode, currentBalance, onClose, onSave }: { mode: 'current' | 'starting'; currentBalance: number; onClose: () => void; onSave: (target: number, note: string) => Promise<void> }) {
  const [amount, setAmount] = useState((currentBalance / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 }))
  const [note, setNote] = useState(mode === 'starting' ? 'Başlangıç bütçesi düzeltmesi' : 'Sayım sonrası kasa düzeltmesi')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const target = parseMoney(amount)
  const difference = target - currentBalance
  const isStarting = mode === 'starting'
  return <Modal title={isStarting ? 'Başlangıç bütçesini değiştir' : 'Kasa bakiyesini düzelt'} subtitle={isStarting ? 'Yüzde hesabının temelini ve kasayı birlikte güncelle.' : 'Geçmişi silmeden, fark kaydıyla kasayı güncelle.'} onClose={onClose}><form className="form-stack" onSubmit={async e => { e.preventDefault(); if (target <= 0) return; setSaving(true); setError(''); try { await onSave(target, note) } catch (err) { setError(err instanceof Error ? err.message : 'Bakiye güncellenemedi') } finally { setSaving(false) } }}><div className="amount-field"><label>{isStarting ? 'Yeni başlangıç bütçesi' : 'Yeni kasa bakiyesi'}</label><div><span>₺</span><input autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></div></div><div className={`balance-difference ${difference >= 0 ? 'increase' : 'decrease'}`}><span>{isStarting ? 'Mevcut başlangıç' : 'Mevcut bakiye'}: {formatMoney(currentBalance)}</span><strong>{difference === 0 ? 'Değişiklik yok' : `${difference > 0 ? '+' : '−'}${formatMoney(Math.abs(difference))} fark kaydı`}</strong></div><label className="field">Düzeltme açıklaması<input required value={note} onChange={e => setNote(e.target.value)} placeholder="Örn. başlangıç sermayesi güncellemesi" /></label><div className="inline-note"><ShieldCheck /><p>{isStarting ? 'Başlangıç tutarı ve mevcut kasa aynı fark kadar güncellenir; kalan yüzde yeni tutara göre hesaplanır.' : 'Bu işlem eski hareketleri değiştirmez. Aradaki fark ayrı bir “Bakiye Düzeltme” kaydı olarak denetim günlüğüne eklenir.'}</p></div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>Vazgeç</button><button className="primary-button" disabled={saving || target <= 0}>{saving ? 'Güncelleniyor…' : isStarting ? 'Başlangıcı güncelle' : 'Bakiyeyi güncelle'}</button></div></form></Modal>
}

function InviteModal({ workspaceId, onClose, onDone }: { workspaceId: string; onClose: () => void; onDone: (emails: string[], role: 'editor' | 'viewer') => void }) {
  const [rawEmails, setRawEmails] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [links, setLinks] = useState<Array<{ email: string; actionLink: string }>>([])
  const [copied, setCopied] = useState('')
  const emails = [...new Set(rawEmails.split(/[\s,;]+/).map(item => item.trim().toLowerCase()).filter(Boolean))]
  const invalidEmails = emails.filter(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  if (links.length) return <Modal title="Davet bağlantıları hazır" subtitle="Her bağlantıyı ilgili kişiye özel olarak gönderin." onClose={() => onDone(emails, role)}><div className="invite-results">{links.map(item => <div className="invite-link-row" key={item.email}><div><strong>{item.email}</strong><span>Tek kullanımlık · 1 saat geçerli</span></div><button type="button" className="secondary-button" onClick={async () => { if (!isTrustedInviteLink(item.actionLink, import.meta.env.VITE_SUPABASE_URL ?? '')) { setError('Güvenilmeyen davet bağlantısı engellendi.'); return } await navigator.clipboard.writeText(item.actionLink); setCopied(item.email) }}>{copied === item.email ? <><Check size={15}/> Kopyalandı</> : 'Bağlantıyı kopyala'}</button></div>)}</div>{error && <p className="form-error">{error}</p>}<div className="inline-note"><ShieldCheck /><p>Yalnızca bu projenin şifreli Supabase adresindeki bağlantılar kopyalanabilir. Bağlantıları ilgili kişiye özel gönderin.</p></div><div className="modal-actions"><button type="button" className="primary-button" onClick={() => onDone(emails, role)}>Bitti</button></div></Modal>
  return <Modal title="Ekibini davet et" subtitle="E-postaları ekle; paylaşabileceğin özel bağlantıları oluşturalım." onClose={onClose}><form className="form-stack" onSubmit={async e => { e.preventDefault(); setError(''); if (!emails.length) { setError('En az bir e-posta yazın.'); return } if (invalidEmails.length) { setError(`Geçersiz e-posta: ${invalidEmails.join(', ')}`); return } if (emails.length > 50) { setError('Tek seferde en fazla 50 davet oluşturulabilir; kalanları yeni bir grupta oluşturun.'); return } setSending(true); try { if (isConfigured) { const result = await createInvites(workspaceId, emails, role); setLinks(result.links ?? []); if (result.failures?.length) setError(`${result.failures.length} adres için bağlantı oluşturulamadı: ${result.failures.map(item => `${item.email} (${item.message})`).join(', ')}`) } else onDone(emails, role) } catch (err) { setError(err instanceof Error ? err.message : 'Davetler oluşturulamadı') } finally { setSending(false) } }}><label className="field">E-posta adresleri<textarea required rows={6} value={rawEmails} onChange={e => setRawEmails(e.target.value)} placeholder={'ayse@example.com\nmehmet@example.com\nece@example.com'} /><small>Virgül, boşluk veya yeni satırla ayırın · {emails.length}/50 adres</small></label><label className="field">Bu grubun rolü<select value={role} onChange={e => setRole(e.target.value as 'editor' | 'viewer')}><option value="viewer">Görüntüleyici — yalnızca kasa ve giderleri görür</option><option value="editor">Düzenleyici — gider ve proje ekleyebilir</option></select></label><div className="inline-note"><ShieldCheck /><p>Uygulama her kişi için tek kullanımlık bağlantı üretir. Bağlantıyı istediğiniz mesajlaşma uygulamasından paylaşabilirsiniz.</p></div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>Vazgeç</button><button className="primary-button" disabled={sending}>{sending ? 'Bağlantılar oluşturuluyor…' : `${emails.length || ''} bağlantı oluştur`}</button></div></form></Modal>
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="modal"><button className="modal-close" onClick={onClose}><X /></button><div className="modal-title"><span className="eyebrow">YENİ KAYIT</span><h2>{title}</h2><p>{subtitle}</p></div>{children}</section></div>
}

function LoginScreen({ error, onError }: { error: string; onError: (s: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setLoading(true); onError('')
    const { error: signInError } = await supabase!.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (signInError) onError('E-posta veya şifre hatalı. İlk girişte davet bağlantınızı kullanıp bir şifre belirleyin.')
  }

  return <div className="auth-page"><div className="auth-art"><div className="brand auth-brand"><div className="brand-mark"><span>₺</span></div><div><strong>ORTAK KASA</strong><small>ekibin para defteri</small></div></div><div className="auth-quote"><span>01 / GÜVENLİ ORTAK ALAN</span><h1>Paranızın nerede olduğunu <em>hepiniz de</em> bilin.</h1><p>Giderler, belgeler ve projeler aynı defterde. Sessiz, düzenli, birlikte.</p></div><div className="auth-stamp">DAVETLİ<br/>EKİP ALANI</div></div><div className="auth-form-wrap"><form className="auth-form" onSubmit={submit}><span className="eyebrow">HOŞ GELDİN</span><h2>Kasaya giriş yap</h2><p>İlk girişte davet bağlantını kullan. Sonraki girişlerde e-posta ve şifren yeterli.</p><label className="field">E-posta adresi<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="sen@ekip.com" /></label><label className="field">Şifre<input required type="password" autoComplete="current-password" minLength={10} value={password} onChange={e => setPassword(e.target.value)} placeholder="En az 10 karakter" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button wide" disabled={loading}>{loading ? 'Giriş yapılıyor…' : 'Şifreyle giriş yap'}</button><small className="privacy"><ShieldCheck /> Açık kayıt yoktur. Yalnızca davet edilen kişiler giriş yapabilir.</small></form></div></div>
}

function PasswordModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return <Modal title="Giriş şifreni belirle" subtitle="Bundan sonra davet bağlantısına ihtiyaç duymadan giriş yap." onClose={onClose}><form className="form-stack" onSubmit={async e => { e.preventDefault(); setError(''); if (password.length < 10) { setError('Şifre en az 10 karakter olmalı.'); return } if (password !== again) { setError('Şifreler aynı değil.'); return } setSaving(true); const { error: updateError } = await supabase!.auth.updateUser({ password, data: { has_password: true } }); setSaving(false); if (updateError) setError(updateError.message); else onDone() }}><label className="field">Yeni şifre<input required type="password" autoComplete="new-password" minLength={10} value={password} onChange={e => setPassword(e.target.value)} placeholder="En az 10 karakter" /></label><label className="field">Yeni şifre tekrar<input required type="password" autoComplete="new-password" minLength={10} value={again} onChange={e => setAgain(e.target.value)} /></label><div className="inline-note"><ShieldCheck /><p>Benzersiz bir şifre kullanın. Şifrenizi belirledikten sonra e-posta kotası veya owner yardımı olmadan giriş yapabilirsiniz.</p></div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="text-button" onClick={onClose}>Vazgeç</button><button className="primary-button" disabled={saving}>{saving ? 'Kaydediliyor…' : 'Şifreyi kaydet'}</button></div></form></Modal>
}

function ClaimScreen({ onClaim, error, onError }: { onClaim: (name: string, amount: number) => Promise<void>; error: string; onError: (s: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('Proje Kasası')
  const [amount, setAmount] = useState('')
  const initialMinor = parseMoney(amount)
  return <div className="claim-page"><form className="claim-card" onSubmit={async e => { e.preventDefault(); if (!initialMinor) { onError('Başlangıç bakiyesi sıfırdan büyük olmalı.'); return } setLoading(true); onError(''); try { await onClaim(name.trim(), initialMinor) } catch (err) { onError(err instanceof Error ? err.message : 'Kurulum tamamlanamadı') } finally { setLoading(false) } }}><div className="brand-mark big"><span>₺</span></div><span className="eyebrow">İLK KURULUM</span><h1>Kasanı oluştur</h1><p>Kasanın adını ve başlangıç parasını belirle. Yüzde göstergesi bu tutara göre hesaplanacak; bakiyeyi daha sonra güvenli fark kaydıyla değiştirebilirsin.</p><label className="field left-field">Kasa adı<input required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Örn. Dernek Proje Kasası" /></label><div className="amount-field claim-amount"><label>Başlangıç bakiyesi</label><div><span>₺</span><input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" /></div></div>{error && <p className="form-error">{error}</p>}<button className="primary-button wide" disabled={loading || !initialMinor}>{loading ? 'Hazırlanıyor…' : 'Kasayı oluştur'}</button></form></div>
}

function LoadingScreen() { return <div className="loading-page"><div className="ledger-loader"><span>₺</span></div><p>Kasa defteri açılıyor…</p></div> }
const formatDate = (date: string) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))

export default App
