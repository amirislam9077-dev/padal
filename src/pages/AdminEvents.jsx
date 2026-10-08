import { useState, useEffect } from 'react'
import { Plus, Check, X, Pencil, Trash2, Trophy, PartyPopper } from 'lucide-react'
import { format } from 'date-fns'
import { adminEventsApi, adminSaveEventApi, adminDeleteEventApi } from '../store'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const inputStyle = { width: '100%', border: `1.5px solid ${BORDER}`, borderRadius: '10px', padding: '8px 11px', fontSize: '14px', outline: 'none', color: NAVY, background: '#F8FAFC' }
const labelStyle = { fontSize: '11px', fontWeight: '700', color: LGRAY, marginBottom: '4px', display: 'block', letterSpacing: '0.06em', textTransform: 'uppercase' }
const EMPTY = { title: '', type: 'tournament', date: '', startTime: '', endTime: '', venue: 'Court 1', entryFee: '', maxTeams: '', description: '', status: 'open' }

export default function AdminEvents() {
  const [events, setEvents] = useState([])
  const [form, setForm] = useState(null) // event being added/edited
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    adminEventsApi().then(r => {
      if (cancelled) return
      if (r.error) setError(r.error)
      else setEvents(r.events)
    })
    return () => { cancelled = true }
  }, [reload])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true); setError('')
    const r = await adminSaveEventApi(form)
    setSaving(false)
    if (r.error) { setError(r.error); return }
    setForm(null)
    setReload(n => n + 1)
  }

  async function remove(ev) {
    if (!confirm(`Delete "${ev.title}"?`)) return
    const r = await adminDeleteEventApi(ev.id)
    if (r.error) alert(r.error)
    setReload(n => n + 1)
  }

  const today = format(new Date(), 'yyyy-MM-dd') // local date, not UTC

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black" style={{ color: NAVY }}>Events &amp; Tournaments</h1>
          <p className="text-sm mt-0.5" style={{ color: LGRAY }}>
            {events.filter(e => e.date >= today && e.status !== 'closed').length} upcoming · shown on the home page
          </p>
        </div>
        {!form && (
          <button onClick={() => { setForm({ ...EMPTY }); setError('') }}
            className="btn flex items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl" style={{ background: NAVY, color: 'white' }}>
            <Plus size={15} /> Add Event
          </button>
        )}
      </div>

      {/* Add / edit form */}
      {form && (
        <div className="bg-white rounded-xl p-5 shadow-sm" style={{ border: `2px solid ${NAVY}` }}>
          <p className="font-black mb-4" style={{ color: NAVY }}>{form.id ? 'Edit event' : 'New event'}</p>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div className="sm:col-span-2">
              <label style={labelStyle}>Title *</label>
              <input type="text" value={form.title} placeholder="e.g. NNG Monthly Doubles Cup" onChange={e => set('title', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)} style={inputStyle}>
                <option value="tournament">Tournament</option>
                <option value="event">Event</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Date *</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Start time</label>
              <input type="time" value={form.startTime} onChange={e => set('startTime', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>End time</label>
              <input type="time" value={form.endTime} onChange={e => set('endTime', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Venue</label>
              <input type="text" value={form.venue} placeholder="e.g. Court 1 & 2" onChange={e => set('venue', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} style={inputStyle}>
                <option value="open">Open for entries</option>
                <option value="full">Full</option>
                <option value="closed">Closed (hidden)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Entry fee (Rs per team)</label>
              <input type="number" min="0" value={form.entryFee ?? ''} placeholder="0 = free" onChange={e => set('entryFee', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Max teams</label>
              <input type="number" min="1" value={form.maxTeams ?? ''} placeholder="e.g. 16" onChange={e => set('maxTeams', e.target.value)} style={inputStyle} />
            </div>
            <div className="sm:col-span-2">
              <label style={labelStyle}>Description</label>
              <textarea rows={2} maxLength={500} value={form.description} placeholder="Format, prizes, who can join…"
                onChange={e => set('description', e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
          </div>
          {error && <p className="text-sm font-semibold mb-3" style={{ color: '#DC2626' }}>{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-xl"
              style={{ background: NAVY, color: 'white', opacity: saving ? 0.7 : 1 }}>
              <Check size={14} /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setForm(null); setError('') }} className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl"
              style={{ border: `1.5px solid ${BORDER}`, color: '#64748B', background: '#F8FAFC' }}>
              <X size={14} /> Cancel
            </button>
          </div>
        </div>
      )}

      {!form && error && <p className="text-sm font-semibold" style={{ color: '#DC2626' }}>{error}</p>}

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto" style={{ border: `1px solid ${BORDER}` }}>
        {events.length === 0 ? (
          <p className="text-sm text-center py-10" style={{ color: LGRAY }}>No events yet. Click “Add Event” to create one.</p>
        ) : (
          <table className="w-full text-sm" style={{ minWidth: '640px' }}>
            <thead style={{ background: '#F5F7FA', borderBottom: '2px solid #EEF2F7' }}>
              <tr>
                {['Date', 'Event', 'Time & venue', 'Fee / teams', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide" style={{ color: LGRAY }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map(ev => {
                const past = ev.date < today
                const Icon = ev.type === 'tournament' ? Trophy : PartyPopper
                return (
                  <tr key={ev.id} style={{ borderBottom: '1px solid #F5F7FA', opacity: past || ev.status === 'closed' ? 0.55 : 1 }}>
                    <td className="px-4 py-3 font-bold whitespace-nowrap" style={{ color: NAVY }}>{format(new Date(ev.date + 'T00:00'), 'EEE d MMM yyyy')}</td>
                    <td className="px-4 py-3">
                      <p className="font-bold flex items-center gap-1.5" style={{ color: NAVY }}><Icon size={13} style={{ color: ev.type === 'tournament' ? '#B7791F' : '#4A6FA5' }} />{ev.title}</p>
                      <p className="text-xs capitalize" style={{ color: LGRAY }}>{ev.type}</p>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#4B5563' }}>
                      {ev.startTime ? `${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ''}` : '—'}<br />{ev.venue || ''}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#4B5563' }}>
                      {ev.entryFee != null ? (ev.entryFee ? `Rs. ${ev.entryFee.toLocaleString()}` : 'Free') : '—'}<br />{ev.maxTeams ? `${ev.maxTeams} teams` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2.5 py-1 rounded-full font-semibold capitalize"
                        style={ev.status === 'open' ? { background: '#ECFDF5', color: '#047857' } : ev.status === 'full' ? { background: '#FEF3C7', color: '#B45309' } : { background: '#F1F5F9', color: '#64748B' }}>
                        {past ? 'Past' : ev.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <button onClick={() => { setForm({ ...ev, entryFee: ev.entryFee ?? '', maxTeams: ev.maxTeams ?? '' }); setError('') }} title="Edit"
                        className="btn-icon p-1.5 rounded-lg" style={{ color: NAVY }}><Pencil size={15} /></button>
                      <button onClick={() => remove(ev)} title="Delete" className="btn-icon p-1.5 rounded-lg" style={{ color: '#DC2626' }}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
