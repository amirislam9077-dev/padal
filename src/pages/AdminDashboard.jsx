import { useState, useEffect, useCallback } from 'react'
import EmailNotice from '../components/EmailNotice'
import { getCourts, formatHour, formatSlotRange, adminSlotsApi, adminSetPaymentApi } from '../store'
import { CourtCharts } from '../components/BookingCharts'
import { CalendarDays, CheckCircle, XCircle, TrendingUp, Clock, Paperclip, ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react'
import { format } from 'date-fns'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'

export default function AdminDashboard() {
  const [bookings, setBookings] = useState([])
  const [courts] = useState(getCourts)
  const [loadError, setLoadError] = useState('')
  // Tick "Payment received" → status Confirmed; untick → Processing
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

  // All bookings from MySQL (slot table)
  useEffect(() => {
    let cancelled = false
    adminSlotsApi().then(r => {
      if (cancelled) return
      if (r.error) setLoadError(r.error)
      else setBookings(r.bookings)
    })
    return () => { cancelled = true }
  }, [])

  const today = format(new Date(), 'yyyy-MM-dd')
  const todayBookings = bookings.filter(b => b.date === today)
  const confirmedToday = todayBookings.filter(b => b.status === 'confirmed')
  const totalConfirmed = bookings.filter(b => b.status === 'confirmed')
  const totalCancelled = bookings.filter(b => b.status === 'cancelled')

  const upcoming = bookings
    .filter(b => b.date >= today && b.status === 'confirmed')
    // Processing (payment not yet received) first, then Confirmed — each by date and time
    .sort((a, b) => Number(a.paymentReceived) - Number(b.paymentReceived) || a.date.localeCompare(b.date) || a.startHour - b.startHour)
  const team = (b, t) => (b.players || []).filter(p => p.team === t)
  // Print shows every upcoming booking (not just this page); CSV downloads them all too
  const [printAll, setPrintAll] = useState(false)
  useEffect(() => {
    const done = () => setPrintAll(false)
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [])
  function printUpcoming() {
    setPrintAll(true)
    setTimeout(() => window.print(), 80) // let the full list render first
  }
  function exportCsv() {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['Slot Ref', 'Date', 'Day', 'Time', 'Hours', 'Court', 'Under-18', 'Team 1', 'Team 1 CM No.', 'Team 2', 'Team 2 CM No.',
      'Booked by', 'Phone', 'Payment (Rs)', 'Paid from advance (Rs)', 'Bank', 'Reference No.', 'Deposit slip', 'Payment received', 'Status']
    const lines = upcoming.map(b => {
      const t = n => team(b, n)
      return [b.slotRef, b.date, format(new Date(b.date + 'T00:00'), 'EEE'), formatSlotRange(b.startHour, b.endHour), b.endHour - b.startHour,
        b.courtName, b.junior ? 'Yes' : 'No',
        t(1).map(p => p.name).join(' & '), t(1).map(p => p.cmNo).filter(Boolean).join(' · '),
        t(2).map(p => p.name).join(' & '), t(2).map(p => p.cmNo).filter(Boolean).join(' · '),
        b.playerName, b.playerPhone, b.payment ?? 0, b.creditUsed || 0, b.bankName, b.referenceNo,
        b.depositSlip ? window.location.origin + b.depositSlip : '', b.paymentReceived ? 'Yes' : 'No',
        b.status === 'cancelled' ? 'Cancelled' : b.paymentReceived ? 'Confirmed' : 'Processing'].map(cell).join(',')
    })
    const blob = new Blob(['\ufeff' + [header.map(cell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `upcoming-bookings-${today}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const processingCount = upcoming.filter(b => !b.paymentReceived && b.status !== 'cancelled').length

  // Upcoming table: 15 per page
  const PAGE_SIZE = 15
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(upcoming.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages)
  const firstRow = (curPage - 1) * PAGE_SIZE
  const pageRows = upcoming.slice(firstRow, firstRow + PAGE_SIZE)

  const courtUsage = courts.map(c => ({
    ...c,
    count: bookings.filter(b => b.courtId === c.id && b.status === 'confirmed').length,
    hours: bookings.filter(b => b.courtId === c.id && b.status === 'confirmed').reduce((s, b) => s + b.endHour - b.startHour, 0),
  }))
  const maxCount = Math.max(1, ...courtUsage.map(c => c.count))

  const stats = [
    { icon: CalendarDays, label: "Today's Bookings", value: confirmedToday.length, sub: `${todayBookings.length} requests`, bg: '#EEF2F7', ic: '#4A6FA5' },
    { icon: CheckCircle, label: 'Total Confirmed', value: totalConfirmed.length, sub: 'All time', bg: '#ECFDF5', ic: '#059669' },
    { icon: XCircle, label: 'Cancelled', value: totalCancelled.length, sub: 'All time', bg: '#FEF2F2', ic: '#DC2626' },
    { icon: TrendingUp, label: 'Total Bookings', value: bookings.length, sub: 'All time', bg: '#F5F7FA', ic: NAVY },
  ]

  return (
    <div className="space-y-6">
      <EmailNotice note={emailNote} onClose={closeEmailNote} />
      <div className="print:hidden">
        <h1 className="text-2xl font-black" style={{ color: NAVY }}>Dashboard</h1>
        <p className="text-sm mt-0.5" style={{ color: LGRAY }}>{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
      </div>
      {loadError && (
        <p className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FEE2E2' }}>
          {loadError}
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 print:hidden">
        {stats.map(({ icon: Icon, label, value, sub, bg, ic }) => (
          <div key={label} className="bg-white rounded-xl p-5 shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: bg }}>
              <Icon size={18} style={{ color: ic }} />
            </div>
            <p className="text-2xl font-black" style={{ color: NAVY }}>{value}</p>
            <p className="text-sm font-semibold mt-0.5" style={{ color: '#4B5563' }}>{label}</p>
            <p className="text-xs mt-0.5" style={{ color: LGRAY }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* ── All upcoming bookings (every detail) ── */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <p className="font-black whitespace-nowrap" style={{ color: NAVY }}>All Upcoming Bookings</p>
            <p className="hidden print:block text-xs" style={{ color: LGRAY }}>North Nazimabad Gymkhana Trust · printed {format(new Date(), 'd MMM yyyy, h:mm a')} · {upcoming.length} bookings</p>
          </div>
          <span className="flex flex-wrap items-center gap-2">
            {processingCount > 0 && (
              <span className="badge-pulse text-xs font-black px-2.5 py-1 rounded-full" style={{ background: '#EA580C', color: 'white' }}>{processingCount} processing — tick Payment Received to confirm</span>
            )}
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: '#EEF2F7', color: '#4A6FA5' }}>{upcoming.length} upcoming</span>
            <button type="button" onClick={exportCsv} disabled={!upcoming.length} title="Download all upcoming bookings (opens in Excel)"
              className="print:hidden inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold"
              style={{ border: `1.5px solid ${NAVY}`, color: NAVY, background: 'white', opacity: upcoming.length ? 1 : 0.4 }}>
              <Download size={13} /> CSV
            </button>
            <button type="button" onClick={printUpcoming} disabled={!upcoming.length} title="Print all upcoming bookings"
              className="print:hidden inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold"
              style={{ background: NAVY, color: 'white', border: `1.5px solid ${NAVY}`, opacity: upcoming.length ? 1 : 0.4 }}>
              <Printer size={13} /> Print
            </button>
          </span>
        </div>
        {upcoming.length === 0 ? (
          <div className="text-center py-10" style={{ color: '#DDE3EC' }}>
            <Clock size={36} className="mx-auto mb-2" />
            <p className="text-sm" style={{ color: LGRAY }}>No upcoming bookings</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: '#F5F7FA' }}>
                <tr>
                  {['Slot Ref', 'Date & Time', 'Court', 'Match', 'Booked by', 'Payment', 'Deposit Slip', 'Payment Received', 'Status'].map((h, i) => (
                    <th key={i} className={`px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-wide ${h === 'Payment Received' ? 'leading-tight' : 'whitespace-nowrap'}`} style={{ color: LGRAY, width: h === 'Payment Received' ? '72px' : undefined }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(printAll ? upcoming : pageRows).map(b => {
                  const isToday = b.date === today
                  const names = t => team(b, t).map(p => p.name).join(' & ') || '—'
                  const cell = 'px-2.5 py-1.5 whitespace-nowrap'
                  return (
                    // Processing (payment not yet received) rows are highlighted; today's rows get a light blue tint
                    <tr key={b.id} className={`text-xs ${!b.paymentReceived && b.status !== 'cancelled' ? 'row-processing' : ''}`} style={{
                      borderTop: '1px solid #EEF2F7',
                      background: !b.paymentReceived && b.status !== 'cancelled' ? '#FFE8C2' : isToday ? '#EFF6FF' : 'white',
                      boxShadow: !b.paymentReceived && b.status !== 'cancelled' ? 'inset 6px 0 0 #EA580C, inset 0 1px 0 #FDBA74, inset 0 -1px 0 #FDBA74' : 'none',
                    }}>
                      <td className={`${cell} text-[11px] font-bold`} style={{ color: NAVY, fontFamily: 'Consolas, monospace' }}>{b.slotRef}</td>
                      {/* Date · time · hours on one line */}
                      <td className={cell}>
                        <span className="font-semibold" style={{ color: NAVY }}>{format(new Date(b.date + 'T00:00'), 'EEE d MMM')}</span>
                        <span style={{ color: '#4B5563' }}> · {formatSlotRange(b.startHour, b.endHour)}</span>
                        {isToday && <span className="ml-1.5 text-[9px] font-black px-1 py-px rounded" style={{ background: '#F59E0B', color: 'white' }}>TODAY</span>}
                      </td>
                      <td className={cell} style={{ color: '#4B5563' }}>
                        {b.courtName}
                        {b.junior && <span className="ml-1 px-1 rounded text-[9px] font-black" style={{ background: '#047857', color: 'white' }}>U-18</span>}
                      </td>
                      {/* Team 1 vs Team 2 on one line (CM No. on hover) */}
                      <td className="px-2.5 py-1.5" style={{ maxWidth: '165px' }}>
                        <p className="truncate" title={[1, 2].map(t => team(b, t).map(p => `${p.name} ${p.cmNo || ''}`.trim()).join(' & ') || '—').join('  vs  ')}>
                          <span className="font-semibold" style={{ color: NAVY }}>{names(1)}</span>
                          <span className="mx-1 text-[9px] font-black" style={{ color: LGRAY }}>VS</span>
                          <span style={{ color: '#4B5563' }}>{names(2)}</span>
                        </p>
                      </td>
                      <td className={cell} title={b.playerPhone ? `Phone: ${b.playerPhone}` : ''}>
                        <span className="font-semibold" style={{ color: '#4B5563' }}>{b.playerName}</span>
                      </td>
                      <td className={cell} title={b.creditUsed > 0 ? `Rs. ${b.creditUsed.toLocaleString()} paid from advance` : ''}>
                        <span className="font-bold" style={{ color: NAVY }}>{b.payment ? `Rs. ${b.payment.toLocaleString()}` : 'Free'}</span>
                        {b.creditUsed > 0 && <span className="ml-1 text-[9px] font-black px-1 py-px rounded" style={{ background: '#DBEAFE', color: '#1D4ED8' }}>ADV</span>}
                      </td>
                      {/* Slip: View · bank name, reference no. below — shown in full */}
                      <td className="px-2.5 py-1.5" style={{ maxWidth: '175px' }}>
                        <p className="leading-tight">
                          {b.depositSlip ? (
                            <a href={b.depositSlip} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-0.5 font-bold align-middle" style={{ color: '#047857' }}>
                              <Paperclip size={11} /> View
                            </a>
                          ) : <span style={{ color: '#C8D3E0' }}>—</span>}
                          {b.bankName && <span className="text-[11px] font-semibold" style={{ color: '#334155' }}> · {b.bankName}</span>}
                        </p>
                        {b.referenceNo && (
                          <p className="text-[10.5px] leading-tight mt-0.5" style={{ color: '#64748B' }}>
                            Ref: <span className="font-semibold" style={{ fontFamily: 'Consolas, monospace', color: '#334155' }}>{b.referenceNo}</span>
                          </p>
                        )}
                      </td>
                      {/* Payment received (optional): admin ticks it once the payment is checked */}
                      <td className={cell}>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] font-semibold" style={{ color: b.paymentReceived ? '#047857' : '#6B7280' }}
                          title={b.paymentReceived ? `Received${b.paymentReceivedAt ? ' on ' + format(new Date(String(b.paymentReceivedAt).replace(' ', 'T')), 'd MMM, h:mm a') : ''} — click to undo` : 'Tick when the payment has been received'}>
                          <input type="checkbox" checked={b.paymentReceived} disabled={savingPay === b.id} onChange={() => togglePayment(b)}
                            className="w-4 h-4 cursor-pointer" style={{ accentColor: '#047857' }} aria-label="Payment received" />
                          {savingPay === b.id && '…'}
                        </label>
                      </td>
                      {/* Status: Confirmed once the payment is received, otherwise Processing */}
                      <td className={cell}>
                        {(() => {
                          const st = b.status === 'cancelled' ? ['Cancelled', '#FEF2F2', '#DC2626']
                            : b.paymentReceived ? ['Confirmed', '#ECFDF5', '#047857'] : null
                          if (!st) return ( // Processing: solid, so it stands out
                            <span className="badge-pulse inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: '#EA580C', color: 'white', boxShadow: '0 2px 8px rgba(234,88,12,0.45)' }}>
                              <Clock size={10} strokeWidth={3} />Processing
                            </span>
                          )
                          return (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: st[1], color: st[2] }}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: st[2] }} />{st[0]}
                            </span>
                          )
                        })()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {upcoming.length > 0 && (
          <div className="print:hidden flex flex-wrap items-center justify-between gap-3 px-5 py-2.5" style={{ borderTop: `1px solid ${BORDER}`, background: '#FAFBFD' }}>
            <span className="text-xs" style={{ color: LGRAY }}>
              Showing <b style={{ color: NAVY }}>{firstRow + 1}–{firstRow + pageRows.length}</b> of <b style={{ color: NAVY }}>{upcoming.length}</b> · 15 per page
            </span>
            <nav className="flex items-center gap-1" aria-label="Pages">
              <button type="button" onClick={() => setPage(curPage - 1)} disabled={curPage === 1}
                className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-bold"
                style={{ border: `1.5px solid ${BORDER}`, background: 'white', color: NAVY, opacity: curPage === 1 ? 0.4 : 1 }}>
                <ChevronLeft size={14} /> Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === curPage ? 'page' : undefined}
                  className="min-w-8 h-8 px-2 rounded-lg text-xs font-bold"
                  style={n === curPage
                    ? { background: NAVY, color: 'white', border: `1.5px solid ${NAVY}` }
                    : { background: 'white', color: NAVY, border: `1.5px solid ${BORDER}` }}>
                  {n}
                </button>
              ))}
              <button type="button" onClick={() => setPage(curPage + 1)} disabled={curPage === totalPages}
                className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-bold"
                style={{ border: `1.5px solid ${BORDER}`, background: 'white', color: NAVY, opacity: curPage === totalPages ? 0.4 : 1 }}>
                Next <ChevronRight size={14} />
              </button>
            </nav>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 print:hidden">
        {/* Court Usage */}
        <div className="bg-white rounded-xl p-5 shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
          <p className="font-black mb-5" style={{ color: NAVY }}>Court Usage</p>
          <div className="space-y-5">
            {courtUsage.map(c => (
              <div key={c.id} className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                  style={{ background: '#EEF2F7' }}>🎾</div>
                <div className="flex-1">
                  <div className="flex justify-between mb-1.5">
                    <p className="text-sm font-bold" style={{ color: NAVY }}>{c.name}</p>
                    <p className="text-xs" style={{ color: LGRAY }}>{c.count} bookings · {c.hours}h</p>
                  </div>
                  <div className="w-full rounded-full h-2" style={{ background: '#EEF2F7' }}>
                    <div className="h-2 rounded-full transition-all"
                      style={{ width: `${(c.count / maxCount) * 100}%`, background: NAVY }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Today's Schedule */}
      <div className="bg-white rounded-xl p-5 shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
        <p className="font-black mb-5" style={{ color: NAVY }}>Today's Schedule — {format(new Date(), 'd MMM yyyy')}</p>
        {confirmedToday.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: LGRAY }}>No bookings for today</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `2px solid #EEF2F7` }}>
                  {['Court', 'Player', 'Phone', 'Time', 'Duration'].map(h => (
                    <th key={h} className="pb-3 text-left text-xs font-bold uppercase tracking-wide" style={{ color: LGRAY }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {confirmedToday.sort((a, b) => a.startHour - b.startHour).map(b => (
                  <tr key={b.id} style={{ borderBottom: '1px solid #F5F7FA' }}>
                    <td className="py-3 font-bold" style={{ color: NAVY }}>{b.courtName}</td>
                    <td className="py-3" style={{ color: '#4B5563' }}>{b.playerName}</td>
                    <td className="py-3" style={{ color: LGRAY }}>{b.playerPhone}</td>
                    <td className="py-3 font-semibold" style={{ color: NAVY }}>{formatHour(b.startHour)} – {formatHour(b.endHour)}</td>
                    <td className="py-3" style={{ color: LGRAY }}>{b.endHour - b.startHour}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>

      <div className="print:hidden"><CourtCharts bookings={bookings} courts={courts} today={today} /></div>
    </div>
  )
}
