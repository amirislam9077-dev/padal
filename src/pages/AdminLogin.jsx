import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Mail, Eye, EyeOff, Shield, AlertCircle, ArrowRight } from 'lucide-react'
import { adminLoginApi } from '../store'

// Same colours as the public site (home page / header)
const BG = '#070B18'
const CARD = '#141927'
const LINE = 'rgba(255,255,255,0.09)'
const BLUE = '#2F6BFF'
const MUTED = '#9AA3B5'

const field = { width: '100%', borderRadius: '10px', padding: '11px 40px 11px 38px', fontSize: '14px', outline: 'none', color: 'white',
  background: 'rgba(255,255,255,0.05)', border: `1.5px solid ${LINE}` }

// Admin login — inside the site layout (same header + footer as the public pages)
export default function AdminLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Checked by the server, which returns an admin token for the admin pages
  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Please enter the admin email and password.'); return }
    setBusy(true)
    const result = await adminLoginApi(email.trim(), password)
    setBusy(false)
    if (result.error) { setError(result.error); return }
    navigate('/admin/dashboard')
  }

  return (
    <div className="relative overflow-hidden flex items-center justify-center px-4 py-14" style={{ background: BG, minHeight: 'calc(100vh - 140px)' }}>
      {/* Soft blue / orange glow, like the home page hero */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(600px 300px at 25% 20%, rgba(47,107,255,0.18), transparent 70%), radial-gradient(500px 260px at 80% 85%, rgba(255,138,31,0.10), transparent 70%)' }} />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-7">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg"
            style={{ background: 'white', color: BLUE }}>
            <span className="font-black text-xl">NN</span>
          </div>
          <p className="text-[11px] font-bold tracking-[0.2em] uppercase mb-1.5" style={{ color: '#7EA2FF' }}>Admin access</p>
          <h1 className="text-3xl font-black text-white tracking-tight">Admin Panel</h1>
          <p className="text-sm mt-1" style={{ color: MUTED }}>North Nazimabad Gymkhana Trust</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl p-6 space-y-4"
          style={{ background: CARD, border: `1px solid ${LINE}`, boxShadow: '0 24px 60px -20px rgba(0,0,0,0.7)' }}>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: MUTED }}>Email ID</label>
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
              <input type="email" value={email} autoComplete="username" placeholder="admin@email.com"
                onChange={e => { setEmail(e.target.value); setError('') }} style={field} />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: MUTED }}>Password</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
              <input type={showPw ? 'text' : 'password'} value={password} autoComplete="current-password" placeholder="Enter password"
                onChange={e => { setPassword(e.target.value); setError('') }} style={field} />
              <button type="button" onClick={() => setShowPw(p => !p)} title={showPw ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{ color: '#FCA5A5', background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)' }}>
              <AlertCircle size={14} className="shrink-0" /> {error}
            </p>
          )}

          <button type="submit" disabled={busy}
            className="ot-btn w-full inline-flex items-center justify-center gap-2 py-3 rounded-lg font-bold text-sm"
            style={{ background: BLUE, color: 'white', boxShadow: '0 12px 30px -10px rgba(47,107,255,0.7)', opacity: busy ? 0.7 : 1 }}>
            <Shield size={15} /> {busy ? 'Checking…' : 'Login to Admin Panel'}
            {!busy && (
              <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'white', color: BLUE }}>
                <ArrowRight size={12} strokeWidth={2.75} />
              </span>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
