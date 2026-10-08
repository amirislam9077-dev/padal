import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { User, Mail, Phone, Lock, Eye, EyeOff, AlertCircle, Hash, ShieldCheck, RefreshCw, Camera, X } from 'lucide-react'
import { sendOtpApi, signupApi, checkMembershipApi, checkEmailApi } from '../store'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const MEMBERSHIP_PREFIX = 'NNG-'
const PHONE_PREFIX = '+92'
const MAX_PICTURE_MB = 2

const fieldStyle = {
  width: '100%', border: `1.5px solid ${BORDER}`, borderRadius: '8px',
  padding: '8px 10px 8px 32px', fontSize: '13px', outline: 'none',
  color: NAVY, background: '#F8FAFC', fontFamily: 'inherit',
}
const labelStyle = {
  display: 'block', fontSize: '12px', fontWeight: '800',
  letterSpacing: '0.04em', textTransform: 'uppercase', color: NAVY, marginBottom: '5px',
}

// OTP verification screen — code is sent and checked by the server
function OTPScreen({ form, sentTo, onResend, onVerify, onBack }) {
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [resendTimer, setResendTimer] = useState(30)
  const refs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()]

  useEffect(() => {
    refs[0].current?.focus()
    const interval = setInterval(() => setResendTimer(t => t > 0 ? t - 1 : 0), 1000)
    return () => clearInterval(interval)
  }, [])

  function handleDigit(i, val) {
    if (!/^\d?$/.test(val)) return
    const next = [...digits]
    next[i] = val
    setDigits(next)
    setError('')
    if (val && i < 5) refs[i + 1].current?.focus()
  }

  function handleKeyDown(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      refs[i - 1].current?.focus()
    }
  }

  function handlePaste(e) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (text.length === 6) {
      setDigits(text.split(''))
      refs[5].current?.focus()
    }
  }

  async function verify() {
    const entered = digits.join('')
    if (entered.length < 6) { setError('Please enter all 6 digits.'); return }
    setVerifying(true)
    const err = await onVerify(entered)
    setVerifying(false)
    if (err) { setError(err); setDigits(['', '', '', '', '', '']); refs[0].current?.focus() }
  }

  async function resend() {
    setDigits(['', '', '', '', '', '']); setError('')
    const err = await onResend()
    if (err) setError(err)
    else setResendTimer(30)
  }

  const maskedPhone = form.phone ? PHONE_PREFIX + form.phone.slice(0, -4).replace(/\d/g, '*') + form.phone.slice(-4) : '—'
  const maskedEmail = form.email ? form.email[0] + '***@' + form.email.split('@')[1] : '—'

  return (
    <div className="flex items-center justify-center px-4 py-8" style={{ background: '#F1F4F8' }}>
      <div className="w-full" style={{ maxWidth: '380px' }}>

        <div className="text-center mb-6">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow"
            style={{ background: NAVY }}>
            <ShieldCheck size={20} color="white" />
          </div>
          <h1 className="text-lg font-black" style={{ color: NAVY }}>Verify Your Identity</h1>
          <p className="text-xs mt-1" style={{ color: LGRAY }}>
            A 6-digit code has been sent to your {sentTo.sms && sentTo.email ? 'mobile and email' : sentTo.sms ? 'mobile' : 'email'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm" style={{ border: `1px solid ${BORDER}` }}>

          {/* Sent-to info */}
          <div className="px-5 pt-4 pb-3 space-y-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
            {sentTo.sms && (
              <div className="flex items-center gap-2 text-xs" style={{ color: '#4A6FA5' }}>
                <Phone size={12} /> <span>SMS sent to <strong>{maskedPhone}</strong></span>
              </div>
            )}
            {sentTo.email && (
              <div className="flex items-center gap-2 text-xs" style={{ color: '#4A6FA5' }}>
                <Mail size={12} /> <span>Email sent to <strong>{maskedEmail}</strong></span>
              </div>
            )}
          </div>

          <div className="px-5 py-5 space-y-4">
            {/* OTP boxes */}
            <div className="flex gap-2 justify-center" onPaste={handlePaste}>
              {digits.map((d, i) => (
                <input key={i} ref={refs[i]}
                  type="text" inputMode="numeric" maxLength={1}
                  value={d}
                  onChange={e => handleDigit(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  className="otp-digit text-center font-black text-xl rounded-xl transition"
                  style={{
                    width: '46px', height: '52px', border: `2px solid ${d ? NAVY : BORDER}`,
                    outline: 'none', color: NAVY, background: d ? '#EEF2F7' : '#F8FAFC',
                    fontSize: '20px',
                  }} />
              ))}
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: '#FEF2F2', border: '1px solid #FEE2E2' }}>
                <AlertCircle size={13} style={{ color: '#DC2626', flexShrink: 0 }} />
                <p className="text-xs" style={{ color: '#DC2626' }}>{error}</p>
              </div>
            )}

            <button onClick={verify} disabled={verifying}
              className="btn w-full py-3 rounded-xl font-black text-sm"
              style={{ background: NAVY, color: 'white', boxShadow: '0 4px 14px rgba(27,46,75,0.2)', opacity: verifying ? 0.7 : 1 }}>
              {verifying ? 'Verifying…' : 'Verify & Create Account'}
            </button>

            {/* Resend */}
            <div className="text-center">
              {resendTimer > 0 ? (
                <p className="text-xs" style={{ color: LGRAY }}>Resend code in <strong>{resendTimer}s</strong></p>
              ) : (
                <button onClick={resend}
                  className="btn-text flex items-center gap-1.5 text-xs font-bold mx-auto"
                  style={{ color: NAVY }}>
                  <RefreshCw size={12} /> Resend Code
                </button>
              )}
            </div>
          </div>

          <div className="px-5 py-3 text-center rounded-b-2xl" style={{ background: '#F8FAFC', borderTop: `1px solid ${BORDER}` }}>
            <button onClick={onBack} className="btn-text text-xs font-semibold" style={{ color: LGRAY }}>
              ← Back to registration
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Signup() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', phone: '', membershipNo: '', password: '', confirm: '' })
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState(null)
  const [showOTP, setShowOTP] = useState(false)
  // People already registered on this membership number (family members can share one)
  const [members, setMembers] = useState([])

  // New membership number = start over: empty every other field
  function changeMembership(digits) {
    if (digits === form.membershipNo) return
    setForm({ name: '', email: '', phone: '', membershipNo: digits, password: '', confirm: '' })
    setPicture(null)
    setMembers([])
    setEmailTaken(false)
    setError('')
  }

  // Email must be unique: check the database 500ms after typing stops
  const [emailTaken, setEmailTaken] = useState(false)
  useEffect(() => {
    const email = form.email.trim()
    if (!/^\S+@\S+\.\S+$/.test(email)) return
    let cancelled = false
    const t = setTimeout(async () => {
      const result = await checkEmailApi(email)
      if (!cancelled) setEmailTaken(result.exists === true)
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [form.email])

  // A name may only be registered once per membership number (ignores case and extra spaces)
  const normName = s => s.trim().replace(/\s+/g, ' ').toLowerCase()
  const takenBy = form.name.trim() ? members.find(m => normName(m.name) === normName(form.name)) : null
  const [picture, setPicture] = useState(null) // data URL of the chosen image
  const pictureInput = useRef()

  function handlePicture(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Picture must be a JPG, PNG or WEBP image.'); return }
    if (file.size > MAX_PICTURE_MB * 1024 * 1024) { setError(`Picture must be ${MAX_PICTURE_MB} MB or smaller.`); return }
    setError('')
    const reader = new FileReader()
    reader.onload = () => setPicture(reader.result)
    reader.readAsDataURL(file)
  }

  // Check the membership number against the database 500ms after typing stops
  useEffect(() => {
    if (!form.membershipNo) return
    let cancelled = false
    const t = setTimeout(async () => {
      const result = await checkMembershipApi(MEMBERSHIP_PREFIX + form.membershipNo)
      if (!cancelled) setMembers(result.members || [])
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [form.membershipNo])

  const payload = {
    name: form.name.trim(), email: form.email.trim(),
    phone: PHONE_PREFIX + form.phone, membershipNo: MEMBERSHIP_PREFIX + form.membershipNo,
    password: form.password,
  }

  function handleChange(e) {
    setForm(p => ({ ...p, [e.target.name]: e.target.value }))
    if (error) setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim() || !form.phone.trim() || !form.membershipNo || !form.password) {
      setError('Please fill in all required fields.'); return
    }
    if (form.phone.length !== 10) {
      setError('Please enter a 10-digit mobile number after +92, e.g. 300 1234567.'); return
    }
    if (emailTaken) {
      setError('An account with this email already exists. Please sign in instead.'); return
    }
    if (takenBy) {
      setError(`${takenBy.name} is already registered on ${MEMBERSHIP_PREFIX}${form.membershipNo}. Please sign in instead.`); return
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.'); return
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.'); return
    }
    setLoading(true)
    const result = await sendOtpApi(payload)
    setLoading(false)
    if (result.error) { setError(result.error); return }
    setSentTo(result)
    setShowOTP(true)
  }

  // Returns an error message for the OTP screen, or null
  async function handleVerify(code) {
    const result = await signupApi({ ...payload, picture, otp: code })
    if (result.error) {
      if (result.otpError) return result.error
      setShowOTP(false); setError(result.error); return null
    }
    navigate('/')
    return null
  }

  async function handleResend() {
    const result = await sendOtpApi(payload)
    if (result.error) return result.error
    setSentTo(result)
    return null
  }

  if (showOTP) {
    return (
      <OTPScreen
        form={form}
        sentTo={sentTo}
        onResend={handleResend}
        onVerify={handleVerify}
        onBack={() => setShowOTP(false)}
      />
    )
  }

  return (
    <div className="flex items-center justify-center px-4 py-4 md:py-5" style={{ background: '#F1F4F8' }}>
      {/* Narrow single column on phones; wide two-panel card (photo | fields) from tablet up */}
      <div className="w-full max-w-[440px] md:max-w-[780px]">

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
          <div className="px-5 pt-4 pb-1 flex items-center justify-between"
            style={{ borderBottom: `1px solid ${BORDER}` }}>
            <div>
              <p className="font-black text-base" style={{ color: NAVY }}>Create Account</p>
              <p className="text-xs" style={{ color: LGRAY }}>NNG Trust Members Portal</p>
            </div>
            <p className="text-xs" style={{ color: LGRAY }}>* required</p>
          </div>

          <form onSubmit={handleSubmit} className="md:flex">

            {/* Profile picture (optional): a row on phones, left panel from tablet up */}
            <div className="flex md:flex-col items-center gap-4 md:gap-0 md:justify-center px-5 pt-4 md:py-6 md:w-56 md:shrink-0 md:border-r"
              style={{ borderColor: BORDER, background: 'linear-gradient(180deg, #F8FAFC, #FFFFFF)' }}>
              <div className="relative shrink-0">
                <button type="button" onClick={() => pictureInput.current?.click()}
                  className="w-16 h-16 md:w-28 md:h-28 rounded-full flex items-center justify-center overflow-hidden"
                  style={{
                    background: picture ? 'white' : '#EEF2F7',
                    border: '4px solid white',
                    boxShadow: `0 0 0 1.5px ${picture ? NAVY : BORDER}, 0 6px 16px rgba(27,46,75,0.15)`,
                  }}
                  aria-label={picture ? 'Change profile photo' : 'Upload profile photo'}>
                  {picture
                    ? <img src={picture} alt="Profile preview" className="w-full h-full object-cover" />
                    : <User size={34} strokeWidth={1.5} style={{ color: LGRAY }} />}
                </button>

                {/* Camera badge */}
                <button type="button" onClick={() => pictureInput.current?.click()}
                  className="absolute w-7 h-7 md:w-8 md:h-8 flex items-center justify-center rounded-full transition hover:scale-105"
                  style={{ right: '-3px', bottom: '0px', background: NAVY, border: '3px solid white', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}
                  aria-label="Choose photo">
                  <Camera size={13} color="white" />
                </button>
              </div>

              <div className="min-w-0 md:text-center md:mt-3">
              <p className="text-sm font-bold" style={{ color: NAVY }}>
                {picture ? 'Profile photo' : 'Upload profile photo'}
              </p>
              {picture ? (
                <div className="flex items-center md:justify-center gap-3 mt-0.5">
                  <button type="button" onClick={() => pictureInput.current?.click()}
                    className="btn-text text-xs font-semibold" style={{ color: '#4A6FA5' }}>
                    Change
                  </button>
                  <span style={{ color: BORDER }}>|</span>
                  <button type="button" onClick={() => setPicture(null)}
                    className="btn-text flex items-center gap-1 text-xs font-semibold" style={{ color: '#DC2626' }}>
                    <X size={11} /> Remove
                  </button>
                </div>
              ) : (
                <p className="text-xs mt-0.5" style={{ color: LGRAY }}>Optional · JPG, PNG or WEBP<br className="hidden md:inline" /> · max {MAX_PICTURE_MB} MB</p>
              )}
              </div>

              <input ref={pictureInput} type="file" accept="image/jpeg,image/png,image/webp"
                onChange={handlePicture} className="hidden" />
            </div>

            {/* Form fields */}
            <div className="flex-1 min-w-0 px-5 pt-4 pb-4 md:py-5 space-y-3">

            {/* Row 1: Membership + Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Membership No. *</label>
                <div className="relative">
                  <Hash size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
                  <span className="membership-prefix absolute top-1/2 -translate-y-1/2 font-semibold pointer-events-none"
                    style={{ left: '32px', color: NAVY }}>{MEMBERSHIP_PREFIX}</span>
                  <input type="text" name="membershipNo" placeholder="0001" inputMode="numeric"
                    maxLength={20 - MEMBERSHIP_PREFIX.length}
                    value={form.membershipNo}
                    onChange={e => changeMembership(e.target.value.replace(/\D/g, ''))}
                    style={{ ...fieldStyle, paddingLeft: 'var(--membership-pad)' }} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Full Name *</label>
                <div className="relative">
                  <User size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
                  <input type="text" name="name" placeholder="Ahmed Khan"
                    value={form.name} onChange={handleChange}
                    style={{ ...fieldStyle, ...(takenBy && { borderColor: '#DC2626', background: '#FEF2F2' }) }} />
                </div>
                {takenBy && (
                  <p className="text-xs mt-1" style={{ color: '#DC2626' }}>
                    <strong>{takenBy.name}</strong> is already registered on {MEMBERSHIP_PREFIX}{form.membershipNo}.{' '}
                    <Link to="/login" className="link font-bold whitespace-nowrap" style={{ color: '#DC2626' }}>Sign in</Link>
                  </p>
                )}
              </div>
            </div>

            {/* Members already on this membership number */}
            {members.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 rounded-lg" style={{ background: '#EEF2F7', border: `1px solid ${BORDER}` }}>
                <span className="text-xs mr-0.5" style={{ color: NAVY }}>
                  <strong>{MEMBERSHIP_PREFIX}{form.membershipNo}</strong> members:
                </span>
                {/* Selecting a name puts it in Full Name, which shows the "already registered" message */}
                {members.map(m => (
                  <button key={m.id} type="button"
                    onClick={() => { setForm(p => ({ ...p, name: m.name })); setError('') }}
                    title={`${m.name} is already registered`}
                    className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                    style={takenBy?.id === m.id
                      ? { background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }
                      : { background: 'white', color: NAVY, border: `1px solid ${BORDER}` }}>
                    {m.name}
                  </button>
                ))}
                <span className="text-xs w-full" style={{ color: LGRAY }}>Each name can be registered only once on this membership.</span>
              </div>
            )}

            {/* Row 2: Email + Phone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Email Address *</label>
                <div className="relative">
                  <Mail size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
                  <input type="email" name="email" placeholder="you@email.com"
                    value={form.email} onChange={e => { setEmailTaken(false); handleChange(e) }} autoComplete="email"
                    style={{ ...fieldStyle, ...(emailTaken && { borderColor: '#DC2626', background: '#FEF2F2' }) }} />
                </div>
                {emailTaken && (
                  <p className="text-xs mt-1" style={{ color: '#DC2626' }}>
                    This email is already registered.{' '}
                    <Link to="/login" className="link font-bold whitespace-nowrap" style={{ color: '#DC2626' }}>Sign in</Link>
                  </p>
                )}
              </div>
              <div>
                <label style={labelStyle}>Phone Number *</label>
                <div className="relative">
                  <Phone size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
                  <span className="field-prefix absolute top-1/2 -translate-y-1/2 font-semibold pointer-events-none"
                    style={{ left: '32px', color: NAVY }}>{PHONE_PREFIX}</span>
                  {/* Digits only after +92; a leading 0 (0300…) is dropped */}
                  <input type="tel" name="phone" placeholder="300 1234567" inputMode="numeric" maxLength={10}
                    value={form.phone}
                    onChange={e => handleChange({ target: { name: 'phone', value: e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10) } })}
                    style={{ ...fieldStyle, paddingLeft: 'var(--phone-pad)' }} />
                </div>
              </div>
            </div>

            {/* Row 3: Password + Confirm */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>Password *</label>
                <div className="relative">
                  <Lock size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
                  <input type={showPw ? 'text' : 'password'} name="password" placeholder="Min. 6 chars"
                    value={form.password} onChange={handleChange} autoComplete="new-password"
                    style={{ ...fieldStyle, paddingRight: '30px' }} />
                  <button type="button" onClick={() => setShowPw(p => !p)}
                    className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: LGRAY }}>
                    {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Confirm Password *</label>
                <div className="relative">
                  <Lock size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
                  <input type={showPw ? 'text' : 'password'} name="confirm" placeholder="Re-enter"
                    value={form.confirm} onChange={handleChange} autoComplete="new-password"
                    style={fieldStyle} />
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: '#FEF2F2', border: '1px solid #FEE2E2' }}>
                <AlertCircle size={13} style={{ color: '#DC2626', flexShrink: 0 }} />
                <p className="text-xs" style={{ color: '#DC2626' }}>{error}</p>
              </div>
            )}

            <button type="submit" disabled={loading}
              className="btn w-full py-3 rounded-xl font-black text-sm"
              style={{ background: NAVY, color: 'white', boxShadow: '0 4px 14px rgba(27,46,75,0.25)', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Sending verification code…' : 'Continue'}
            </button>
            </div>
          </form>

          <div className="px-5 py-3 text-center rounded-b-2xl" style={{ background: '#F8FAFC', borderTop: `1px solid ${BORDER}` }}>
            <p className="text-xs" style={{ color: LGRAY }}>
              Already have an account?{' '}
              <Link to="/login" className="link font-bold" style={{ color: NAVY }}>Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
