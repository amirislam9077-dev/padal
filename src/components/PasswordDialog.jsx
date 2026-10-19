import { useState } from 'react'
import { Lock, X, AlertCircle } from 'lucide-react'
import { adminVerifyPasswordApi } from '../store'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'

// Pop-up used by askAdminPassword(): checks the password with the server, then hands it back
export default function PasswordDialog({ title, danger, onDone }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!password) { setError('Please enter the password.'); return }
    setBusy(true)
    const r = await adminVerifyPasswordApi(password)
    setBusy(false)
    if (r.error) { setError(r.error); return }
    onDone(password)
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.55)', zIndex: 9999 }} onClick={() => onDone(null)}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-sm" style={{ border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <p className="font-black text-base flex items-center gap-2" style={{ color: danger ? '#DC2626' : NAVY }}><Lock size={16} /> Password required</p>
          <button type="button" onClick={() => onDone(null)} title="Cancel" style={{ color: '#94A3B8' }}><X size={18} /></button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm mb-3" style={{ color: '#475569' }}>{title}</p>
          <input type="password" autoFocus value={password} placeholder="Admin password" autoComplete="current-password"
            onChange={e => { setPassword(e.target.value); setError('') }}
            className="w-full h-10 px-3 rounded-lg text-sm outline-none"
            style={{ border: `1.5px solid ${error ? '#DC2626' : '#CBD5E1'}`, color: NAVY, background: error ? '#FEF2F2' : 'white' }} />
          {error && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#DC2626' }}><AlertCircle size={13} /> {error}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: `1px solid ${BORDER}`, background: '#F8FAFC' }}>
          <button type="button" onClick={() => onDone(null)} className="h-9 px-4 rounded-lg text-sm font-bold" style={{ color: '#475569', border: `1.5px solid ${BORDER}`, background: 'white' }}>Cancel</button>
          <button type="submit" disabled={busy} className="h-9 px-5 rounded-lg text-sm font-black"
            style={{ background: danger ? '#DC2626' : NAVY, color: 'white', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  )
}
