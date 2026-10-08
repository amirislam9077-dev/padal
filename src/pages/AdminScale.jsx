import { useState, useEffect } from 'react'
import { format, addDays, startOfMonth, endOfMonth } from 'date-fns'
import { getCourts, adminSlotsApi } from '../store'
import { CourtCharts } from '../components/BookingCharts'

const NAVY = '#1B2E4B'
const LGRAY = '#94A3B8'

// Period switch: which dates the charts cover
const PERIODS = [
  { key: 'all', label: 'All time' },
  { key: 'month', label: 'This month' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'next30', label: 'Next 30 days' },
]
function periodRange(key) {
  const now = new Date(), d = x => format(x, 'yyyy-MM-dd')
  if (key === 'month') return { from: d(startOfMonth(now)), to: d(endOfMonth(now)) }
  if (key === 'last30') return { from: d(addDays(now, -29)), to: d(now) }
  if (key === 'next30') return { from: d(now), to: d(addDays(now, 29)) }
  return null
}

// Admin: how busy each court is, by date and by time
export default function AdminScale() {
  const [bookings, setBookings] = useState([])
  const [courts] = useState(getCourts)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [period, setPeriod] = useState('all')
  const today = format(new Date(), 'yyyy-MM-dd')

  useEffect(() => {
    let cancelled = false
    adminSlotsApi().then(r => {
      if (cancelled) return
      setLoading(false)
      if (r.error) setLoadError(r.error)
      else setBookings(r.bookings)
    })
    return () => { cancelled = true }
  }, [])

  const range = periodRange(period)
  const shown = bookings.filter(b => !range || (b.date >= range.from && b.date <= range.to))
  const live = shown.filter(b => b.status !== 'cancelled')
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black" style={{ color: NAVY }}>Scale</h1>
          <p className="text-sm mt-0.5" style={{ color: LGRAY }}>
            How busy each court is · {live.length} {live.length === 1 ? 'booking' : 'bookings'} in this period (cancelled not counted)
          </p>
        </div>
        <div className="flex rounded-xl p-1 bg-white" style={{ border: '1px solid #E5E9F0' }} role="radiogroup" aria-label="Period">
          {PERIODS.map(p => (
            <button key={p.key} type="button" role="radio" aria-checked={period === p.key} onClick={() => setPeriod(p.key)}
              className="px-3 h-8 rounded-lg text-xs font-bold whitespace-nowrap"
              style={period === p.key ? { background: NAVY, color: 'white' } : { color: '#64748B' }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {loadError && (
        <p className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FEE2E2' }}>{loadError}</p>
      )}
      {loading ? (
        <p className="text-sm text-center py-16" style={{ color: LGRAY }}>Loading…</p>
      ) : (
        <CourtCharts bookings={shown} courts={courts} today={today} range={range} />
      )}
    </div>
  )
}
