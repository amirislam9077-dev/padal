import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Lock, Mail, Eye, EyeOff, Home, Calendar, BookOpen, MessageSquare, Shield } from 'lucide-react'
import { adminLoginApi } from '../store'

const NAVY = '#1B2E4B'
const NAVY2 = '#243C60'

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
    <div className="min-h-screen flex flex-col"
      style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY2} 100%)` }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 70% 30%, rgba(255,255,255,0.04) 0%, transparent 60%)' }} />

      {/* ── HEADER ── */}
      <header className="relative z-10 shrink-0" style={{ background: 'rgba(0,0,0,0.25)', borderBottom: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm"
              style={{ background: 'white', color: NAVY }}>NN</div>
            <div>
              <p className="font-black text-sm text-white leading-tight">North Nazimabad Gymkhana Trust</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Where Champions Play</p>
            </div>
          </Link>

          <nav className="hidden sm:flex items-center gap-1">
            {[['/', 'Home', Home], ['/book', 'Padel Booking', Calendar], ['/my-bookings', 'My Bookings', BookOpen], ['/complaints', 'Complaints', MessageSquare]].map(([to, label, Icon]) => (
              <Link key={to} to={to}
                className="nav-link flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ color: 'rgba(255,255,255,0.5)' }}>
                <Icon size={13} />{label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <Shield size={12} /> Admin Access
          </div>
        </div>
      </header>

      <div className="relative flex-1 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl bg-white">
            <span className="font-black text-xl" style={{ color: NAVY }}>NN</span>
          </div>
          <h1 className="text-2xl font-black text-white">Admin Panel</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>North Nazimabad Gymkhana Trust</p>
        </div>

        <div className="rounded-2xl p-7 shadow-2xl"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="admin-email" className="block text-xs font-bold mb-2 uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.45)' }}>Email ID</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                <input id="admin-email" name="admin-email" type="email" placeholder="Enter admin email" autoComplete="off"
                  value={email} onChange={e => { setEmail(e.target.value); setError('') }}
                  className="admin-input w-full rounded-xl pl-10 pr-3 py-3 text-sm focus:outline-none text-white placeholder-gray-500"
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.12)' }} />
              </div>
            </div>
            <div>
              <label htmlFor="admin-password" className="block text-xs font-bold mb-2 uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.45)' }}>Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                <input id="admin-password" type={showPw ? 'text' : 'password'} placeholder="Enter admin password" autoComplete="current-password"
                  value={password} onChange={e => { setPassword(e.target.value); setError('') }}
                  className="admin-input w-full rounded-xl pl-10 pr-10 py-3 text-sm focus:outline-none text-white placeholder-gray-500"
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.12)' }} />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2"
                  style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ color: '#FCA5A5', background: 'rgba(220,38,38,0.12)' }}>
                {error}
              </p>
            )}

            <button type="submit" disabled={busy}
              className="btn-light w-full py-3 rounded-xl font-black text-sm tracking-wide mt-1"
              style={{ background: '#FFFFFF', color: NAVY, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', opacity: busy ? 0.7 : 1 }}>
              {busy ? 'CHECKING…' : 'LOGIN TO ADMIN PANEL'}
            </button>
          </form>
        </div>
      </div>
      </div>
    </div>
  )
}
