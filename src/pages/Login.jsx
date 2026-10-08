import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { loginApi, checkEmailApi } from '../store'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = params.get('redirect') || '/'
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [noAccount, setNoAccount] = useState(false)

  // Check the email against the database 500ms after typing stops
  useEffect(() => {
    const email = form.email.trim()
    if (!/^\S+@\S+\.\S+$/.test(email)) return
    let cancelled = false
    const t = setTimeout(async () => {
      const result = await checkEmailApi(email)
      if (!cancelled) setNoAccount(result.exists === false)
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [form.email])

  function handleChange(e) {
    setForm(p => ({ ...p, [e.target.name]: e.target.value }))
    if (e.target.name === 'email') setNoAccount(false)
    if (error) setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.email.trim() || !form.password) { setError('Please enter your email and password.'); return }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) { setError('Please enter a valid email address, e.g. name@gmail.com'); return }
    if (noAccount) return
    setLoading(true)
    const result = await loginApi(form)
    setLoading(false)
    if (result.noAccount) { setNoAccount(true); return }
    if (result.error) { setError(result.error); return }
    navigate(redirect)
  }

  return (
    <div className="flex items-center justify-center px-4 py-8"
      style={{ background: '#F1F4F8' }}>
      <div className="w-full max-w-sm">

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
          <div className="px-6 pt-5 pb-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <p className="font-black text-xl" style={{ color: NAVY }}>Welcome Back</p>
            <p className="text-sm mt-0.5" style={{ color: '#64748B' }}>Sign in to your NNG Trust account</p>
          </div>

          <form onSubmit={handleSubmit} autoComplete="off" className="px-6 pb-5 pt-4 space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wide mb-1.5" style={{ color: NAVY }}>
                Email Address
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
                <input type="email" name="email" placeholder="Enter your email ID"
                  value={form.email} onChange={handleChange} autoComplete="off"
                  style={{ width: '100%', border: `1.5px solid ${noAccount ? '#DC2626' : BORDER}`, borderRadius: '10px', padding: '10px 12px 10px 36px', fontSize: '14px', outline: 'none', color: NAVY, background: noAccount ? '#FEF2F2' : '#F8FAFC', fontFamily: 'inherit' }} />
              </div>
              {noAccount && (
                <p className="text-xs mt-1.5" style={{ color: '#DC2626' }}>
                  No account found with this email. Please{' '}
                  <Link to="/signup" className="link font-bold underline" style={{ color: '#DC2626' }}>sign up</Link>
                  {' '}first, then sign in.
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wide mb-1.5" style={{ color: NAVY }}>
                Password
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
                <input type={showPw ? 'text' : 'password'} name="password" placeholder="Enter your password"
                  value={form.password} onChange={handleChange} autoComplete="new-password"
                  style={{ width: '100%', border: `1.5px solid ${BORDER}`, borderRadius: '10px', padding: '10px 40px 10px 36px', fontSize: '14px', outline: 'none', color: NAVY, background: '#F8FAFC', fontFamily: 'inherit' }} />
                <button type="button" onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: LGRAY }}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                style={{ background: '#FEF2F2', border: '1px solid #FEE2E2' }}>
                <AlertCircle size={14} style={{ color: '#DC2626', flexShrink: 0 }} />
                <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>
              </div>
            )}

            <button type="submit" disabled={loading}
              className="btn w-full py-3 rounded-xl font-black text-sm"
              style={{ background: NAVY, color: 'white', boxShadow: '0 4px 14px rgba(27,46,75,0.25)', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="px-6 py-4 text-center rounded-b-2xl" style={{ background: '#F8FAFC', borderTop: `1px solid ${BORDER}` }}>
            <p className="text-sm" style={{ color: LGRAY }}>
              Don't have an account?{' '}
              <Link to="/signup" className="link font-bold" style={{ color: NAVY }}>Create one</Link>
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}
