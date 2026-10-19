import { useState, useEffect } from 'react'
import { Users, UserPlus, Baby, AtSign, Search, X, Download, Printer, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Pencil, Trash2, AlertCircle, Check, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { adminMembersApi, adminUpdateMemberApi, adminDeleteMemberApi, adminMemberStatusApi, adminMemberDuesApi, adminMemberSuspendApi } from '../store'
import { askAdminPassword } from '../components/askAdminPassword'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const GREEN = '#047857'

const filterInput = { border: `1.5px solid ${BORDER}`, borderRadius: '8px', height: '32px', padding: '0 8px', fontSize: '12px', outline: 'none', color: NAVY, background: 'white' }
const when = d => { const x = new Date(String(d).replace(' ', 'T')); return isNaN(x) ? '—' : format(x, 'd MMM yyyy') }
const dobText = d => { const x = new Date(`${d}T00:00`); return d && !isNaN(x) ? format(x, 'd MMM yyyy') : '—' }

// Page buttons: first, last, and two either side of the current page, with "…" gaps
function pageNumbers(current, pages) {
  const out = []
  for (let n = 0; n < pages; n++) {
    if (n === 0 || n === pages - 1 || Math.abs(n - current) <= 2) out.push(n)
    else if (out[out.length - 1] !== '…') out.push('…')
  }
  return out
}

function Avatar({ m }) {
  return m.picture
    ? <img src={m.picture} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" style={{ border: `1px solid ${BORDER}` }} />
    : <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0" style={{ background: NAVY, color: 'white' }}>{(m.name || '?').charAt(0).toUpperCase()}</span>
}

// At or above this the member can't book (the server checks it too)
const DUES_LIMIT = 20000

// Dues input in the table: saves when you leave the box or press Enter; red at or above the limit
function DuesInput({ member, onSaved }) {
  const [value, setValue] = useState(member.dues ? String(member.dues) : '')
  const [state, setState] = useState('') // '' | 'saving' | 'saved' | 'error'
  const amount = Number(value || 0)
  const over = amount >= DUES_LIMIT

  async function save() {
    if (!Number.isFinite(amount) || amount < 0) { setState('error'); return }
    if (amount === Number(member.dues || 0)) return
    setState('saving')
    const r = await adminMemberDuesApi(member.id, amount)
    if (r.error) { setState('error'); alert(r.error); return }
    setState('saved'); onSaved(amount)
    setTimeout(() => setState(s => (s === 'saved' ? '' : s)), 1500)
  }

  return (
    <span className="block">
      <span className="relative block">
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold pointer-events-none" style={{ color: over ? '#DC2626' : LGRAY }}>Rs.</span>
        <input type="text" inputMode="decimal" value={value} placeholder="0"
          onChange={e => { setValue(e.target.value.replace(/[^\d.]/g, '')); setState('') }}
          onBlur={save} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          title={over ? `Rs. ${DUES_LIMIT.toLocaleString()} or more — this member cannot book` : `Member dues (bookings are blocked at Rs. ${DUES_LIMIT.toLocaleString()} or more)`}
          className="w-full h-7 pl-7 pr-1.5 rounded-md text-xs font-bold outline-none"
          style={{ border: `1.5px solid ${state === 'error' ? '#DC2626' : over ? '#F87171' : state === 'saved' ? '#34D399' : '#CBD5E1'}`,
            background: over ? '#FEF2F2' : 'white', color: over ? '#DC2626' : NAVY }} />
      </span>
      {over && <span className="block mt-0.5 text-[9px] font-black uppercase tracking-wide" style={{ color: '#DC2626' }}>Booking blocked</span>}
      {!over && state === 'saving' && <span className="block mt-0.5 text-[9px] font-bold" style={{ color: LGRAY }}>Saving…</span>}
      {!over && state === 'saved' && <span className="block mt-0.5 text-[9px] font-bold" style={{ color: GREEN }}>Saved</span>}
    </span>
  )
}

// Admin edits a member: name, User ID, membership no., email, phone, date of birth (not the password)
function MemberForm({ member, onClose, onSaved }) {
  const [m, setM] = useState({ ...member, phone: member.phone || '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => { setM(p => ({ ...p, [k]: v })); setError('') }
  const input = { width: '100%', border: '1.5px solid #CBD5E1', borderRadius: '8px', height: '38px', padding: '0 10px', fontSize: '13px', outline: 'none', color: NAVY, background: 'white', fontWeight: 600 }
  const label = 'block text-[11px] font-extrabold uppercase tracking-wide mb-1'

  async function save(e) {
    e.preventDefault()
    if (!m.name.trim()) { setError('Please enter the full name.'); return }
    if (m.username && !/^[A-Za-z0-9._]{3,30}$/.test(m.username)) { setError('User ID must be 3–30 letters, numbers, dots or underscores.'); return }
    setSaving(true)
    const r = await adminUpdateMemberApi(m.id, { name: m.name, username: m.username, membershipNo: m.membershipNo, email: m.email, phone: m.phone, dob: m.dob }, member.password)
    setSaving(false)
    if (r.error) { setError(r.error); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden" style={{ background: 'rgba(15,23,42,0.5)' }} onClick={onClose}>
      <form onSubmit={save} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-lg" style={{ border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `1px solid ${BORDER}`, background: '#FFFBEB' }}>
          <p className="font-black text-base flex items-center gap-2" style={{ color: '#B45309' }}><Pencil size={16} /> Edit Member</p>
          <button type="button" onClick={onClose} title="Close" style={{ color: LGRAY }}><X size={18} /></button>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={label} style={{ color: NAVY }}>Full Name *</label>
            <input value={m.name} maxLength={150} onChange={e => set('name', e.target.value)} style={input} />
          </div>
          <div>
            <label className={label} style={{ color: NAVY }}>User ID</label>
            <input value={m.username} maxLength={30} placeholder="e.g. ahmed.khan" onChange={e => set('username', e.target.value.replace(/[^A-Za-z0-9._]/g, ''))} style={input} />
          </div>
          <div>
            <label className={label} style={{ color: NAVY }}>Membership No. *</label>
            <input value={m.membershipNo} maxLength={20} onChange={e => set('membershipNo', e.target.value.toUpperCase())} style={{ ...input, fontFamily: 'Consolas, monospace' }} />
          </div>
          <div className="col-span-2">
            <label className={label} style={{ color: NAVY }}>Email *</label>
            <input type="email" value={m.email} onChange={e => set('email', e.target.value)} style={input} />
          </div>
          <div>
            <label className={label} style={{ color: NAVY }}>Phone *</label>
            <input value={m.phone} placeholder="+923001234567" onChange={e => set('phone', e.target.value)} style={input} />
          </div>
          <div>
            <label className={label} style={{ color: NAVY }}>Date of Birth</label>
            <input type="date" value={m.dob || ''} max={format(new Date(), 'yyyy-MM-dd')} onChange={e => set('dob', e.target.value)} style={input} />
          </div>
          {error && (
            <div className="col-span-2 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: '#FEF2F2', border: '1px solid #FEE2E2' }}>
              <AlertCircle size={14} style={{ color: '#DC2626', flexShrink: 0 }} />
              <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-3" style={{ borderTop: `1px solid ${BORDER}`, background: '#F8FAFC' }}>
          <span className="text-[11px]" style={{ color: LGRAY }}>The password isn't changed here.</span>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-bold" style={{ color: '#475569', border: `1.5px solid ${BORDER}`, background: 'white' }}>Cancel</button>
            <button type="submit" disabled={saving} className="h-9 px-5 rounded-lg text-sm font-black" style={{ background: GREEN, color: 'white', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </span>
        </div>
      </form>
    </div>
  )
}

// Everyone who signed up (padalcreate), newest first, with search, filters, CSV and Print/PDF
export default function AdminMembers() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [age, setAge] = useState('') // '' | 'u18' | 'adult' | 'none'
  const [userId, setUserId] = useState('') // '' | 'yes' | 'no'
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(15) // 15 members per page
  const [printAll, setPrintAll] = useState(false)
  const [sort, setSort] = useState('nng') // membership no. low → high

  const [reload, setReload] = useState(0) // bump to load the list again (after an edit)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [status, setStatus] = useState('') // '' | 'pending' | 'approved' | 'rejected'
  const [deciding, setDeciding] = useState(null) // member id being approved / rejected
  useEffect(() => {
    let cancelled = false
    adminMembersApi().then(r => {
      if (cancelled) return
      setLoading(false)
      if (r.error) setError(r.error)
      else setMembers(r.members)
    })
    return () => { cancelled = true }
  }, [reload])

  async function removeMember(m) {
    const note = m.bookings ? ` ${m.name} has ${m.bookings} booking(s); they stay in the bookings list, but the account will be gone.` : ''
    const password = await askAdminPassword(`Enter the admin password to delete the account of ${m.name} (${m.membershipNo}${m.username ? `, @${m.username}` : ''}).${note} This cannot be undone.`, { danger: true })
    if (!password) return
    setDeleting(m.id)
    const r = await adminDeleteMemberApi(m.id, password)
    setDeleting(null)
    if (r.error) { alert(r.error); return }
    setMembers(list => list.filter(x => x.id !== m.id))
  }

  // Suspended members can't book (the server refuses it too)
  async function toggleSuspend(m) {
    const next = !m.suspended
    if (!confirm(next
      ? `Suspend ${m.name} (${m.membershipNo})?\n\nThey will not be able to make any booking until you remove the suspension.`
      : `Remove the suspension of ${m.name} (${m.membershipNo})?\n\nThey will be able to book again.`)) return
    setDeciding(m.id)
    const r = await adminMemberSuspendApi(m.id, next)
    setDeciding(null)
    if (r.error) { alert(r.error); return }
    setMembers(list => list.map(x => x.id === m.id ? { ...x, suspended: next } : x))
  }

  // New sign-ups wait as 'pending' until approved here; the member gets an email either way
  async function decide(m, next) {
    const ask = next === 'approved'
      ? `Approve the sign-up of ${m.name} (${m.membershipNo})?\n\nThey will get an email and can then sign in and book.`
      : next === 'pending'
        ? `Remove the approval of ${m.name} (${m.membershipNo})?\n\nThey will not be able to sign in or book until you tick Approved again.`
        : `Reject the sign-up of ${m.name} (${m.membershipNo})?\n\nThey will get an email and will not be able to sign in.`
    if (!confirm(ask)) return
    setDeciding(m.id)
    const r = await adminMemberStatusApi(m.id, next)
    setDeciding(null)
    if (r.error) { alert(r.error); return }
    setMembers(list => list.map(x => x.id === m.id ? { ...x, status: next } : x))
    if (!r.emailed) alert(`Saved, but the email to ${m.email} could not be sent. Please let the member know yourself.`)
  }
  useEffect(() => {
    const done = () => setPrintAll(false)
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [])

  const joined = m => { const x = new Date(String(m.createdAt).replace(' ', 'T')); return isNaN(x) ? '' : format(x, 'yyyy-MM-dd') }
  const q = search.trim().toLowerCase()
  const shown = members.filter(m =>
    (!q || [m.name, m.username, m.membershipNo, m.email, m.phone].some(v => (v || '').toLowerCase().includes(q)))
    && (age !== 'u18' || (m.age != null && m.age < 18)) && (age !== 'adult' || (m.age != null && m.age >= 18)) && (age !== 'none' || m.age == null)
    && (userId !== 'yes' || m.username) && (userId !== 'no' || !m.username)
    && (!from || joined(m) >= from) && (!to || joined(m) <= to)
    && (!status || (status === 'suspended' ? m.suspended : status === 'dues' ? m.dues >= DUES_LIMIT : m.status === status)))
  // Sorting: by membership number as a number (NNG-23 < NNG-345 < NNG-1358), family members together by name
  const nngNumber = m => Number(String(m.membershipNo || '').replace(/\D/g, '')) || 0
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
  const SORTS = {
    nng: (a, b) => nngNumber(a) - nngNumber(b) || byName(a, b),
    'nng-desc': (a, b) => nngNumber(b) - nngNumber(a) || byName(a, b),
    name: byName,
    newest: (a, b) => Number(b.id) - Number(a.id),
    bookings: (a, b) => b.bookings - a.bookings || byName(a, b),
  }
  // Sign-ups waiting for approval always come first
  const waiting = m => (m.status === 'pending' ? 1 : 0)
  shown.sort((a, b) => waiting(b) - waiting(a) || (SORTS[sort] || SORTS.nng)(a, b))
  const filtered = q || age || userId || from || to || status
  const pages = Math.max(1, Math.ceil(shown.length / perPage))
  const current = Math.min(page, pages - 1)
  const rows = printAll ? shown : shown.slice(current * perPage, current * perPage + perPage)
  const reset = fn => v => { fn(v); setPage(0) }

  const thisMonth = format(new Date(), 'yyyy-MM')
  const cards = [
    { icon: Clock, label: 'Waiting for approval', value: members.filter(m => m.status === 'pending').length, color: '#B45309', bg: '#FEF3C7', onClick: () => reset(setStatus)('pending') },
    { icon: Users, label: 'Total members', value: members.length, color: NAVY, bg: '#EFF6FF' },
    { icon: UserPlus, label: 'Joined this month', value: members.filter(m => joined(m).startsWith(thisMonth)).length, color: '#1D4ED8', bg: '#DBEAFE' },
    { icon: Baby, label: 'Under 18', value: members.filter(m => m.age != null && m.age < 18).length, color: GREEN, bg: '#ECFDF5' },
    { icon: AtSign, label: 'No User ID yet', value: members.filter(m => !m.username).length, color: '#B45309', bg: '#FFFBEB' },
  ]

  function downloadCsv() {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Name', 'User ID', 'Membership No.', 'Email', 'Phone', 'Date of birth', 'Age', 'Bookings', 'Signed up', 'Status', 'Dues (Rs.)', 'Suspended']
    const lines = shown.map(m => [m.name, m.username, m.membershipNo, m.email, m.phone, m.dob, m.age ?? '', m.bookings, when(m.createdAt), m.status, m.dues || 0, m.suspended ? 'Yes' : 'No'].map(cell).join(','))
    const blob = new Blob(['﻿' + [head.map(cell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `members-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click()
    URL.revokeObjectURL(a.href)
  }
  function printList() { setPrintAll(true); setTimeout(() => window.print(), 80) }

  return (
    <div className="space-y-4">
      {printAll && <style>{'@page { size: A4 landscape; margin: 10mm; }'}</style>}
      {editing && <MemberForm member={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReload(n => n + 1) }} />}
      <div className="print:hidden">
        <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: NAVY }}><Users size={22} /> Signed-up Members</h1>
        <p className="text-sm mt-0.5" style={{ color: LGRAY }}>Everyone who created an account on the website</p>
      </div>

      {error && <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FEE2E2' }}>{error}</div>}

      {/* New sign-ups waiting for approval, at the very top so they're not missed */}
      {members.some(m => m.status === 'pending') && (
        <div className="print:hidden rounded-2xl overflow-hidden shadow-sm" style={{ border: '2px solid #FCD34D', background: '#FFFBEB' }}>
          <p className="px-4 py-2.5 flex items-center gap-2 text-sm font-black" style={{ color: '#B45309', borderBottom: '1px solid #FDE68A' }}>
            <Clock size={16} /> New sign-ups waiting for approval ({members.filter(m => m.status === 'pending').length})
            <span className="text-[11px] font-semibold" style={{ color: '#92400E' }}>— the member gets an email when you approve or reject</span>
          </p>
          <div className="divide-y" style={{ borderColor: '#FDE68A' }}>
            {members.filter(m => m.status === 'pending').map(m => (
              <div key={m.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 bg-white/60">
                <span className="flex items-center gap-2 min-w-0 flex-1" style={{ minWidth: '220px' }}>
                  <Avatar m={m} />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold truncate" style={{ color: NAVY }}>
                      {m.name} <span className="font-mono text-xs" style={{ color: '#475569' }}>· {m.membershipNo}</span>
                    </span>
                    <span className="block text-[11px] truncate" style={{ color: '#64748B' }}>
                      {m.username && <>@{m.username} · </>}{m.email} · {m.phone} · signed up {when(m.createdAt)}
                    </span>
                  </span>
                </span>
                <span className="flex gap-2 shrink-0">
                  <button type="button" onClick={() => decide(m, 'approved')} disabled={deciding === m.id}
                    className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-black"
                    style={{ background: GREEN, color: 'white', opacity: deciding === m.id ? 0.5 : 1 }}>
                    <Check size={13} strokeWidth={3} /> {deciding === m.id ? 'Saving…' : 'Approve'}
                  </button>
                  <button type="button" onClick={() => decide(m, 'rejected')} disabled={deciding === m.id}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold"
                    style={{ background: 'white', color: '#DC2626', border: '1px solid #FECACA', opacity: deciding === m.id ? 0.5 : 1 }}>
                    <X size={13} /> Reject
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="print:hidden grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map(({ icon: Icon, label, value, color, bg, onClick }) => (
          <div key={label} onClick={onClick} className={`bg-white rounded-2xl p-4 shadow-sm ${onClick ? 'cursor-pointer' : ''}`}
            style={{ border: `1px solid ${onClick && value ? '#FCD34D' : BORDER}` }} title={onClick ? 'Show sign-ups waiting for approval' : undefined}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2" style={{ background: bg }}><Icon size={17} style={{ color }} /></div>
            <p className="text-2xl font-black" style={{ color }}>{loading ? '…' : value}</p>
            <p className="text-sm font-semibold" style={{ color: '#475569' }}>{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
        <div className="print:hidden px-4 py-3 flex flex-wrap items-center gap-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
            <input value={search} onChange={e => reset(setSearch)(e.target.value)} placeholder="Name, User ID, NNG no., email, phone…"
              style={{ ...filterInput, paddingLeft: '28px', width: '240px' }} />
          </div>
          <select value={age} onChange={e => reset(setAge)(e.target.value)} style={filterInput} aria-label="Age">
            <option value="">All ages</option>
            <option value="u18">Under 18</option>
            <option value="adult">18 and over</option>
            <option value="none">No date of birth</option>
          </select>
          <select value={userId} onChange={e => reset(setUserId)(e.target.value)} style={filterInput} aria-label="User ID">
            <option value="">With &amp; without User ID</option>
            <option value="yes">Has User ID</option>
            <option value="no">No User ID yet</option>
          </select>
          <select value={status} onChange={e => reset(setStatus)(e.target.value)} style={filterInput} aria-label="Approval status">
            <option value="">All statuses</option>
            <option value="pending">Waiting for approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="suspended">Suspended</option>
            <option value="dues">Dues Rs. {DUES_LIMIT.toLocaleString()} or more</option>
          </select>
          <span className="text-xs font-semibold" style={{ color: LGRAY }}>Joined</span>
          <input type="date" value={from} onChange={e => reset(setFrom)(e.target.value)} style={filterInput} aria-label="Joined from" />
          <span className="text-xs font-semibold" style={{ color: LGRAY }}>to</span>
          <input type="date" value={to} onChange={e => reset(setTo)(e.target.value)} style={filterInput} aria-label="Joined to" />
          <select value={sort} onChange={e => reset(setSort)(e.target.value)} style={{ ...filterInput, fontWeight: 700 }} aria-label="Sort by">
            <option value="nng">Sort: Membership No. (low → high)</option>
            <option value="nng-desc">Sort: Membership No. (high → low)</option>
            <option value="name">Sort: Name (A → Z)</option>
            <option value="newest">Sort: Newest signup first</option>
            <option value="bookings">Sort: Most bookings</option>
          </select>
          {filtered && (
            <button type="button" onClick={() => { setSearch(''); setAge(''); setUserId(''); setFrom(''); setTo(''); setStatus(''); setPage(0) }}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-bold" style={{ color: '#475569', border: `1.5px solid ${BORDER}` }}>
              <X size={12} /> Clear
            </button>
          )}
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={downloadCsv} disabled={!shown.length} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold"
              style={{ color: NAVY, border: `1.5px solid ${BORDER}`, opacity: shown.length ? 1 : 0.4 }}><Download size={13} /> CSV</button>
            <button type="button" onClick={printList} disabled={!shown.length} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold"
              style={{ background: NAVY, color: 'white', opacity: shown.length ? 1 : 0.4 }}><Printer size={13} /> Print / PDF</button>
          </span>
        </div>

        {/* Only on paper / PDF */}
        <div className="hidden print:block px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <p className="text-lg font-black" style={{ color: NAVY }}>North Nazimabad Gymkhana Trust — Signed-up Members</p>
          <p className="text-xs" style={{ color: '#475569' }}>{shown.length} members{filtered ? ' (filtered)' : ''} · printed {format(new Date(), 'd MMM yyyy, h:mm a')}</p>
        </div>

        <div className="overflow-x-auto">
          {/* Fits the page width: fixed column widths, two lines per cell, long text cut short (full text on hover) */}
          <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: '720px' }}>
            <colgroup>
              <col style={{ width: '18%' }} />{/* Member + User ID */}
              <col style={{ width: '10%' }} />{/* Membership no. */}
              <col style={{ width: '19%' }} />{/* Email + phone */}
              <col style={{ width: '11%' }} />{/* Date of birth + age */}
              <col style={{ width: '6%' }} />{/* Bookings */}
              <col style={{ width: '9%' }} />{/* Signed up */}
              <col style={{ width: '9%' }} />{/* Member dues */}
              <col style={{ width: '7%' }} />{/* Approved tick box */}
              <col className="print:hidden" style={{ width: '11%' }} />{/* Actions */}
            </colgroup>
            <thead style={{ background: '#F5F7FA' }}>
              <tr>{['Member', 'Membership No.', 'Contact', 'Date of birth', 'Bookings', 'Signed up', 'Dues / Suspend', 'Approved', 'Actions'].map(h => h === 'Membership No.' ? (
                // Click to sort by membership no.: low → high, again for high → low
                <th key={h} className="px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-wide">
                  <button type="button" onClick={() => { setSort(s => (s === 'nng' ? 'nng-desc' : 'nng')); setPage(0) }}
                    className="inline-flex items-center gap-1 uppercase" style={{ color: sort.startsWith('nng') ? NAVY : LGRAY }} title="Sort by membership no.">
                    Membership {sort === 'nng' ? <ArrowUp size={11} /> : sort === 'nng-desc' ? <ArrowDown size={11} /> : <ArrowUpDown size={11} />}
                  </button>
                </th>
              ) : (
                <th key={h} className={`px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-wide truncate ${h === 'Actions' ? 'print:hidden' : ''}`} style={{ color: LGRAY }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map(m => (
                // Waiting for approval: highlighted orange like the "Processing" bookings, so it stands out
                <tr key={m.id} className="text-xs" style={m.status === 'pending'
                  ? { borderTop: '1px solid #FDBA74', background: '#FFE8C2', boxShadow: 'inset 6px 0 0 #EA580C, inset 0 -1px 0 #FDBA74' }
                  : { borderTop: '1px solid #EEF2F7' }}>
                  <td className="px-2.5 py-1.5">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="print:hidden shrink-0"><Avatar m={m} /></span>
                      <span className="min-w-0">
                        <span className="block font-bold truncate" style={{ color: NAVY }} title={m.name}>{m.name}</span>
                        {m.username
                          ? <span className="block text-[11px] font-semibold truncate" style={{ color: '#1D4ED8' }}>@{m.username}</span>
                          : <span className="inline-block text-[10px] font-bold px-1.5 rounded" style={{ background: '#FFFBEB', color: '#B45309' }}>No User ID</span>}
                        {m.status === 'pending' && <span className="inline-block mt-0.5 text-[10px] font-black px-1.5 rounded" style={{ background: '#FEF3C7', color: '#B45309', border: '1px solid #FCD34D' }}>Waiting for approval</span>}
                        {m.suspended && <span className="inline-block mt-0.5 mr-1 text-[10px] font-black px-1.5 rounded" style={{ background: '#DC2626', color: 'white' }}>Suspended</span>}
                        {m.status === 'rejected' && <span className="inline-block mt-0.5 text-[10px] font-black px-1.5 rounded" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>Rejected</span>}
                      </span>
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 font-bold truncate" style={{ color: NAVY, fontFamily: 'Consolas, monospace' }}>{m.membershipNo}</td>
                  <td className="px-2.5 py-1.5" title={`${m.email} · ${m.phone}`}>
                    <span className="block truncate" style={{ color: '#475569' }}>{m.email}</span>
                    <span className="block truncate text-[11px]" style={{ color: LGRAY }}>{m.phone}</span>
                  </td>
                  <td className="px-2.5 py-1.5" style={{ color: '#475569' }}>
                    <span className="block truncate">{dobText(m.dob)}</span>
                    {m.age != null && (
                      <span className="block text-[11px]" style={{ color: LGRAY }}>
                        {m.age} yrs{m.age < 18 && <span className="ml-1 px-1 rounded text-[9px] font-black" style={{ background: GREEN, color: 'white' }}>U-18</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 font-bold" style={{ color: m.bookings ? NAVY : '#C8D3E0' }}>{m.bookings}</td>
                  <td className="px-2.5 py-1.5 truncate" style={{ color: LGRAY }}>{when(m.createdAt)}</td>
                  <td className="px-2.5 py-1.5">
                    <span className="print:hidden"><DuesInput member={m} onSaved={dues => setMembers(list => list.map(x => x.id === m.id ? { ...x, dues } : x))} /></span>
                    <span className="hidden print:inline font-bold">{m.dues ? `Rs. ${m.dues.toLocaleString()}` : '—'}{m.suspended ? ' · Suspended' : ''}</span>
                    {/* Suspended: no bookings until the tick is removed */}
                    <label className="print:hidden mt-1 inline-flex items-center gap-1 cursor-pointer select-none text-[10px] font-black uppercase tracking-wide"
                      style={{ color: m.suspended ? '#DC2626' : LGRAY }} title={m.suspended ? 'Suspended — untick to allow bookings again' : 'Tick to suspend (no bookings)'}>
                      <input type="checkbox" checked={!!m.suspended} disabled={deciding === m.id} onChange={() => toggleSuspend(m)}
                        className="w-3.5 h-3.5 cursor-pointer" style={{ accentColor: '#DC2626' }} />
                      {m.suspended ? 'Suspended' : 'Suspend'}
                    </label>
                  </td>
                  {/* Tick = approved (the member is emailed and can sign in and book); untick = back to waiting */}
                  <td className="px-2.5 py-1.5">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none"
                      title={m.status === 'approved' ? 'Approved — untick to remove the approval' : 'Tick to approve (emails the member)'}>
                      <input type="checkbox" checked={m.status === 'approved'} disabled={deciding === m.id}
                        onChange={e => decide(m, e.target.checked ? 'approved' : 'pending')}
                        className="w-4 h-4 cursor-pointer" style={{ accentColor: GREEN }} />
                      <span className="text-[11px] font-bold" style={{ color: m.status === 'approved' ? GREEN : m.status === 'rejected' ? '#DC2626' : '#B45309' }}>
                        {deciding === m.id ? '…' : m.status === 'approved' ? 'Yes' : m.status === 'rejected' ? 'Rejected' : 'Pending'}
                      </span>
                    </label>
                  </td>
                  <td className="px-2.5 py-1.5 print:hidden">
                    <span className="inline-flex flex-wrap gap-1">
                      <button type="button" title="Edit member (asks for the password)"
                        onClick={async () => { const password = await askAdminPassword(`Enter the admin password to edit ${m.name} (${m.membershipNo}).`); if (password) setEditing({ ...m, password }) }} className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] font-bold"
                        style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}><Pencil size={12} /> Edit</button>
                      <button type="button" onClick={() => removeMember(m)} disabled={deleting === m.id} title="Delete member" aria-label="Delete member"
                        className="inline-flex items-center h-7 px-2 rounded-lg"
                        style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', opacity: deleting === m.id ? 0.5 : 1 }}>
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && !rows.length && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-sm" style={{ color: LGRAY }}>{members.length ? 'No members match' : 'No members yet'}</td></tr>
              )}
              {loading && <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: LGRAY }}>Loading…</td></tr>}
            </tbody>
          </table>
        </div>

        {shown.length > 0 && (
          <div className="print:hidden px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ borderTop: `1px solid ${BORDER}`, color: LGRAY }}>
            <span className="flex items-center gap-2">
              <span>Showing <b style={{ color: NAVY }}>{current * perPage + 1}–{Math.min(shown.length, (current + 1) * perPage)}</b> of <b style={{ color: NAVY }}>{shown.length}</b></span>
              <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(0) }} style={{ ...filterInput, height: '28px' }} aria-label="Rows per page">
                {[15, 25, 50, 100].map(n => <option key={n} value={n}>{n} per page</option>)}
              </select>
            </span>
            {/* Always shown (Prev / Next are greyed out when there's nowhere to go) */}
            <span className="flex items-center gap-1">
              <span className="mr-1.5">Page <b style={{ color: NAVY }}>{current + 1}</b> of <b style={{ color: NAVY }}>{pages}</b></span>
              <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="h-7 px-2 rounded-lg inline-flex items-center gap-0.5 font-bold"
                style={{ border: `1.5px solid ${BORDER}`, color: NAVY, opacity: current === 0 ? 0.4 : 1, cursor: current === 0 ? 'not-allowed' : 'pointer' }}><ChevronLeft size={13} /> Prev</button>
              {pageNumbers(current, pages).map((n, i) => n === '…'
                ? <span key={`gap${i}`} className="px-1">…</span>
                : <button key={n} type="button" onClick={() => setPage(n)} className="min-w-7 h-7 px-1.5 rounded-lg font-bold"
                    style={n === current ? { background: NAVY, color: 'white', border: `1.5px solid ${NAVY}` } : { border: `1.5px solid ${BORDER}`, color: NAVY }}>{n + 1}</button>)}
              <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="h-7 px-2 rounded-lg inline-flex items-center gap-0.5 font-bold"
                style={{ border: `1.5px solid ${BORDER}`, color: NAVY, opacity: current >= pages - 1 ? 0.4 : 1, cursor: current >= pages - 1 ? 'not-allowed' : 'pointer' }}>Next <ChevronRight size={13} /></button>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
