import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, Wallet, Receipt, Printer, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { adminPnlApi } from '../store'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const GREEN = '#047857'
const RED = '#DC2626'

const rs = n => `${n < 0 ? '− ' : ''}Rs. ${Math.abs(Math.round(Number(n) || 0)).toLocaleString()}`
const monthName = m => format(new Date(`${m}-01T00:00`), 'MMMM yyyy')
const ymd = d => format(d, 'yyyy-MM-dd')
const filterInput = { border: `1.5px solid ${BORDER}`, borderRadius: '8px', height: '32px', padding: '0 8px', fontSize: '12px', outline: 'none', color: NAVY, background: 'white' }

// Quick ranges for the date filter
function presets() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth()
  return [
    ['This month', ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))],
    ['Last month', ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))],
    ['Last 3 months', ymd(new Date(y, m - 2, 1)), ymd(new Date(y, m + 1, 0))],
    ['This year', `${y}-01-01`, `${y}-12-31`],
  ]
}

function Breakdown({ title, rows, color, empty, total }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden break-inside-avoid" style={{ border: `1px solid ${BORDER}` }}>
      <p className="px-4 py-2.5 font-black text-sm" style={{ color: NAVY, borderBottom: `1px solid ${BORDER}` }}>{title}</p>
      <div className="p-4 space-y-2.5">
        {rows.length ? rows.map(r => (
          <div key={r.name}>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-semibold" style={{ color: '#334155' }}>{r.name}</span>
              <span className="font-black" style={{ color }}>{rs(r.total)} <span className="font-semibold" style={{ color: LGRAY }}>· {total ? Math.round(r.total / total * 100) : 0}%</span></span>
            </div>
            <div className="h-2 rounded-full" style={{ background: '#F1F5F9' }}>
              <div className="h-2 rounded-full" style={{ width: `${total ? r.total / total * 100 : 0}%`, background: color }} />
            </div>
          </div>
        )) : <p className="text-sm text-center py-3" style={{ color: LGRAY }}>{empty}</p>}
      </div>
    </div>
  )
}

// Profit & Loss: income from bookings (payment received) minus expense vouchers, month by month
export default function AdminProfitLoss() {
  const [range, setRange] = useState(() => { const p = presets()[3]; return { from: p[1], to: p[2] } })
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!range.from || !range.to || range.from > range.to) return
    let cancelled = false
    adminPnlApi(range.from, range.to).then(r => {
      if (cancelled) return
      if (r.error) { setError(r.error); setData(null) } else { setError(''); setData(r) }
    })
    return () => { cancelled = true }
  }, [range])

  const months = data?.months || []
  const income = months.reduce((s, m) => s + m.income, 0)
  const expenses = months.reduce((s, m) => s + m.expenses, 0)
  const profit = income - expenses
  const rangeText = `${format(new Date(`${range.from}T00:00`), 'd MMM yyyy')} – ${format(new Date(`${range.to}T00:00`), 'd MMM yyyy')}`

  const cards = [
    { icon: TrendingUp, label: 'Income', value: rs(income), sub: `${months.reduce((s, m) => s + m.bookings, 0)} paid bookings`, color: GREEN, bg: '#ECFDF5' },
    { icon: Receipt, label: 'Expenses', value: rs(expenses), sub: `${months.reduce((s, m) => s + m.vouchers, 0)} vouchers`, color: RED, bg: '#FEF2F2' },
    { icon: profit >= 0 ? Wallet : TrendingDown, label: profit >= 0 ? 'Net Profit' : 'Net Loss', value: rs(profit),
      sub: income ? `${Math.round(profit / income * 100)}% of income` : '—', color: profit >= 0 ? NAVY : RED, bg: profit >= 0 ? '#EFF6FF' : '#FEF2F2' },
  ]

  return (
    <div className="space-y-4">
      <div className="print:hidden flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: NAVY }}><TrendingUp size={22} /> Profit &amp; Loss</h1>
          <p className="text-sm mt-0.5" style={{ color: LGRAY }}>Booking income (payment received) minus expense vouchers</p>
        </div>
        <button type="button" onClick={() => window.print()} disabled={!data}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl text-sm font-black" style={{ background: NAVY, color: 'white', opacity: data ? 1 : 0.4 }}>
          <Printer size={15} /> Print / PDF
        </button>
      </div>

      {/* Only on paper / PDF */}
      <div className="hidden print:block">
        <p className="text-lg font-black" style={{ color: NAVY }}>North Nazimabad Gymkhana Trust — Profit &amp; Loss</p>
        <p className="text-xs" style={{ color: '#475569' }}>{rangeText} · printed {format(new Date(), 'd MMM yyyy, h:mm a')}</p>
      </div>

      <div className="print:hidden bg-white rounded-2xl shadow-sm px-4 py-3 flex flex-wrap items-center gap-2" style={{ border: `1px solid ${BORDER}` }}>
        {presets().map(([name, from, to]) => (
          <button key={name} type="button" onClick={() => setRange({ from, to })} className="h-8 px-3 rounded-lg text-xs font-bold"
            style={range.from === from && range.to === to ? { background: NAVY, color: 'white' } : { color: '#475569', border: `1.5px solid ${BORDER}` }}>{name}</button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: LGRAY }}>From</span>
          <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} style={filterInput} />
          <span className="text-xs font-semibold" style={{ color: LGRAY }}>To</span>
          <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} style={filterInput} />
        </span>
      </div>

      {error && <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#FEF2F2', color: RED, border: '1px solid #FEE2E2' }}>{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cards.map(({ icon: Icon, label, value, sub, color, bg }) => (
          <div key={label} className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 print:hidden" style={{ background: bg }}><Icon size={18} style={{ color }} /></div>
            <p className="text-2xl font-black" style={{ color }}>{value}</p>
            <p className="text-sm font-semibold" style={{ color: '#475569' }}>{label}</p>
            <p className="text-xs" style={{ color: LGRAY }}>{sub}</p>
          </div>
        ))}
      </div>

      {data?.pendingIncome?.count > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs" style={{ background: '#FFF7ED', border: '1px solid #FED7AA', color: '#9A3412' }}>
          <Clock size={14} className="shrink-0" />
          <span><b>{rs(data.pendingIncome.total)}</b> from {data.pendingIncome.count} bookings is still processing (payment not yet received) and is not counted as income.</span>
        </div>
      )}

      {/* Month by month */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
        <p className="px-4 py-2.5 font-black text-sm" style={{ color: NAVY, borderBottom: `1px solid ${BORDER}` }}>Month by month</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: '#F5F7FA' }}>
              <tr>{['Month', 'Bookings', 'Income', 'Vouchers', 'Expenses', 'Profit / Loss'].map(h => (
                <th key={h} className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: LGRAY }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {months.map(m => {
                const p = m.income - m.expenses
                const empty = !m.income && !m.expenses
                return (
                  <tr key={m.month} className="text-xs" style={{ borderTop: '1px solid #EEF2F7', opacity: empty ? 0.5 : 1 }}>
                    <td className="px-4 py-2 font-bold whitespace-nowrap" style={{ color: NAVY }}>{monthName(m.month)}</td>
                    <td className="px-4 py-2" style={{ color: '#475569' }}>{m.bookings}</td>
                    <td className="px-4 py-2 font-semibold whitespace-nowrap" style={{ color: GREEN }}>{rs(m.income)}</td>
                    <td className="px-4 py-2" style={{ color: '#475569' }}>{m.vouchers}</td>
                    <td className="px-4 py-2 font-semibold whitespace-nowrap" style={{ color: RED }}>{rs(m.expenses)}</td>
                    <td className="px-4 py-2 font-black whitespace-nowrap" style={{ color: p >= 0 ? NAVY : RED }}>{rs(p)}</td>
                  </tr>
                )
              })}
              {months.length > 0 && (
                <tr className="text-sm" style={{ borderTop: `2px solid ${NAVY}`, background: '#F8FAFC' }}>
                  <td className="px-4 py-2.5 font-black" style={{ color: NAVY }}>Total</td>
                  <td className="px-4 py-2.5 font-bold" style={{ color: NAVY }}>{months.reduce((s, m) => s + m.bookings, 0)}</td>
                  <td className="px-4 py-2.5 font-black whitespace-nowrap" style={{ color: GREEN }}>{rs(income)}</td>
                  <td className="px-4 py-2.5 font-bold" style={{ color: NAVY }}>{months.reduce((s, m) => s + m.vouchers, 0)}</td>
                  <td className="px-4 py-2.5 font-black whitespace-nowrap" style={{ color: RED }}>{rs(expenses)}</td>
                  <td className="px-4 py-2.5 font-black whitespace-nowrap" style={{ color: profit >= 0 ? NAVY : RED }}>{rs(profit)}</td>
                </tr>
              )}
              {!data && !error && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: LGRAY }}>Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Breakdown title="Income by court" rows={data?.byCourt || []} total={income} color={GREEN} empty="No income in this period" />
        <Breakdown title="Expenses by category" rows={data?.byCategory || []} total={expenses} color={RED}
          empty={<>No expenses in this period — <Link to="/admin/vouchers" className="link font-bold" style={{ color: '#1D4ED8' }}>add a voucher</Link></>} />
      </div>
    </div>
  )
}
