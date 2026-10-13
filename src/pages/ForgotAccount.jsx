import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AtSign, Mail, Lock, KeyRound, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react'
import { sendRecoveryCodeApi, recoverAccountsApi, setUserIdApi, resetPasswordApi } from '../store'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const USERNAME_RE = /^[A-Za-z0-9._]{3,30}$/

const inputStyle = { width: '100%', border: `1.5px solid ${BORDER}`, borderRadius: '10px', padding: '10px 12px 10px 36px', fontSize: '14px', outline: 'none', color: NAVY, background: '#F8FAFC', fontFamily: 'inherit' }

function Field({ label, icon: Icon, ...props }) {
  return (
    <div>
      <label className="block text-xs font-extrabold uppercase tracking-wide mb-1.5" style={{ color: NAVY }}>{label}</label>
      <div className="relative">
        <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
        <input style={inputStyle} {...props} />
      </div>
    </div>
  )
}

function ErrorBox({ text }) {
  if (!text) return null
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: '#FEF2F2', border: '1px solid #FEE2E2' }}>
      <AlertCircle size={14} style={{ color: '#DC2626', flexShrink: 0 }} />
      <p className="text-sm" style={{ color: '#DC2626' }}>{text}</p>
    </div>
  )
}

function SubmitButton({ busy, children }) {
  return (
    <button type="submit" disabled={busy} className="btn w-full py-3 rounded-xl font-black text-sm"
      style={{ background: NAVY, color: 'white', boxShadow: '0 4px 14px rgba(27,46,75,0.25)', opacity: busy ? 0.7 : 1 }}>
      {children}
    </button>
  )
}

// One account on the email: shows its User ID, or lets the member set one if it has none
function AccountRow({ account, onSetUserId }) {
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e) {
    e.preventDefault()
    if (!USERNAME_RE.test(username)) { setError('3–30 letters, numbers, dots or underscores.'); return }
    setBusy(true)
    const err = await onSetUserId(account.id, username)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="px-4 py-3 rounded-xl" style={{ border: `1px solid ${BORDER}`, background: '#F8FAFC' }}>
      <p className="font-bold text-sm" style={{ color: NAVY }}>{account.name}</p>
      <p className="text-xs" style={{ color: LGRAY }}>{account.membershipNo}</p>
      {account.username ? (
        <p className="text-sm mt-1.5" style={{ color: NAVY }}>
          User ID: <span className="font-black">{account.username}</span>
        </p>
      ) : (
        <form onSubmit={save} className="mt-2">
          <p className="text-xs mb-1.5" style={{ color: '#B45309' }}>This account has no User ID yet. Choose one to sign in with:</p>
          <div className="flex gap-2">
            <input value={username} placeholder="e.g. ahmed.khan" maxLength={30} autoCapitalize="none" spellCheck={false}
              onChange={e => { setUsername(e.target.value.replace(/[^A-Za-z0-9._]/g, '')); setError('') }}
              style={{ ...inputStyle, padding: '8px 10px', background: 'white' }} />
            <button type="submit" disabled={busy} className="btn px-4 rounded-xl font-black text-xs shrink-0"
              style={{ background: NAVY, color: 'white', opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          {error && <p className="text-xs mt-1.5" style={{ color: '#DC2626' }}>{error}</p>}
        </form>
      )}
    </div>
  )
}

// mode "userid": email → code → list of accounts with their User IDs
// mode "password": User ID → code + new password → signed in
export default function ForgotAccount({ mode }) {
  const navigate = useNavigate()
  const forPassword = mode === 'password'
  const [step, setStep] = useState('start') // start → code → (userid only) list
  const [who, setWho] = useState('') // email or User ID
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accounts, setAccounts] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function sendCode() {
    setBusy(true)
    const result = await sendRecoveryCodeApi(forPassword ? { userId: who.trim() } : { email: who.trim() })
    setBusy(false)
    if (result.error) return result.error
    setSentTo(result.sentTo)
    return null
  }

  async function handleStart(e) {
    e.preventDefault()
    if (forPassword && !USERNAME_RE.test(who.trim())) { setError('Please enter your User ID.'); return }
    if (!forPassword && !/^\S+@\S+\.\S+$/.test(who.trim())) { setError('Please enter a valid email address.'); return }
    const err = await sendCode()
    if (err) { setError(err); return }
    setError(''); setStep('code')
  }

  async function handleResend() {
    setCode('')
    setError((await sendCode()) || '')
  }

  async function handleCode(e) {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) { setError('Please enter the 6-digit code.'); return }
    if (forPassword) {
      if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
      if (password !== confirm) { setError('Passwords do not match.'); return }
      setBusy(true)
      const result = await resetPasswordApi(who.trim(), code, password)
      setBusy(false)
      if (result.error) { setError(result.error); return }
      navigate('/')
    } else {
      setBusy(true)
      const result = await recoverAccountsApi(who.trim(), code)
      setBusy(false)
      if (result.error) { setError(result.error); return }
      setAccounts(result.accounts); setError(''); setStep('list')
    }
  }

  async function handleSetUserId(id, username) {
    const result = await setUserIdApi(who.trim(), code, id, username)
    if (result.error) return result.error
    setAccounts(result.accounts)
    return null
  }

  const title = forPassword ? 'Forgot Password' : 'Forgot User ID'
  const subtitle = step === 'start'
    ? (forPassword ? 'Enter your User ID and we will email you a code' : 'Enter your email and we will send you a code')
    : step === 'code' ? <>We sent a 6-digit code to <strong>{sentTo}</strong></>
    : 'Accounts registered with this email'

  return (
    <div className="flex items-center justify-center px-4 py-8" style={{ background: '#F1F4F8' }}>
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
          <div className="px-6 pt-5 pb-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <p className="font-black text-xl" style={{ color: NAVY }}>{title}</p>
            <p className="text-sm mt-0.5" style={{ color: '#64748B' }}>{subtitle}</p>
          </div>

          {step === 'start' && (
            <form onSubmit={handleStart} className="px-6 pb-5 pt-4 space-y-4">
              {forPassword
                ? <Field label="User ID" icon={AtSign} placeholder="Enter your User ID" maxLength={30} autoComplete="username"
                    autoCapitalize="none" spellCheck={false} value={who}
                    onChange={e => { setWho(e.target.value.replace(/[^A-Za-z0-9._]/g, '')); setError('') }} />
                : <Field label="Email Address" icon={Mail} type="email" placeholder="Enter your email" autoComplete="email"
                    value={who} onChange={e => { setWho(e.target.value); setError('') }} />}
              <ErrorBox text={error} />
              <SubmitButton busy={busy}>{busy ? 'Sending…' : 'Send Code'}</SubmitButton>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={handleCode} className="px-6 pb-5 pt-4 space-y-4">
              <Field label="6-digit code" icon={KeyRound} inputMode="numeric" placeholder="123456" maxLength={6}
                autoComplete="one-time-code" value={code}
                onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError('') }} />
              {forPassword && <>
                <Field label="New password" icon={Lock} type="password" placeholder="Min. 6 chars" autoComplete="new-password"
                  value={password} onChange={e => { setPassword(e.target.value); setError('') }} />
                <Field label="Confirm password" icon={Lock} type="password" placeholder="Re-enter" autoComplete="new-password"
                  value={confirm} onChange={e => { setConfirm(e.target.value); setError('') }} />
              </>}
              <ErrorBox text={error} />
              <SubmitButton busy={busy}>
                {busy ? 'Checking…' : forPassword ? 'Reset Password' : 'Show My User ID'}
              </SubmitButton>
              <div className="flex justify-between text-xs font-bold">
                <button type="button" onClick={() => { setStep('start'); setCode(''); setError('') }}
                  className="link flex items-center gap-1" style={{ color: LGRAY }}>
                  <ArrowLeft size={12} /> Change {forPassword ? 'User ID' : 'email'}
                </button>
                <button type="button" onClick={handleResend} disabled={busy} className="link" style={{ color: '#4A6FA5' }}>
                  Resend code
                </button>
              </div>
            </form>
          )}

          {step === 'list' && (
            <div className="px-6 pb-5 pt-4 space-y-3">
              {accounts.map(a => <AccountRow key={a.id} account={a} onSetUserId={handleSetUserId} />)}
              {accounts.some(a => a.username) && (
                <div className="flex items-center gap-2 text-xs" style={{ color: '#15803D' }}>
                  <CheckCircle2 size={13} /> Use your User ID and password to sign in.
                </div>
              )}
              <Link to="/login" className="btn block w-full py-3 rounded-xl font-black text-sm text-center"
                style={{ background: NAVY, color: 'white', boxShadow: '0 4px 14px rgba(27,46,75,0.25)' }}>
                Go to Sign In
              </Link>
            </div>
          )}

          <div className="px-6 py-4 text-center rounded-b-2xl" style={{ background: '#F8FAFC', borderTop: `1px solid ${BORDER}` }}>
            <p className="text-sm" style={{ color: LGRAY }}>
              Remembered it?{' '}
              <Link to="/login" className="link font-bold" style={{ color: NAVY }}>Sign in</Link>
              {' · '}
              <Link to={forPassword ? '/forgot-user-id' : '/forgot-password'} className="link font-bold" style={{ color: NAVY }}>
                {forPassword ? 'Forgot User ID?' : 'Forgot password?'}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
