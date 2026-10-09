import { useState } from 'react'
import { formatHourShort, formatSlotRange, OPEN_HOUR, CLOSE_HOUR } from '../store'
import { format, addDays, parseISO } from 'date-fns'
import { CalendarDays, Clock, Gauge, Flame, Hash } from 'lucide-react'

const INK = '#0F172A'
const MUTED = '#64748B'
const FAINT = '#94A3B8'
const LINE = '#E5E9F0'

// One colour per court (validated: distinct for colour-blind viewers, >= 3:1 on white)
const COURT_COLORS = ['#4F46E5', '#0D9488', '#D97706', '#DB2777']
const OPEN_HOURS_PER_DAY = CLOSE_HOUR - OPEN_HOUR

// Chart data, split by court (cancelled left out). Dates run over `range` if given, else first → last booking.
function buildSeries(bookings, courts, today, range) {
  const live = bookings.filter(b => b.status !== 'cancelled')
  const keys = live.map(b => b.date).sort()
  const from = range?.from || keys[0], to = range?.to || keys[keys.length - 1]
  const dateSeries = []
  if (from && to) {
    for (let d = parseISO(from), end = parseISO(to); d <= end; d = addDays(d, 1)) {
      const key = format(d, 'yyyy-MM-dd')
      const list = live.filter(b => b.date === key)
      dateSeries.push({ key, parts: courts.map(c => list.filter(b => b.courtId === c.id).length),
        hours: courts.map(c => list.filter(b => b.courtId === c.id).reduce((n, b) => n + b.endHour - b.startHour, 0)),
        label: format(d, 'EEE d MMM'), short: format(d, 'd MMM'), today: key === today })
    }
  }
  const hFrom = Math.min(OPEN_HOUR, ...live.map(b => b.startHour)), hTo = Math.max(CLOSE_HOUR, ...live.map(b => b.endHour))
  const timeSeries = live.length || from ? Array.from({ length: hTo - hFrom }, (_, i) => {
    const h = hFrom + i
    const inHour = live.filter(b => h >= b.startHour && h < b.endHour)
    return { key: String(h), parts: courts.map(c => inHour.filter(b => b.courtId === c.id).length),
      label: formatSlotRange(h, h + 1), short: formatHourShort(h) }
  }) : []
  return { dateSeries, timeSeries }
}

// One card per court: key figures, then "By date" and "By time" (same scale for every court, so they compare)
export function CourtCharts({ bookings, courts, today, range }) {
  const { dateSeries, timeSeries } = buildSeries(bookings, courts, today, range)
  const dateMax = Math.max(1, ...dateSeries.flatMap(d => d.parts))
  const timeMax = Math.max(1, ...timeSeries.flatMap(d => d.parts))
  return (
    <div className="space-y-5">
      {courts.map((c, i) => {
        const color = COURT_COLORS[i % COURT_COLORS.length]
        const byDate = dateSeries.map(d => ({ ...d, value: d.parts[i] }))
        const byTime = timeSeries.map(d => ({ ...d, value: d.parts[i] }))
        const total = byDate.reduce((n, d) => n + d.value, 0)
        const hours = dateSeries.reduce((n, d) => n + d.hours[i], 0)
        const util = dateSeries.length ? Math.round((hours / (dateSeries.length * OPEN_HOURS_PER_DAY)) * 100) : 0
        const peakDay = total ? byDate.reduce((a, d) => (d.value > a.value ? d : a)) : null
        const peakHour = byTime.some(d => d.value) ? byTime.reduce((a, d) => (d.value > a.value ? d : a)) : null
        const kpis = [
          { icon: Hash, label: 'Bookings', value: total },
          { icon: Clock, label: 'Hours booked', value: `${hours} h` },
          { icon: Gauge, label: 'Utilisation', value: `${util}%`, bar: util, hint: `${hours} of ${dateSeries.length * OPEN_HOURS_PER_DAY} open hours (${OPEN_HOURS_PER_DAY} h × ${dateSeries.length} days)` },
          { icon: CalendarDays, label: 'Peak day', value: peakDay ? peakDay.label : '—', sub: peakDay ? `${peakDay.value} ${peakDay.value === 1 ? 'slot' : 'slots'}` : '' },
          { icon: Flame, label: 'Peak hour', value: peakHour ? peakHour.label : '—', sub: peakHour ? `${peakHour.value} ${peakHour.value === 1 ? 'slot' : 'slots'}` : '' },
        ]
        return (
          <section key={c.id} className="bg-white rounded-2xl overflow-hidden" style={{ border: `1px solid ${LINE}`, boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}>
            {/* Court header + key figures */}
            <div className="flex flex-col sm:flex-row items-stretch" style={{ borderBottom: `1px solid ${LINE}` }}>
              <div className="flex items-center gap-3 px-5 py-3 sm:min-w-[150px]" style={{ borderLeft: `5px solid ${color}` }}>
                <div>
                  <p className="text-lg font-black leading-tight" style={{ color: INK }}>{c.name}</p>
                  <p className="text-[11px]" style={{ color: MUTED }}>{dateSeries.length ? `${dateSeries[0].short} – ${dateSeries[dateSeries.length - 1].short}` : 'No data'}</p>
                </div>
              </div>
              <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-5 kpi-grid">
                {kpis.map(k => (
                  <div key={k.label} className="px-4 py-3 min-w-0" style={{ borderLeft: `1px solid ${LINE}` }} title={k.hint}>
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: FAINT }}>
                      <k.icon size={11} strokeWidth={2.5} /> {k.label}
                    </p>
                    <p className="text-base font-black truncate mt-0.5" style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{k.value}</p>
                    {k.bar != null ? (
                      <div className="h-1 rounded-full mt-1 overflow-hidden" style={{ background: '#EEF2F7' }}>
                        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, k.bar)}%`, background: color }} />
                      </div>
                    ) : k.sub ? <p className="text-[10px]" style={{ color: MUTED }}>{k.sub}</p> : null}
                  </div>
                ))}
              </div>
            </div>
            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2">
              <MiniBars title="By date" data={byDate} color={color} scaleMax={dateMax} labelEvery={Math.max(1, Math.ceil(byDate.length / 9))} />
              <div className="min-w-0 border-t lg:border-t-0 lg:border-l" style={{ borderColor: LINE }}>
                <MiniBars title="By time" data={byTime} color={color} scaleMax={timeMax} labelEvery={1} />
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

// Column chart for one court: count on each bar, busiest bar in full colour + "Peak", empty slots as dots
function MiniBars({ title, data, color, scaleMax, labelEvery }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(0, ...data.map(d => d.value))
  const top = Math.max(2, Math.ceil((scaleMax + 1) / 2) * 2) // headroom for the count; shared across courts
  const pct = v => (v / top) * 100
  const H = 150
  const slots = n => `${n} ${n === 1 ? 'slot' : 'slots'}`
  return (
    <div className="px-4 sm:px-5 pt-4 pb-3 min-w-0">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-black" style={{ color: INK }}>{title}</p>
        <p className="text-[11px]" style={{ color: MUTED }}>slots booked</p>
      </div>
      <div className="flex gap-2">
        {/* y axis */}
        <div className="relative shrink-0 text-[10px] text-right" style={{ height: H, width: 14, color: FAINT }}>
          {[top, top / 2, 0].map((t, i) => (
            <span key={t} className="absolute right-0 leading-none" style={{ top: `${i * 50}%`, transform: 'translateY(-50%)' }}>{t}</span>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="relative" style={{ height: H }}>
            {[0, 0.5].map(p => <div key={p} className="absolute left-0 right-0" style={{ top: `${p * 100}%`, borderTop: '1px dashed #EEF2F7' }} />)}
            <div className="absolute left-0 right-0 bottom-0" style={{ borderTop: '1px solid #CBD5E1' }} />
            <div className="absolute inset-0 flex items-end" style={{ gap: '3px' }}>
              {data.map((d, idx) => {
                const on = hover === d.key
                const peak = d.value > 0 && d.value === max
                const tall = pct(d.value) > 45
                const tip = !tall
                  ? { left: '50%', transform: 'translateX(-50%)', bottom: `calc(${Math.max(4, pct(d.value))}% + 18px)` }
                  : idx > data.length / 2 ? { right: 'calc(100% + 6px)', bottom: `calc(${pct(d.value)}% - 30px)` }
                    : { left: 'calc(100% + 6px)', bottom: `calc(${pct(d.value)}% - 30px)` }
                return (
                  <div key={d.key} className="relative flex-1 h-full flex flex-col justify-end items-center"
                    onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)} aria-label={`${d.label}: ${slots(d.value)}`}>
                    {d.value > 0 ? (
                      <>
                        {peak && <span className="text-[9px] font-black uppercase tracking-wide leading-none mb-0.5" style={{ color }}>Peak</span>}
                        <span className="text-[10px] font-bold leading-none mb-1" style={{ color: peak ? INK : MUTED, fontVariantNumeric: 'tabular-nums' }}>{d.value}</span>
                        <div className="w-full" style={{
                          height: `${pct(d.value)}%`, maxWidth: 34, borderRadius: '5px 5px 1px 1px',
                          background: color, opacity: peak ? 1 : on ? 0.85 : 0.45, transition: 'opacity .12s',
                        }} />
                      </>
                    ) : (
                      <span className="mb-[-2px] w-1 h-1 rounded-full" style={{ background: on ? MUTED : '#CBD5E1' }} />
                    )}
                    {d.today && <span className="absolute -bottom-3 w-1.5 h-1.5 rounded-full" style={{ background: '#F59E0B' }} title="Today" />}
                    {on && (
                      <div className="absolute z-10 px-2.5 py-1.5 rounded-lg text-[11px] whitespace-nowrap pointer-events-none"
                        style={{ ...tip, background: INK, color: 'white', boxShadow: '0 6px 16px rgba(15,23,42,0.25)' }}>
                        <b>{d.label}</b>{d.today ? ' · today' : ''}<br />{slots(d.value)}{peak ? ' · peak' : ''}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {/* x labels */}
          <div className="flex mt-2" style={{ gap: '3px' }}>
            {data.map((d, i) => (
              <span key={d.key} className="flex-1 min-w-0 text-center text-[10px] whitespace-nowrap"
                style={{ color: FAINT, visibility: i % labelEvery === 0 ? 'visible' : 'hidden' }}>{d.short}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
