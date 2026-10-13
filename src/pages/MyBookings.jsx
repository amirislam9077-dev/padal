import { useState, useEffect, useCallback } from 'react'
import LoginRequired from '../components/LoginRequired'
import { formatSlotRange, getCurrentUser, mySlotsApi, scoreSlotApi, confirmScoreApi, creditApi } from '../store'
import EmailNotice from '../components/EmailNotice'
import { X, Check, Paperclip, Trophy, Pencil, RefreshCw, Plus, Download, Printer, Clock, ClipboardList, ChevronLeft, ChevronRight, CalendarCheck, TrendingUp, Activity } from 'lucide-react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'

const NAVY = '#1B2E4B'
const BLUE = '#4A6FA5'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const MAX_SETS = 3

const EMPTY_FILTERS = { from: '', to: '', result: 'all', player: 'all', time: 'all' }
const TIME_FILTERS = [
  { value: 'morning', label: 'Morning (before 12pm)', from: 0, to: 12 },
  { value: 'afternoon', label: 'Afternoon (12–5pm)', from: 12, to: 17 },
  { value: 'evening', label: 'Evening (from 5pm)', from: 17, to: 24 },
]
const filterInput = { border: '1px solid #D1D5DB', borderRadius: '8px', padding: '2px 8px', fontSize: '12px', outline: 'none', color: '#111827', background: 'white', height: '30px' }

// Team players from a booking. Older bookings have no team field (players 1–2 → Team 1,
// players 3–4 → Team 2) and the oldest only have the booker's name.
function teamsOf(b) {
  const players = b.players?.length ? b.players : [{ name: b.playerName }]
  const teamOfPlayer = (p, i) => p.team || (p.n ? (p.n <= 2 ? 1 : 2) : (i < 2 ? 1 : 2))
  return [1, 2].map(t => players.filter((p, i) => teamOfPlayer(p, i) === t))
}

// Score confirmation: a new score waits until a player of Team 1 and a player of Team 2 confirm it
// (email link or the Confirm buttons here); the player who entered it doesn't count.
const teamOfNo = n => (n <= 2 ? 1 : 2)
function scoreConfirmState(b, isMe) {
  const pending = !!b.score?.sets?.length && b.scoreStatus === 'pending'
  const myNo = (b.players || []).find(isMe)?.n
  const confirmedBy = b.scoreConfirmedBy || []
  const canConfirm = pending && b.status !== 'cancelled' && !!myNo && myNo !== b.scoreBy && !confirmedBy.includes(myNo)
  const waitingTeams = [1, 2].filter(team =>
    (b.players || []).some(p => p.n !== b.scoreBy && teamOfNo(p.n) === team) && !confirmedBy.some(n => teamOfNo(n) === team))
  return { pending, canConfirm, waitingTeams }
}
const waitingText = teams => (teams.length ? teams.map(t => `Team ${t}`).join(' & ') : 'confirmation')

// Sets won by each team, and the match winner (best of 3: first to 2 sets)
// Won − Lost as "+5" / "−1" / "0"
const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')

// Total games won and lost, seen from one team (1 or 2)
function gamesFor(r, team) {
  const t = team === 2 ? 1 : 0
  return { won: r.games[t], lost: r.games[1 - t] }
}

function scoreResult(sets) {
  const won = [0, 0]   // sets won by Team 1 / Team 2
  const games = [0, 0] // all games added up across the sets
  for (const [a, b] of sets) { won[a > b ? 0 : 1]++; games[0] += a; games[1] += b }
  // The match is decided by SETS (best of 3): more sets won wins; level sets (1–1) is a draw.
  // Total games are shown alongside (Won / Lost columns) but don't decide the result.
  const winner = won[0] === won[1] ? null : won[0] > won[1] ? 1 : 2
  const draw = sets.length > 0 && won[0] === won[1]
  return { won, games, winner, draw }
}
// Only a confirmed score counts for results and totals; a score waiting for another player's confirmation doesn't
const finalResult = b => (b.score?.sets?.length && b.scoreStatus !== 'pending' ? scoreResult(b.score.sets) : null)

export default function MyBookings() {
  const user = getCurrentUser()
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(!!user)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [tab, setTab] = useState('upcoming')
  const [scoring, setScoring] = useState(null) // booking whose score is being edited

  // Bookings come from MySQL (slot table): ones I made, or where I'm a player
  useEffect(() => {
    if (!user) return
    let cancelled = false
    mySlotsApi().then(r => {
      if (cancelled) return
      setLoading(false)
      if (r.error) setLoadError(r.error)
      else { setLoadError(''); setBookings(r.bookings) }
    })
    return () => { cancelled = true }
  }, [user?.id, reload]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reload by itself, so "Processing" turns "Confirmed" soon after the club ticks Payment received:
  // every 20 seconds while the page is visible, and right away when the member comes back to the tab
  useEffect(() => {
    if (!user) return
    const again = () => { if (document.visibilityState === 'visible') setReload(n => n + 1) }
    const timer = setInterval(again, 20000)
    document.addEventListener('visibilitychange', again)
    window.addEventListener('focus', again)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again) }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Advance balance from cancelled bookings (used automatically on the next booking)
  const [credit, setCredit] = useState(null)
  useEffect(() => {
    if (!user) return
    let cancelled = false
    creditApi().then(r => { if (!cancelled && !r.error) setCredit(r.balance) })
    return () => { cancelled = true }
  }, [user?.id, reload]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveScore(id, score) {
    const r = await scoreSlotApi(id, score ? score.sets : null)
    if (r.error) return r.error
    setBookings(prev => prev.map(b => b.id === id ? r.booking : b))
    setScoring(null)
    if (r.emails) setScoreNote({
      slotRef: r.booking?.slotRef, sent: r.emails.sent, skipped: r.emails.skipped, error: r.emails.error,
      title: r.emails.sent?.length
        ? <>Score saved — it counts once a player from each team confirms it. "Please confirm the score" email sent to <b>{r.emails.sent.map(x => x.name).join(', ')}</b>.</>
        : 'Score saved — it counts once a player from each team confirms it. No email could be sent; they can confirm it from My Bookings.',
    })
    return null
  }
  const [confirming, setConfirming] = useState(null) // booking id while its confirmation is saving
  async function confirmScore(id) {
    if (confirming) return
    setConfirming(id)
    const r = await confirmScoreApi(id)
    setConfirming(null)
    if (r.error) { alert(r.error); return }
    setBookings(prev => prev.map(b => b.id === id ? r.booking : b))
    const left = scoreConfirmState(r.booking, isMe).waitingTeams
    setScoreNote({
      ok: true,
      title: r.booking.scoreStatus === 'confirmed'
        ? <>{r.booking.slotRef}: score <b>confirmed</b> by both teams ✓</>
        : <>{r.booking.slotRef}: your confirmation is saved ✓ Waiting for <b>{waitingText(left)}</b>.</>,
    })
  }
  const [scoreNote, setScoreNote] = useState(null)
  const closeScoreNote = useCallback(() => setScoreNote(null), [])

  const today = format(new Date(), 'yyyy-MM-dd') // local date (Pakistan time), not UTC
  const byStart = (a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour
  // Every tab: oldest date first, then newer (by start time within a day); Processing still on top
  // Processing (club still checking the payment) on top, then Confirmed
  const processingFirst = (a, b) => Number(a.paymentReceived || a.date < today || a.status === 'cancelled') - Number(b.paymentReceived || b.date < today || b.status === 'cancelled')
  const upcoming = bookings.filter(b => b.date >= today && b.status !== 'cancelled').sort((a, b) => processingFirst(a, b) || byStart(a, b))
  const past = bookings.filter(b => b.date < today || b.status === 'cancelled').sort(byStart)
  // Show all: every booking, oldest date first
  const allBookings = [...bookings].sort((a, b) => processingFirst(a, b) || byStart(a, b))
  const tabList = tab === 'upcoming' ? upcoming : tab === 'past' ? past : allBookings

  // ── Filters: date range, result, player, time of day ──
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const filtersOn = Object.keys(EMPTY_FILTERS).some(k => filters[k] !== EMPTY_FILTERS[k])

  // Every player who appears in my bookings, for the player dropdown
  const playerOptions = [...new Map(bookings.flatMap(b => b.players || [])
    .filter(p => p.name)
    .map(p => [`${p.name}|${p.cmNo || ''}`, p])).values()]
    .sort((a, b) => a.name.localeCompare(b.name))

  // Is this player me? (name + CM No., because two members can share a name)
  const isMe = p => p.name === user?.name && (p.cmNo || '') === (user?.membershipNo || '')
  // Which team I was on (by my name + CM No.), so "I won / I lost" works
  const myTeam = b =>(b.players || []).find(p => p.name === user?.name && (p.cmNo || '') === (user?.membershipNo || ''))?.team || (b.userId === user?.id ? 1 : null)

  const list = tabList.filter(b => {
    if (filters.from && b.date < filters.from) return false
    if (filters.to && b.date > filters.to) return false
    if (filters.time !== 'all') {
      const slot = TIME_FILTERS.find(t => t.value === filters.time)
      if (b.startHour < slot.from || b.startHour >= slot.to) return false
    }
    if (filters.player !== 'all' && !(b.players || []).some(p => `${p.name}|${p.cmNo || ''}` === filters.player)) return false
    if (filters.result !== 'all') {
      if (filters.result === 'pending') return b.scoreStatus === 'pending'
      if (filters.result === 'none') return !b.score?.sets?.length
      const scored = finalResult(b)
      if (filters.result === 'draw') return !!scored?.draw
      const winner = scored?.winner || null
      if (!winner) return false
      const mine = myTeam(b)
      if (filters.result === 'won' && winner !== mine) return false
      if (filters.result === 'lost' && (!mine || winner === mine)) return false
    }
    return true
  })

  // ── Pagination: 15 bookings per page (summary, CSV and Print still use the whole list) ──
  const PAGE_SIZE = 15
  const [page, setPage] = useState(1)
  const pageKey = [tab, ...Object.values(filters)].join('|') // a new tab or filter starts again at page 1
  const [seenKey, setSeenKey] = useState(pageKey)
  if (seenKey !== pageKey) { setSeenKey(pageKey); setPage(1) }
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages)
  const firstRow = (curPage - 1) * PAGE_SIZE
  const [printAll, setPrintAll] = useState(false)
  useEffect(() => {
    const done = () => setPrintAll(false)
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [])
  const pageRows = printAll ? list : list.slice(firstRow, firstRow + PAGE_SIZE)
  function printReport() {
    setPrintAll(true)
    setTimeout(() => window.print(), 80) // let every row render first
  }

  // ── Report summary for the filtered list ──
  const played = list.filter(b => b.status !== 'cancelled')
  const withResult = played.map(b => ({ b, winner: finalResult(b)?.winner || null, mine: myTeam(b) }))
    .filter(x => x.winner && x.mine)
  const wins = withResult.filter(x => x.winner === x.mine).length
  const losses = withResult.length - wins
  const draws = played.filter(b => finalResult(b)?.draw).length
  const gameTotals = played.filter(b => finalResult(b)).reduce((t, b) => {
    const g = gamesFor(finalResult(b), myTeam(b) || 1)
    return { won: t.won + g.won, lost: t.lost + g.lost }
  }, { won: 0, lost: 0 })
  const summary = {
    matches: played.length,
    wins, losses,
    draws,
    winRate: withResult.length + draws ? Math.round((wins / (withResult.length + draws)) * 100) : null,
    // Only hours already played: earlier days, plus today's slots that have finished (not upcoming or cancelled)
    hours: played.filter(b => b.date < today || (b.date === today && b.endHour <= new Date().getHours()))
      .reduce((s, b) => s + (b.endHour - b.startHour), 0),
  }

  // Download the filtered list as a CSV file (opens in Excel)
  function exportCsv() {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['Slot Ref No.', 'Date','Day', 'Time', 'Court', 'Hours', 'Team 1', 'Team 2', 'Score', 'Games won', 'Games lost', 'Won − Lost', 'Result', 'Status', 'Payment (Rs)', 'Bank Name', 'Reference No.']
    const lines = list.map(b => {
      const [t1, t2] = teamsOf(b)
      const team = ps => ps.map(p => `${p.name}${p.cmNo ? ` (${p.cmNo})` : ''}`).join(' & ')
      const r = finalResult(b)
      const mine = myTeam(b)
      const result = b.scoreStatus === 'pending' ? 'Waiting for score confirmation' : r?.draw ? 'Draw' : !r?.winner ? '' : mine ? (r.winner === mine ? 'You won' : 'You lost') : `Team ${r.winner} won`
      const d = new Date(b.date + 'T00:00')
      return [b.slotRef, b.date, format(d, 'EEE'), formatSlotRange(b.startHour, b.endHour), b.courtName, b.endHour - b.startHour,
        team(t1), team(t2), b.score?.sets?.map(([x, y]) => `${x}-${y}`).join(' ') || '', r ? gamesFor(r, mine || 1).won : '', r ? gamesFor(r, mine || 1).lost : '', r ? signed(gamesFor(r, mine || 1).won - gamesFor(r, mine || 1).lost) : '', result, b.status, b.payment ?? '', b.bankName || '', b.referenceNo || ''].map(cell).join(',')
    })
    const blob = new Blob(['﻿' + [header.map(cell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `my-padel-bookings-${tab}-${today}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!user) return <LoginRequired message="Please log in to see your bookings" />

  return (
    <div className="max-w-6xl mx-auto px-4 pt-4 pb-6">
      {/* Title + actions */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h1 className="text-xl font-black whitespace-nowrap" style={{ color: INK }}>My Bookings</h1>
        <span className="mr-auto sm:ml-2 text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap"
          title="Money from cancelled bookings. It's used automatically on your next booking."
          style={{ border: `1px solid ${INK}`, color: INK }}>
          Advance balance: Rs. {(credit ?? 0).toLocaleString()}
        </span>
        <button type="button" onClick={() => { setLoading(true); setReload(n => n + 1) }} data-print="hide"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold" style={plainBtn}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <Link to="/book" data-print="hide" className="btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold"
          style={{ background: INK, color: 'white' }}>
          <Plus size={13} /> New booking
        </Link>
      </div>

      {loadError && <p className="mb-3 px-3 py-2 rounded-lg text-sm font-semibold" style={{ border: `1px solid ${INK}`, color: INK }}>{loadError}</p>}

      <ConfirmScorePanel bookings={bookings.filter(b => scoreConfirmState(b, isMe).canConfirm).sort(byStart)}
        isMe={isMe} confirming={confirming} onConfirm={confirmScore} />

      {loading && !bookings.length ? (
        <p className="text-center py-12 text-sm" style={{ color: GRAY }}>Loading your bookings…</p>
      ) : !loadError && bookings.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl" style={{ border: `1px solid ${LINE}` }}>
          <p className="font-bold" style={{ color: INK }}>No bookings yet</p>
          <p className="text-sm mt-1" style={{ color: GRAY }}>Bookings you make or play in will appear here.</p>
          <Link to="/book" className="link inline-block mt-3 text-sm font-bold" style={{ color: INK }}>Book a court</Link>
        </div>
      ) : bookings.length > 0 && (
        <>
          {/* Controls: tabs | filters | export — one row on wide screens */}
          <div className="print:hidden bg-white rounded-xl px-3 py-2 mb-2 flex flex-wrap items-center gap-2" style={{ border: `1px solid ${LINE}` }}>
            <div className="inline-flex rounded-lg overflow-hidden" style={{ border: `1px solid ${INK}` }}>
              {[['upcoming', 'Upcoming', upcoming.length], ['past', 'Past & Cancelled', past.length], ['all', 'Show All', allBookings.length]].map(([key, label, count], i) => (
                <button key={key} type="button" onClick={() => setTab(key)}
                  className="px-3 py-1 text-xs font-bold"
                  style={{ background: tab === key ? INK : 'white', color: tab === key ? 'white' : INK, borderLeft: i ? `1px solid ${INK}` : 'none' }}>
                  {label} ({count})
                </button>
              ))}
            </div>

            <span className="w-px h-6 mx-1 hidden md:block" style={{ background: LINE }} />

            <label className="flex items-center gap-1 text-xs font-semibold" style={{ color: GRAY }}>
              From <input type="date" value={filters.from} max={filters.to || undefined} onChange={e => setFilter('from', e.target.value)} style={filterInput} />
            </label>
            <label className="flex items-center gap-1 text-xs font-semibold" style={{ color: GRAY }}>
              To <input type="date" value={filters.to} min={filters.from || undefined} onChange={e => setFilter('to', e.target.value)} style={filterInput} />
            </label>
            <select aria-label="Result" value={filters.result} onChange={e => setFilter('result', e.target.value)} style={filterInput}>
              <option value="all">All results</option>
              <option value="won">I won</option>
              <option value="lost">I lost</option>
              <option value="draw">Draw</option>
              <option value="pending">Score waiting confirmation</option>
              <option value="none">No score yet</option>
            </select>
            <select aria-label="Player" value={filters.player} onChange={e => setFilter('player', e.target.value)} style={{ ...filterInput, maxWidth: '190px' }}>
              <option value="all">All players</option>
              {playerOptions.map(p => (
                <option key={`${p.name}|${p.cmNo || ''}`} value={`${p.name}|${p.cmNo || ''}`}>{p.name}{p.cmNo ? ` (${p.cmNo})` : ''}</option>
              ))}
            </select>
            <select aria-label="Time" value={filters.time} onChange={e => setFilter('time', e.target.value)} style={filterInput}>
              <option value="all">Any time</option>
              {TIME_FILTERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {filtersOn && (
              <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="btn-text text-xs font-bold" style={{ color: INK }}>Clear</button>
            )}

            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={exportCsv} disabled={!list.length} title="Download as CSV (opens in Excel)"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold" style={{ ...plainBtn, opacity: list.length ? 1 : 0.4 }}>
                <Download size={12} /> CSV
              </button>
              <button type="button" onClick={printReport} disabled={!list.length} title="Print this report (all pages)"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold" style={{ ...plainBtn, opacity: list.length ? 1 : 0.4 }}>
                <Printer size={12} /> Print
              </button>
            </div>
          </div>

          {/* Summary bar for the bookings shown (follows the tab + filters) */}
          {list.length > 0 && (() => {
            const diff = gameTotals.won - gameTotals.lost
            const rate = summary.winRate
            const R = 15, C = 2 * Math.PI * R // win-rate ring
            const Section = ({ icon: Icon, label, hint, children }) => (
              <div className="px-4 py-2.5 min-w-0" title={hint}>
                <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: '#3B4A7A' }}>
                  <Icon size={12} strokeWidth={2.5} /> {label}
                </p>
                <div className="flex items-center gap-2 min-h-[34px]">{children}</div>
              </div>
            )
            const num = { color: '#1B2E4B', fontVariantNumeric: 'tabular-nums' }
            const Pill = ({ n, letter, bg, fg, title }) => (
              <span className="inline-flex items-baseline gap-0.5 px-2 py-0.5 rounded-md" style={{ background: bg, color: fg }} title={title}>
                <b className="text-base leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>{n}</b>
                <span className="text-[10px] font-black">{letter}</span>
              </span>
            )
            return (
              <div className="summary-bar rounded-xl mb-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #EEF2FF 0%, #F8FAFF 100%)', border: '1px solid #C7D2FE', borderLeft: '5px solid #1B2E4B', boxShadow: '0 4px 14px rgba(27,46,75,0.10)' }}>
                <Section icon={CalendarCheck} label="Matches" hint={`Showing ${list.length} of ${tabList.length}`}>
                  <span className="text-2xl font-black leading-none" style={num}>{summary.matches}</span>
                  <span className="text-[11px]" style={{ color: '#9CA3AF' }}>of {tabList.length}</span>
                </Section>

                <Section icon={Trophy} label="Record" hint="Won · Lost · Drawn (by sets)">
                  <Pill n={summary.wins} letter="W" bg="#DCFCE7" fg="#166534" title="Won" />
                  <Pill n={summary.losses} letter="L" bg="#FEE2E2" fg="#991B1B" title="Lost" />
                  <Pill n={summary.draws} letter="D" bg="#FEF3C7" fg="#92400E" title="Drawn" />
                </Section>

                <Section icon={TrendingUp} label="Win rate" hint="Won ÷ scored matches">
                  <svg width="34" height="34" viewBox="0 0 36 36" className="shrink-0" aria-hidden="true">
                    <circle cx="18" cy="18" r={R} fill="none" stroke="#DDE3F5" strokeWidth="4" />
                    <circle cx="18" cy="18" r={R} fill="none" stroke="#1B2E4B" strokeWidth="4" strokeLinecap="round"
                      strokeDasharray={`${((rate || 0) / 100) * C} ${C}`} transform="rotate(-90 18 18)" />
                  </svg>
                  <span className="text-2xl font-black leading-none" style={num}>{rate != null ? `${rate}%` : '—'}</span>
                </Section>

                <Section icon={Activity} label="Games" hint="Games won – games lost (all sets)">
                  <span className="text-2xl font-black leading-none" style={num}>
                    {gameTotals.won}<span className="text-lg font-bold mx-1" style={{ color: '#CBD5E1' }}>/</span>{gameTotals.lost}
                  </span>
                  <span className="text-[11px] font-black px-1.5 py-0.5 rounded-md" title="Won minus lost"
                    style={diff > 0 ? { background: '#DCFCE7', color: '#166534' } : diff < 0 ? { background: '#FEE2E2', color: '#991B1B' } : { background: '#F3F4F6', color: GRAY }}>
                    {signed(diff)}
                  </span>
                </Section>

                <Section icon={Clock} label="Hours played" hint="Finished matches only">
                  <span className="text-2xl font-black leading-none" style={num}>{summary.hours}</span>
                  <span className="text-xs font-bold" style={{ color: GRAY }}>h</span>
                </Section>
              </div>
            )
          })()}

          {list.length === 0 ? (
            <div className="text-center py-8 bg-white rounded-xl text-sm" style={{ border: `1px solid ${LINE}`, color: GRAY }}>
              {filtersOn && tabList.length > 0 ? (
                <>No bookings match these filters. <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="link font-bold" style={{ color: INK }}>Clear filters</button></>
              ) : tab === 'upcoming'
                ? <>No upcoming bookings. <Link to="/book" className="link font-bold" style={{ color: INK }}>Book a court</Link></>
                : tab === 'past' ? 'No past or cancelled bookings.' : 'No bookings yet.'}
            </div>
          ) : (
            <div className="bg-white rounded-xl" style={{ border: `1px solid ${LINE}` }}>
              {/* below desktop width the table scrolls sideways inside its box */}
              <div className="overflow-x-auto lg:overflow-visible">
              <table className="w-full text-sm" style={{ color: INK, borderCollapse: 'collapse', minWidth: '980px' }}>
                <thead className="lg:sticky z-10 bg-white print:static" style={{ top: 'var(--site-header-h, 76px)', boxShadow: `inset 0 -1.5px 0 ${INK}` }}>
                  <tr>
                    {['Slot Ref', 'Date', 'Time', 'Court', 'Team 1', '', 'Team 2', 'Score', 'Won', 'Lost', 'Won − Lost', 'Result', 'Status'].map((h, i) => (
                      <th key={i} className={`text-[11px] font-black uppercase tracking-wider px-2 py-2 align-bottom ${h === 'Won' || h === 'Lost' || h === 'Won − Lost' ? 'text-center whitespace-nowrap' : 'text-left'}`} title={h === 'Won − Lost' ? 'Won − Lost: total games won minus total games lost' : undefined}>
                        {/* Total games won / lost (for the rows shown) above the Won / Lost headings */}
                        {(h === 'Won' || h === 'Lost' || h === 'Won − Lost') && (
                          <span className="block mx-auto mb-1 px-1.5 py-0.5 rounded-md text-xs normal-case tracking-normal"
                            title={h === 'Won − Lost' ? 'Total games won minus total games lost' : `Total games ${h.toLowerCase()} in the bookings shown`}
                            style={{ background: INK, color: 'white', fontVariantNumeric: 'tabular-nums' }}>
                            {h === 'Won' ? gameTotals.won : h === 'Lost' ? gameTotals.lost : signed(gameTotals.won - gameTotals.lost)}
                          </span>
                        )}
                        {h === 'Won − Lost' ? 'W − L' : h}
                      </th>
                    ))}
                    <th className="print:hidden px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(b => (
                    <BookingRow key={b.id} booking={b} today={today} isMe={isMe} myTeam={myTeam(b)}
                      onScore={() => setScoring(b)} onConfirmScore={confirmScore}
                      isOwner={b.userId === user.id} />
                  ))}
                </tbody>
              </table>
              </div>
              {/* Pagination */}
              <div className="print:hidden flex flex-wrap items-center justify-between gap-3 px-3 py-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
                <span className="text-xs" style={{ color: GRAY }}>
                  Showing <b style={{ color: INK }}>{firstRow + 1}–{Math.min(firstRow + PAGE_SIZE, list.length)}</b> of <b style={{ color: INK }}>{list.length}</b> · 15 per page
                </span>
                {totalPages > 1 && (
                  <nav className="flex items-center gap-1" aria-label="Pages">
                    <button type="button" onClick={() => setPage(curPage - 1)} disabled={curPage === 1}
                      className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-bold" style={{ ...plainBtn, opacity: curPage === 1 ? 0.35 : 1 }}>
                      <ChevronLeft size={14} /> Prev
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                      <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === curPage ? 'page' : undefined}
                        className="min-w-8 h-8 px-2 rounded-lg text-xs font-bold"
                        style={n === curPage ? { background: INK, color: 'white', border: `1px solid ${INK}` } : plainBtn}>
                        {n}
                      </button>
                    ))}
                    <button type="button" onClick={() => setPage(curPage + 1)} disabled={curPage === totalPages}
                      className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-bold" style={{ ...plainBtn, opacity: curPage === totalPages ? 0.35 : 1 }}>
                      Next <ChevronRight size={14} />
                    </button>
                  </nav>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <EmailNotice note={scoreNote} onClose={closeScoreNote} />
      {scoring && <ScoreDialog booking={scoring} onClose={() => setScoring(null)} onSave={score => saveScore(scoring.id, score)} />}
    </div>
  )
}

// Scores that wait for MY confirmation — big buttons that are easy to tap on a phone
function ConfirmScorePanel({ bookings, isMe, confirming, onConfirm }) {
  if (!bookings.length) return null
  return (
    <section data-print="hide" className="print:hidden mb-3 rounded-xl p-3 sm:p-4" aria-label="Scores to confirm"
      style={{ background: '#FFFBEB', border: '1.5px solid #F59E0B', boxShadow: '0 1px 3px rgba(180,83,9,0.12)' }}>
      <p className="flex items-center gap-2 font-black text-sm mb-1" style={{ color: '#92400E' }}>
        <ClipboardList size={16} /> Confirm match score
        <span className="text-[11px] font-black px-2 py-0.5 rounded-full" style={{ background: '#B45309', color: 'white' }}>{bookings.length}</span>
      </p>
      <p className="text-xs mb-3" style={{ color: '#92400E' }}>Check the score and tap <b>Confirm score</b>. It counts once a player from each team confirms.</p>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {bookings.map(b => {
          const [t1, t2] = teamsOf(b)
          const names = ps => ps.map(p => (isMe(p) ? `${p.name} (you)` : p.name)).join(' & ') || '—'
          const { waitingTeams } = scoreConfirmState(b, isMe)
          const busy = confirming === b.id
          return (
            <div key={b.id} className="bg-white rounded-lg p-3 flex flex-col gap-2" style={{ border: '1px solid #FCD34D' }}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold" style={{ fontFamily: 'Consolas, monospace', color: INK }}>{b.slotRef}</span>
                <span style={{ color: GRAY }}>{format(new Date(b.date + 'T00:00'), 'EEE d MMM')} · {formatSlotRange(b.startHour, b.endHour)} · {b.courtName}</span>
              </div>
              <p className="text-sm leading-snug" style={{ color: INK }}>
                <b>{names(t1)}</b> <span className="text-xs font-black" style={{ color: GRAY }}>vs</span> <b>{names(t2)}</b>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {b.score.sets.map(([x, y], i) => (
                  <span key={i} className="text-sm font-black px-2 py-0.5 rounded-md" style={{ border: `1.5px solid ${INK}`, color: INK, fontVariantNumeric: 'tabular-nums' }}
                    title={`Set ${i + 1}: Team 1 ${x} – ${y} Team 2`}>{x}–{y}</span>
                ))}
                <span className="text-[11px] font-bold ml-auto" style={{ color: '#B45309' }}>Waiting for {waitingText(waitingTeams)}</span>
              </div>
              <button type="button" onClick={() => onConfirm(b.id)} disabled={busy}
                className="w-full h-11 sm:h-10 rounded-lg inline-flex items-center justify-center gap-2 text-sm font-black"
                style={{ background: INK, color: 'white', opacity: busy ? 0.6 : 1 }}>
                <Check size={16} strokeWidth={3} /> {busy ? 'Confirming…' : 'Confirm score'}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// Black & white palette for the report
const INK = '#111827'
const GRAY = '#6B7280'
const LINE = '#E5E7EB'
const plainBtn = { color: INK, border: `1px solid ${INK}`, background: 'white' }

// "Hous & Amir Islam (you)" — my name in bold; CM No. shows on hover
function TeamCell({ players, isMe }) {
  if (!players.length) return <span style={{ color: GRAY }}>—</span>
  return (
    <span>
      {players.map((p, i) => (
        // a name never splits, but the second player may drop to the next line after "&"
        <span key={i}>
          {i > 0 && <span className="whitespace-nowrap"> &amp;</span>}{i > 0 && ' '}
          <span className="whitespace-nowrap" title={p.cmNo ? `${p.name} · ${p.cmNo}` : p.name}>
            <span style={{ fontWeight: isMe(p) ? 800 : 500, textDecoration: isMe(p) ? 'underline' : 'none' }}>{p.name}</span>
            {isMe(p) && <span className="text-[11px]" style={{ color: GRAY }}> (you)</span>}
          </span>
        </span>
      ))}
    </span>
  )
}

function BookingRow({ booking, onScore, onConfirmScore, today, isMe, myTeam, isOwner }) {
  const cancelled = booking.status === 'cancelled'
  const isPast = booking.date < today
  // Upcoming booking whose payment the club hasn't approved yet → highlighted row
  const processing = !cancelled && !isPast && !booking.paymentReceived
  const date = new Date(booking.date + 'T00:00')
  const [team1, team2] = teamsOf(booking)
  const score = booking.score?.sets?.length ? booking.score : null
  const { pending, canConfirm, waitingTeams } = scoreConfirmState(booking, isMe)
  const result = score && !pending ? scoreResult(score.sets) : null
  const resultText = pending ? 'Pending' : result?.draw ? 'Draw' : !result?.winner ? '—'
    : myTeam ? (result.winner === myTeam ? 'Won' : 'Lost')
    : `Team ${result.winner} won`
  const cell = 'px-2 py-1.5 align-middle'

  return (
    <tr className={processing ? 'row-processing' : ''} style={{
      borderBottom: `1px solid ${processing ? '#FDBA74' : LINE}`, color: cancelled ? '#9CA3AF' : INK,
      ...(processing ? { background: '#FFE8C2', boxShadow: 'inset 6px 0 0 #EA580C' } : {}),
    }}>
      <td className={`${cell} whitespace-nowrap text-xs font-bold`} style={{ fontFamily: 'Consolas, monospace' }}>{booking.slotRef}</td>
      <td className={`${cell} whitespace-nowrap font-semibold`}>{format(date, 'EEE d MMM')}</td>
      <td className={`${cell} whitespace-nowrap`}>{formatSlotRange(booking.startHour, booking.endHour)}</td>
      <td className={`${cell} whitespace-nowrap`}>
        {booking.courtName}
        {booking.junior && (
          <span className="ml-1 px-1 rounded text-[10px] font-black align-middle" title="Under-18 booking: 3pm–6pm free"
            style={{ border: `1px solid ${INK}`, color: INK }}>U-18</span>
        )}
        {booking.depositSlip && (
          <a href={booking.depositSlip} target="_blank" rel="noreferrer" title={['Deposit slip', booking.bankName, booking.referenceNo && `Ref ${booking.referenceNo}`].filter(Boolean).join(' · ')} className="print:hidden ml-1 inline-flex align-middle" style={{ color: GRAY }}>
            <Paperclip size={12} />
          </a>
        )}
      </td>
      <td className={cell}><TeamCell players={team1} isMe={isMe} /></td>
      <td className="px-0.5 py-2 align-middle text-[11px] font-black" style={{ color: GRAY }}>vs</td>
      <td className={cell}><TeamCell players={team2} isMe={isMe} /></td>
      <td className={`${cell} whitespace-nowrap`} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {/* One box per set (Team 1 – Team 2). Dark = a set my team won, light = a set my team lost */}
        {score ? (
          <>
          <span className="inline-flex items-center gap-0.5" style={pending ? { opacity: 0.55 } : undefined}>
            {score.sets.map(([a, c], i) => {
              const won = myTeam ? (myTeam === 1 ? a > c : c > a) : null
              return (
                <span key={i} title={`Set ${i + 1}: Team 1 ${a} – ${c} Team 2${won == null ? '' : won ? ' (you won this set)' : ' (you lost this set)'}`}
                  className="inline-block text-center text-[11px] font-bold px-1 py-px rounded leading-tight"
                  style={won ? { background: INK, color: 'white', border: `1px solid ${INK}` }
                    : { background: 'white', color: won === false ? GRAY : INK, border: `1px solid ${won === false ? '#D1D5DB' : INK}` }}>
                  {a}–{c}
                </span>
              )
            })}
          </span>
          {/* Score state under the boxes */}
          {pending ? (
            <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5 mt-0.5 max-w-[112px] whitespace-normal text-[10px] font-bold leading-tight" style={{ color: '#B45309' }}
              title="At least one player from each team has to confirm the score (link sent by email)">
              <span className="inline-flex items-center gap-1"><Clock size={10} strokeWidth={2.75} className="shrink-0" />
                Waiting for {waitingText(waitingTeams)}</span>
              {canConfirm && (
                <button type="button" onClick={() => onConfirmScore(booking.id)}
                  className="print:hidden inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-black"
                  style={{ background: INK, color: 'white' }} title="The score is correct — confirm it">
                  <Check size={10} strokeWidth={3} /> Confirm
                </button>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-0.5 mt-0.5 text-[10px] font-bold leading-tight" style={{ color: '#047857' }}
              title="Confirmed by players of both teams">
              <Check size={10} strokeWidth={3} /> Confirmed score
            </span>
          )}
          </>
        ) : '—'}
      </td>
      {/* All games added up: won by my team / lost (Team 1's side if I didn't play) */}
      {(() => {
        const g = result ? gamesFor(result, myTeam || 1) : null
        return (
          <>
            <td className={`${cell} whitespace-nowrap text-center`} style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}
              title={g ? `Games won: ${score.sets.map(([a, c]) => (myTeam === 2 ? c : a)).join(' + ')} = ${g.won}` : ''}>
              {g ? g.won : '—'}
            </td>
            <td className={`${cell} whitespace-nowrap text-center`} style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}
              title={g ? `Games lost: ${score.sets.map(([a, c]) => (myTeam === 2 ? a : c)).join(' + ')} = ${g.lost}` : ''}>
              {g ? g.lost : '—'}
            </td>
            {/* Won − Lost: + means more games won, − more games lost */}
            <td className={`${cell} whitespace-nowrap text-center`} style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}
              title={g ? `${g.won} − ${g.lost} = ${signed(g.won - g.lost)} (${g.won > g.lost ? 'more games won' : g.won < g.lost ? 'more games lost' : 'level'})` : ''}>
              {g ? signed(g.won - g.lost) : '—'}
            </td>
          </>
        )
      })()}
      <td className={`${cell} whitespace-nowrap`} style={{ fontWeight: resultText === 'Won' ? 800 : 500, color: pending ? '#B45309' : undefined }}
        title={pending ? 'The result counts once another player confirms the score' : undefined}>{resultText}</td>
      <td className={`${cell} whitespace-nowrap`} style={{ color: cancelled ? '#9CA3AF' : GRAY }}>
        {cancelled ? 'Cancelled' : isPast ? 'Played' : booking.paymentReceived ? 'Confirmed'
          : <span className="badge-pulse inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-full" style={{ background: '#EA580C', color: 'white' }}
              title="Your payment is being checked by the club"><Clock size={11} strokeWidth={3} />Processing</span>}
      </td>
      <td className={`${cell} print:hidden whitespace-nowrap`}>
        {/* Labelled buttons: icon + name, so it's clear which is which */}
        <div className="flex items-center justify-end gap-1.5">
          {!cancelled && (
            <button type="button" onClick={onScore} title={score ? 'Edit the match score' : 'Add the match score'}
              className="row-act row-act-label" style={{ color: '#1D4ED8', borderColor: '#93C5FD', background: '#EFF6FF' }}>
              <ClipboardList size={14} strokeWidth={2.2} />{score ? 'Edit Score' : 'Add Score'}
            </button>
          )}
          {/* Upcoming booking I made: change date, time, court or players */}
          {booking.status === 'confirmed' && !isPast && isOwner && (
            <Link to="/book" state={{ edit: booking }} title="Change the date, time, court or players"
              className="row-act row-act-label" style={{ color: 'white', borderColor: INK, background: INK }}>
              <Pencil size={13} strokeWidth={2.4} />Edit Booking
            </Link>
          )}
          {/* Cancelled: edit the date + time to make it active again (same court, players, slip) */}
          {cancelled && isOwner && (
            <Link to="/book" state={{ rebook: booking }} title="Pick a new date and time to book it again"
              className="row-act row-act-label" style={{ color: 'white', borderColor: INK, background: INK }}>
              <Pencil size={13} strokeWidth={2.4} />Edit Booking
            </Link>
          )}
        </div>
      </td>
    </tr>
  )
}

// Score card: up to 3 sets, games for Team 1 and Team 2
function ScoreDialog({ booking, onClose, onSave }) {
  const [team1, team2] = teamsOf(booking)
  const initial = Array.from({ length: MAX_SETS }, (_, i) => {
    const s = booking.score?.sets?.[i]
    return s ? [String(s[0]), String(s[1])] : ['', '']
  })
  const [sets, setSets] = useState(initial)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function setGame(i, side, v) {
    const digits = v.replace(/\D/g, '').slice(0, 1)
    setSets(prev => prev.map((s, j) => j === i ? (side === 0 ? [digits, s[1]] : [s[0], digits]) : s))
    setError('')
  }

  // Completed sets only (both numbers entered)
  const filled = sets.map(([a, b]) => [a, b]).filter(([a, b]) => a !== '' && b !== '').map(([a, b]) => [Number(a), Number(b)])
  const { won, games, winner, draw } = scoreResult(filled)

  function save() {
    for (const [i, [a, b]] of sets.entries()) {
      if ((a === '') !== (b === '')) return setError(`Set ${i + 1}: enter games for both teams.`)
      if (a === '') continue
      if (Number(a) > 7 || Number(b) > 7) return setError(`Set ${i + 1}: games must be between 0 and 7.`)
      if (a === b) return setError(`Set ${i + 1} can't be a draw — one team must win the set.`)
    }
    if (!filled.length) return setError('Enter the games for at least one set.')
    submit({ sets: filled })
  }

  // Saves to MySQL; shows the server's message if it fails
  const [saving, setSaving] = useState(false)
  async function submit(score) {
    setSaving(true)
    const err = await onSave(score)
    setSaving(false)
    if (err) setError(err)
  }

  const names = players => players.length ? players.map(p => p.name).join(' & ') : 'No players'
  const cell = { width: '44px', height: '40px', textAlign: 'center', fontSize: '18px', fontWeight: 800, color: NAVY, border: `1.5px solid ${BORDER}`, borderRadius: '10px', outline: 'none', background: 'white' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Match score"
      style={{ background: 'rgba(10,22,40,0.55)' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 24px 60px rgba(10,22,40,0.4)' }}>
        <div className="flex items-start justify-between px-5 py-4" style={{ background: NAVY }}>
          <div>
            <p className="text-white font-black text-lg flex items-center gap-2"><Trophy size={18} /> Match score</p>
            <p className="text-xs mt-0.5" style={{ color: '#8FA9C8' }}>
              {booking.courtName} · {format(new Date(booking.date + 'T00:00'), 'EEE d MMM')} · {formatSlotRange(booking.startHour, booking.endHour)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-icon p-1 rounded-full" style={{ color: 'white' }}><X size={18} /></button>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs mb-3" style={{ color: LGRAY }}>Enter the games won by each team in every set (best of 3 sets).</p>
          <div className="grid items-center gap-x-2 gap-y-2" style={{ gridTemplateColumns: `1fr repeat(${MAX_SETS}, 44px)` }}>
            <span />
            {sets.map((_, i) => <span key={i} className="text-center text-[10px] font-black uppercase tracking-wider" style={{ color: LGRAY }}>Set {i + 1}</span>)}

            {[[team1, NAVY, 'Team 1'], [team2, BLUE, 'Team 2']].map(([players, color, label], side) => [
              <div key={`l${side}`} className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wider" style={{ color }}>{label}{winner === side + 1 && <Trophy size={11} className="inline ml-1 -mt-0.5" style={{ color: '#B45309' }} />}</p>
                <p className="text-sm font-semibold truncate" style={{ color: NAVY }}>{names(players)}</p>
              </div>,
              ...sets.map((s, i) => (
                <input key={`${side}-${i}`} inputMode="numeric" value={s[side]} placeholder="–"
                  aria-label={`${label} games in set ${i + 1}`}
                  onChange={e => setGame(i, side, e.target.value)}
                  style={{ ...cell, borderColor: s[side] !== '' && s[0] !== '' && s[1] !== '' && Number(s[side]) > Number(s[1 - side]) ? color : BORDER }} />
              )),
            ])}
          </div>

          {/* Live result */}
          <div className="mt-4 px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
            style={winner ? { background: '#FFFBEB', color: '#B45309' } : { background: '#F1F5F9', color: '#64748B' }}>
            <Trophy size={15} />
            {winner ? `Team ${winner} wins · sets ${won[0]}–${won[1]} (games ${games[0]}–${games[1]})`
              : draw ? `Draw · sets ${won[0]}–${won[1]} (games ${games[0]}–${games[1]})`
              : 'No sets entered yet'}
          </div>

          {error && <p className="text-xs font-semibold mt-2" style={{ color: '#DC2626' }}>{error}</p>}

          <div className="flex items-center gap-2 mt-4">
            {booking.score && (
              <button type="button" onClick={() => submit(null)} disabled={saving} className="btn-text text-xs font-bold" style={{ color: '#DC2626' }}>
                Clear score
              </button>
            )}
            <button type="button" onClick={onClose} className="ml-auto px-4 py-2 rounded-xl text-sm font-bold"
              style={{ color: '#475569', border: `1.5px solid ${BORDER}`, background: 'white' }}>
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving} className="btn px-5 py-2 rounded-xl text-sm font-black"
              style={{ background: NAVY, color: 'white', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save score'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
