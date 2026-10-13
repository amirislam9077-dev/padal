import { useState } from 'react'
import { X, AlertCircle } from 'lucide-react'
import { getCourts, TIME_SLOTS, formatSlotRange, adminUpdateSlotApi } from '../store'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'

const input = { width: '100%', border: `1.5px solid ${BORDER}`, borderRadius: '8px', padding: '7px 10px', fontSize: '13px', outline: 'none', color: NAVY, background: '#F8FAFC', fontFamily: 'inherit' }
const label = 'block text-[10px] font-extrabold uppercase tracking-wide mb-1'

// Admin: change a booking's court, date, start time, players and phone. Length and payment stay the same.
export default function AdminEditBooking({ booking, onClose, onSaved }) {
  const courts = getCourts()
  const hours = booking.endHour - booking.startHour
  const [courtId, setCourtId] = useState(booking.courtId)
  const [date, setDate] = useState(booking.date)
  const [startHour, setStartHour] = useState(booking.startHour)
  const [phone, setPhone] = useState(booking.playerPhone || '')
  const [players, setPlayers] = useState([1, 2, 3, 4].map(n => {
    const p = (booking.players || []).find(x => x.n === n)
    return { n, name: p?.name || '', cmNo: p?.cmNo || '' }
  }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const setPlayer = (n, field, value) => setPlayers(list => list.map(p => (p.n === n ? { ...p, [field]: value } : p)))

  async function save(e) {
    e.preventDefault()
    if (!players[0].name.trim()) { setError('Player 1 name is required.'); return }
    setSaving(true); setError('')
    const court = courts.find(c => c.id === courtId)
    const r = await adminUpdateSlotApi(booking.id, {
      courtId, courtName: court?.name || booking.courtName, date, startHour, phone: phone.trim(),
      players: players.filter(p => p.name.trim()),
    })
    setSaving(false)
    if (r.error) { setError(r.error); return }
    onSaved(r.booking)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden" style={{ background: 'rgba(15,23,42,0.5)' }} onClick={onClose}>
      <form onSubmit={save} onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <p className="font-black text-base" style={{ color: NAVY }}>Edit Booking</p>
            <p className="text-xs" style={{ color: LGRAY }}>{booking.slotRef} · {hours} {hours === 1 ? 'hour' : 'hours'} · payment unchanged</p>
          </div>
          <button type="button" onClick={onClose} title="Close" style={{ color: LGRAY }}><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={label} style={{ color: NAVY }}>Court</label>
              <select value={courtId} onChange={e => setCourtId(e.target.value)} style={input}>
                {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label} style={{ color: NAVY }}>Date</label>
              <input type="date" value={date} required onChange={e => setDate(e.target.value)} style={input} />
            </div>
            <div>
              <label className={label} style={{ color: NAVY }}>Time</label>
              <select value={startHour} onChange={e => setStartHour(Number(e.target.value))} style={input}>
                {TIME_SLOTS.filter(h => h + hours <= 24).map(h => <option key={h} value={h}>{formatSlotRange(h, h + hours)}</option>)}
              </select>
            </div>
          </div>

          {[1, 2].map(team => (
            <div key={team}>
              <p className={label} style={{ color: LGRAY }}>Team {team}</p>
              <div className="space-y-2">
                {players.filter(p => (p.n <= 2 ? 1 : 2) === team).map(p => (
                  <div key={p.n} className="grid grid-cols-[1fr_120px] gap-2">
                    <input value={p.name} placeholder={`Player ${p.n} name${p.n === 1 ? ' *' : ''}`} onChange={e => setPlayer(p.n, 'name', e.target.value)} style={input} />
                    <input value={p.cmNo} placeholder="CM No." onChange={e => setPlayer(p.n, 'cmNo', e.target.value)} style={input} />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div>
            <label className={label} style={{ color: NAVY }}>Phone</label>
            <input value={phone} placeholder="+923001234567" onChange={e => setPhone(e.target.value)} style={input} />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: '#FEF2F2', border: '1px solid #FEE2E2' }}>
              <AlertCircle size={14} style={{ color: '#DC2626', flexShrink: 0 }} />
              <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: `1px solid ${BORDER}`, background: '#F8FAFC' }}>
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-bold" style={{ color: '#475569', border: `1.5px solid ${BORDER}`, background: 'white' }}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className="h-9 px-5 rounded-lg text-sm font-black" style={{ background: NAVY, color: 'white', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
