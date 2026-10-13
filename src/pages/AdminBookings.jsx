import { useState, useEffect, useCallback } from 'react'
import EmailNotice from '../components/EmailNotice'
import { useSearchParams } from 'react-router-dom'
import { getCourts, formatSlotRange, adminSlotsApi, adminSetStatusApi, adminDeleteSlotApi, adminSetPaymentApi } from '../store'
import { Search, Trash2, CheckCircle, XCircle, SlidersHorizontal, Paperclip, ArrowUpNarrowWide, ArrowDownWideNarrow, ChevronLeft, ChevronRight, BarChart3 } from 'lucide-react'
import BalanceSlotsReport from '../components/BalanceSlotsReport'
import { format } from 'date-fns'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
// Date range filter: from 1 Jan 2026 (Upcoming: from today), no end date by default
const DEFAULT_FROM = '2026-01-01'
const todayKey = () => format(new Date(), 'yyyy-MM-dd')
const inputStyle = { border: `1.5px solid ${BORDER}`, borderRadius: '10px', padding: '8px 12px', fontSize: '13px', outline: 'none', color: NAVY, background: '#F8FAFC' }

export default function AdminBookings() {
  const [bookings, setBookings] = useState([])
  const [courts] = useState(getCourts)
  const [showBalance, setShowBalance] = useState(false) // "Balance Slots" report
  // Quick views (also linked from the sidebar): ?view=all | upcoming | court-<id> | u18
  const [params, setParams] = useSearchParams()
  const views = [
    { key: 'all', label: 'All Bookings' },
    { key: 'upcoming', label: 'Upcoming' },
    ...courts.map(c => ({ key: `court-${c.id}`, label: `${c.name} Bookings`, courtId: c.id })),
    { key: 'u18', label: 'U-18 Bookings' },
  ]
  const view = views.find(v => v.key === params.get('view')) || views[0]
  const [search, setSearch] = useState('')
  const [filterCourt, setFilterCourt] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [dateFrom, setDateFrom] = useState(() => (params.get('view') === 'upcoming' ? todayKey() : DEFAULT_FROM))
  const [dateTo, setDateTo] = useState('') // no end date: future bookings show too
  // Upcoming starts from today; the other views from 1 Jan 2026 — none has an end date
  const defaultRange = v => v === 'upcoming' ? [todayKey(), ''] : [DEFAULT_FROM, '']
  const rangeChanged = dateFrom !== defaultRange(view.key)[0] || dateTo !== defaultRange(view.key)[1]
  // Switching view (tab or sidebar link) resets the date range to that view's default
  const [rangeView, setRangeView] = useState(view.key)
  if (rangeView !== view.key) {
    const [f, t] = defaultRange(view.key)
    setRangeView(view.key); setDateFrom(f); setDateTo(t)
  }
  const viewMatch = b =>
    view.key === 'upcoming' ? b.status === 'confirmed' && b.date >= todayKey()
    : view.courtId ? b.courtId === view.courtId
    : view.key === 'u18' ? b.junior
    : true
  const viewCount = v => bookings.filter(b =>
    v.key === 'upcoming' ? b.status === 'confirmed' && b.date >= todayKey()
    : v.courtId ? b.courtId === v.courtId
    : v.key === 'u18' ? b.junior : true).length
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)

  // All bookings from MySQL (slot table), newest first
  useEffect(() => {
    let cancelled = false
    adminSlotsApi().then(r => {
      if (cancelled) return
      if (r.error) setLoadError(r.error)
      else { setLoadError(''); setBookings(r.bookings) }
    })
    return () => { cancelled = true }
  }, [reload])
  const load = () => setReload(n => n + 1)

  async function setStatus(id, status) {
    const r = await adminSetStatusApi(id, status)
    if (r.error) alert(r.error)
    load()
  }
  // Tick "Payment received" → Confirmed; untick → Processing
  const [savingPay, setSavingPay] = useState(null)
  const [emailNote, setEmailNote] = useState(null)
  const closeEmailNote = useCallback(() => setEmailNote(null), [])
  async function togglePayment(b) {
    setSavingPay(b.id)
    const r = await adminSetPaymentApi(b.id, !b.paymentReceived)
    setSavingPay(null)
    if (r.error) { alert(r.error); return }
    setBookings(list => list.map(x => (x.id === b.id ? r.booking : x)))
    if (r.emails) setEmailNote({ slotRef: r.booking?.slotRef, ...r.emails }) // approving sends the "confirmed" email
  }
  async function remove(id) {
    if (!confirm('Delete this booking permanently?')) return
    const r = await adminDeleteSlotApi(id)
    if (r.error) alert(r.error)
    load()
  }

  const [sortAsc, setSortAsc] = useState(true)
  const statusRank = b => (b.status === 'cancelled' ? 2 : b.paymentReceived ? 1 : 0)
  const filtered = bookings.filter(b => {
    const q = search.toLowerCase()
    const names = (b.players || []).map(p => p.name).join(' ').toLowerCase()
    return viewMatch(b) && (!q ||(b.playerName || '').toLowerCase().includes(q) || names.includes(q) || (b.playerPhone || '').includes(q))
      && (filterCourt === 'all' || b.courtId === filterCourt)
      && (filterStatus === 'all'
        || (filterStatus === 'processing' ? b.status === 'confirmed' && !b.paymentReceived
          : filterStatus === 'confirmed' ? b.status === 'confirmed' && b.paymentReceived
          : b.status === filterStatus))
      && (!dateFrom || b.date >= dateFrom)
      && (!dateTo || b.date <= dateTo)
  })
    // Date-wise: by date, then start time (oldest first, or newest first)
    // Processing first, then Confirmed, then Cancelled; inside each group by date (the Date sort button flips that)
    .sort((a, b) => statusRank(a) - statusRank(b)
      || (a.date.localeCompare(b.date) || a.startHour - b.startHour || Number(a.id) - Number(b.id)) * (sortAsc ? 1 : -1))

  // ── Pagination ──
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  // Any filter / view / sort change goes back to page 1
  const filterKey = [view.key, search, filterCourt, filterStatus, dateFrom, dateTo, sortAsc, pageSize].join('|')
  const [pageKey, setPageKey] = useState(filterKey)
  if (pageKey !== filterKey) { setPageKey(filterKey); setPage(1) }
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const curPage = Math.min(page, totalPages) // e.g. after deleting the last row of the last page
  const firstRow = (curPage - 1) * pageSize
  const pageRows = filtered.slice(firstRow, firstRow + pageSize)
  // Page numbers to show: first, last, and two either side of the current page (with … gaps)
  const pageNums = [...new Set([1, totalPages, ...[-2, -1, 0, 1, 2].map(d => curPage + d)])]
    .filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b)

  return (
    <div className="space-y-5">
      <EmailNotice note={emailNote} onClose={closeEmailNote} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black" style={{ color: NAVY }}>{view.label}</h1>
          <p className="text-sm mt-0.5" style={{ color: LGRAY }}>{filtered.length} of {bookings.length} bookings</p>
        </div>
        {/* Free slots still left to book, on every court */}
        <button type="button" onClick={() => setShowBalance(true)}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-black"
          style={{ background: 'white', color: '#047857', border: '2px solid #6EE7B7', boxShadow: '0 4px 12px rgba(4,120,87,0.12)' }}>
          <BarChart3 size={16} /> Balance Slots
        </button>
      </div>
      {showBalance && <BalanceSlotsReport courts={courts.filter(c => c.isActive)} onClose={() => setShowBalance(false)} />}

      {/* Quick views */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Booking views">
        {views.map(v => {
          const on = v.key === view.key
          return (
            <button key={v.key} type="button" role="tab" aria-selected={on}
              onClick={() => setParams(v.key === 'all' ? {} : { view: v.key })}
              className="btn inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold"
              style={on
                ? { background: NAVY, color: 'white', border: `1.5px solid ${NAVY}`, boxShadow: '0 4px 12px rgba(27,46,75,0.2)' }
                : { background: 'white', color: NAVY, border: `1.5px solid ${BORDER}` }}>
              {v.label}
              <span className="text-[11px] font-black px-1.5 py-0.5 rounded-md"
                style={on ? { background: 'rgba(255,255,255,0.18)', color: 'white' } : { background: '#EEF2F7', color: '#4A6FA5' }}>
                {viewCount(v)}
              </span>
            </button>
          )
        })}
      </div>
      {loadError && (
        <p className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FEE2E2' }}>
          {loadError}
        </p>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm flex flex-wrap gap-3" style={{ border: `1px solid ${BORDER}` }}>
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
          <input type="text" placeholder="Search name or phone…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: '32px', width: '100%' }} />
        </div>
        <select value={filterCourt} onChange={e => setFilterCourt(e.target.value)} style={inputStyle}>
          <option value="all">All Courts</option>
          {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={inputStyle}>
          <option value="all">All Status</option>
          <option value="confirmed">Confirmed</option>
          <option value="processing">Processing</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {/* Starting date → end date (default: from 1 Jan 2026, no end date) */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label htmlFor="date-from" className="text-xs font-bold" style={{ color: LGRAY }}>From</label>
          <input id="date-from" type="date" value={dateFrom} max={dateTo || undefined}
            onChange={e => setDateFrom(e.target.value)} className="flex-1 min-w-0 sm:flex-none" style={inputStyle} />
          <label htmlFor="date-to" className="text-xs font-bold" style={{ color: LGRAY }}>To</label>
          <input id="date-to" type="date" value={dateTo} min={dateFrom || undefined}
            onChange={e => setDateTo(e.target.value)} className="flex-1 min-w-0 sm:flex-none" style={inputStyle} />
        </div>
        <button type="button" onClick={() => setSortAsc(s => !s)} title="Sort by date"
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 rounded-lg"
          style={{ ...inputStyle, cursor: 'pointer' }}>
          {sortAsc ? <ArrowUpNarrowWide size={14} /> : <ArrowDownWideNarrow size={14} />}
          Date: {sortAsc ? 'Oldest first' : 'Newest first'}
        </button>
        {(search || filterCourt !== 'all' || filterStatus !== 'all' || rangeChanged) && (
          <button onClick={() => { setSearch(''); setFilterCourt('all'); setFilterStatus('all'); const [f, t] = defaultRange(view.key); setDateFrom(f); setDateTo(t) }}
            className="text-xs px-3 rounded-lg transition" style={{ color: LGRAY, border: `1.5px solid ${BORDER}`, background: '#F8FAFC' }}>
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
        {filtered.length === 0 ? (
          <div className="text-center py-16" style={{ color: '#DDE3EC' }}>
            <SlidersHorizontal size={40} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm" style={{ color: LGRAY }}>No bookings match your filters</p>
          </div>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: '#F5F7FA', borderBottom: `2px solid #EEF2F7` }}>
                <tr>
                  {['Slot Ref', 'Player', 'Court', 'Date & Time', 'Slip', 'Payment Received', 'Status', ''].map((h, i) => (
                    <th key={i} className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: i === 3 ? NAVY : LGRAY }}
                      aria-sort={i === 3 ? (sortAsc ? 'ascending' : 'descending') : undefined}>
                      {i === 3 ? (
                        <button type="button" onClick={() => setSortAsc(s => !s)} className="inline-flex items-center gap-1 uppercase font-bold" title="Sort by date">
                          {h} {sortAsc ? '▲' : '▼'}
                        </button>
                      ) : h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(b => {
                  const confirmed = b.status === 'confirmed'
                  const cell = 'px-3 py-2 align-middle'
                  return (
                    // Processing (payment not yet received) rows are highlighted
                    <tr key={b.id} className={confirmed && !b.paymentReceived ? 'row-processing' : ''} style={{ borderBottom: '1px solid #EEF2F7', ...(confirmed && !b.paymentReceived ? { background: '#FFE8C2', boxShadow: 'inset 6px 0 0 #EA580C, inset 0 1px 0 #FDBA74, inset 0 -1px 0 #FDBA74' } : {}) }}>
                      <td className={`${cell} whitespace-nowrap text-xs font-bold`} style={{ color: NAVY, fontFamily: 'Consolas, monospace' }}>{b.slotRef}</td>
                      <td className={cell}>
                        <p className="font-bold leading-tight" style={{ color: NAVY }}>{b.playerName}</p>
                        <p className="text-[11px]" style={{ color: LGRAY }}>{b.playerPhone}</p>
                      </td>
                      <td className={`${cell} whitespace-nowrap`} style={{ color: '#4B5563' }}>
                        {b.courtName}
                        {b.junior && <span className="ml-1 px-1 rounded text-[10px] font-black" style={{ background: '#047857', color: 'white' }}>U-18</span>}
                      </td>
                      {/* Date on top; time + hours below */}
                      <td className={`${cell} whitespace-nowrap`}>
                        <p className="font-semibold leading-tight" style={{ color: NAVY }}>{format(new Date(b.date + 'T00:00'), 'EEE d MMM yyyy')}</p>
                        <p className="text-xs" style={{ color: '#4B5563' }}>
                          {formatSlotRange(b.startHour, b.endHour)} <span style={{ color: LGRAY }}>· {b.endHour - b.startHour}h</span>
                        </p>
                      </td>
                      <td className={cell} style={{ maxWidth: '220px' }}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          {b.depositSlip ? (
                            <a href={b.depositSlip} target="_blank" rel="noreferrer" title="Open deposit slip"
                              className="link inline-flex items-center gap-1 text-xs font-bold whitespace-nowrap shrink-0" style={{ color: '#047857' }}>
                              <Paperclip size={12} /> View
                            </a>
                          ) : (
                            <span className="text-xs" style={{ color: '#C8D3E0' }}>—</span>
                          )}
                          {b.bankName && <span className="text-[11px] font-semibold truncate" style={{ color: '#4B5563' }} title={b.bankName}>{b.bankName}</span>}
                        </div>
                        {b.referenceNo && <p className="text-[11px] truncate" style={{ color: LGRAY }} title={b.referenceNo}>Ref: {b.referenceNo}</p>}
                      </td>
                      {/* Payment received (optional): admin ticks it once the payment is checked */}
                      <td className={`${cell} whitespace-nowrap`}>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-semibold" style={{ color: b.paymentReceived ? '#047857' : '#6B7280' }}
                          title={b.paymentReceived ? 'Payment received — click to undo' : 'Tick when the payment has been received'}>
                          <input type="checkbox" checked={b.paymentReceived} disabled={savingPay === b.id} onChange={() => togglePayment(b)}
                            className="w-4 h-4 cursor-pointer" style={{ accentColor: '#047857' }} />
                          {savingPay === b.id ? 'Saving…' : b.paymentReceived ? 'Received' : 'Not yet'}
                        </label>
                      </td>
                      {/* Confirmed once the payment is received, otherwise Processing */}
                      <td className={cell}>
                        {(() => {
                          const st = !confirmed ? ['Cancelled', '#FEF2F2', '#DC2626', '#FEE2E2']
                            : b.paymentReceived ? ['Confirmed', '#ECFDF5', '#047857', '#A7F3D0'] : ['Processing', '#EA580C', '#FFFFFF', '#EA580C']
                          return (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap"
                              style={{ background: st[1], color: st[2], border: `1px solid ${st[3]}` }}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: st[2] }} />{st[0]}
                            </span>
                          )
                        })()}
                      </td>
                      <td className={cell}>
                        <div className="flex items-center gap-0.5 justify-end">
                          {confirmed ? (
                            <button onClick={() => setStatus(b.id, 'cancelled')} title="Cancel"
                              className="btn-icon p-1.5 rounded-lg" style={{ color: '#DC2626' }}>
                              <XCircle size={16} />
                            </button>
                          ) : (
                            <button onClick={() => setStatus(b.id, 'confirmed')} title="Restore"
                              className="btn-icon p-1.5 rounded-lg" style={{ color: '#059669' }}>
                              <CheckCircle size={16} />
                            </button>
                          )}
                          <button onClick={() => remove(b.id)} title="Delete"
                            className="btn-icon p-1.5 rounded-lg" style={{ color: '#94A3B8' }}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
            {/* Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5" style={{ borderTop: `1px solid ${BORDER}`, background: '#FAFBFD' }}>
              <div className="flex items-center gap-2 text-xs" style={{ color: LGRAY }}>
                <span>Showing <b style={{ color: NAVY }}>{firstRow + 1}–{firstRow + pageRows.length}</b> of <b style={{ color: NAVY }}>{filtered.length}</b></span>
                <span>·</span>
                <label htmlFor="page-size">Rows per page</label>
                <select id="page-size" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
                  style={{ ...inputStyle, padding: '4px 8px', fontSize: '12px' }}>
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <nav className="flex items-center gap-1" aria-label="Pages">
                <button type="button" onClick={() => setPage(curPage - 1)} disabled={curPage === 1}
                  className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-bold"
                  style={{ border: `1.5px solid ${BORDER}`, background: 'white', color: NAVY, opacity: curPage === 1 ? 0.4 : 1 }}>
                  <ChevronLeft size={14} /> Prev
                </button>
                {pageNums.map((n, i) => (
                  <span key={n} className="flex items-center gap-1">
                    {i > 0 && n - pageNums[i - 1] > 1 && <span className="px-1 text-xs" style={{ color: LGRAY }}>…</span>}
                    <button type="button" onClick={() => setPage(n)} aria-current={n === curPage ? 'page' : undefined}
                      className="min-w-8 h-8 px-2 rounded-lg text-xs font-bold"
                      style={n === curPage
                        ? { background: NAVY, color: 'white', border: `1.5px solid ${NAVY}` }
                        : { background: 'white', color: NAVY, border: `1.5px solid ${BORDER}` }}>
                      {n}
                    </button>
                  </span>
                ))}
                <button type="button" onClick={() => setPage(curPage + 1)} disabled={curPage === totalPages}
                  className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-bold"
                  style={{ border: `1.5px solid ${BORDER}`, background: 'white', color: NAVY, opacity: curPage === totalPages ? 0.4 : 1 }}>
                  Next <ChevronRight size={14} />
                </button>
              </nav>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
