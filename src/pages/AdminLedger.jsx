import { useState, useEffect } from 'react'
import { BookOpenText, ArrowDownLeft, ArrowUpRight, Wallet, Search, X, CalendarDays, Banknote, CheckCircle, Clock, Paperclip, Download, ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { format } from 'date-fns'
import { adminLedgerApi, formatSlotRange } from '../store'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const GREEN = '#047857'
const RED = '#DC2626'
const PAGE = 25

const rs = n => `Rs. ${Math.abs(Number(n) || 0).toLocaleString()}`
const when = d => { const x = new Date(String(d).replace(' ', 'T')); return isNaN(x) ? '—' : format(x, 'd MMM yyyy, h:mm a') }
const day = d => { const x = new Date(`${d}T00:00`); return isNaN(x) ? d : format(x, 'EEE d MMM yyyy') }
const statusOf = b => (b.status === 'cancelled' ? 'cancelled' : b.paymentReceived ? 'confirmed' : 'processing')
const STATUS = {
  confirmed: ['Confirmed', '#ECFDF5', GREEN],
  processing: ['Processing', '#FFF7ED', '#C2410C'],
  cancelled: ['Cancelled', '#FEF2F2', RED],
}
// Page buttons to show: first, last, and two either side of the current page (0-based), with "…" gaps
function pageNumbers(current, pages) {
  const out = []
  for (let n = 0; n < pages; n++) {
    if (n === 0 || n === pages - 1 || Math.abs(n - current) <= 2) out.push(n)
    else if (out[out.length - 1] !== '…') out.push('…')
  }
  return out
}
const team = (b, t) => (b.players || []).filter(p => p.team === t).map(p => p.name).join(' & ') || '—'

function Card({ icon: Icon, label, value, sub, color, bg }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2" style={{ background: bg }}><Icon size={17} style={{ color }} /></div>
      <p className="text-xl font-black" style={{ color }}>{value}</p>
      <p className="text-sm font-semibold" style={{ color: '#475569' }}>{label}</p>
      {sub && <p className="text-xs" style={{ color: LGRAY }}>{sub}</p>}
    </div>
  )
}

const th = 'px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide whitespace-nowrap'
const inputStyle = { border: `1.5px solid ${BORDER}`, borderRadius: '8px', height: '32px', padding: '0 8px', fontSize: '12px', outline: 'none', color: NAVY, background: 'white' }

// ── Bookings: every row of the slot table with its date and money details ──
function BookingsLedger({ bookings, loading }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const q = search.trim().toLowerCase()
  const shown = bookings.filter(b => (!from || b.date >= from) && (!to || b.date <= to) && (!status || statusOf(b) === status)
    && (!q || [b.slotRef, b.bookerName, b.bookerUsername, b.courtName, b.bankName, b.referenceNo, b.playerPhone, ...(b.players || []).map(p => `${p.name} ${p.cmNo || ''}`)]
      .some(v => (v || '').toLowerCase().includes(q))))
  const active = shown.filter(b => b.status !== 'cancelled')
  const total = active.reduce((s, b) => s + (b.payment || 0), 0)
  const fromAdvance = active.reduce((s, b) => s + (b.creditUsed || 0), 0)
  const received = active.filter(b => b.paymentReceived).reduce((s, b) => s + (b.payment || 0), 0)
  const [perPage, setPerPage] = useState(PAGE)
  const pages = Math.max(1, Math.ceil(shown.length / perPage))
  const current = Math.min(page, pages - 1)
  const resetPage = fn => v => { fn(v); setPage(0) }

  // Print / Save as PDF: every filtered booking (not just this page), without the sidebar and buttons
  const [printAll, setPrintAll] = useState(false)
  useEffect(() => {
    const done = () => setPrintAll(false)
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [])
  function printLedger() {
    setPrintAll(true)
    setTimeout(() => window.print(), 80) // let the full list render first
  }
  const rows = printAll ? shown : shown.slice(current * perPage, current * perPage + perPage)
  const filterText = [
    from || to ? `${from ? day(from) : 'start'} – ${to ? day(to) : 'today onwards'}` : 'All dates',
    status ? STATUS[status][0] : 'All statuses',
    search.trim() && `Search: "${search.trim()}"`,
  ].filter(Boolean).join(' · ')

  function downloadCsv() {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Date', 'Time', 'Hours', 'Slot Ref', 'Court', 'Booked by', 'User ID', 'Membership', 'Phone', 'Team 1', 'Team 2',
      'Amount', 'From advance', 'By slip', 'Bank', 'Reference no.', 'Payment received', 'Status', 'Booked on']
    const lines = shown.map(b => [b.date, formatSlotRange(b.startHour, b.endHour), b.endHour - b.startHour, b.slotRef, b.courtName,
      b.bookerName, b.bookerUsername, b.bookerMembership, b.playerPhone, team(b, 1), team(b, 2),
      b.payment ?? 0, b.creditUsed || 0, Math.max(0, (b.payment || 0) - (b.creditUsed || 0)), b.bankName, b.referenceNo,
      b.paymentReceived ? 'Yes' : 'No', STATUS[statusOf(b)][0], b.createdAt ? when(b.createdAt) : ''].map(cell).join(','))
    const blob = new Blob(['﻿' + [head.map(cell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `ledger-bookings-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-4">
      <div className="print:hidden grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card icon={CalendarDays} label="Bookings" value={active.length} sub={`${shown.length - active.length} cancelled`} color={NAVY} bg="#EFF6FF" />
        <Card icon={Banknote} label="Total amount" value={rs(total)} sub="Not counting cancelled" color={NAVY} bg="#F1F5F9" />
        <Card icon={CheckCircle} label="Payment received" value={rs(received)} sub={`${rs(total - received)} still processing`} color={GREEN} bg="#ECFDF5" />
        <Card icon={Wallet} label="Paid from advance" value={rs(fromAdvance)} sub={`${rs(total - fromAdvance)} by deposit slip`} color="#1D4ED8" bg="#DBEAFE" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
        <div className="print:hidden px-4 py-3 flex flex-wrap items-center gap-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <span className="text-xs font-semibold" style={{ color: LGRAY }}>From</span>
          <input type="date" value={from} onChange={e => resetPage(setFrom)(e.target.value)} style={inputStyle} />
          <span className="text-xs font-semibold" style={{ color: LGRAY }}>To</span>
          <input type="date" value={to} onChange={e => resetPage(setTo)(e.target.value)} style={inputStyle} />
          <select value={status} onChange={e => resetPage(setStatus)(e.target.value)} style={inputStyle}>
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="processing">Processing</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
            <input value={search} onChange={e => resetPage(setSearch)(e.target.value)} placeholder="Slot, name, CM no., bank, ref…"
              style={{ ...inputStyle, paddingLeft: '28px', width: '220px' }} />
          </div>
          {(from || to || status || search) && (
            <button type="button" onClick={() => { setFrom(''); setTo(''); setStatus(''); setSearch(''); setPage(0) }}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-bold" style={{ color: '#475569', border: `1.5px solid ${BORDER}` }}>
              <X size={12} /> Clear
            </button>
          )}
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={downloadCsv} disabled={!shown.length}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold"
              style={{ color: NAVY, border: `1.5px solid ${BORDER}`, opacity: shown.length ? 1 : 0.4 }}>
              <Download size={13} /> CSV
            </button>
            <button type="button" onClick={printLedger} disabled={!shown.length} title="Print, or choose “Save as PDF” in the print window"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold"
              style={{ background: NAVY, color: 'white', border: `1.5px solid ${NAVY}`, opacity: shown.length ? 1 : 0.4 }}>
              <Printer size={13} /> Print / PDF
            </button>
          </span>
        </div>

        {/* Wide table: print across an A4 page in landscape (only while this ledger is printing) */}
        {printAll && <style>{'@page { size: A4 landscape; margin: 10mm; }'}</style>}
        {/* Only on paper / PDF: title, filters and totals */}
        <div className="hidden print:block px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <p className="text-lg font-black" style={{ color: NAVY }}>North Nazimabad Gymkhana Trust — Bookings Ledger</p>
          <p className="text-xs" style={{ color: '#475569' }}>{filterText} · printed {format(new Date(), 'd MMM yyyy, h:mm a')}</p>
          <p className="text-xs mt-1" style={{ color: NAVY }}>
            <b>{active.length}</b> bookings · Total <b>{rs(total)}</b> · Received <b>{rs(received)}</b> · Processing <b>{rs(total - received)}</b>
            {shown.length > active.length && <> · {shown.length - active.length} cancelled</>}
          </p>
        </div>

        {/* Fits the page width: fixed column widths, long text is cut short (full text on hover) */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: '860px' }}>
            <colgroup>
              <col style={{ width: '13%' }} />{/* Date & time */}
              <col style={{ width: '9%' }} />{/* Slot ref */}
              <col style={{ width: '7%' }} />{/* Court */}
              <col style={{ width: '14%' }} />{/* Booked by */}
              <col style={{ width: '17%' }} />{/* Match */}
              <col style={{ width: '8%' }} />{/* Amount */}
              <col style={{ width: '13%' }} />{/* Deposit slip */}
              <col style={{ width: '10%' }} />{/* Status */}
              <col style={{ width: '9%' }} />{/* Booked on */}
            </colgroup>
            <thead style={{ background: '#F5F7FA' }}>
              <tr>{['Date & Time', 'Slot Ref', 'Court', 'Booked by', 'Match', 'Amount', 'Deposit Slip', 'Status', 'Booked on'].map(h => (
                <th key={h} className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide truncate" style={{ color: LGRAY }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map(b => {
                const [label, bg, color] = STATUS[statusOf(b)]
                const cancelled = b.status === 'cancelled'
                const matchTitle = [1, 2].map(t => (b.players || []).filter(p => p.team === t).map(p => `${p.name} ${p.cmNo || ''}`.trim()).join(' & ') || '—').join('  vs  ')
                const created = b.createdAt ? new Date(String(b.createdAt).replace(' ', 'T')) : null
                return (
                  <tr key={b.id} className="text-xs align-middle" style={{ borderTop: '1px solid #EEF2F7', opacity: cancelled ? 0.65 : 1 }}>
                    <td className="px-2 py-1.5">
                      <p className="font-bold truncate" style={{ color: NAVY }}>{day(b.date)}</p>
                      <p className="truncate" style={{ color: '#475569' }}>{formatSlotRange(b.startHour, b.endHour)}<span style={{ color: LGRAY }}> · {b.endHour - b.startHour}h</span></p>
                    </td>
                    <td className="px-2 py-1.5 font-bold truncate" style={{ color: NAVY, fontFamily: 'Consolas, monospace' }}>{b.slotRef}</td>
                    <td className="px-2 py-1.5" style={{ color: '#475569' }}>
                      <p className="truncate">{b.courtName}</p>
                      {b.junior && <span className="px-1 rounded text-[9px] font-black" style={{ background: GREEN, color: 'white' }}>U-18</span>}
                    </td>
                    <td className="px-2 py-1.5" title={[b.bookerName, b.bookerUsername && `@${b.bookerUsername}`, b.bookerMembership, b.playerPhone].filter(Boolean).join(' · ')}>
                      <p className="font-semibold truncate" style={{ color: NAVY }}>{b.bookerName}</p>
                      <p className="text-[10.5px] truncate" style={{ color: LGRAY }}>
                        {[b.bookerUsername && `@${b.bookerUsername}`, b.bookerMembership].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </td>
                    <td className="px-2 py-1.5" title={matchTitle}>
                      <p className="font-semibold truncate" style={{ color: NAVY }}>{team(b, 1)}</p>
                      <p className="truncate" style={{ color: '#475569' }}><span className="text-[9px] font-black" style={{ color: LGRAY }}>VS </span>{team(b, 2)}</p>
                    </td>
                    <td className="px-2 py-1.5 font-bold truncate" style={{ color: NAVY }}>{b.payment ? rs(b.payment) : 'Free'}</td>
                    <td className="px-2 py-1.5" title={[b.bankName, b.referenceNo && `Ref: ${b.referenceNo}`].filter(Boolean).join(' · ')}>
                      <p className="truncate leading-tight">
                        {b.depositSlip ? (
                          <a href={b.depositSlip} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-0.5 font-bold" style={{ color: GREEN }}>
                            <Paperclip size={11} /> View
                          </a>
                        ) : <span style={{ color: '#C8D3E0' }}>—</span>}
                        {b.bankName && <span className="text-[11px] font-semibold" style={{ color: '#334155' }}> · {b.bankName}</span>}
                      </p>
                      {b.referenceNo && <p className="text-[10.5px] truncate" style={{ color: '#64748B' }}>Ref: <span className="font-semibold" style={{ fontFamily: 'Consolas, monospace' }}>{b.referenceNo}</span></p>}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: bg, color }}>
                        {statusOf(b) === 'processing' ? <Clock size={10} /> : <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}{label}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-[11px]" style={{ color: LGRAY }}>
                      {created && !isNaN(created) ? <><p className="truncate">{format(created, 'd MMM yyyy')}</p><p className="truncate">{format(created, 'h:mm a')}</p></> : '—'}
                    </td>
                  </tr>
                )
              })}
              {!loading && !rows.length && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: LGRAY }}>No bookings match</td></tr>
              )}
              {loading && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: LGRAY }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination: rows per page, then « Prev 1 2 3 Next » (not printed — printing shows every row) */}
        {shown.length > 0 && (
          <div className="print:hidden px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ borderTop: `1px solid ${BORDER}`, color: LGRAY }}>
            <span className="flex items-center gap-2">
              <span>Showing <b style={{ color: NAVY }}>{current * perPage + 1}–{Math.min(shown.length, (current + 1) * perPage)}</b> of <b style={{ color: NAVY }}>{shown.length}</b></span>
              <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(0) }} style={{ ...inputStyle, height: '28px' }} aria-label="Rows per page">
                {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} per page</option>)}
              </select>
            </span>
            {pages > 1 && (
              <span className="flex items-center gap-1">
                <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}
                  className="h-7 px-2 rounded-lg inline-flex items-center gap-0.5 font-bold"
                  style={{ border: `1.5px solid ${BORDER}`, color: NAVY, opacity: current === 0 ? 0.4 : 1 }}><ChevronLeft size={13} /> Prev</button>
                {pageNumbers(current, pages).map((n, i) => n === '…'
                  ? <span key={`gap${i}`} className="px-1">…</span>
                  : (
                    <button key={n} type="button" onClick={() => setPage(n)} className="min-w-7 h-7 px-1.5 rounded-lg font-bold"
                      style={n === current ? { background: NAVY, color: 'white', border: `1.5px solid ${NAVY}` } : { border: `1.5px solid ${BORDER}`, color: NAVY }}>
                      {n + 1}
                    </button>
                  ))}
                <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}
                  className="h-7 px-2 rounded-lg inline-flex items-center gap-0.5 font-bold"
                  style={{ border: `1.5px solid ${BORDER}`, color: NAVY, opacity: current >= pages - 1 ? 0.4 : 1 }}>Next <ChevronRight size={13} /></button>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Advance balance: money put on a member's advance (cancellations) and taken from it (new bookings) ──
function AdvanceLedger({ entries, members, loading }) {
  const [member, setMember] = useState('') // userId filter
  const [search, setSearch] = useState('')

  const credited = members.reduce((s, m) => s + m.credited, 0)
  const used = members.reduce((s, m) => s + m.used, 0)
  const q = search.trim().toLowerCase()
  const shown = entries.filter(e => (!member || e.userId === member)
    && (!q || [e.name, e.username, e.membershipNo, e.reason, e.slotRef].some(v => (v || '').toLowerCase().includes(q))))
  const picked = members.find(m => m.userId === member)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card icon={ArrowDownLeft} label="Total credited" value={rs(credited)} sub="Put on advance (cancellations)" color={GREEN} bg="#ECFDF5" />
        <Card icon={ArrowUpRight} label="Total used" value={rs(used)} sub="Spent on new bookings" color={RED} bg="#FEF2F2" />
        <Card icon={Wallet} label="Outstanding balance" value={rs(credited - used)} sub={`${members.filter(m => m.balance > 0).length} members have a balance`} color={NAVY} bg="#EFF6FF" />
      </div>

      {/* Balance per member — click a row to see only their entries */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
        <div className="px-5 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <p className="font-black" style={{ color: NAVY }}>Member balances</p>
          <p className="text-xs" style={{ color: LGRAY }}>Click a member to see their entries below</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: '#F5F7FA' }}>
              <tr>{['Member', 'User ID', 'Membership', 'Credited', 'Used', 'Balance', 'Entries'].map(h => (
                <th key={h} className={th} style={{ color: LGRAY }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.userId} onClick={() => setMember(member === m.userId ? '' : m.userId)} className="cursor-pointer text-xs"
                  style={{ borderTop: '1px solid #EEF2F7', background: member === m.userId ? '#EFF6FF' : 'white' }}>
                  <td className="px-3 py-2 font-bold" style={{ color: NAVY }}>{m.name}</td>
                  <td className="px-3 py-2" style={{ color: '#475569' }}>{m.username || '—'}</td>
                  <td className="px-3 py-2" style={{ color: '#475569' }}>{m.membershipNo || '—'}</td>
                  <td className="px-3 py-2 font-semibold" style={{ color: GREEN }}>{rs(m.credited)}</td>
                  <td className="px-3 py-2 font-semibold" style={{ color: RED }}>{rs(m.used)}</td>
                  <td className="px-3 py-2 font-black" style={{ color: m.balance > 0 ? NAVY : LGRAY }}>{m.balance < 0 ? '−' : ''}{rs(m.balance)}</td>
                  <td className="px-3 py-2" style={{ color: LGRAY }}>{m.count}</td>
                </tr>
              ))}
              {!loading && !members.length && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: LGRAY }}>No advance entries yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
        <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <p className="font-black" style={{ color: NAVY }}>{picked ? `Entries — ${picked.name}` : 'All entries'}</p>
            <p className="text-xs" style={{ color: LGRAY }}>{shown.length} {shown.length === 1 ? 'entry' : 'entries'} · newest first</p>
          </div>
          <div className="flex items-center gap-2">
            {picked && (
              <button type="button" onClick={() => setMember('')} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-xs font-bold"
                style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>
                <X size={12} /> Show all members
              </button>
            )}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, slot, reason…"
                style={{ ...inputStyle, paddingLeft: '28px', width: '210px' }} />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: '#F5F7FA' }}>
              <tr>{['Date', 'Member', 'Slot Ref', 'Reason', 'Credit', 'Debit'].map(h => (
                <th key={h} className={th} style={{ color: LGRAY }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {shown.map(e => (
                <tr key={e.id} className="text-xs" style={{ borderTop: '1px solid #EEF2F7' }}>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: '#475569' }}>{when(e.createdAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-semibold" style={{ color: NAVY }}>{e.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-bold" style={{ color: NAVY, fontFamily: 'Consolas, monospace' }}>{e.slotRef || '—'}</td>
                  <td className="px-3 py-2" style={{ color: '#475569' }}>{e.reason}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-bold" style={{ color: GREEN }}>{e.amount > 0 ? `+ ${rs(e.amount)}` : ''}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-bold" style={{ color: RED }}>{e.amount < 0 ? `− ${rs(e.amount)}` : ''}</td>
                </tr>
              ))}
              {!loading && !shown.length && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: LGRAY }}>No entries match</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function AdminLedger() {
  const [data, setData] = useState({ bookings: [], entries: [], members: [] })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('bookings')

  useEffect(() => {
    let cancelled = false
    adminLedgerApi().then(r => {
      if (cancelled) return
      setLoading(false)
      if (r.error) setError(r.error)
      else setData({ bookings: r.bookings || [], entries: r.entries || [], members: r.members || [] })
    })
    return () => { cancelled = true }
  }, [])

  const tabs = [['bookings', `Bookings (${data.bookings.length})`], ['advance', `Advance balance (${data.entries.length})`]]

  return (
    <div className="space-y-4">
      <div className="print:hidden flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: NAVY }}><BookOpenText size={22} /> Ledger</h1>
          <p className="text-sm mt-0.5" style={{ color: LGRAY }}>Every booking with its date and payment details, and members' advance balance</p>
        </div>
        <div className="inline-flex rounded-xl p-1" style={{ background: '#E2E8F0' }}>
          {tabs.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className="h-8 px-3.5 rounded-lg text-xs font-bold"
              style={tab === key ? { background: NAVY, color: 'white' } : { color: '#475569' }}>{label}</button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#FEF2F2', color: RED, border: '1px solid #FEE2E2' }}>{error}</div>}

      {tab === 'bookings'
        ? <BookingsLedger bookings={data.bookings} loading={loading} />
        : <AdvanceLedger entries={data.entries} members={data.members} loading={loading} />}
    </div>
  )
}
