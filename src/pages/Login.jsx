import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AtSign, Lock, Eye, EyeOff, AlertCircle, TriangleAlert } from 'lucide-react'
import { loginApi, checkUsernameApi } from '../store'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const USERNAME_RE = /^[A-Za-z0-9._]{3,30}$/

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = params.get('redirect') || '/'
  const [form, setForm] = useState({ userId: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [noAccount, setNoAccount] = useState(false)
  const [under18, setUnder18] = useState(false)

  // Check the User ID against the database 500ms after typing stops
  useEffect(() => {
    const userId = form.userId.trim()
    if (!USERNAME_RE.test(userId)) return
    let cancelled = false
    const t = setTimeout(async () => {
      const result = await checkUsernameApi(userId)
      if (!cancelled) { setNoAccount(result.taken === false); setUnder18(result.under18 === true) }
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [form.userId])

  function handleChange(e) {
    const { name } = e.target
    // User ID: letters, numbers, dots and underscores only (no spaces, no email)
    const value = name === 'userId' ? e.target.value.replace(/[^A-Za-z0-9._]/g, '') : e.target.value
    setForm(p => ({ ...p, [name]: value }))
    if (name === 'userId') { setNoAccount(false); setUnder18(false) }
    if (error) setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.userId.trim() || !form.password) { setError('Please enter your User ID and password.'); return }
    if (!USERNAME_RE.test(form.userId.trim())) { setError('User ID must be 3–30 letters, numbers, dots or underscores.'); return }
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
            {under18 && (
              <div role="alert" className="flex items-center gap-3 mt-3 px-4 py-3 rounded-xl animate-[under18_0.5s_ease-out_2]"
                style={{ background: '#DC2626', border: '2px solid #991B1B', boxShadow: '0 6px 18px rgba(220,38,38,0.35)' }}>
                <TriangleAlert size={22} color="white" style={{ flexShrink: 0 }} />
                <p className="text-base font-black tracking-wide" style={{ color: 'white' }}>You are under 18.</p>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} autoComplete="off" className="px-6 pb-5 pt-4 space-y-4">
            {/* User ID */}
            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wide mb-1.5" style={{ color: NAVY }}>
                User ID
              </label>
              <div className="relative">
                <AtSign size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
                <input type="text" name="userId" placeholder="Enter your User ID" maxLength={30}
                  value={form.userId} onChange={handleChange} autoComplete="username" autoCapitalize="none" spellCheck={false}
                  style={{ width: '100%', border: `1.5px solid ${noAccount ? '#DC2626' : BORDER}`, borderRadius: '10px', padding: '10px 12px 10px 36px', fontSize: '14px', outline: 'none', color: NAVY, background: noAccount ? '#FEF2F2' : '#F8FAFC', fontFamily: 'inherit' }} />
              </div>
              {noAccount && (
                <p className="text-xs mt-1.5" style={{ color: '#DC2626' }}>
                  No account found with this User ID. Please{' '}
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
              <div className="flex justify-between mt-2 text-xs font-bold">
                <Link to="/forgot-user-id" className="link" style={{ color: '#4A6FA5' }}>Forgot User ID?</Link>
                <Link to="/forgot-password" className="link" style={{ color: '#4A6FA5' }}>Forgot password?</Link>
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
