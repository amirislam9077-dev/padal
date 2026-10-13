import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useEffect } from 'react'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}
import Home from './pages/Home'
import BookCourt from './pages/BookCourt'
import MyBookings from './pages/MyBookings'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import AdminBookings from './pages/AdminBookings'
import AdminCourts from './pages/AdminCourts'
import AdminEvents from './pages/AdminEvents'
import AdminCalendar from './pages/AdminCalendar'
import AdminScale from './pages/AdminScale'
import AdminLedger from './pages/AdminLedger'
import AdminProfitLoss from './pages/AdminProfitLoss'
import AdminVouchers from './pages/AdminVouchers'
import AdminMembers from './pages/AdminMembers'
import Complaints from './pages/Complaints'
import Login from './pages/Login'
import Signup from './pages/Signup'
import ForgotAccount from './pages/ForgotAccount'
import Layout from './components/Layout'
import AdminLayout from './components/AdminLayout'

function AdminGuard({ children }) {
  const isAdmin = sessionStorage.getItem('padel_admin') === 'true'
  return isAdmin ? children : <Navigate to="/admin" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/book" element={<BookCourt />} />
          <Route path="/my-bookings" element={<MyBookings />} />
          <Route path="/complaints" element={<Complaints />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          {/* Admin login uses the site header + footer, like every public page */}
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/forgot-user-id" element={<ForgotAccount mode="userid" key="userid" />} />
          <Route path="/forgot-password" element={<ForgotAccount mode="password" key="password" />} />
        </Route>
        <Route
          element={
            <AdminGuard>
              <AdminLayout />
            </AdminGuard>
          }
        >
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/bookings" element={<AdminBookings />} />
          <Route path="/admin/calendar" element={<AdminCalendar />} />
          <Route path="/admin/scale" element={<AdminScale />} />
          <Route path="/admin/courts" element={<AdminCourts />} />
          <Route path="/admin/events" element={<AdminEvents />} />
          <Route path="/admin/ledger" element={<AdminLedger />} />
          <Route path="/admin/profit-loss" element={<AdminProfitLoss />} />
          <Route path="/admin/vouchers" element={<AdminVouchers />} />
          <Route path="/admin/members" element={<AdminMembers />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
