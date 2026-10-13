import { useState, useEffect, useRef } from 'react'
import LoginRequired from '../components/LoginRequired'
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowRight, Check, User, Phone, AlertCircle, X, Paperclip, FileText, Mail, Calendar, Clock, MapPin, Timer, RefreshCw, Pencil, Landmark, ChevronDown, Search } from 'lucide-react'
import { getCourts, TIME_SLOTS, formatHour, formatHourShort, formatSlotRange, formatDate, getCurrentUser, isUnder18, RATE_PER_HOUR, KIDS_FREE_FROM, KIDS_FREE_TO, kidsFreeHours, bookingCost, searchMembersApi, uploadSlipApi, sendBookingEmailsApi, bookedSlotsApi, holdSlotApi, releaseHoldApi, mySlotsApi, createSlotApi, updateSlotApi, creditApi, newSlotRefApi } from '../store'
import { format, addDays, startOfWeek } from 'date-fns'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const SLIP_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_SLIP_MB = 5
// Banks in Pakistan for the Bank Name drop-down ("Other" lets the member type any name)
const BANK_GROUPS = [
  { label: 'Public sector banks', banks: ['National Bank of Pakistan (NBP)', 'The Bank of Punjab (BOP)', 'Bank of Khyber (BOK)', 'Sindh Bank',
    'First Women Bank', 'Bank of Azad Jammu & Kashmir', 'Zarai Taraqiati Bank (ZTBL)', 'Punjab Provincial Co-operative Bank'] },
  { label: 'Private banks', banks: ['Allied Bank (ABL)', 'Askari Bank', 'Bank Alfalah', 'Bank AL Habib', 'Bank Makramah (formerly Summit Bank)',
    'Faysal Bank', 'Habib Bank (HBL)', 'Habib Metropolitan Bank', 'JS Bank', 'MCB Bank', 'Samba Bank', 'Silkbank', 'Soneri Bank',
    'Standard Chartered Bank', 'United Bank (UBL)'] },
  { label: 'Islamic banks', banks: ['Meezan Bank', 'BankIslami Pakistan', 'Dubai Islamic Bank Pakistan', 'Al Baraka Bank Pakistan',
    'MCB Islamic Bank'] },
  { label: 'Foreign banks', banks: ['Citibank', 'Deutsche Bank', 'Bank of China', 'Industrial and Commercial Bank of China (ICBC)'] },
  { label: 'Digital banks', banks: ['Mashreq Bank Pakistan', 'Raqami Islamic Digital Bank', 'Hugo Bank', 'KT Bank Pakistan'] },
  { label: 'Microfinance banks', banks: ['Mobilink Microfinance Bank', 'Easypaisa Bank (Telenor Microfinance)', 'U Microfinance Bank (Upaisa)',
    'Khushhali Microfinance Bank', 'FINCA Microfinance Bank', 'NRSP Microfinance Bank', 'HBL Microfinance Bank', 'Apna Microfinance Bank',
    'LOLC Microfinance Bank', 'Advans Pakistan Microfinance Bank'] },
  { label: 'Mobile wallets', banks: ['JazzCash', 'Easypaisa', 'SadaPay', 'NayaPay', 'UPaisa', 'Konnect by HBL'] },
]
const ALL_BANKS = BANK_GROUPS.flatMap(g => g.banks)

function getNext30Days() {
  return Array.from({ length: 30 }, (_, i) => {
    const d = addDays(new Date(), i)
    return { key: format(d, 'yyyy-MM-dd'), day: DAYS[d.getDay()], dow: d.getDay(), num: d.getDate(), month: format(d, 'MMM'), label: format(d, 'EEE, d MMM') }
  })
}

// Start times grouped by part of the day (hour ranges are [from, to))
// The under-18 free hours (3pm–6pm) get their own line
const SLOT_GROUPS = [
  { label: 'Morning', from: 0, to: 12 },
  { label: 'Afternoon', from: 12, to: KIDS_FREE_FROM },
  { label: 'Kids time', from: KIDS_FREE_FROM, to: KIDS_FREE_TO, kids: true },
  { label: 'Evening', from: KIDS_FREE_TO, to: 21 },
  { label: 'Night', from: 21, to: 24 },
].filter(g => TIME_SLOTS.some(h => h >= g.from && h < g.to)) // skip groups outside opening hours

const card = { background: '#FFFFFF', border: `1px solid ${BORDER}`, borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 6px rgba(27,46,75,0.07)' }
const sectionLabel = { fontSize: '11px', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: LGRAY, marginBottom: '10px', display: 'block' }
const inputStyle = { width: '100%', border: `1.5px solid ${BORDER}`, borderRadius: '10px', padding: '10px 12px', fontSize: '14px', outline: 'none', color: NAVY, background: '#F8FAFC' }
const compactInput = { ...inputStyle, padding: '7px 12px' }
// Contact phone, deposit slip, bank name, reference no.: highlighted so they're not missed
const KEY_BLUE = '#3B82F6'
const keyLabel = { ...sectionLabel, fontSize: '12.5px', fontWeight: '800', letterSpacing: '0.04em', color: NAVY, marginBottom: '6px' }
const keyInput = { ...compactInput, height: '40px', background: 'white', border: `2px solid #93C5FD`, fontWeight: 600, boxShadow: '0 1px 3px rgba(59,130,246,0.12)' }

// Toast popup component
function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="fixed z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl"
      style={{
        top: '24px', left: '50%', transform: 'translateX(-50%)',
        background: NAVY, color: 'white', minWidth: '280px', maxWidth: '380px',
        animation: 'slideDown 0.25s ease',
      }}>
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ background: 'rgba(255,255,255,0.15)' }}>
        <AlertCircle size={16} color="white" />
      </div>
      <p className="text-sm font-semibold flex-1">{message}</p>
      <button onClick={onClose} className="btn-icon ml-2 p-1 rounded-full opacity-60 hover:opacity-100">
        <X size={15} />
      </button>

      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  )
}

// Player photo (or initial / number) with the player number on the corner
function PlayerAvatar({ player, size = 32 }) {
  const filled = player.name.trim()
  const active = player.you || (filled && player.cm.trim())
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {player.picture ? (
        <img src={player.picture} alt={player.name} className="rounded-full object-cover block"
          style={{ width: size, height: size, border: '2px solid white', boxShadow: `0 0 0 1.5px ${NAVY}` }} />
      ) : (
        <span className="rounded-full flex items-center justify-center font-black"
          style={{ width: size, height: size, fontSize: size * 0.4,
            background: active ? NAVY : '#DDE3EC', color: active ? 'white' : LGRAY, border: '2px solid white',
            boxShadow: `0 0 0 1.5px ${active ? NAVY : '#DDE3EC'}` }}>
          {filled ? player.name.trim().charAt(0).toUpperCase() : player.n}
        </span>
      )}
      {(player.picture || filled) && (
        <span className="absolute flex items-center justify-center rounded-full font-black"
          style={{ right: -4, bottom: -3, width: 15, height: 15, fontSize: 9, background: active ? NAVY : LGRAY, color: 'white', border: '1.5px solid white' }}>
          {player.n}
        </span>
      )}
    </span>
  )
}

const sameMember = (player, m) =>
  player.name.trim().toLowerCase() === m.name.toLowerCase() && player.cm.trim().toUpperCase() === m.membershipNo

// Combo box: shows the chosen member's full name; opens a panel with a search box and the list of
// every registered member (filtered as you type). "None" clears the player.
function MemberCombo({ value, onPick, placeholder, icon, exclude, style }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef(null)
  const listRef = useRef(null)
  const seq = useRef(0)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  // Load the members list (empty text = everyone), waiting a moment while typing
  function load(q, delay) {
    clearTimeout(timer.current)
    const mine = ++seq.current
    setLoading(true)
    timer.current = setTimeout(async () => {
      const r = await searchMembersApi(q.trim(), 'name')
      if (mine !== seq.current) return // a newer search is on its way
      setResults((r.members || []).filter(m => !exclude.some(p => sameMember(p, m))))
      setActive(0)
      setLoading(false)
    }, delay)
  }

  // Close when clicking anywhere outside the combo box
  useEffect(() => {
    if (!open) return
    const close = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  // Keep the highlighted row in view while using the arrow keys
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function toggle() {
    if (!open) { setQuery(''); setResults([]); load('', 0) }
    setOpen(!open)
  }

  function pick(m) {
    setOpen(false)
    onPick(m)
  }

  function handleKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
    if (!results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % results.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + results.length) % results.length) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[active]) }
  }

  return (
    <div className="relative" ref={box}>
      <span className="pointer-events-none">{icon}</span>
      <button type="button" onClick={toggle} aria-haspopup="listbox" aria-expanded={open}
        className="w-full text-left truncate"
        style={{ ...style, paddingRight: '30px', cursor: 'pointer', color: value ? NAVY : LGRAY, textDecoration: 'none' }}>
        {value || placeholder}
      </button>
      <ChevronDown size={15} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none transition-transform"
        style={{ color: LGRAY, transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)` }} />
      {open && (
        <div className="absolute left-0 mt-1 z-30 rounded-xl overflow-hidden"
          style={{ top: '100%', width: 'max(100%, 260px)', background: 'white', border: `1px solid ${BORDER}`, boxShadow: '0 12px 28px rgba(27,46,75,0.18)' }}>
          <div className="relative p-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
            <input type="text" autoFocus value={query} placeholder="Search full name…" autoComplete="off"
              onChange={e => { setQuery(e.target.value); load(e.target.value, 200) }} onKeyDown={handleKey}
              className="w-full rounded-lg text-sm outline-none"
              style={{ padding: '7px 10px 7px 28px', border: `1px solid ${BORDER}`, background: '#F8FAFC', color: NAVY }} />
          </div>
          <div ref={listRef} className="max-h-60 overflow-y-auto py-1" role="listbox">
            {value && !query && (
              <button type="button" onClick={() => pick({ name: '', membershipNo: '', picture: null })}
                className="btn-text w-full px-3 py-2 text-left text-xs italic"
                style={{ color: LGRAY, background: 'white', textDecoration: 'none' }}>
                — None (remove this player) —
              </button>
            )}
            {loading && !results.length ? (
              <p className="px-3 py-2.5 text-xs" style={{ color: LGRAY }}>Loading members…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2.5 text-xs" style={{ color: LGRAY }}>
                {query.trim() ? `No registered member matches “${query.trim()}”.` : 'No other registered members yet.'}
              </p>
            ) : results.map((m, i) => (
              <button key={m.id} type="button" role="option" data-i={i} aria-selected={i === active}
                onClick={() => pick(m)} onMouseEnter={() => setActive(i)}
                className="btn-text w-full flex items-center gap-2.5 px-3 py-2 text-left"
                style={{ background: i === active ? '#EEF2F7' : 'white', textDecoration: 'none' }}>
                {m.picture
                  ? <img src={m.picture} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                  : <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0"
                      style={{ background: NAVY, color: 'white' }}>{m.name.charAt(0).toUpperCase()}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold truncate" style={{ color: NAVY }}>{m.name}</span>
                  <span className="block text-xs" style={{ color: LGRAY }}>{m.membershipNo}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Text input that searches registered members (by name or CM No.) and shows a pick list
function MemberSearchInput({ value, onChange, onPick, field, placeholder, icon, exclude, style }) {
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const timer = useRef(null)
  const seq = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  // Empty text lists every registered member, so clicking the box shows the full list
  function search(v, delay) {
    clearTimeout(timer.current)
    const mine = ++seq.current
    timer.current = setTimeout(async () => {
      const r = await searchMembersApi(v.trim(), field)
      if (mine !== seq.current) return // a newer search is on its way
      setResults((r.members || []).filter(m => !exclude.some(p => sameMember(p, m))))
      setActive(0)
      setOpen(true)
    }, delay)
  }

  function handleInput(v) {
    onChange(v)
    search(v, 250)
  }

  function pick(m) {
    seq.current++
    setOpen(false)
    setResults([])
    onPick(m)
  }

  function handleKey(e) {
    if (!open || !results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % results.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + results.length) % results.length) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="relative">
      {icon}
      <input type="text" value={value} placeholder={placeholder} autoComplete="off"
        onChange={e => handleInput(field === 'cm' ? e.target.value.toUpperCase() : e.target.value)}
        onKeyDown={handleKey}
        onFocus={() => search(value, 0)}
        onBlur={() => { seq.current++; clearTimeout(timer.current); setOpen(false) }}
        role="combobox" aria-expanded={open} aria-autocomplete="list"
        style={style} />
      {open && (
        <div className="absolute left-0 right-0 mt-1 z-30 rounded-xl overflow-hidden"
          style={{ top: '100%', background: 'white', border: `1px solid ${BORDER}`, boxShadow: '0 12px 28px rgba(27,46,75,0.18)' }}
          role="listbox">
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-xs" style={{ color: LGRAY }}>
              {value.trim() ? `No registered member matches “${value.trim()}”.` : 'No other registered members yet.'}
            </p>
          ) : (
            <div className="max-h-52 overflow-y-auto py-1">
              {results.map((m, i) => (
                <button key={m.id} type="button" role="option" aria-selected={i === active}
                  onMouseDown={e => { e.preventDefault(); pick(m) }}
                  onMouseEnter={() => setActive(i)}
                  className="btn-text w-full flex items-center gap-2.5 px-3 py-2 text-left"
                  style={{ background: i === active ? '#EEF2F7' : 'white', textDecoration: 'none' }}>
                  {m.picture
                    ? <img src={m.picture} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                    : <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0"
                        style={{ background: NAVY, color: 'white' }}>{m.name.charAt(0).toUpperCase()}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold truncate" style={{ color: NAVY }}>{m.name}</span>
                    <span className="block text-xs" style={{ color: LGRAY }}>{m.membershipNo}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function BookCourt() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const user = getCurrentUser()
  // 3pm–6pm (kids time) can only be booked by under-18 members
  const under18 = isUnder18(user?.dob)

  const courts = getCourts().filter(c => c.isActive)
  const dates = getNext30Days()
  // Empty cells before the first date so every date sits under its real weekday
  const leadingBlanks = dates[0].dow
  const firstMonth = format(addDays(new Date(), 0), 'MMMM')
  const lastDay = addDays(new Date(), dates.length - 1)
  const calendarTitle = firstMonth === format(lastDay, 'MMMM')
    ? format(lastDay, 'MMMM yyyy')
    : `${firstMonth} – ${format(lastDay, 'MMMM yyyy')}`

  const [step, setStep] = useState(1)
  // "Book new slot" from a cancelled booking in My Bookings: same court + players
  const [rebook, setRebook] = useState(location.state?.rebook || null)
  // "Edit" on an upcoming booking in My Bookings: everything filled in, saving updates that booking
  const [editing, setEditing] = useState(location.state?.edit || null)
  const prefill = editing || rebook
  const [courtId, setCourtId] = useState(
    (prefill && courts.some(c => c.id === prefill.courtId) && prefill.courtId) || params.get('court') || courts[0]?.id || '')
  // Start from the booking's own date + time (if that date can still be booked)
  const [selectedDate, setSelectedDate] = useState(prefill && dates.some(d => d.key === prefill.date) ? prefill.date : '')
  const [selectedTime, setSelectedTime] = useState(prefill && selectedDate && TIME_SLOTS.includes(prefill.startHour) ? String(prefill.startHour) : '')
  const [duration] = useState(prefill ? Math.min(3, (prefill.endHour - prefill.startHour) || 1) : 1)
  // Under-18 players: hours between 3pm and 6pm are free
  // Under-18 members play 3pm–6pm free (only they can book those hours), no checkbox needed
  const junior = under18
  const startHour = parseInt(selectedTime)
  const inKidsWindow = !!selectedTime && kidsFreeHours(startHour, duration) > 0
  const cost = selectedTime ? bookingCost(startHour, duration, junior && inKidsWindow) : { total: RATE_PER_HOUR * duration, freeHours: 0, paidHours: duration }
  // Advance balance (from cancelled bookings) is used first; a slip is only needed for the rest
  const [credit, setCredit] = useState(0)
  useEffect(() => {
    let cancelled = false
    creditApi().then(r => { if (!cancelled) setCredit(r.balance || 0) })
    return () => { cancelled = true }
  }, [])
  // Editing (upcoming or cancelled): what the booking was paid by its slip counts first, then the advance.
  // A cancelled booking's money that was put on the advance is taken back from it (not counted twice).
  const held = (editing || rebook)?.refundable || 0
  const advance = credit - (rebook?.creditRefunded ? Math.min(credit, rebook.creditRefunded) : 0)
  const paidBefore = Math.min(held, cost.total)
  const refundBack = Math.max(0, held - cost.total) // cheaper slot → to advance
  const creditUse = paidBefore + Math.min(advance, cost.total - paidBefore)
  const amountDue = cost.total - creditUse
  const slipNeeded = amountDue > 0
  // Nothing to pay at all (under-18 in kids time): no deposit slip, bank or reference no.
  const isFree = !!selectedTime && cost.total === 0
  const advLabel = prefill ? 'Paid before' : 'Advance'
  // Slot reference no. (SLOT-001 …): a new booking reserves its unique number as soon as the page opens;
  // an edited booking keeps its own
  const [savedRef, setSavedRef] = useState(null)
  // The club still has to check the deposit slip → "Processing" until the admin approves it
  const [paymentPending, setPaymentPending] = useState(false)
  const [newRef, setNewRef] = useState(null)
  const [refVersion, setRefVersion] = useState(0) // bump to reserve the next number ("Book Another")
  useEffect(() => {
    if (prefill || !user) return
    let cancelled = false
    newSlotRefApi().then(r => { if (!cancelled && r.slotRef) setNewRef(r.slotRef) })
    return () => { cancelled = true }
  }, [refVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  const slotRefText = savedRef || prefill?.slotRef || newRef || 'Generating…'
  const [playerName, setPlayerName] = useState(user?.name || '')
  const [playerCnic, setPlayerCnic] = useState(user?.membershipNo || '')
  const [playerPhone, setPlayerPhone] = useState(prefill?.playerPhone || user?.phone || '')
  // Players 2–4 (optional): name + CM No. each
  const emptyExtraPlayers = () => [2, 3, 4].map(n => ({ n, name: '', cm: '', picture: null }))
  const [extraPlayers, setExtraPlayers] = useState(() => emptyExtraPlayers().map(p => {
    const prev = prefill?.players?.find(x => x.n === p.n) // players 2–4 from the booking being edited / rebooked
    return prev ? { ...p, name: prev.name || '', cm: prev.cmNo || '' } : p
  }))
  const [showRebookNote, setShowRebookNote] = useState(!!rebook)
  const [replacedBooking, setReplacedBooking] = useState(null) // shown on the confirmation screen
  const filledExtras = extraPlayers.filter(p => p.name.trim() || p.cm.trim())
  const allPlayers = [{ n: 1, name: playerName, cm: playerCnic, picture: user?.picture || null, you: true }, ...extraPlayers]
  // Padel is 2 vs 2: players 1 & 2 are Team 1, players 3 & 4 are Team 2
  const teamOf = n => (n <= 2 ? 1 : 2)
  const teamPlayers = team => [allPlayers[0], ...filledExtras].filter(p => teamOf(p.n) === team)
  const bookingPlayers = () => [allPlayers[0], ...filledExtras].map(p => ({
    n: p.n, team: teamOf(p.n), name: p.name.trim(), cmNo: p.cm.trim().toUpperCase(),
  }))
  const playerCount = 1 + filledExtras.length

  function updateExtra(n, field, value) {
    // Typing by hand means it's no longer the picked member, so drop their photo
    setExtraPlayers(list => list.map(p => p.n === n ? { ...p, [field]: value, picture: null } : p))
    if (error) setError('')
  }

  // Deposit slip (optional): uploaded to the server straight away
  // { path, name, type, fromCancelled } — a rebooking starts with the cancelled booking's slip,
  // but only if that booking's money hasn't already been spent on other bookings
  // (fromCancelled = carried over from the old booking, so it's never sent as a new slip)
  const [slip, setSlip] = useState(() => {
    const carried = prefill?.depositSlip
    return carried ? {
      path: carried, name: prefill.slipNo || (editing ? 'Slip from this booking' : 'Slip from cancelled booking'), fromCancelled: true,
      type: carried.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/*',
    } : null
  })
  const oldSlip = editing?.depositSlip || rebook?.depositSlip || null
  // Reference no. printed on the deposit slip (comes with a carried-over slip)
  const [refNo, setRefNo] = useState(() => (slip?.fromCancelled && prefill?.referenceNo) || '')
  const [bankName, setBankName] = useState(() => (slip?.fromCancelled && prefill?.bankName) || '')
  const [otherBank, setOtherBank] = useState(() => !!bankName && !ALL_BANKS.includes(bankName)) // a bank not in the list
  const [refError, setRefError] = useState('') // reference no. / bank name message
  const refNeeded = !!slip && !slip.fromCancelled && !isFree // a newly attached slip needs its reference no. (a free booking sends none)
  const [slipBusy, setSlipBusy] = useState(false)
  const [slipError, setSlipError] = useState('')
  // Confirmation emails after booking: { sending } → { sent, skipped } or { error }
  const [emailStatus, setEmailStatus] = useState(null)
  const slipInput = useRef(null)

  function handleSlip(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (!SLIP_TYPES.includes(file.type)) { setSlipError('Deposit slip must be a JPG, PNG, WEBP or PDF file.'); return }
    if (file.size > MAX_SLIP_MB * 1024 * 1024) { setSlipError(`Deposit slip must be ${MAX_SLIP_MB} MB or smaller.`); return }
    setSlipError('')
    setSlipBusy(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const result = await uploadSlipApi(reader.result, file.name)
      setSlipBusy(false)
      if (result.error) { setSlipError(result.error); return }
      setSlip(result)
      setSlipError('')
    }
    reader.readAsDataURL(file)
  }

  // Member chosen from the search list: fill name, CM No. and their photo
  function pickExtra(n, m) {
    // Each player must be a different person: don't let the same member in twice
    const taken = allPlayers.find(o => o.n !== n && sameMember(o, m))
    if (taken) { setToast(`${m.name} (${m.membershipNo}) is already added as Player ${taken.n}. Please choose a different player.`); return }
    setExtraPlayers(list => list.map(p => p.n === n ? { ...p, name: m.name, cm: m.membershipNo, picture: m.picture || null } : p))
    if (error) setError('')
  }
  const [bookedSlots, setBookedSlots] = useState([])
  const [heldHours, setHeldHours] = useState([]) // another member is booking these right now ("processing")
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)

  // Booked hours for the chosen court + date come from MySQL (slot table); reloaded every
  // 10 seconds so a time another member has just picked shows as "processing"
  const [bookedVersion, setBookedVersion] = useState(0) // bump to reload after a clash
  useEffect(() => {
    if (!courtId || !selectedDate || success) return
    let cancelled = false
    const load = () => bookedSlotsApi(selectedDate, courtId).then(r => {
      if (cancelled || r.error) return
      // The booking being edited doesn't block its own time
      const own = b => editing && courtId === editing.courtId && selectedDate === editing.date
        && b.startHour === editing.startHour && b.endHour === editing.endHour
      setBookedSlots((r.booked || []).filter(b => !own(b)))
      setHeldHours(r.held || [])
    })
    load()
    const timer = setInterval(load, 10000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [courtId, selectedDate, bookedVersion, editing, success])

  // Hold the picked time while this member books it (renewed every minute); let go of it when
  // the time is cleared or the page is left. Losing a race to another member un-picks the time.
  useEffect(() => {
    if (!courtId || !selectedDate || !selectedTime || success) { releaseHoldApi(); return }
    let cancelled = false
    const hold = () => holdSlotApi(courtId, selectedDate, parseInt(selectedTime), duration).then(r => {
      if (cancelled || !r.processing) return
      setSelectedTime(''); setStep(1); setToast(r.error); setBookedVersion(v => v + 1)
    })
    hold()
    const timer = setInterval(hold, 60000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [courtId, selectedDate, selectedTime, duration, success])
  useEffect(() => {
    window.addEventListener('pagehide', releaseHoldApi)
    return () => { window.removeEventListener('pagehide', releaseHoldApi); releaseHoldApi() }
  }, [])

  // Changing the court or date clears the chosen time
  // On phones the time slots are below the calendar, so bring them into view after picking a date
  const timeSection = useRef(null)
  function chooseDate(key) {
    setSelectedDate(key); setSelectedTime(''); setBookedSlots([]); setHeldHours([])
    if (window.innerWidth < 768) setTimeout(() => timeSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }
  function chooseCourt(id) { setCourtId(id); setSelectedTime(''); setBookedSlots([]); setHeldHours([]) }
  const [saving, setSaving] = useState(false)

  function isHourBooked(h) { return bookedSlots.some(b => h >= b.startHour && h < b.endHour) }

  function rangeOverlapsBooked(start, end) {
    return bookedSlots.some(b => start < b.endHour && end > b.startHour)
  }

  // One booking per week (Monday–Sunday): the member's own active bookings, by week. The booking being
  // edited doesn't count; a cancelled one being rebooked is already cancelled. The server checks this too.
  const [myBookings, setMyBookings] = useState([])
  useEffect(() => {
    let cancelled = false
    mySlotsApi().then(r => {
      if (!cancelled && r.bookings) setMyBookings(r.bookings.filter(b => b.userId === String(user?.id) && b.status !== 'cancelled'))
    })
    return () => { cancelled = true }
  }, [user?.id, success])
  // The same time (e.g. 8–9 PM) can be booked at most twice a week (Mon–Sun), both courts counted together
  const SAME_TIME_PER_WEEK = 2
  const weekOf = key => format(startOfWeek(new Date(`${key}T00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const sameTimeThisWeek = hour => selectedDate
    ? myBookings.filter(b => b.id !== editing?.id && b.startHour === hour && weekOf(b.date) === weekOf(selectedDate)) : []
  const weekFull = hour => sameTimeThisWeek(hour).length >= SAME_TIME_PER_WEEK
  const weekLimitText = hour => `You have already booked ${formatSlotRange(hour, hour + 1)} ${sameTimeThisWeek(hour).length === 2 ? 'twice' : `${sameTimeThisWeek(hour).length} times`} this week (${
    sameTimeThisWeek(hour).map(b => `${b.slotRef} ${format(new Date(`${b.date}T00:00`), 'EEE d MMM')}`).join(', ')
  }). The same time can be booked only twice a week (Monday–Sunday). Please choose another time or another week.`
  // This week's bookings by time, for the note above the slots: { 20: 2, 21: 1 }
  const weekCounts = selectedDate ? myBookings.filter(b => b.id !== editing?.id && weekOf(b.date) === weekOf(selectedDate))
    .reduce((m, b) => ({ ...m, [b.startHour]: (m[b.startHour] || 0) + 1 }), {}) : {}

  const isHourHeld = h => heldHours.includes(h)
  const rangeOverlapsHeld = (start, end) => heldHours.some(h => h >= start && h < end)

  const durationConflict = selectedTime
    ? rangeOverlapsBooked(parseInt(selectedTime), parseInt(selectedTime) + duration)
    : false

  function handleSlotClick(hour) {
    const booked = isHourBooked(hour)
    if (booked) {
      setToast(`This slot (${formatSlotRange(hour, hour + 1)}) is already booked — please choose another time.`)
      return
    }
    if (weekFull(hour)) { setToast(weekLimitText(hour)); return }
    if (!under18 && kidsFreeHours(hour, duration) > 0) {
      setToast('You are not applicable to book this slot. Only under-18 players can book this slot.')
      return
    }
    if (rangeOverlapsHeld(hour, hour + duration)) {
      setToast('This time is in processing — another member is booking it right now. Please choose another time or try again in a few minutes.')
      return
    }
    setSelectedTime(String(hour))
  }

  function goStep2() {
    if (!selectedDate || !selectedTime) { setError('Please select a date and a time slot.'); return }
    if (weekFull(parseInt(selectedTime))) { setError(weekLimitText(parseInt(selectedTime))); return }
    if (!under18 && inKidsWindow) { setError('You are not applicable to book this slot. Only under-18 players can book this slot.'); return }
    setError(''); setStep(2)
    setTimeout(() => document.getElementById('step2')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  function goStep3() {
    if (!playerName.trim() || !playerPhone.trim()) { setError('Please fill in your name and phone number.'); return }
    const half = filledExtras.find(p => !p.name.trim() || !p.cm.trim())
    if (half) { setError(`Please enter both the name and CM No. for Player ${half.n}, or leave both empty.`); return }
    // The same person (name + CM No.) can't be entered twice
    const key = p => `${p.name.trim().toLowerCase()}|${p.cm.trim().toUpperCase()}`
    const entered = [{ n: 1, name: playerName, cm: playerCnic }, ...filledExtras]
    const dup = entered.find((p, i) => entered.findIndex(o => key(o) === key(p)) !== i)
    if (dup) { setError(`${dup.name.trim()} (${dup.cm.trim().toUpperCase()}) is entered more than once. Each player can only be added once.`); return }
    // Deposit slip is required before checkout
    if (slipBusy) { setError('Please wait — the deposit slip is still uploading.'); return }
    if (slipNeeded && !slip) { setSlipError('Please attach the deposit slip to continue.'); setError(''); return }
    // The cancelled booking's slip only covers what was paid then — more to pay needs a new slip
    if (slipNeeded && slip?.fromCancelled) {
      setSlipError(`The new slot costs more than you paid before. Please attach a new deposit slip for Rs. ${amountDue.toLocaleString()}.`)
      setError(''); return
    }
    if (refNeeded && !bankName.trim()) { setRefError('Please enter the bank name of the deposit slip.'); setError(''); return }
    if (refNeeded && !refNo.trim()) { setRefError('Please enter the reference no. printed on the deposit slip.'); setError(''); return }
    if (isFree) { setError(''); handleConfirm(); return } // nothing to pay: book it now, skip checkout
    setError(''); setStep(3)
    setTimeout(() => document.getElementById('step3')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  async function handleConfirm() {
    if (saving) return
    const start = parseInt(selectedTime), end = start + duration
    if (slipNeeded && (!slip || slip.fromCancelled)) { setError('Please go back and attach a deposit slip for the amount to pay.'); return }
    const court = courts.find(c => c.id === courtId)

    // Save to MySQL; the server re-checks the slot is still free
    setSaving(true); setError('')
    const payload = {
      courtId, courtName: court?.name, date: selectedDate, startHour: start, hours: duration,
      // A carried-over slip isn't sent as new — the server keeps the old booking's slip itself
      phone: playerPhone.trim(), depositSlip: slip && !slip.fromCancelled && !isFree ? slip.path : null, players: bookingPlayers(),
      referenceNo: isFree ? null : refNo.trim() || null, bankName: isFree ? null : bankName.trim() || null,
      slotRef: prefill ? null : newRef, // the number reserved for this booking
      junior: junior && inKidsWindow,
      rebookOf: rebook?.id || null, // the cancelled booking this replaces (removed after saving)
    }
    const result = editing ? await updateSlotApi(editing.id, payload) : await createSlotApi(payload)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      if (result.relogin === undefined && (result.processing || /just booked/.test(result.error))) setBookedVersion(v => v + 1) // refresh taken slots
      return
    }
    setSuccess(editing || rebook ? 'updated' : true)
    setPaymentPending(result.booking ? !result.booking.paymentReceived : false)
    setSavedRef(result.booking?.slotRef || null)
    if (editing) navigate(location.pathname, { replace: true, state: null })
    if (result.replaced && rebook) {
      setReplacedBooking(rebook) // (rebook itself is cleared by "Book Another")
      navigate(location.pathname, { replace: true, state: null }) // a refresh won't try to replace it again
    }

    // Email every registered player: "in process" now, "confirmed" once the admin approves the payment (runs in the background)
    setEmailStatus({ sending: true })
    sendBookingEmailsApi({
      court: court?.name,
      date: format(new Date(selectedDate + 'T00:00'), 'EEE, d MMMM yyyy'),
      time: formatSlotRange(start, end),
      duration: `${duration} ${duration === 1 ? 'hour' : 'hours'}`,
      total: `Rs. ${cost.total.toLocaleString()}`
        + (cost.freeHours ? ` (under-18: ${cost.freeHours} free ${cost.freeHours === 1 ? 'hour' : 'hours'})` : '')
        + (creditUse ? ` · Rs. ${creditUse.toLocaleString()} ${editing ? 'already paid' : 'paid from advance balance'}` : '')
        + (editing ? ' · booking changed' : ''),
      players: bookingPlayers(),
    }, result.booking?.id).then(setEmailStatus)
  }


  if (!user) return <LoginRequired message="Please log in to book a padel court" />

  if (success) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg" style={{ background: NAVY }}>
          <Check size={38} color="white" strokeWidth={3} />
        </div>
        <h2 className="text-2xl font-black mb-2" style={{ color: NAVY }}>{paymentPending ? (success === 'updated' ? 'Booking Updated — Processing' : 'Booking Received — Processing') : success === 'updated' ? 'Booking Updated!' : 'Booking Confirmed!'}</h2>
        <p className="text-sm mb-6" style={{ color: LGRAY }}>
          {success === 'updated' && refundBack > 0 ? `Rs. ${refundBack.toLocaleString()} added to your advance balance. ` : ''}
          {paymentPending ? 'Your payment is being processed. The booking will show as Confirmed once the club approves your deposit slip.' : 'See you on the court!'}
        </p>
        <div className="rounded-xl p-5 text-left text-sm mb-6 space-y-2.5" style={{ background: '#EEF2F7', border: `1px solid ${BORDER}` }}>
          {[
            ...(savedRef ? [['Slot Ref No.', savedRef]] : []),
            ['Team 1', teamPlayers(1).map(p => p.name.trim()).join(' & ') || '—'],
            ['Team 2', teamPlayers(2).map(p => p.name.trim()).join(' & ') || '—'],
            ...(slip ? [['Deposit slip', 'Attached ✓']] : []),
            ...(bankName.trim() ? [['Bank', bankName.trim()]] : []),
            ...(refNo.trim() ? [['Reference no.', refNo.trim()]] : []),
            ...(replacedBooking ? [['Replaces', `Cancelled booking of ${format(new Date(replacedBooking.date + 'T00:00'), 'EEE d MMM')}`]] : []),
            ['Price', cost.total ? `Rs. ${cost.total.toLocaleString()}${cost.freeHours ? ` (${cost.freeHours} hr free, U-18)` : ''}` : 'Free (under-18)'],
            ...(creditUse ? [[editing ? 'Paid before + advance' : 'Advance used', `− Rs. ${creditUse.toLocaleString()}`], ['Paid now', amountDue ? `Rs. ${amountDue.toLocaleString()}` : 'Nothing']] : []),
            ['Court', courts.find(c => c.id === courtId)?.name],
            ['Date', selectedDate ? formatDate(selectedDate) : ''],
            ['Time', formatSlotRange(parseInt(selectedTime), parseInt(selectedTime) + duration)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span style={{ color: LGRAY }}>{k}</span>
              <span className="font-bold" style={{ color: NAVY }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Booking email status */}
        {emailStatus && (
          <div className="rounded-xl px-4 py-3 text-left text-sm mb-6 flex gap-3"
            style={emailStatus.error
              ? { background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }
              : { background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46' }}>
            <Mail size={16} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              {emailStatus.sending && <p className="font-semibold">Sending booking emails to the players…</p>}
              {emailStatus.error && <p className="font-semibold">Booking emails were not sent: {emailStatus.error}</p>}
              {emailStatus.sent && (
                <>
                  <p className="font-semibold">
                    {emailStatus.sent.length
                      ? <>{emailStatus.stage === 'processing' ? '"Booking in process"' : '"Booking confirmed"'} email sent to <b>{emailStatus.sent.map(s => s.name).join(', ')}</b>.{emailStatus.stage === 'processing' && ' They will get a "confirmed" email once the club approves the payment.'}</>
                      : 'No booking emails were sent.'}
                  </p>
                  {emailStatus.skipped?.length > 0 && (
                    <p className="text-xs mt-1" style={{ color: '#92400E' }}>
                      Not emailed: {emailStatus.skipped.map(s => `${s.name} (${s.reason})`).join(', ')}.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-center">
          <button onClick={() => { setSuccess(false); setEditing(null); setRebook(null); setReplacedBooking(null); setSavedRef(null); setNewRef(null); setRefVersion(v => v + 1); setStep(1); setSelectedDate(''); setSelectedTime(''); setBookedVersion(v => v + 1); setPlayerName(user.name || ''); setPlayerCnic(user.membershipNo || ''); setPlayerPhone(user.phone || ''); setExtraPlayers(emptyExtraPlayers()); setSlip(null); setSlipError(''); setRefNo(''); setBankName(''); setOtherBank(false); setRefError(''); setEmailStatus(null); creditApi().then(r => setCredit(r.balance || 0)) }}
            className="btn font-bold px-6 py-2.5 rounded-xl text-sm" style={{ background: NAVY, color: 'white' }}>
            Book Another
          </button>
          <button onClick={() => navigate('/my-bookings')}
            className="font-semibold px-6 py-2.5 rounded-xl text-sm"
            style={{ border: `1.5px solid ${BORDER}`, color: '#4B5563', background: 'white' }}>
            My Bookings
          </button>
        </div>
      </div>
    )
  }

  const stepNumStyle = (active) => ({
    width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '12px', fontWeight: '800', background: active ? NAVY : '#DDE3EC', color: active ? 'white' : LGRAY, flexShrink: 0,
  })

  return (
    <div>
      {/* ── PAGE HEADING ── */}
      <div style={{ background: NAVY }}>
        <div className="max-w-4xl mx-auto px-4 py-4 sm:py-5 text-center">
          <h1 className="font-black text-white" style={{ fontSize: '24px', letterSpacing: '-0.5px' }}>
            {prefill ? 'Edit Booking' : 'Padel Court Booking'}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {editing ? 'Change the date, time, court or players, then save.'
              : rebook ? 'Pick a new date and time for your cancelled booking, then save.'
              : 'Select a date, pick a slot, confirm.'}
          </p>
        </div>
      </div>

    <div className="max-w-4xl mx-auto px-4 space-y-4 pt-4 pb-2">
      {/* Rebooking a cancelled booking */}
      {rebook && showRebookNote && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-2xl text-sm"
          style={{ background: '#EFF6FF', border: '1.5px solid #BFDBFE', color: NAVY }}>
          <RefreshCw size={16} className="shrink-0 mt-0.5" style={{ color: '#1D4ED8' }} />
          <div className="flex-1">
            <p className="font-bold">Editing your cancelled booking of {format(new Date(rebook.date + 'T00:00'), 'EEE d MMM')}, {formatSlotRange(rebook.startHour, rebook.endHour)} ({rebook.courtName})</p>
            <p className="text-xs mt-0.5" style={{ color: '#475569' }}>
              The court, players{slip?.fromCancelled ? ', deposit slip, bank name, reference no.' : ''} and old time are filled in — change the date and time, then save.
              {held > 0 && <> <b>Rs. {held.toLocaleString()}</b> already paid {rebook.depositSlip ? 'by its deposit slip ' : ''}is applied automatically.</>}
              {' '}Once saved, the booking is active again on the new date and the cancelled entry is replaced.
            </p>
          </div>
          <button type="button" onClick={() => setShowRebookNote(false)} aria-label="Close" className="btn-icon p-1 rounded-full" style={{ color: '#64748B' }}><X size={14} /></button>
        </div>
      )}

      {/* Editing an upcoming booking */}
      {editing && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-2xl text-sm"
          style={{ background: '#EFF6FF', border: '1.5px solid #BFDBFE', color: NAVY }}>
          <Pencil size={16} className="shrink-0 mt-0.5" style={{ color: '#1D4ED8' }} />
          <div className="flex-1">
            <p className="font-bold">
              Editing your booking of {format(new Date(editing.date + 'T00:00'), 'EEE d MMM')}, {formatSlotRange(editing.startHour, editing.endHour)} ({editing.courtName})
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#475569' }}>
              {(editing.refundable || 0) > 0
                ? <>The <b>Rs. {editing.refundable.toLocaleString()}</b> already paid stays with this booking. A cheaper slot puts the difference on your advance balance; a dearer one needs only the extra.</>
                : 'Change anything below and save.'}
            </p>
          </div>
          <button type="button" onClick={() => navigate('/my-bookings')} className="btn-text text-xs font-bold shrink-0" style={{ color: '#64748B' }}>Cancel edit</button>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {/* ── STEP 1 ── */}
      <div id="step1" style={{ ...card, scrollMarginTop: '84px' }}>
        <div className="px-5 sm:px-6 pt-4">
          {/* Step title + court choice */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div style={stepNumStyle(true)}>1</div>
            <span className="font-black text-lg" style={{ color: NAVY }}>Select date and time</span>
            {/* Slot reference no.: given by the server when the booking is saved (kept when editing) */}
            <div className="flex items-center gap-1.5 ml-auto" title="Unique slot reference no. — generated automatically for this booking">
              <span className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: LGRAY }}>Slot Ref</span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap"
                style={{ border: `1px solid ${BORDER}`, background: '#F1F5F9', color: savedRef || prefill?.slotRef || newRef ? NAVY : '#94A3B8', fontFamily: 'Consolas, monospace' }}>
                {slotRefText}
              </span>
            </div>
            <div className="flex gap-2">
              {courts.map(c => (
                <button key={c.id} onClick={() => chooseCourt(c.id)}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border transition"
                  style={courtId === c.id ? { background: NAVY, color: 'white', borderColor: NAVY } : { background: 'white', color: '#4B5563', borderColor: BORDER }}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Calendar left, time + duration right (stacked on phones) */}
          <div className="md:grid md:gap-7 md:items-start" style={{ gridTemplateColumns: '1fr 1.2fr' }}>

          {/* ── Calendar: dates under their real weekday ── */}
          <div className="mb-5 md:mb-0">
            <div className="flex items-center justify-between mb-2">
              <span style={{ ...sectionLabel, marginBottom: 0 }}>Select Date</span>
              <span className="text-xs font-bold" style={{ color: NAVY }}>{calendarTitle}</span>
            </div>
            <div className="rounded-xl p-2" style={{ border: `1px solid ${BORDER}`, background: '#FBFCFE' }}>
              <div className="grid grid-cols-7 mb-0.5">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                  <div key={d} className="text-center text-[11px] font-semibold py-1" style={{ color: LGRAY }}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: leadingBlanks }, (_, i) => <span key={`blank-${i}`} />)}
                {dates.map((d, i) => {
                  const active = selectedDate === d.key
                  const isToday = i === 0
                  const showMonth = i === 0 || d.num === 1
                  return (
                    <button key={d.key} type="button" onClick={() => chooseDate(d.key)}
                      aria-pressed={active} title={isToday ? `Today · ${d.label}` : d.label}
                      className="relative h-9 rounded-lg flex flex-col items-center justify-center"
                      style={active
                        ? { background: NAVY, color: 'white', boxShadow: '0 4px 10px rgba(27,46,75,0.25)' }
                        : { background: 'transparent', color: NAVY }}>
                      {showMonth && (
                        <span className="text-[8px] font-bold uppercase leading-none"
                          style={{ color: active ? 'rgba(255,255,255,0.75)' : '#4A6FA5' }}>{d.month}</span>
                      )}
                      <span className="text-sm font-bold leading-tight">{d.num}</span>
                      {isToday && (
                        <span className="absolute rounded-full" style={{ bottom: 3, width: 4, height: 4, background: active ? 'white' : '#4A6FA5' }} />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div>
          {/* ── Time slots grouped by part of day ── */}
          <div ref={timeSection} className="mb-4" style={{ scrollMarginTop: "140px" }}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-sm font-black uppercase tracking-wide" style={{ color: NAVY }}>
                  <Clock size={16} strokeWidth={2.5} /> Select Time
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#E0E7FF', color: '#3730A3' }}>
                  Open {formatHourShort(TIME_SLOTS[0])} – {formatHourShort(TIME_SLOTS[TIME_SLOTS.length - 1] + 1)}
                </span>
              </span>
              {/* Legend: each chip looks like the slot button it explains */}
              {selectedDate && (
                <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: NAVY, color: 'white', border: `1.5px solid ${NAVY}` }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: 'white' }} />Selected
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: '#FEF2F2', color: '#DC2626', border: '1.5px solid #FCA5A5' }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: '#EF4444' }} />Booked
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: '#FFFBEB', color: '#B45309', border: '1.5px solid #FCD34D' }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: '#F59E0B' }} />Processing
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: 'white', color: '#334155', border: `1.5px solid ${BORDER}` }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: '#94A3B8' }} />Available
                  </span>
                </div>
              )}
            </div>
            {!selectedDate ? (
              <div className="rounded-xl flex flex-col items-center justify-center gap-1 text-sm py-12"
                style={{ border: `1.5px dashed ${BORDER}`, color: LGRAY }}>
                <Calendar size={20} />
                Pick a date to see the available times
              </div>
            ) : (
              <div className="space-y-2">
                {/* Day nearly full: only under-18 slots left, or nothing left at all */}
                {(() => {
                  const kidsHours = TIME_SLOTS.filter(h => h >= KIDS_FREE_FROM && h < KIDS_FREE_TO)
                  const otherHours = TIME_SLOTS.filter(h => h < KIDS_FREE_FROM || h >= KIDS_FREE_TO)
                  const kidsFree = kidsHours.filter(h => !isHourBooked(h))
                  const otherFull = otherHours.length > 0 && otherHours.every(isHourBooked)
                  if (!otherFull) return null
                  return kidsFree.length ? (
                    <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-sm font-semibold" role="status"
                      style={{ background: '#FDE68A', border: '1.5px solid #F59E0B', borderLeft: '6px solid #D97706', color: '#78350F', boxShadow: '0 4px 14px rgba(217,119,6,0.25)' }}>
                      <AlertCircle size={20} strokeWidth={2.5} className="shrink-0" style={{ color: "#B45309" }} />
                      <span><b>Fully booked</b> — only under-18 slots left ({
                        kidsFree.every((h, i) => !i || h === kidsFree[i - 1] + 1)
                          ? formatSlotRange(kidsFree[0], kidsFree[kidsFree.length - 1] + 1) // one block, e.g. 3pm–6pm
                          : kidsFree.map(h => formatSlotRange(h, h + 1)).join(', ')
                      }).</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-sm font-semibold" role="status"
                      style={{ background: '#FECACA', border: '1.5px solid #F87171', borderLeft: '6px solid #DC2626', color: '#7F1D1D', boxShadow: '0 4px 14px rgba(220,38,38,0.22)' }}>
                      <AlertCircle size={20} strokeWidth={2.5} className="shrink-0" style={{ color: "#B91C1C" }} />
                      <span><b>Fully booked</b> — please pick another date or court.</span>
                    </div>
                  )
                })()}
                {/* This week's bookings by time (Mon–Sun): each time can be booked twice a week */}
                {Object.keys(weekCounts).length > 0 && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl text-xs" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E3A8A' }}>
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>
                      <b>Your bookings this week:</b>{' '}
                      {Object.entries(weekCounts).sort(([a], [b]) => a - b).map(([h, n], i) => (
                        <span key={h}>{i > 0 && ' · '}<span style={n >= SAME_TIME_PER_WEEK ? { color: '#B91C1C', fontWeight: 800 } : { fontWeight: 700 }}>
                          {formatSlotRange(+h, +h + 1)} ×{n}{n >= SAME_TIME_PER_WEEK ? ' (full)' : ''}</span></span>
                      ))}
                      <span className="block" style={{ color: '#64748B' }}>The same time can be booked twice a week (Monday–Sunday).</span>
                    </span>
                  </div>
                )}
                {SLOT_GROUPS.map(g => (
                  <div key={g.label}>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: g.kids ? '#047857' : LGRAY }}>
                      {g.label}
                      {g.kids && <span> · {formatHourShort(KIDS_FREE_FROM)}–{formatHourShort(KIDS_FREE_TO)} only for under-18 players (free)</span>}
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-1.5">
                      {TIME_SLOTS.filter(h => h >= g.from && h < g.to).map(hour => {
                        const booked = isHourBooked(hour)
                        const start = parseInt(selectedTime)
                        const sel = start === hour
                        const inRange = selectedTime && hour > start && hour < start + duration // rest of a 2–3 hr booking
                        const kidsFree = hour >= KIDS_FREE_FROM && hour < KIDS_FREE_TO
                        const kidsOnly = !under18 && kidsFreeHours(hour, duration) > 0 // greyed out for 18+ members
                        const held = !booked && isHourHeld(hour) // another member is booking it right now
                        const weekLimit = weekFull(hour) // this time already booked twice this week
                        const avail = !booked && !kidsOnly && !weekLimit && !rangeOverlapsBooked(hour, hour + duration) && !rangeOverlapsHeld(hour, hour + duration) && hour + duration <= 24
                        let style
                        if (sel) style = { background: NAVY, color: 'white', border: `1.5px solid ${NAVY}`, boxShadow: '0 4px 10px rgba(27,46,75,0.25)' }
                        else if (booked) style = { background: '#FEF2F2', color: '#EF4444', border: '1.5px solid #FECACA' }
                        else if (held) style = { background: '#FFFBEB', color: '#B45309', border: '1.5px solid #FCD34D', cursor: 'not-allowed' }
                        else if (inRange) style = { background: '#E3EAF4', color: NAVY, border: `1.5px solid #B6C4D6` }
                        else if (!avail) style = { background: '#F8F9FB', color: '#C8D3E0', border: '1.5px solid #EEF2F7', cursor: 'not-allowed' }
                        else style = { background: 'white', color: '#334155', border: `1.5px solid ${BORDER}` }
                        return (
                          <button key={hour} type="button" onClick={() => handleSlotClick(hour)}
                            title={booked ? `${formatSlotRange(hour, hour + 1)} · booked` : weekLimit ? `${formatSlotRange(hour, hour + 1)} · you already booked this time twice this week` : held ? `${formatSlotRange(hour, hour + 1)} · processing (another member is booking it)` : kidsFree ? `${formatSlotRange(hour, hour + 1)} · only for under-18 players` : formatSlotRange(hour, hour + 1)}
                            className="relative h-11 sm:h-8 px-1 rounded-lg text-sm sm:text-xs font-semibold whitespace-nowrap"
                            style={{ ...style, textDecoration: booked ? 'line-through' : 'none' }}>
                            {formatSlotRange(hour, hour + 1)}
                            {weekLimit && !booked ? (
                              <span className="absolute -top-1.5 right-1 px-1 rounded text-[8px] font-black leading-tight"
                                style={{ background: '#B91C1C', color: 'white', textDecoration: 'none' }}>2/2 WEEK</span>
                            ) : held ? (
                              <span className="absolute -top-1.5 right-1 px-1 rounded text-[8px] font-black leading-tight"
                                style={{ background: '#D97706', color: 'white', textDecoration: 'none' }}>PROCESSING</span>
                            ) : kidsFree && !booked && (
                              <span className="absolute -top-1.5 right-1 px-1 rounded text-[8px] font-black leading-tight"
                                style={{ background: kidsOnly ? '#94A3B8' : '#047857', color: 'white', textDecoration: 'none' }}>
                                {kidsOnly ? 'U18 ONLY' : 'U18 FREE'}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* No duration choice: new bookings are 1 hour; an edited booking keeps its own length */}
          <div className="mb-1">
            {/* Overlap warning (an edited 2–3 hr booking whose new start time runs into another booking) */}
            {selectedTime && durationConflict && (
              <div className="w-full flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm"
                style={{ background: '#FEF2F2', border: '1.5px solid #FCA5A5', color: '#DC2626' }}>
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-black">Slot overlap</p>
                  <p className="text-xs mt-0.5" style={{ color: '#EF4444' }}>
                    {duration} {duration === 1 ? 'hour' : 'hours'} from {formatHour(parseInt(selectedTime))} runs into a booked slot.
                    Choose another start time or date.
                  </p>
                </div>
              </div>
            )}

            {/* Under-18 member in kids time (3pm–6pm): free automatically */}
            {inKidsWindow && junior && !durationConflict && (
              <div className="mt-2 flex items-start gap-2.5 px-3 py-2 rounded-xl"
                style={{ background: '#ECFDF5', border: '1.5px solid #6EE7B7' }}>
                <Check size={16} strokeWidth={3} className="shrink-0 mt-0.5" style={{ color: '#047857' }} />
                <span className="text-xs leading-snug" style={{ color: NAVY }}>
                  <b style={{ color: '#047857' }}>Free for you (under-18)</b> — {formatHourShort(KIDS_FREE_FROM)}–{formatHourShort(KIDS_FREE_TO)} is free
                  {' '}({kidsFreeHours(startHour, duration)} of {duration} {duration === 1 ? 'hour' : 'hours'} free).
                  {cost.total === 0 && <> No deposit slip or payment needed.</>}
                  <span className="block" style={{ color: LGRAY }}>Age may be checked at the court.</span>
                </span>
              </div>
            )}
          </div>
          </div>{/* right column */}
          </div>{/* calendar | time grid */}
        </div>

        {error && step === 1 && (
          <div className="mx-5 sm:mx-6 mb-3 rounded-xl px-4 py-2.5 text-sm"
            style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FEE2E2' }}>
            {error}
          </div>
        )}

        <div className="px-5 sm:px-6 pb-5">
          {/* Summary of the choice so far */}
          {selectedDate && selectedTime && !durationConflict && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 mb-3 rounded-xl text-sm"
              style={{ background: '#EEF2F7', color: NAVY }}>
              <span className="flex items-center gap-1.5 font-semibold"><Calendar size={14} style={{ color: '#4A6FA5' }} />
                {format(new Date(selectedDate + 'T00:00'), 'EEE, d MMM')}</span>
              <span className="flex items-center gap-1.5 font-semibold"><Clock size={14} style={{ color: '#4A6FA5' }} />
                {formatSlotRange(parseInt(selectedTime), parseInt(selectedTime) + duration)}</span>
              <span className="font-semibold">{duration} {duration === 1 ? 'hr' : 'hrs'}</span>
              <span className="font-semibold">{courts.find(c => c.id === courtId)?.name}</span>
              {cost.freeHours > 0 && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#047857', color: 'white' }}>U-18 · {cost.freeHours} hr free</span>}
              {creditUse > 0 && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#1D4ED8', color: 'white' }}>{advLabel} − Rs. {creditUse.toLocaleString()}</span>}
              <span className="ml-auto font-black">
                {cost.total === 0 ? 'Free' : amountDue === 0 ? (prefill ? 'Already paid' : 'Paid by advance') : `${creditUse ? 'To pay ' : ''}Rs. ${amountDue.toLocaleString()}`}
              </span>
            </div>
          )}
          <button onClick={goStep2} disabled={durationConflict}
            className="btn w-full py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 tracking-wide"
            style={selectedDate && selectedTime && !durationConflict
              ? { background: NAVY, color: 'white', boxShadow: '0 4px 14px rgba(27,46,75,0.25)', cursor: 'pointer' }
              : durationConflict
                ? { background: '#FEE2E2', color: '#DC2626', border: '2px solid #FCA5A5', cursor: 'not-allowed' }
                : { background: '#EEF2F7', color: '#B0BFCC', cursor: 'not-allowed' }}>
            {durationConflict ? '⚠️ Fix Overlap to Continue' : <> NEXT <ArrowRight size={17} /> </>}
          </button>
        </div>
      </div>

      {/* ── STEP 2 ── */}
      {/* overflow visible so the member search list isn't cut off at the card edge */}
      <div id="step2" style={{ ...card, overflow: 'visible', position: 'relative', zIndex: 2, opacity: step >= 2 ? 1 : 0.55, scrollMarginTop: '84px' }}>
        <div className="px-5 sm:px-6 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div style={stepNumStyle(step >= 2)}>2</div>
            <span className="font-black text-lg" style={{ color: step >= 2 ? NAVY : LGRAY }}>Players Selection</span>
            {step >= 2 && (
              <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: '#EEF2F7', color: NAVY }}>
                {playerCount} / 4 players
              </span>
            )}
          </div>

          {step >= 2 ? (
            <>
              {/* Team 1 (players 1 & 2)  VS  Team 2 (players 3 & 4) */}
              {(() => {
                const nameIcon = <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
                const cmIcon = (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: LGRAY }}>
                    <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
                  </svg>
                )
                const inputStyleWithIcon = { ...compactInput, paddingLeft: '34px', background: 'white' }

                const renderPlayer = p => {
                  // Players already in other rows are hidden from this row's search results
                  const others = allPlayers.filter(o => o.n !== p.n && o.name.trim() && o.cm.trim())
                  // Same person (name + CM No.) already in an earlier row → this row is shown in red
                  const playerKey = o => `${o.name.trim().toLowerCase()}|${o.cm.trim().toUpperCase()}`
                  const dupOf = p.name.trim() && p.cm.trim() ? allPlayers.find(o => o.n < p.n && playerKey(o) === playerKey(p)) : null
                  return (
                    <div key={p.n} className="flex items-start gap-2.5">
                      <span className="mt-5" title={p.you ? 'Player 1 (you)' : `Player ${p.n} (optional)`}><PlayerAvatar player={p} /></span>
                      <div className="flex-1 min-w-0">
                      {/* Label above each row: Player 1 is you; players 2–4 are optional */}
                      <p className="flex items-center gap-1.5 mb-1 text-[10px] font-black uppercase tracking-wider" style={{ color: NAVY }}>
                        Player {p.n}
                        {p.you
                          ? <span className="px-1.5 py-px rounded" style={{ background: NAVY, color: 'white' }}>You</span>
                          : <span className="px-1.5 py-px rounded normal-case tracking-normal font-bold" style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' }}>Optional</span>}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {p.you ? (
                          <>
                            <div className="relative">
                              {nameIcon}
                              <input type="text" value={p.name} placeholder="Your name"
                                onChange={e => setPlayerName(e.target.value)} style={inputStyleWithIcon} />
                            </div>
                            <div className="relative">
                              {cmIcon}
                              <input type="text" value={p.cm} maxLength={20} placeholder="NNG-0001"
                                onChange={e => setPlayerCnic(e.target.value.toUpperCase())} style={inputStyleWithIcon} />
                            </div>
                          </>
                        ) : (
                          <>
                            <MemberCombo value={p.name} icon={nameIcon} exclude={others}
                              placeholder="Select player"
                              onPick={m => pickExtra(p.n, m)}
                              style={dupOf ? { ...inputStyleWithIcon, borderColor: '#DC2626', background: '#FEF2F2' } : inputStyleWithIcon} />
                            <MemberSearchInput field="cm" value={p.cm} icon={cmIcon} exclude={others}
                              placeholder="or CM No."
                              onChange={v => updateExtra(p.n, 'cm', v)} onPick={m => pickExtra(p.n, m)}
                              style={dupOf ? { ...inputStyleWithIcon, borderColor: '#DC2626', background: '#FEF2F2' } : inputStyleWithIcon} />
                          </>
                        )}
                      </div>
                      {dupOf && (
                        <p className="flex items-center gap-1 mt-1 text-[11px] font-bold" style={{ color: '#DC2626' }}>
                          <AlertCircle size={12} className="shrink-0" />
                          Already added as Player {dupOf.n}{dupOf.you ? ' (you)' : ''} — please choose a different player.
                        </p>
                      )}
                      </div>
                    </div>
                  )
                }

                const teamCard = (team, color, players) => (
                  <div className="flex-1 min-w-0 rounded-xl" style={{ border: `1.5px solid ${color}33`, background: `${color}0D` }}>
                    <div className="flex items-center justify-between px-3 py-1.5 rounded-t-xl" style={{ background: color }}>
                      <span className="text-xs font-black tracking-wider text-white">TEAM {team}</span>
                      <span className="text-[10px] font-semibold text-white/70">
                        {players.filter(p => p.name.trim()).length} / 2
                      </span>
                    </div>
                    <div className="p-2.5 space-y-2">{players.map(renderPlayer)}</div>
                  </div>
                )

                return (
                  <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 mb-2">
                    {teamCard(1, NAVY, allPlayers.slice(0, 2))}
                    <div className="self-center shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-black text-sm"
                      style={{ background: 'white', color: NAVY, border: `2px solid ${BORDER}`, boxShadow: '0 4px 12px rgba(27,46,75,0.12)' }}>
                      VS
                    </div>
                    {teamCard(2, '#4A6FA5', allPlayers.slice(2, 4))}
                  </div>
                )
              })()}
              <p className="text-xs mb-3" style={{ color: LGRAY }}>
                Players 2–4 are optional — type a name or CM No. and pick the member from the list.
              </p>

              {/* Wide screens: contact phone | deposit slip | total, then bank name | reference no.
                  Highlighted blue panel so these details aren't missed */}
              <div className="grid sm:grid-cols-2 md:grid-cols-6 gap-3 mb-3 items-end p-3 sm:p-4 rounded-2xl"
                style={{ background: '#EFF6FF', border: `2px solid #BFDBFE`, boxShadow: 'inset 4px 0 0 #3B82F6' }}>
                <p className="sm:col-span-2 md:col-span-6 order-first flex items-center gap-2 text-sm font-black -mb-1" style={{ color: '#1D4ED8' }}>
                  <Landmark size={15} /> {isFree ? 'Contact Details' : <>Payment &amp; Contact Details</>}
                  <span className="text-[11px] font-semibold" style={{ color: '#64748B' }}>
                    {isFree ? '— free booking, no payment needed' : '— please fill these in carefully'}
                  </span>
                </p>
                <div className={isFree ? 'md:col-span-4' : 'md:col-span-2'}>
                  <label style={{ ...keyLabel }}>Contact Phone</label>
                  <div className="relative">
                    <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: KEY_BLUE }} />
                    <input type="tel" placeholder="0300 1234567" value={playerPhone}
                      onChange={e => setPlayerPhone(e.target.value)}
                      style={{ ...keyInput, paddingLeft: '34px' }} />
                  </div>
                </div>

                {/* Free booking (under-18 kids time): no slip, bank or reference no. */}
                {!isFree && (<>
                {/* Deposit slip (required unless the booking is free) */}
                <div className="min-w-0 md:col-span-2">
                  <label style={{ ...keyLabel, color: slipError ? '#DC2626' : NAVY }} title={`JPG, PNG, WEBP or PDF · max ${MAX_SLIP_MB} MB`}>
                    Deposit Slip{slipNeeded ? ' *' : ''} <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: LGRAY }}>
                      ({slipNeeded ? 'required' : cost.total === 0 ? 'not needed · free' : 'not needed · paid'})
                    </span>
                  </label>
                  {slip ? (
                    <div className="flex items-center gap-2 px-2 rounded-xl" style={{ height: '40px', background: '#ECFDF5', border: '2px solid #6EE7B7' }}>
                      {slip.type === 'application/pdf'
                        ? <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: '#FEE2E2', color: '#DC2626' }}><FileText size={14} /></span>
                        : <img src={slip.path} alt="Deposit slip" className="w-7 h-7 rounded-md object-cover shrink-0" style={{ border: `1px solid ${BORDER}` }} />}
                      <span className="min-w-0 flex-1 text-xs font-bold truncate flex items-center gap-1" style={{ color: '#047857' }} title={slip.name}>
                        <Check size={12} strokeWidth={3} className="shrink-0" /> <span className="truncate">{slip.name || 'Attached'}</span>
                      </span>
                      <a href={slip.path} target="_blank" rel="noreferrer" className="link text-xs font-bold" style={{ color: '#4A6FA5' }}>View</a>
                      <button type="button" onClick={() => slipInput.current?.click()} className="btn-text text-xs font-bold" style={{ color: NAVY }}>Change</button>
                      <button type="button" onClick={() => setSlip(null)} title="Remove" aria-label="Remove deposit slip"
                        className="btn-icon p-1 rounded-full" style={{ color: '#DC2626' }}><X size={13} /></button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => slipInput.current?.click()} disabled={slipBusy}
                      title="JPG, PNG, WEBP or PDF"
                      className="w-full flex items-center justify-center gap-2 px-3 rounded-xl text-sm font-black"
                      style={{ height: '40px', border: `2px dashed ${slipError ? '#DC2626' : KEY_BLUE}`, background: slipError ? '#FEF2F2' : '#DBEAFE', color: slipError ? '#DC2626' : '#1D4ED8' }}>
                      <Paperclip size={15} /> {slipBusy ? 'Uploading…' : 'Attach deposit slip'}
                    </button>
                  )}
                  <input ref={slipInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleSlip} className="hidden" />
                </div>

                {/* Bank name + reference no. of the deposit slip (required with a newly attached slip) */}
                <div className="min-w-0 md:col-span-3 order-last">
                  <label htmlFor="bank-name" style={{ ...keyLabel, color: refError && !bankName.trim() ? '#DC2626' : NAVY }}>
                    Bank Name{refNeeded ? ' *' : ''} <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: LGRAY }}>
                      ({refNeeded ? 'required' : 'of the slip'})
                    </span>
                  </label>
                  <div className="relative">
                    <Landmark size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: KEY_BLUE }} />
                    <select id="bank-name" value={otherBank ? 'other' : bankName}
                      onChange={e => {
                        const v = e.target.value
                        setOtherBank(v === 'other'); setBankName(v === 'other' ? '' : v); setRefError('')
                      }}
                      style={{ ...keyInput, paddingLeft: '34px', cursor: 'pointer', color: bankName || otherBank ? NAVY : LGRAY,
                        borderColor: refError && !bankName.trim() ? '#DC2626' : '#93C5FD', background: refError && !bankName.trim() ? '#FEF2F2' : keyInput.background }}>
                      <option value="">Select bank</option>
                      {BANK_GROUPS.map(g => (
                        <optgroup key={g.label} label={g.label}>
                          {g.banks.map(b => <option key={b} value={b}>{b}</option>)}
                        </optgroup>
                      ))}
                      <option value="other">Other (type the name)</option>
                    </select>
                  </div>
                  {otherBank && (
                    <input type="text" value={bankName} maxLength={60} placeholder="Type the bank name" autoFocus autoComplete="off"
                      onChange={e => { setBankName(e.target.value); setRefError('') }}
                      className="mt-1.5" style={{ ...keyInput, borderColor: refError && !bankName.trim() ? '#DC2626' : '#93C5FD' }} />
                  )}
                </div>

                <div className="min-w-0 md:col-span-3 order-last">
                  <label htmlFor="ref-no" style={{ ...keyLabel, color: refError && bankName.trim() && !refNo.trim() ? '#DC2626' : NAVY }}>
                    Reference No.{refNeeded ? ' *' : ''} <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: LGRAY }}>
                      ({refNeeded ? 'required' : 'on the slip'})
                    </span>
                  </label>
                  <div className="relative">
                    <FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: KEY_BLUE }} />
                    <input id="ref-no" type="text" value={refNo} maxLength={50} placeholder="e.g. TRX-123456" autoComplete="off"
                      onChange={e => { setRefNo(e.target.value.toUpperCase()); setRefError('') }}
                      style={{ ...keyInput, paddingLeft: '34px', ...(refError && bankName.trim() && !refNo.trim() ? { borderColor: '#DC2626', background: '#FEF2F2' } : {}) }} />
                  </div>
                </div>
                </>)}

                <div className="md:col-span-2 rounded-xl px-3 py-2 flex items-center justify-between gap-2"
                  style={{ background: '#EEF2F7', border: `1px solid ${BORDER}`, minHeight: '38px' }}>
                  <div className="text-[11px] leading-tight" style={{ color: LGRAY }}>
                    <span className="font-bold whitespace-nowrap" style={{ color: NAVY }}>Rs. {RATE_PER_HOUR.toLocaleString()}/hr</span>
                    <span className="block whitespace-nowrap">× <b style={{ color: NAVY }}>{cost.paidHours} {cost.paidHours === 1 ? 'hr' : 'hrs'}</b></span>
                    {cost.freeHours > 0 && <span className="block font-bold" style={{ color: '#047857' }}>+ {cost.freeHours} hr free (U-18)</span>}
                  </div>
                  <div className="text-right leading-tight">
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: LGRAY }}>{creditUse ? 'To pay' : 'Total'}</p>
                    <p className="font-black text-base whitespace-nowrap" style={{ color: NAVY }}>
                      {cost.total === 0 ? 'Free' : amountDue === 0 ? 'Rs. 0' : `Rs. ${amountDue.toLocaleString()}`}
                    </p>
                    {creditUse > 0 && <p className="text-[10px] font-bold" style={{ color: '#1D4ED8' }}>{advLabel.toLowerCase()} − Rs. {creditUse.toLocaleString()}</p>}
                  </div>
                </div>
              </div>
              {/* The old booking's slip, when a different slip was attached or it was removed */}
              {oldSlip && slip?.path !== oldSlip && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 mb-3 rounded-xl text-xs"
                  style={{ background: '#FFFBEB', border: '1.5px solid #FDE68A', color: '#92400E' }}>
                  <a href={oldSlip} target="_blank" rel="noreferrer" className="shrink-0" title="Open the slip">
                    {oldSlip.toLowerCase().endsWith('.pdf')
                      ? <span className="w-9 h-9 rounded-md flex items-center justify-center" style={{ background: '#FEE2E2', color: '#DC2626' }}><FileText size={16} /></span>
                      : <img src={oldSlip} alt="Deposit slip of the cancelled booking" className="w-9 h-9 rounded-md object-cover block" style={{ border: '1px solid #FDE68A' }} />}
                  </a>
                  <span className="flex-1 min-w-0">
                    <b className="block" style={{ color: NAVY }}>Deposit slip from the {editing ? 'booking' : 'cancelled booking'}</b>
                    {[prefill?.bankName, prefill?.referenceNo && `Ref ${prefill.referenceNo}`].filter(Boolean).join(' · ') || 'Its payment still counts for this booking.'}
                  </span>
                  <a href={oldSlip} target="_blank" rel="noreferrer" className="link font-bold shrink-0" style={{ color: '#4A6FA5' }}>View</a>
                  {!slip && (
                    <button type="button" onClick={() => {
                      setSlip({ path: oldSlip, name: editing ? 'Slip from this booking' : 'Slip from cancelled booking', fromCancelled: true, type: oldSlip.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/*' })
                      setBankName(prefill?.bankName || ''); setOtherBank(!!prefill?.bankName && !ALL_BANKS.includes(prefill.bankName))
                      setRefNo(prefill?.referenceNo || ''); setRefError('')
                    }}
                      className="btn-text font-bold shrink-0" style={{ color: NAVY }}>Use this slip</button>
                  )}
                </div>
              )}
              {(slipError || refError) && (
                <p className="text-xs -mt-1 mb-3 font-semibold flex items-center gap-1.5" style={{ color: '#DC2626' }}>
                  <AlertCircle size={13} /> {slipError || refError}
                </p>
              )}

              {error && step === 2 && (
                <div className="mb-4 rounded-xl px-4 py-2.5 text-sm"
                  style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FEE2E2' }}>
                  {error}
                </div>
              )}
              {/* Free (under-18 kids time): book straight away — no checkout step, no payment */}
              <button onClick={goStep3} disabled={saving}
                className="btn w-full py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 tracking-wide"
                style={isFree
                  ? { background: '#047857', color: 'white', boxShadow: '0 4px 14px rgba(4,120,87,0.3)', opacity: saving ? 0.7 : 1 }
                  : { background: NAVY, color: 'white', boxShadow: '0 4px 14px rgba(27,46,75,0.25)' }}>
                {isFree
                  ? <>{saving ? 'BOOKING…' : editing ? 'SAVE — FREE (UNDER-18)' : 'BOOK NOW — FREE (UNDER-18)'} <Check size={17} strokeWidth={3} /></>
                  : <>NEXT <ArrowRight size={17} /></>}
              </button>
            </>
          ) : (
            <p className="text-sm pb-1" style={{ color: '#C8D3E0' }}>Up to 4 players</p>
          )}
        </div>
      </div>

      {/* ── STEP 3 ── */}
      <div id="step3" style={{ ...card, opacity: step >= 3 ? 1 : 0.55, scrollMarginTop: '84px' }}>
        <div className="px-5 sm:px-6 py-4">
          <div className="flex items-center gap-3 mb-4">
            <div style={stepNumStyle(step >= 3)}>3</div>
            <span className="font-black text-lg" style={{ color: step >= 3 ? NAVY : LGRAY }}>Checkout</span>
            {step >= 3 && (
              <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: '#EEF2F7', color: NAVY }}>
                {slotRefText.startsWith('SLOT-') ? <>Slot Ref: <span style={{ fontFamily: 'Consolas, monospace' }}>{slotRefText}</span></> : <>Review &amp; confirm</>}
              </span>
            )}
          </div>

          {step >= 3 ? (
            <>
              {/* Booking details: 4 tiles */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                {[
                  { icon: <MapPin size={15} />, label: 'Court', value: courts.find(c => c.id === courtId)?.name },
                  { icon: <Calendar size={15} />, label: 'Date', value: selectedDate ? format(new Date(selectedDate + 'T00:00'), 'EEE d MMM') : '' },
                  { icon: <Clock size={15} />, label: 'Time', value: formatSlotRange(parseInt(selectedTime), parseInt(selectedTime) + duration) },
                  { icon: <Timer size={15} />, label: 'Duration', value: `${duration} ${duration === 1 ? 'hour' : 'hours'}` },
                ].map(t => (
                  <div key={t.label} className="flex items-center gap-2.5 px-3 py-2 rounded-xl" style={{ background: '#F5F7FA', border: `1px solid ${BORDER}` }}>
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'white', color: '#4A6FA5', border: `1px solid ${BORDER}` }}>{t.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: LGRAY }}>{t.label}</span>
                      <span className="block text-sm font-bold truncate" style={{ color: NAVY }}>{t.value}</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* Team 1 VS Team 2 (equal-height cards) */}
              <div className="flex flex-col md:flex-row md:items-stretch gap-2 md:gap-3 mb-3">
                {[1, 2].map(team => {
                  const color = team === 1 ? NAVY : '#4A6FA5'
                  const teamBox = (
                    <div key={team} className="flex-1 min-w-0 rounded-xl overflow-hidden flex flex-col" style={{ border: `1.5px solid ${color}33` }}>
                      <div className="flex items-center justify-between px-3 py-1.5" style={{ background: color }}>
                        <span className="text-xs font-black tracking-wider text-white">TEAM {team}</span>
                        <span className="text-[10px] font-semibold text-white/70">{teamPlayers(team).length} / 2</span>
                      </div>
                      <div className="flex-1 px-3 py-2 space-y-1.5" style={{ background: `${color}0D` }}>
                        {teamPlayers(team).length ? teamPlayers(team).map(p => (
                          <div key={p.n} className="flex items-center gap-2.5 min-w-0">
                            <PlayerAvatar player={p} size={28} />
                            <span className="text-sm font-bold truncate" style={{ color: NAVY }}>{p.name.trim()}</span>
                            <span className="ml-auto text-xs font-semibold shrink-0" style={{ color: LGRAY }}>{p.cm.trim()}</span>
                          </div>
                        )) : (
                          <p className="text-sm py-1" style={{ color: LGRAY }}>No players added</p>
                        )}
                      </div>
                    </div>
                  )
                  return team === 1 ? teamBox : [
                    <div key="vs" className="self-center shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-black text-xs"
                      style={{ background: 'white', color: NAVY, border: `2px solid ${BORDER}`, boxShadow: '0 4px 12px rgba(27,46,75,0.12)' }}>VS</div>,
                    teamBox,
                  ]
                })}
              </div>

              {/* Contact | deposit slip | payment, then bank name | reference no. */}
              <div className="grid sm:grid-cols-2 md:grid-cols-6 gap-2 mb-4">
                {[
                  ...(isFree ? [] : [ // free booking: no bank / reference no.
                  { icon: <Landmark size={15} />, label: 'Bank Name', value: bankName.trim() },
                  { icon: <FileText size={15} />, label: 'Reference No.', value: refNo.trim() }]),
                ].map(t => (
                  <div key={t.label} className="md:col-span-3 order-last flex items-center gap-2.5 px-3 py-2 rounded-xl" style={{ background: '#F5F7FA', border: `1px solid ${BORDER}` }}>
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'white', color: '#4A6FA5', border: `1px solid ${BORDER}` }}>{t.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: LGRAY }}>{t.label}{refNeeded ? ' *' : ''}</span>
                      <span className="block text-sm font-bold truncate" style={{ color: t.value ? NAVY : LGRAY }} title={t.value}>{t.value || '—'}</span>
                    </span>
                  </div>
                ))}
                <div className="md:col-span-2 flex items-center gap-2.5 px-3 py-2 rounded-xl" style={{ background: '#F5F7FA', border: `1px solid ${BORDER}` }}>
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'white', color: '#4A6FA5', border: `1px solid ${BORDER}` }}><Phone size={15} /></span>
                  <span className="min-w-0">
                    <span className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: LGRAY }}>Contact</span>
                    <span className="block text-sm font-bold truncate" style={{ color: NAVY }}>{playerPhone || '—'}</span>
                  </span>
                </div>
                <div className="md:col-span-2 flex items-center gap-2.5 px-3 py-2 rounded-xl"
                  style={slip ? { background: '#ECFDF5', border: '1px solid #A7F3D0' } : !slipNeeded ? { background: '#F5F7FA', border: `1px solid ${BORDER}` } : { background: '#FEF2F2', border: '1px solid #FECACA' }}>
                  {slip && slip.type !== 'application/pdf'
                    ? <img src={slip.path} alt="Deposit slip" className="w-8 h-8 rounded-lg object-cover shrink-0" style={{ border: `1px solid ${BORDER}` }} />
                    : <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'white', color: slip ? '#DC2626' : '#DC2626', border: `1px solid ${BORDER}` }}><FileText size={15} /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: LGRAY }}>Deposit slip</span>
                    <span className="block text-sm font-bold truncate" style={{ color: slip ? '#047857' : !slipNeeded ? LGRAY : '#DC2626' }}>
                      {slip ? '✓ Attached' : !slipNeeded ? (cost.total === 0 ? 'Not needed (free)' : 'Not needed (advance)') : 'Not attached'}
                    </span>
                  </span>
                  {slip && <a href={slip.path} target="_blank" rel="noreferrer" className="link text-xs font-bold shrink-0" style={{ color: '#4A6FA5' }}>View</a>}
                </div>
                <div className="sm:col-span-2 md:col-span-2 flex items-center justify-between px-4 py-2 rounded-xl" style={{ background: NAVY, color: 'white' }}>
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    Rs. {RATE_PER_HOUR.toLocaleString()}/hr × {cost.paidHours} {cost.paidHours === 1 ? 'hr' : 'hrs'}
                    {cost.freeHours > 0 && <span className="block font-bold" style={{ color: '#6EE7B7' }}>+ {cost.freeHours} hr free (under-18)</span>}
                  </span>
                  <span className="text-right leading-tight">
                    <span className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.6)' }}>{creditUse ? 'To pay' : 'Total'}</span>
                    <span className="block text-lg font-black">{cost.total === 0 ? 'Free' : `Rs. ${amountDue.toLocaleString()}`}</span>
                    {creditUse > 0 && <span className="block text-[10px] font-bold" style={{ color: '#93C5FD' }}>Rs. {cost.total.toLocaleString()} − {advLabel.toLowerCase()} Rs. {creditUse.toLocaleString()}</span>}
                  </span>
                </div>
              </div>

              {error && step === 3 && (
                <div className="mb-3 rounded-xl px-4 py-2.5 text-sm"
                  style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FEE2E2' }}>
                  {error}
                </div>
              )}
              <button onClick={handleConfirm}
                className="btn w-full py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 tracking-wide mb-2"
                disabled={saving}
                style={{ background: NAVY, color: 'white', boxShadow: '0 4px 14px rgba(27,46,75,0.3)', opacity: saving ? 0.7 : 1 }}>
                <Check size={17} strokeWidth={3} /> {saving ? 'SAVING…' : prefill ? 'SAVE CHANGES' : 'CONFIRM BOOKING'}
              </button>
              <button onClick={() => setStep(2)} className="btn-text w-full text-center text-sm" style={{ color: LGRAY }}>
                ← Edit details
              </button>
            </>
          ) : (
            <p className="text-sm pb-1" style={{ color: '#C8D3E0' }}>Complete previous steps</p>
          )}
        </div>
      </div>
    </div>
    </div>
  )
}
