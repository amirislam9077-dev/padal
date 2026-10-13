import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, CalendarDays, Grid2x2, LogOut, ChevronRight, Trophy, CalendarRange, BarChart3, House, BookOpenText, TrendingUp, Receipt, Users } from 'lucide-react'
import { adminLogout, getCourts } from '../store'

// Same dark colours as the public site header (Layout.jsx)
const NAVY = '#070B18'
const NAVY2 = '#0B0F1C'
const BLUE = '#2F6BFF'
const LINE = 'rgba(255,255,255,0.09)'

export default function AdminLayout() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const currentView = new URLSearchParams(search).get('view') || 'all'
  const bookingViews = [
    { key: 'all', label: 'All Bookings' },
    { key: 'upcoming', label: 'Upcoming Bookings' },
    ...getCourts().map(c => ({ key: `court-${c.id}`, label: `${c.name} Bookings` })),
    { key: 'u18', label: 'U-18 Bookings' },
  ]

  function logout() {
    adminLogout()
    navigate('/admin')
  }

  const navLinks = [
    { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/admin/bookings', label: 'All Bookings', short: 'Bookings', icon: CalendarDays },
    { to: '/admin/calendar', label: 'Calendar Bookings', short: 'Calendar', icon: CalendarRange },
    { to: '/admin/scale', label: 'Scale', icon: BarChart3 },
    { to: '/admin/courts', label: 'Courts', icon: Grid2x2 },
    { to: '/admin/events', label: 'Events', icon: Trophy },
    { to: '/admin/members', label: 'Signed-up Members', short: 'Members', icon: Users },
    { to: '/admin/ledger', label: 'Ledger', icon: BookOpenText },
    { to: '/admin/vouchers', label: 'Vouchers', icon: Receipt },
    { to: '/admin/profit-loss', label: 'Profit & Loss', short: 'P&L', icon: TrendingUp },
    // Back to the public booking site
    { to: '/', label: 'Booking Home Page', short: 'Home', icon: House, divider: true },
  ]

  return (
    <div className="min-h-screen flex" style={{ background: '#F1F4F8' }}>
      {/* Sidebar on wide screens; phones/tablets get the top bar below */}
      {/* Fits the window height and stays in place while the page scrolls (scrolls itself only on very short screens) */}
      <aside className="hidden lg:flex print:hidden w-60 shrink-0 flex-col shadow-xl sticky top-0 h-screen" style={{ background: NAVY, borderRight: `1px solid ${LINE}` }}>
        <div className="px-4 py-3 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shadow"
              style={{ background: '#FFFFFF', color: BLUE }}>NN</div>
            <div>
              <p className="font-bold text-white text-sm">NNGT Admin</p>
              <p className="text-xs" style={{ color: '#9AA3B5' }}>Padel Management</p>
            </div>
          </div>
        </div>

        <nav className="admin-tabs flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5">
          {navLinks.map(({ to, label, icon: Icon, divider }) => (
            <div key={to} className={divider ? 'pt-1.5 mt-1.5' : ''} style={divider ? { borderTop: '1px solid rgba(255,255,255,0.08)' } : undefined}>
              <Link to={to}
                className="nav-link flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold"
                style={pathname === to
                  ? { background: 'rgba(255,255,255,0.15)', color: '#FFFFFF' }
                  : { color: 'rgba(255,255,255,0.5)' }}>
                <Icon size={16} />
                {label}
                {pathname === to && <ChevronRight size={13} className="ml-auto" />}
              </Link>
              {/* Booking views under "All Bookings" — only while on that page, so the sidebar fits the screen */}
              {to === '/admin/bookings' && pathname === to && (
                <div className="mt-0.5 mb-1 ml-5 pl-3 space-y-0.5" style={{ borderLeft: '1px solid rgba(255,255,255,0.12)' }}>
                  {bookingViews.map(v => {
                    const on = pathname === to && currentView === v.key
                    return (
                      <Link key={v.key} to={v.key === 'all' ? to : `${to}?view=${v.key}`}
                        className="nav-link block px-3 py-1 rounded-lg text-xs font-semibold"
                        style={on ? { background: 'rgba(255,255,255,0.12)', color: '#FFFFFF' } : { color: 'rgba(255,255,255,0.45)' }}>
                        {v.label}
                      </Link>
                    )
                  })}                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="px-3 py-2 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button onClick={logout}
            className="nav-link flex items-center gap-2 text-sm w-full px-3 py-2 rounded-xl"
            style={{ color: 'rgba(255,255,255,0.35)' }}>
            <LogOut size={15} /> Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Phone / tablet top bar */}
        <div className="lg:hidden print:hidden sticky top-0 z-40" style={{ background: NAVY, boxShadow: '0 2px 12px rgba(10,22,40,0.3)' }}>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
                style={{ background: '#FFFFFF', color: BLUE }}>NN</div>
              <div className="min-w-0">
                <p className="font-bold text-white text-sm truncate">NNGT Admin</p>
                <p className="text-xs truncate" style={{ color: '#9AA3B5' }}>Padel Management</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link to="/" title="Booking Home Page"
                className="btn-ghost flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg"
                style={{ color: '#8FA9C8', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)' }}>
                <House size={13} /> Home
              </Link>
              <button onClick={logout}
                className="btn-ghost flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg"
                style={{ color: '#8FA9C8', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)' }}>
                <LogOut size={13} /> Logout
              </button>
            </div>
          </div>
          <nav className="admin-tabs flex overflow-x-auto" style={{ background: NAVY2, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {navLinks.filter(l => !l.divider).map(({ to, label, short, icon: Icon }) => ( // Home is a button beside Logout here
              <Link key={to} to={to}
                className="nav-link flex-1 shrink-0 min-w-[64px] flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-2 py-2.5 text-[11px] sm:text-sm font-semibold border-b-2 whitespace-nowrap"
                style={pathname === to
                  ? { borderColor: 'white', color: 'white' }
                  : { borderColor: 'transparent', color: 'rgba(255,255,255,0.45)' }}>
                <Icon size={16} />{short || label}
              </Link>
            ))}
          </nav>
        </div>

        <header className="hidden lg:flex print:hidden items-center justify-between px-6 py-3.5 sticky top-0 z-30"
          style={{ background: NAVY, borderBottom: `1px solid ${LINE}`, boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
          <div>
            <p className="font-bold text-base text-white">North Nazimabad Gymkhana Trust</p>
            <p className="text-xs" style={{ color: '#9AA3B5' }}>Admin Control Panel</p>
          </div>
          <span className="text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color: '#7EA2FF' }}>Where Champions Play</span>
        </header>
        <main className="flex-1 p-4 sm:p-6 print:p-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
