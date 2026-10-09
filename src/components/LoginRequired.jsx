import { Link, useLocation } from 'react-router-dom'
import { CalendarX } from 'lucide-react'

const NAVY = '#1B2E4B'

// Shown on member-only pages (Padel Booking, My Bookings, Complaints) when nobody is logged in.
// "Log in" comes back to this page afterwards.
export default function LoginRequired({ message = 'Please log in to continue', icon: Icon = CalendarX }) {
  const location = useLocation()
  const back = encodeURIComponent(location.pathname + location.search)
  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <Icon size={44} className="mx-auto mb-3" style={{ color: '#DDE3EC' }} />
      <p className="font-bold" style={{ color: NAVY }}>{message}</p>
      <Link to={`/login?redirect=${back}`} className="btn inline-block mt-5 px-5 py-2.5 rounded-xl text-sm font-bold"
        style={{ background: NAVY, color: 'white' }}>Log in</Link>
    </div>
  )
}
