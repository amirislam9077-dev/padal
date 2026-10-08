import { useState, useEffect } from 'react'
import { getCourts, saveCourts, generateId } from '../store'
import { Plus, Edit2, Check, X, ToggleLeft, ToggleRight } from 'lucide-react'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const inputStyle = { width: '100%', border: `1.5px solid ${BORDER}`, borderRadius: '10px', padding: '9px 12px', fontSize: '14px', outline: 'none', color: NAVY, background: '#F8FAFC' }
const labelStyle = { fontSize: '11px', fontWeight: '700', color: LGRAY, marginBottom: '5px', display: 'block', letterSpacing: '0.06em', textTransform: 'uppercase' }

export default function AdminCourts() {
  const [courts, setCourts] = useState([])
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [newCourt, setNewCourt] = useState({ name: '', description: '' })

  useEffect(() => { setCourts(getCourts()) }, [])

  function save(updated) { saveCourts(updated); setCourts(updated) }
  function toggleActive(id) { save(courts.map(c => c.id === id ? { ...c, isActive: !c.isActive } : c)) }
  function saveEdit() { if (!editing.name.trim()) return; save(courts.map(c => c.id === editing.id ? editing : c)); setEditing(null) }
  function addCourt() {
    if (!newCourt.name.trim()) return
    save([...courts, { id: generateId(), ...newCourt, isActive: true }])
    setNewCourt({ name: '', description: '' }); setAdding(false)
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black" style={{ color: NAVY }}>Courts</h1>
          <p className="text-sm mt-0.5" style={{ color: LGRAY }}>{courts.filter(c => c.isActive).length} active courts</p>
        </div>
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl shadow-sm"
          style={{ background: NAVY, color: 'white' }}>
          <Plus size={15} /> Add Court
        </button>
      </div>

      {adding && (
        <div className="bg-white rounded-xl p-5 shadow-sm" style={{ border: `2px solid ${NAVY}` }}>
          <p className="font-black mb-4" style={{ color: NAVY }}>New Court</p>
          <div className="space-y-3 mb-4">
            <div><label style={labelStyle}>Court Name</label><input type="text" placeholder="e.g. Court 3" value={newCourt.name} onChange={e => setNewCourt(p => ({ ...p, name: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>Description</label><input type="text" placeholder="Short description" value={newCourt.description} onChange={e => setNewCourt(p => ({ ...p, description: e.target.value }))} style={inputStyle} /></div>
          </div>
          <div className="flex gap-2">
            <button onClick={addCourt} className="flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-xl"
              style={{ background: NAVY, color: 'white' }}>
              <Check size={14} /> Save
            </button>
            <button onClick={() => setAdding(false)} className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl"
              style={{ border: `1.5px solid ${BORDER}`, color: '#64748B', background: '#F8FAFC' }}>
              <X size={14} /> Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {courts.map(court => (
          <div key={court.id} className="bg-white rounded-xl p-5 shadow-sm transition"
            style={{ border: `1px solid ${BORDER}`, opacity: court.isActive ? 1 : 0.6 }}>
            {editing?.id === court.id ? (
              <div className="space-y-3">
                <input type="text" value={editing.name} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))}
                  style={{ ...inputStyle, fontWeight: '700' }} />
                <input type="text" value={editing.description} onChange={e => setEditing(p => ({ ...p, description: e.target.value }))}
                  style={inputStyle} />
                <div className="flex gap-2">
                  <button onClick={saveEdit} className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg"
                    style={{ background: NAVY, color: 'white' }}>
                    <Check size={12} /> Save
                  </button>
                  <button onClick={() => setEditing(null)} className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
                    style={{ border: `1.5px solid ${BORDER}`, color: '#64748B', background: '#F8FAFC' }}>
                    <X size={12} /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                  style={{ background: '#EEF2F7' }}>🎾</div>
                <div className="flex-1 min-w-0">
                  <p className="font-black" style={{ color: NAVY }}>{court.name}</p>
                  <p className="text-sm" style={{ color: LGRAY }}>{court.description}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                    style={court.isActive
                      ? { background: '#EEF2F7', color: '#4A6FA5', border: `1px solid ${BORDER}` }
                      : { background: '#F5F7FA', color: LGRAY, border: `1px solid ${BORDER}` }}>
                    {court.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <button onClick={() => setEditing({ ...court })} className="p-2 rounded-xl"
                    style={{ color: LGRAY, background: '#F5F7FA' }}>
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => toggleActive(court.id)} className="p-2 rounded-xl transition"
                    style={{ color: court.isActive ? NAVY : LGRAY, background: '#F5F7FA' }}>
                    {court.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
