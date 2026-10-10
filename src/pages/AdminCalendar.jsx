import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Paperclip, CalendarDays, Phone } from 'lucide-react'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, isSameMonth } from 'date-fns'
import { getCourts, formatSlotRange, formatHourShort, adminSlotsApi, TIME_SLOTS, KIDS_FREE_FROM, KIDS_FREE_TO } from '../store'

const NAVY = '#1B2E4B'
const INK = '#0F172A'
const DATE_C = '#4F46E5' // date numbers in the month grid (indigo)
const SLOT_C = '#3730A3' // booked-slot count chip (indigo text, soft indigo fill — same family as the dates)
const SLOT_BG = '#EEF2FF'
const SLOT_LINE = '#C7D2FE'
const MUTED = '#64748B'
const FAINT = '#94A3B8'
const LINE = '#E8EDF3'
// One colour per court (by position in the court list)
const COURT_COLORS = ['#4F46E5', '#0D9488', '#D97706', '#DB2777', '#7C3AED']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Time-slot grid for the selected day (same groups as the booking page)
const SLOT_GROUPS = [
  { label: 'Kids time', from: KIDS_FREE_FROM, to: KIDS_FREE_TO, kids: true },
  { label: 'Evening', from: KIDS_FREE_TO, to: 21 },
  { label: 'Night', from: 21, to: 24 },
].filter(g => TIME_SLOTS.some(h => h >= g.from && h < g.to))

// Admin: bookings on a month calendar; click a day to see its agenda
export default function AdminCalendar() {
  const [courts] = useState(getCourts)
  const courtColor = id => COURT_COLORS[Math.max(0, courts.findIndex(c => c.id === id)) % COURT_COLORS.length]
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const todayKey = format(new Date(), 'yyyy-MM-dd')
  const [selected, setSelected] = useState(todayKey)
  const [filterCourt, setFilterCourt] = useState('all')
  const [showCancelled, setShowCancelled] = useState(true)
  // Court shown in the time-slot grid (follows the court filter when one court is picked)
  const [slotCourt, setSlotCourt] = useState(() => getCourts()[0]?.id || '')

  useEffect(() => {
    let cancelled = false
    adminSlotsApi().then(r => {
      if (cancelled) return
      setLoading(false)
      if (r.error) setLoadError(r.error)
      else { setLoadError(''); setBookings(r.bookings) }
    })
    return () => { cancelled = true }
  }, [])

  // Bookings per date (after the filters), each day sorted by start time
  const byDate = {}
  for (const b of bookings) {
    if (filterCourt !== 'all' && b.courtId !== filterCourt) continue
    if (!showCancelled && b.status === 'cancelled') continue
    ;(byDate[b.date] ||= []).push(b)
  }
  for (const list of Object.values(byDate)) list.sort((a, b) => a.startHour - b.startHour || a.courtName.localeCompare(b.courtName))

  // Weeks shown: Sunday before the 1st → Saturday after the last day
  const days = []
  for (let d = startOfWeek(startOfMonth(month)); d <= endOfWeek(endOfMonth(month)); d = addDays(d, 1)) days.push(d)

  // Month summary (current filters)
  const monthList = days.filter(d => isSameMonth(d, month)).flatMap(d => byDate[format(d, 'yyyy-MM-dd')] || [])
  const confirmed = monthList.filter(b => b.status !== 'cancelled')
  const stats = [
    { label: 'Bookings', value: monthList.length },
    { label: 'Confirmed', value: confirmed.length },
    { label: 'Cancelled', value: monthList.length - confirmed.length },
    { label: 'Hours booked', value: confirmed.reduce((n, b) => n + (b.endHour - b.startHour), 0) },
  ]

  function goMonth(delta) {
    const m = addMonths(month, delta)
    setMonth(m)
    setSelected(isSameMonth(new Date(), m) ? todayKey : format(m, 'yyyy-MM-dd'))
  }
  function goToday() {
    setMonth(startOfMonth(new Date()))
    setSelected(todayKey)
  }
  // Clicking a grey day from the previous / next month also moves to that month
  function pickDay(d) {
    setSelected(format(d, 'yyyy-MM-dd'))
    if (!isSameMonth(d, month)) setMonth(startOfMonth(d))
  }

  const dayList = byDate[selected] || []
  // Which hours of the selected day are taken on the chosen court (confirmed bookings only)
  const gridCourt = filterCourt !== 'all' ? filterCourt : slotCourt
  const takenBy = h => bookings.find(b => b.date === selected && b.courtId === gridCourt && b.status !== 'cancelled'
    && h >= b.startHour && h < b.endHour)
  const freeCount = TIME_SLOTS.filter(h => !takenBy(h)).length
  const selDate = new Date(selected + 'T00:00')
  const team = (b, t) => (b.players || []).filter(p => p.team === t).map(p => p.name).join(' & ')

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100vh-121px)]">
      {/* ── Header: title + month summary, month navigation, filters ── */}
      <div className="bg-white rounded-2xl" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <div className="mr-auto">
            <h1 className="text-lg font-black leading-tight" style={{ color: INK }}>Calendar Bookings</h1>
            <p className="text-xs" style={{ color: MUTED }}>
              {stats.map((s, i) => <span key={s.label}>{i > 0 && ' · '}<b style={{ color: INK }}>{s.value}</b> {s.label.toLowerCase()}</span>)}
            </p>
          </div>

          {/* Month switcher */}
          <div className="flex items-center rounded-xl p-1" style={{ background: '#F1F5F9' }}>
            <button type="button" onClick={() => goMonth(-1)} aria-label="Previous month"
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white" style={{ color: NAVY }}><ChevronLeft size={16} /></button>
            <span className="px-3 text-sm font-black text-center" style={{ color: INK, minWidth: '128px' }}>{format(month, 'MMMM yyyy')}</span>
            <button type="button" onClick={() => goMonth(1)} aria-label="Next month"
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white" style={{ color: NAVY }}><ChevronRight size={16} /></button>
          </div>
          <button type="button" onClick={goToday}
            className="h-10 px-4 rounded-xl text-sm font-bold" style={{ border: `1px solid ${LINE}`, color: NAVY, background: 'white' }}>
            Today
          </button>

          {/* Court switch */}
          <div className="flex items-center rounded-xl p-1 gap-1" style={{ background: '#F1F5F9' }} role="radiogroup" aria-label="Court">
            {[{ id: 'all', name: 'All courts' }, ...courts].map(c => {
              const on = filterCourt === c.id
              return (
                <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => setFilterCourt(c.id)}
                  className="h-8 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5"
                  style={on ? { background: 'white', color: INK, boxShadow: '0 1px 3px rgba(15,23,42,0.12)' } : { color: MUTED }}>
                  {c.id !== 'all' && <span className="w-2 h-2 rounded-full" style={{ background: courtColor(c.id) }} />}
                  {c.name}
                </button>
              )
            })}
          </div>

          {/* Show cancelled toggle */}
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer select-none" style={{ color: MUTED }}>
            <span className="relative inline-block w-9 h-5 rounded-full transition" style={{ background: showCancelled ? NAVY : '#CBD5E1' }}>
              <input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} className="sr-only" />
              <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: showCancelled ? '18px' : '2px', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
            </span>
            Show cancelled
          </label>
        </div>

      </div>

      {loadError && (
        <p className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FEE2E2' }}>{loadError}</p>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_290px]">
        <div className="flex flex-col gap-3 min-h-0 min-w-0">
        {/* ── Time slots of the selected day (same look as the booking page) ── */}
        <div className="rounded-2xl px-4 py-3 shrink-0" style={{ background: `linear-gradient(135deg, ${NAVY} 0%, #2B4A75 100%)`, boxShadow: '0 6px 18px rgba(27,46,75,0.28)' }}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-white">Select time</span>
            <span className="text-[11px] font-semibold" style={{ color: '#B8C7DC' }}>· {format(selDate, 'EEE d MMM')} · open {formatHourShort(TIME_SLOTS[0])} – {formatHourShort(TIME_SLOTS[TIME_SLOTS.length - 1] + 1)} · <b className="text-white">{freeCount}</b> of {TIME_SLOTS.length} free</span>
            <span className="ml-auto flex items-center gap-3 text-[11px] font-semibold" style={{ color: '#B8C7DC' }}>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: '#F87171' }} />Booked</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: '#CBD5E1' }} />Available</span>
              {filterCourt === 'all' ? (
                <span className="flex rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.12)' }} role="radiogroup" aria-label="Court for time slots">
                  {courts.map(c => (
                    <button key={c.id} type="button" role="radio" aria-checked={gridCourt === c.id} onClick={() => setSlotCourt(c.id)}
                      className="px-2 h-6 rounded-md text-[11px] font-bold flex items-center gap-1 whitespace-nowrap"
                      style={gridCourt === c.id ? { background: 'white', color: INK, boxShadow: '0 1px 2px rgba(15,23,42,0.2)' } : { color: '#D5DFEC' }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: gridCourt === c.id ? courtColor(c.id) : '#D5DFEC' }} />{c.name}
                    </button>
                  ))}
                </span>
              ) : (
                <span className="font-bold px-2 py-0.5 rounded-md bg-white" style={{ color: courtColor(filterCourt) }}>{courts.find(c => c.id === filterCourt)?.name}</span>
              )}
            </span>
          </div>
          {/* One row: group names on top, all opening hours below (columns share the width) */}
          <div className="slot-scroll overflow-x-auto pt-1.5 -mt-1.5">
          <div className="grid gap-x-1.5 gap-y-1 min-w-[600px]" style={{ gridTemplateColumns: `repeat(${TIME_SLOTS.length}, minmax(0, 1fr))` }}>
            {SLOT_GROUPS.map((g, gi) => (
              <p key={g.label} className="text-[11px] font-semibold truncate" title={g.kids ? 'Kids time · 3pm–6pm free for under-18s' : g.label}
                style={{ gridColumn: `span ${TIME_SLOTS.filter(h => h >= g.from && h < g.to).length}`, color: g.kids ? '#6EE7B7' : '#B8C7DC', paddingLeft: gi ? '6px' : 0 }}>
                {g.label}{g.kids && ' · free for under-18s'}
              </p>
            ))}
            {SLOT_GROUPS.map((g, gi) => TIME_SLOTS.filter(h => h >= g.from && h < g.to).map((h, i) => {
              const by = takenBy(h)
              return (
                <span key={h} title={by ? `Booked · ${by.playerName} · ${by.slotRef}` : 'Available'}
                  className="relative h-8 px-1 rounded-lg flex items-center justify-center text-[11.5px] font-semibold whitespace-nowrap"
                  style={{
                    marginLeft: gi && i === 0 ? '6px' : 0, // small gap between the groups
                    ...(by
                      ? { background: '#FEE2E2', color: '#DC2626', border: '1.5px solid #FCA5A5', textDecoration: 'line-through' }
                      : { background: 'white', color: '#334155', border: '1.5px solid #DDE3EC' }),
                  }}>
                  {formatSlotRange(h, h + 1)}
                  {g.kids && !by && (
                    <span className="absolute -top-1.5 right-1 px-1 rounded text-[8px] font-black leading-tight"
                      style={{ background: '#047857', color: 'white', textDecoration: 'none' }}>U18 FREE</span>
                  )}
                </span>
              )
            }))}
          </div>
          </div>
        </div>

        {/* ── Month grid ── */}
        <div className="flex-1 bg-white rounded-2xl overflow-hidden flex flex-col min-h-0" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}>
          <div className="grid grid-cols-7 shrink-0" style={{ borderBottom: `1px solid ${LINE}` }}>
            {WEEKDAYS.map(d => (
              <div key={d} className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: FAINT }}>{d}</div>
            ))}
          </div>
          <div className="flex-1 min-h-0 grid grid-cols-7 lg:[grid-auto-rows:minmax(0,1fr)]">
            {days.map((d, i) => {
              const key = format(d, 'yyyy-MM-dd')
              const list = byDate[key] || []
              const inMonth = isSameMonth(d, month)
              const isSel = key === selected
              const isToday = key === todayKey
              const weekend = d.getDay() === 0 || d.getDay() === 6
              return (
                <button key={key} type="button" onClick={() => pickDay(d)} aria-pressed={isSel}
                  aria-label={`${format(d, 'EEEE d MMMM')}: ${list.length} bookings`}
                  className="cal-day relative text-left px-1.5 pt-1 pb-1.5 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-1 min-h-[84px] lg:min-h-0 overflow-hidden focus:outline-none"
                  style={{
                    borderRight: (i + 1) % 7 ? `1px solid ${LINE}` : 'none',
                    borderBottom: i < days.length - 7 ? `1px solid ${LINE}` : 'none',
                    background: isSel ? '#F5F7FF' : !inMonth ? '#FBFCFD' : weekend ? '#FCFDFE' : 'white',
                  }}>
                  {isSel && <span className="absolute inset-0 pointer-events-none" style={{ boxShadow: `inset 0 0 0 2px ${NAVY}` }} />}
                  <span className="flex items-center justify-between shrink-0">
                    <span className="text-xs font-bold w-[22px] h-[22px] rounded-full flex items-center justify-center"
                      style={isToday ? { background: DATE_C, color: 'white' } : { color: inMonth ? DATE_C : '#CBD5E1' }}>
                      {format(d, 'd')}
                    </span>
                  </span>
                  {/* Only the number of booked slots in the box; full details in the day panel */}
                  {(() => {
                    const booked = list.filter(b => b.status !== 'cancelled').length
                    const cancelled = list.length - booked
                    if (!list.length) return null
                    return (
                      // Small chips: bottom of the box on phones/tablets, beside the date on laptops (short rows)
                      <span className="mt-auto lg:mt-[2px] flex flex-wrap lg:flex-nowrap items-center lg:justify-end gap-1 min-w-0" style={{ opacity: inMonth ? 1 : 0.5 }}>
                        {booked > 0 && (
                          <span className="inline-flex items-center gap-1 h-[18px] rounded-md px-1.5 text-[11px] font-semibold leading-none whitespace-nowrap"
                            style={{ background: SLOT_BG, color: SLOT_C, border: `1px solid ${SLOT_LINE}` }}>
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: DATE_C }} />
                            <span className="font-bold">{booked}</span>
                            {/* Phones: number only, the word doesn't fit the narrow box */}
                            <span className="hidden sm:inline">{booked === 1 ? 'slot' : 'slots'}</span>
                          </span>
                        )}
                        {cancelled > 0 && (
                          <span className="inline-flex items-center h-[18px] rounded-md px-1.5 text-[10px] font-semibold leading-none whitespace-nowrap"
                            style={{ background: '#F8FAFC', color: FAINT, border: `1px solid ${LINE}` }}>
                            {cancelled}<span className="hidden sm:inline">&nbsp;cancelled</span>
                          </span>
                        )}
                      </span>
                    )
                  })()}
                </button>
              )
            })}
          </div>
        </div>

        </div>{/* calendar column */}

        {/* ── Selected day agenda ── */}
        <div className="bg-white rounded-2xl overflow-hidden flex flex-col min-h-0" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}>
          <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${LINE}` }}>
            <div className="w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0" style={{ background: NAVY, color: 'white' }}>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#9EB0C5' }}>{format(selDate, 'MMM')}</span>
              <span className="text-xl font-black leading-none">{format(selDate, 'd')}</span>
            </div>
            <div className="min-w-0">
              <p className="font-black" style={{ color: INK }}>{format(selDate, 'EEEE')}</p>
              <p className="text-xs" style={{ color: MUTED }}>{format(selDate, 'd MMMM yyyy')} · {dayList.length} {dayList.length === 1 ? 'booking' : 'bookings'}</p>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-center py-10" style={{ color: FAINT }}>Loading…</p>
          ) : dayList.length === 0 ? (
            <div className="text-center py-12 px-6">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: '#F1F5F9' }}>
                <CalendarDays size={22} style={{ color: FAINT }} />
              </div>
              <p className="text-sm font-bold" style={{ color: INK }}>No bookings</p>
              <p className="text-xs mt-0.5" style={{ color: MUTED }}>Nothing is booked on this day{filterCourt !== 'all' ? ' for this court' : ''}.</p>
            </div>
          ) : (
            <ul className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
              {dayList.map(b => {
                const off = b.status === 'cancelled'
                const c = courtColor(b.courtId)
                const t1 = team(b, 1) || b.playerName || '—', t2 = team(b, 2)
                return (
                  <li key={b.id} className="rounded-xl px-3 py-2.5" style={{ background: off ? '#FAFAFB' : 'white', border: `1px solid ${LINE}`, borderLeft: `4px solid ${off ? '#CBD5E1' : c}` }}>
                    {/* Time · hours · court ……… status */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-black" style={{ color: off ? FAINT : INK, textDecoration: off ? 'line-through' : 'none' }}>{formatSlotRange(b.startHour, b.endHour)}</span>
                      <span className="text-[11px]" style={{ color: FAINT }}>{b.endHour - b.startHour}h</span>
                      <span className="text-[10px] font-bold px-1.5 py-px rounded" style={{ background: `${c}14`, color: c }}>{b.courtName}</span>
                      {b.junior && <span className="text-[10px] font-bold px-1.5 py-px rounded" style={{ background: '#ECFDF5', color: '#047857' }}>U-18</span>}
                      <span className="ml-auto flex items-center gap-1 text-[10px] font-bold" style={{ color: off ? '#DC2626' : b.paymentReceived ? '#047857' : '#B45309' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: off ? '#DC2626' : b.paymentReceived ? '#10B981' : '#F59E0B' }} />{off ? 'Cancelled' : b.paymentReceived ? 'Confirmed' : 'Processing'}
                      </span>
                    </div>
                    {/* Teams on one line */}
                    <p className="text-xs mt-1 truncate" style={{ color: off ? FAINT : '#334155' }} title={t2 ? `${t1} vs ${t2}` : t1}>
                      <span className="font-semibold">{t1}</span>
                      {t2 && <><span className="mx-1 text-[10px] font-black" style={{ color: FAINT }}>VS</span><span className="font-semibold">{t2}</span></>}
                    </p>
                    {/* Ref · phone · slip */}
                    <div className="flex items-center gap-2 mt-1 text-[10.5px]" style={{ color: FAINT }}>
                      <span style={{ fontFamily: 'Consolas, monospace' }}>{b.slotRef}</span>
                      {b.playerPhone && <span className="flex items-center gap-0.5 truncate"><Phone size={10} />{b.playerPhone}</span>}
                      {b.depositSlip && (
                        <a href={b.depositSlip} target="_blank" rel="noreferrer" title="Open deposit slip"
                          className="link ml-auto shrink-0 inline-flex items-center gap-0.5 font-bold" style={{ color: NAVY }}>
                          <Paperclip size={10} /> Slip
                        </a>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

    </div>
  )
}
