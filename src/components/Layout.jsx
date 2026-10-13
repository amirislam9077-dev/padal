import { useState, useRef, useEffect } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { Calendar, BookOpen, Home, Shield, MapPin, Phone, MessageSquare, LogOut, ChevronDown, Camera, Trash2, ArrowRight } from 'lucide-react'
import { getCurrentUser, logoutUser, updatePictureApi } from '../store'

const NAVY = '#1B2E4B'
// Dark "OneText" theme for the header and footer
const OT_BG = '#070B18'
const OT_BLUE = '#2F6BFF'
const OT_LINE = 'rgba(255,255,255,0.09)'

// White logo box with blue letters and a speech-bubble tail (like the OneText logo)
export function OtLogo({ size = 40 }) {
  return (
    <div className="ot-logo rounded-lg flex items-center justify-center font-black shrink-0"
      style={{ width: size, height: size * 0.9, background: '#FFFFFF', color: OT_BLUE, fontSize: size * 0.38, letterSpacing: '-0.5px' }}>NN</div>
  )
}

function SiteFooter() {
  return (
    <footer style={{ background: '#05070F', borderTop: `1px solid ${OT_LINE}` }}>
      {/* Main row */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center gap-x-6 gap-y-5 justify-between"
        style={{ borderBottom: `1px solid ${OT_LINE}` }}>

        {/* Logo + name */}
        <div className="flex items-center gap-3">
          <OtLogo size={42} />
          <div>
            <p className="font-bold text-white text-sm leading-tight">North Nazimabad</p>
            <p className="text-xs font-semibold" style={{ color: '#7EA2FF' }}>Gymkhana Trust</p>
          </div>
        </div>

        {/* Nav links */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {/* Admin link only on phones (wider screens have the Admin button in the header) */}
          {[['/', 'Home'], ['/book', 'Padel Booking'], ['/my-bookings', 'My Bookings'], ['/complaints', 'Complaints'], ['/admin', 'Admin', true]].map(([to, label, phoneOnly]) => (
            <Link key={to} to={to}
              className={`${phoneOnly ? 'sm:hidden ' : ''}text-sm font-medium whitespace-nowrap transition hover:text-white`}
              style={{ color: '#9AA3B5' }}>
              {label}
            </Link>
          ))}
        </div>

        {/* Phone */}
        <div className="flex items-center gap-2 text-sm" style={{ color: '#C9CFDB' }}>
          <Phone size={14} style={{ color: OT_BLUE }} />
          <span className="font-semibold">+92 21 0000 0000</span>
        </div>

        {/* Address */}
        <div className="flex items-center gap-2 text-sm" style={{ color: '#9AA3B5', maxWidth: '260px' }}>
          <MapPin size={14} style={{ color: OT_BLUE, flexShrink: 0 }} />
          North Nazimabad, Karachi, Pakistan
        </div>

        {/* Social icons */}
        <div className="flex items-center gap-3">
          {/* Facebook */}
          <a href="#" className="btn-light w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: '#1877F2' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
            </svg>
          </a>
          {/* Instagram */}
          <a href="#" className="btn-light w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
              <circle cx="12" cy="12" r="4"/>
              <circle cx="17.5" cy="6.5" r="1" fill="white" stroke="none"/>
            </svg>
          </a>
          {/* WhatsApp */}
          <a href="#" className="btn-light w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: '#25D366' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M11.999 2C6.477 2 2 6.477 2 12c0 1.9.52 3.677 1.428 5.202L2 22l4.948-1.395A9.953 9.953 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 11.999 2z"/>
            </svg>
          </a>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs" style={{ color: '#5E6678' }}>
          © 2026 North Nazimabad Gymkhana Trust. All rights reserved.
        </p>
        <p className="text-xs" style={{ color: '#4A5163' }}>
          Padel Court Booking System
        </p>
      </div>
    </footer>
  )
}

// Round profile photo with a bright white ring + soft glow so it stands out on the dark header
function Avatar({ user, size, online = false }) {
  const [broken, setBroken] = useState(null) // the picture URL that failed to load
  const ring = {
    width: size, height: size,
    border: `${size >= 60 ? 3 : 2.5}px solid white`,
    boxShadow: '0 0 0 2px rgba(143,169,200,0.65), 0 4px 14px rgba(0,0,0,0.35)',
  }
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {user.picture && broken !== user.picture ? (
        <img src={user.picture} alt={user.name} className="rounded-full object-cover block"
          onError={() => setBroken(user.picture)}
          style={{ ...ring, background: 'white' }} />
      ) : (
        <span className="rounded-full flex items-center justify-center font-black"
          style={{ ...ring, fontSize: size * 0.4, background: 'white', color: NAVY }}>
          {user.name.charAt(0).toUpperCase()}
        </span>
      )}
      {online && (
        <span className="absolute rounded-full"
          style={{ right: 0, bottom: 0, width: size * 0.28, height: size * 0.28, background: '#22C55E', border: '2px solid ' + NAVY }} />
      )}
    </span>
  )
}

const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_PICTURE_MB = 2

// Profile picture button (top right) with a dropdown: details, change/remove picture, My Bookings, Logout
function ProfileMenu({ user, onLogout, onUserChange }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { type: 'error' | 'ok', text }
  const ref = useRef(null)
  const fileInput = useRef(null)

  async function savePicture(dataUrl) {
    setBusy(true); setMsg(null)
    const result = await updatePictureApi(dataUrl)
    setBusy(false)
    if (result.error) { setMsg({ type: 'error', text: result.error }); return }
    setMsg({ type: 'ok', text: dataUrl ? 'Profile picture updated.' : 'Profile picture removed.' })
    onUserChange()
  }

  function handleFile(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (!PICTURE_TYPES.includes(file.type)) { setMsg({ type: 'error', text: 'Picture must be a JPG, PNG or WEBP image.' }); return }
    if (file.size > MAX_PICTURE_MB * 1024 * 1024) { setMsg({ type: 'error', text: `Picture must be ${MAX_PICTURE_MB} MB or smaller.` }); return }
    const reader = new FileReader()
    reader.onload = () => savePicture(reader.result)
    reader.readAsDataURL(file)
  }

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!open) return
    const onClick = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="btn-ghost flex items-center gap-2.5 pl-1 pr-2 sm:pr-3.5 py-1 rounded-full"
        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', color: 'white', overflow: 'visible' }}
        aria-label="Profile menu" aria-expanded={open}>
        <Avatar user={user} size={34} online />
        <span className="hidden sm:block text-sm font-bold max-w-[110px] truncate">{user.name.split(' ')[0]}</span>
        <ChevronDown size={14} className="transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none', opacity: 0.7 }} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-2xl overflow-hidden z-50"
          style={{ background: 'white', border: '1px solid #DDE3EC', boxShadow: '0 16px 40px rgba(10,22,40,0.25)' }}>
          <div className="flex items-center gap-3 p-4" style={{ background: NAVY }}>
            {/* Photo with a camera button to change it */}
            <div className="relative shrink-0">
              <Avatar user={user} size={72} />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}
                className="absolute flex items-center justify-center rounded-full"
                style={{ right: -4, bottom: -2, width: 24, height: 24, background: 'white', color: NAVY, boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}
                aria-label="Change profile picture">
                <Camera size={12} />
              </button>
              {busy && (
                <span className="absolute inset-0 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: 'rgba(10,22,40,0.6)' }}>…</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-white text-sm truncate">{user.name}</p>
              {user.membershipNo && <p className="text-xs font-semibold" style={{ color: '#8FA9C8' }}>{user.membershipNo}</p>}
              <p className="text-xs truncate" style={{ color: '#6B8CAE' }}>{user.email}</p>
            </div>
          </div>
          {msg && (
            <p className="mx-3 mt-2 px-3 py-2 rounded-lg text-xs font-semibold"
              style={msg.type === 'error'
                ? { background: '#FEF2F2', color: '#DC2626' }
                : { background: '#ECFDF5', color: '#047857' }}>
              {msg.text}
            </p>
          )}
          <div className="p-2">
            <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}
              className="btn-text w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-slate-100"
              style={{ color: NAVY }}>
              <Camera size={15} /> {busy ? 'Saving…' : user.picture ? 'Change profile picture' : 'Add profile picture'}
            </button>
            {user.picture && (
              <button type="button" onClick={() => savePicture(null)} disabled={busy}
                className="btn-text w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-slate-100"
                style={{ color: '#64748B' }}>
                <Trash2 size={15} /> Remove picture
              </button>
            )}
            <div className="my-1" style={{ borderTop: '1px solid #EEF2F7' }} />
            <Link to="/my-bookings" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-slate-100"
              style={{ color: NAVY }}>
              <BookOpen size={15} /> My Bookings
            </Link>
            <button type="button" onClick={onLogout}
              className="btn-text w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-red-50"
              style={{ color: '#DC2626' }}>
              <LogOut size={15} /> Logout
            </button>
          </div>
          <p className="px-5 pb-3 text-[11px]" style={{ color: '#94A3B8' }}>JPG, PNG or WEBP · max {MAX_PICTURE_MB} MB</p>
        </div>
      )}
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} className="hidden" />
    </div>
  )
}

export default function Layout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isHome = pathname === '/'
  // Pages on the dark site background (the rest use the light grey one)
  const darkPage = isHome || pathname === '/admin'
  const user = getCurrentUser()
  const [, refresh] = useState(0) // re-read the session after the picture changes

  function handleLogout() {
    logoutUser()
    navigate('/login')
  }

  const navLinks = [
    { to: '/', label: 'Home', short: 'Home', icon: Home },
    { to: '/book', label: 'Padel Booking', short: 'Book', icon: Calendar },
    { to: '/my-bookings', label: 'My Bookings', short: 'Bookings', icon: BookOpen },
    { to: '/complaints', label: 'Complaints', short: 'Complaints', icon: MessageSquare, phoneHidden: true }, // not in the phone tab bar (footer still links it)
  ]

  return (
    <div style={{ background: darkPage ? OT_BG : '#F1F4F8', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ── HEADER ── */}
      {/* Dark header like the OneText design: logo box, menu in a grey pill, Login + outlined button */}
      <header className="sticky top-0 z-40" style={{ background: OT_BG, borderBottom: `1px solid ${OT_LINE}`, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3 sm:gap-4">
          <Link to="/" className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <OtLogo size={40} />
            <div className="min-w-0">
              <p className="font-bold text-sm text-white leading-tight truncate">
                {/* Short title where space is tight: phones, and laptops where the full menu shows */}
                <span className="sm:hidden lg:inline xl:hidden">NNG Trust</span>
                <span className="hidden sm:inline lg:hidden xl:inline">North Nazimabad Gymkhana Trust</span>
              </p>
              <p className="text-xs truncate" style={{ color: '#9AA3B5' }}>Where Champions Play</p>
            </div>
          </Link>

          {/* Full menu only on wide screens; phones and tablets use the tab bar below */}
          <nav className="hidden lg:flex items-center gap-0.5 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.08)', border: `1px solid ${OT_LINE}` }}>
            {navLinks.map(({ to, label }) => (
              <Link key={to} to={to} aria-current={pathname === to ? 'page' : undefined}
                className="ot-navlink px-3 xl:px-4 py-1.5 rounded-md text-sm font-medium whitespace-nowrap"
                style={pathname === to
                  ? { background: 'rgba(255,255,255,0.16)', color: 'white' }
                  : { color: 'rgba(255,255,255,0.78)' }}>
                {label}
              </Link>
            ))}
          </nav>

          {/* Right side: auth */}
          <div className="flex items-center gap-2 shrink-0">
            {!user && (
              <>
                <Link to="/login" className="text-sm font-medium px-2 sm:px-3 py-2 rounded-lg hover:opacity-80" style={{ color: 'white' }}>
                  Login
                </Link>
                {/* Outlined button with an arrow in a white circle */}
                <Link to="/signup"
                  className="ot-outline inline-flex items-center gap-2 text-sm font-medium pl-3 sm:pl-4 pr-1.5 py-1.5 rounded-lg whitespace-nowrap"
                  style={{ color: 'white', border: '1.5px solid rgba(255,255,255,0.85)' }}>
                  Sign Up
                  <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'white', color: OT_BG }}><ArrowRight size={12} strokeWidth={2.75} /></span>
                </Link>
              </>
            )}
            <Link to="/admin"
              className="ot-outline hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.06)', color: '#C9CFDB', border: `1px solid ${OT_LINE}` }}>
              <Shield size={12} /> Admin
            </Link>
            {/* Logged in: profile picture at the far right, opens the profile menu */}
            {/* key={pathname}: menu closes after navigating to another page */}
            {user && <ProfileMenu key={pathname} user={user} onLogout={handleLogout} onUserChange={() => refresh(n => n + 1)} />}
          </div>
        </div>

        {/* Phone / tablet tab bar */}
        <nav className="lg:hidden flex border-t" style={{ borderColor: OT_LINE, background: '#0B0F1C' }}>
          {/* Admin tab only on phones — the header has no room for the Admin button there */}
          {[...navLinks, { to: '/admin', label: 'Admin', short: 'Admin', icon: Shield, phoneOnly: true }].map(({ to, label, short, icon: Icon, phoneHidden, phoneOnly }) => (
            <Link key={to} to={to} title={label}
              className={`nav-link flex-1 min-w-0 ${phoneHidden ? "hidden sm:flex" : phoneOnly ? "flex sm:hidden" : "flex"} flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-1 py-2.5 sm:py-3 text-[11px] sm:text-sm font-semibold border-b-2 whitespace-nowrap overflow-hidden`}
              style={pathname === to
                ? { borderColor: OT_BLUE, color: 'white' }
                : { borderColor: 'transparent', color: '#8A93A6' }}>
              <Icon size={16} className="shrink-0" />
              <span className="sm:hidden truncate max-w-full">{short}</span>
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </nav>
      </header>

      {/* ── CONTENT ── */}
      <main style={{ flex: 1, paddingBottom: darkPage ? 0 : '50px' /* Home ends with its own dark footer */ }}>
        <Outlet />
      </main>

      {/* ── FOOTER — shown on all pages (Home has its own identical footer inside the page) ── */}
      {!isHome && <SiteFooter />}
    </div>
  )
}
