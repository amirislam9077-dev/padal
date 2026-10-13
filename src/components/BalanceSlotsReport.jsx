import { useState, useEffect } from 'react'
import { X, BarChart3, Printer, CalendarCheck, CircleSlash, Layers } from 'lucide-react'
import { format, addDays } from 'date-fns'
import { TIME_SLOTS, KIDS_FREE_FROM, KIDS_FREE_TO, formatSlotRange, slotAvailabilityApi } from '../store'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const GREEN = '#047857'
const RANGES = [[7, 'Next 7 days'], [14, 'Next 14 days'], [30, 'Next 30 days']]

// "Balance Booking Slots": the free (not booked) one-hour slots on every court for the coming days.
// Today's hours that have already passed are left out. onPick (booking page only): a day + court to jump to.
export default function BalanceSlotsReport({ courts, onClose, onPick }) {
  const [days, setDays] = useState(7)
  const [booked, setBooked] = useState(null)
  const [error, setError] = useState('')

  const today = new Date()
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i))
  const from = format(dates[0], 'yyyy-MM-dd'), to = format(dates[dates.length - 1], 'yyyy-MM-dd')

  useEffect(() => {
    let cancelled = false
    slotAvailabilityApi(from, to).then(r => {
      if (cancelled) return
      if (r.error) { setError(r.error); setBooked([]) } else { setError(''); setBooked(r.booked) }
    })
    return () => { cancelled = true }
  }, [from, to])

  const nowHour = today.getHours()
  const todayKey = format(today, 'yyyy-MM-dd')
  // For each day and court: the free hours (not booked, and not already past today)
  const rows = dates.map(d => {
    const key = format(d, 'yyyy-MM-dd')
    const perCourt = courts.map(c => {
      const taken = (booked || []).filter(b => b.date === key && b.courtId === c.id)
      const open = TIME_SLOTS.filter(h => key !== todayKey || h > nowHour)
      const free = open.filter(h => !taken.some(b => h >= b.startHour && h < b.endHour))
      return { court: c, open: open.length, free }
    })
    return { key, d, perCourt }
  })
  const totalOpen = rows.reduce((s, r) => s + r.perCourt.reduce((t, c) => t + c.open, 0), 0)
  const totalFree = rows.reduce((s, r) => s + r.perCourt.reduce((t, c) => t + c.free.length, 0), 0)
  const loading = booked === null

  // Print / PDF: the report on its own page
  function print() {
    const esc = s => String(s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))
    const body = rows.map(r => `<tr><td><b>${esc(format(r.d, 'EEE d MMM yyyy'))}</b></td>${r.perCourt.map(c =>
      `<td><b>${c.free.length}</b> / ${c.open} free<br><small>${c.free.length ? c.free.map(h => esc(formatSlotRange(h, h + 1))).join(', ') : 'Fully booked'}</small></td>`).join('')}</tr>`).join('')
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Balance Booking Slots</title><style>
      body{font-family:'Red Hat Display','Segoe UI',sans-serif;color:#1B2E4B;margin:24px}h1{margin:0 0 4px;font-size:20px}
      p{margin:0 0 14px;color:#475569;font-size:12px}table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #DDE3EC;padding:6px 8px;text-align:left;vertical-align:top}th{background:#F5F7FA}small{color:#475569}
      @page{size:A4 landscape;margin:10mm}</style></head><body>
      <h1>North Nazimabad Gymkhana Trust — Balance Booking Slots</h1>
      <p>${esc(format(dates[0], 'd MMM yyyy'))} – ${esc(format(dates[dates.length - 1], 'd MMM yyyy'))} · ${totalFree} of ${totalOpen} one-hour slots free · printed ${esc(format(new Date(), 'd MMM yyyy, h:mm a'))}</p>
      <table><thead><tr><th>Date</th>${courts.map(c => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
      <script>window.onload=function(){window.print()}</script></body></html>`)
    w.document.close()
  }

  const cards = [
    { icon: Layers, label: 'Total slots', value: totalOpen, color: NAVY, bg: '#EFF6FF' },
    { icon: CircleSlash, label: 'Booked', value: totalOpen - totalFree, color: '#DC2626', bg: '#FEF2F2' },
    { icon: CalendarCheck, label: 'Balance (free)', value: totalFree, color: GREEN, bg: '#ECFDF5' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" style={{ background: 'rgba(15,23,42,0.55)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col" style={{ border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 shrink-0" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="min-w-0">
            <p className="font-black text-base sm:text-lg flex items-center gap-2" style={{ color: NAVY }}><BarChart3 size={18} /> Balance Booking Slots</p>
            <p className="text-xs" style={{ color: LGRAY }}>Free one-hour slots (3pm–12am) still left to book</p>
          </div>
          <button type="button" onClick={onClose} title="Close" className="shrink-0" style={{ color: LGRAY }}><X size={20} /></button>
        </div>

        <div className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-2 shrink-0" style={{ borderBottom: `1px solid ${BORDER}` }}>
          {RANGES.map(([n, label]) => (
            <button key={n} type="button" onClick={() => setDays(n)} className="h-8 px-3 rounded-lg text-xs font-bold"
              style={days === n ? { background: NAVY, color: 'white' } : { color: '#475569', border: `1.5px solid ${BORDER}` }}>{label}</button>
          ))}
          <button type="button" onClick={print} disabled={loading} className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold"
            style={{ color: NAVY, border: `1.5px solid ${BORDER}`, opacity: loading ? 0.4 : 1 }}><Printer size={13} /> Print / PDF</button>
        </div>

        <div className="overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {cards.map(({ icon: Icon, label, value, color, bg }) => (
              <div key={label} className="rounded-xl p-3" style={{ background: bg }}>
                <p className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color }}><Icon size={13} /> {label}</p>
                <p className="text-xl sm:text-2xl font-black mt-0.5" style={{ color }}>{loading ? '…' : value}</p>
              </div>
            ))}
          </div>
          {error && <p className="text-sm px-3 py-2 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</p>}

          {!loading && rows.map(r => (
            <div key={r.key} className="rounded-xl" style={{ border: `1px solid ${BORDER}` }}>
              <p className="px-3 py-2 text-sm font-black flex items-center justify-between" style={{ color: NAVY, background: '#F8FAFC', borderBottom: `1px solid ${BORDER}`, borderRadius: '12px 12px 0 0' }}>
                <span>{format(r.d, 'EEE d MMM')}{r.key === todayKey && <span className="ml-2 text-[10px] font-black px-1.5 py-0.5 rounded" style={{ background: '#F59E0B', color: 'white' }}>TODAY</span>}</span>
                <span className="text-xs font-bold" style={{ color: GREEN }}>{r.perCourt.reduce((s, c) => s + c.free.length, 0)} free</span>
              </p>
              <div className="grid sm:grid-cols-2">
                {r.perCourt.map((c, i) => (
                  <div key={c.court.id} className="px-3 py-2.5" style={i ? { borderTop: `1px solid ${BORDER}` } : undefined}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold" style={{ color: NAVY }}>{c.court.name}</span>
                      <span className="text-[11px] font-bold" style={{ color: c.free.length ? GREEN : '#DC2626' }}>
                        {c.free.length ? `${c.free.length} / ${c.open} free` : c.open ? 'Fully booked' : 'Closed for today'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {c.free.map(h => {
                        const kids = h >= KIDS_FREE_FROM && h < KIDS_FREE_TO
                        return (
                          <button key={h} type="button" disabled={!onPick} onClick={() => onPick?.(r.key, c.court.id)} title={onPick ? `Book ${c.court.name} on ${format(r.d, 'EEE d MMM')}` : formatSlotRange(h, h + 1)}
                            className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md"
                            style={kids ? { background: '#ECFDF5', color: GREEN, border: '1px solid #A7F3D0' } : { background: 'white', color: '#334155', border: `1px solid ${BORDER}` }}>
                            {formatSlotRange(h, h + 1)}{kids && <span className="ml-0.5 text-[8px] font-black">U18</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {loading && <p className="text-sm text-center py-6" style={{ color: LGRAY }}>Loading…</p>}
        </div>
        <p className="px-4 sm:px-5 py-2 text-[11px] shrink-0" style={{ color: LGRAY, borderTop: `1px solid ${BORDER}` }}>
          {onPick && 'Tap a time to open that day and court for booking. '}Green <b style={{ color: GREEN }}>U18</b> times (3pm–6pm) are for under-18 members only.
        </p>
      </div>
    </div>
  )
}
