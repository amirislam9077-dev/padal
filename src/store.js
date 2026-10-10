// Persistent store using localStorage

const COURTS_KEY = 'padel_courts'
const BOOKINGS_KEY = 'padel_bookings'

const defaultCourts = [
  { id: '1', name: 'Court 1', description: 'Main court with premium flooring', isActive: true },
  { id: '2', name: 'Court 2', description: 'Indoor court with lighting', isActive: true },
]

// Empty = call /api on the website's own address. Locally Vite passes it to the backend (vite.config.js);
// on Vercel, vercel.json passes it to the Render backend. Change the backend address in vercel.json only.
const BACKEND_URL = ''

export function getCourts() {
  const stored = localStorage.getItem(COURTS_KEY)
  if (!stored) {
    localStorage.setItem(COURTS_KEY, JSON.stringify(defaultCourts))
    return defaultCourts
  }
  return JSON.parse(stored)
}

export function saveCourts(courts) {
  localStorage.setItem(COURTS_KEY, JSON.stringify(courts))
}

export function getBookings() {
  const stored = localStorage.getItem(BOOKINGS_KEY)
  return stored ? JSON.parse(stored) : []
}

export function saveBooking(booking) {
  const bookings = getBookings()
  bookings.push(booking)
  localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings))
}

export function updateBooking(id, updates) {
  const bookings = getBookings()
  const idx = bookings.findIndex(b => b.id === id)
  if (idx !== -1) {
    bookings[idx] = { ...bookings[idx], ...updates }
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings))
  }
}

export function deleteBooking(id) {
  const bookings = getBookings().filter(b => b.id !== id)
  localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings))
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// Check if a time slot conflicts with existing bookings
export function isSlotAvailable(courtId, date, startHour, endHour, excludeId = null) {
  const bookings = getBookings().filter(
    b => b.courtId === courtId && b.date === date && b.status !== 'cancelled' && b.id !== excludeId
  )
  return !bookings.some(b => startHour < b.endHour && endHour > b.startHour)
}

export const RATE_PER_HOUR = 1000 // Rs. per court per hour

// Under-18 players play free from 3pm to 6pm (hours 15, 16, 17)
export const KIDS_FREE_FROM = 15
export const KIDS_FREE_TO = 18

// Hours of a booking that fall in the free kids window
export function kidsFreeHours(start, hours) {
  let n = 0
  for (let h = start; h < start + hours; h++) if (h >= KIDS_FREE_FROM && h < KIDS_FREE_TO) n++
  return n
}

// Price of a booking → { total, freeHours, paidHours }
export function bookingCost(start, hours, junior) {
  const freeHours = junior ? kidsFreeHours(start, hours) : 0
  const paidHours = hours - freeHours
  return { total: paidHours * RATE_PER_HOUR, freeHours, paidHours }
}

// Opening hours: 3pm to 12am (midnight).
export const OPEN_HOUR = 15
export const CLOSE_HOUR = 24
export const TIME_SLOTS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => i + OPEN_HOUR)

export function formatHour(h) {
  if (h === 0 || h === 24) return '12:00 AM'
  if (h === 12) return '12:00 PM'
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`
}

export function formatHourShort(h) {
  if (h === 0 || h === 24) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

export function formatSlotRange(startH, endH) {
  return `${formatHourShort(startH)}–${formatHourShort(endH)}`
}

// ── USER AUTH ──
const SESSION_KEY = 'padel_session'

async function postJson(path, body) {
  try {
    const fullUrl = path.startsWith('http') ? path : `${BACKEND_URL}${path}`
    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    if (!data) return { error: 'Cannot reach the server.' }
    if (!res.ok) return { ...data, error: data.error || 'Server error. Please try again.' }
    return data
  } catch {
    return { error: 'Cannot reach the server. Is it running?' }
  }
}

async function authRequest(path, body) {
  const data = await postJson(path, body)
  if (data.user) sessionStorage.setItem(SESSION_KEY, JSON.stringify(data.user))
  return data
}

export async function checkMembershipApi(membershipNo) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/check-membership?no=${encodeURIComponent(membershipNo)}`)
    return await res.json()
  } catch {
    return { error: 'Cannot reach the server.' }
  }
}

export async function checkUsernameApi(username) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/check-username?username=${encodeURIComponent(username)}`)
    return await res.json()
  } catch {
    return { error: 'Cannot reach the server.' }
  }
}

export async function checkEmailApi(email) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/check-email?email=${encodeURIComponent(email)}`)
    return await res.json()
  } catch {
    return { error: 'Cannot reach the server.' }
  }
}

export function sendOtpApi(form) {
  return postJson('/api/send-otp', form)
}

export function signupApi(form) {
  return authRequest('/api/signup', form)
}

export function loginApi(form) {
  return authRequest('/api/login', form)
}

// ── Bookings ──
function memberHeaders() {
  const user = getCurrentUser()
  return user?.token ? { 'x-user-id': user.id, 'x-user-token': user.token } : null
}

async function apiRequest(path, { method = 'GET', body, headers = {} } = {}) {
  try {
    const fullUrl = path.startsWith('http') ? path : `${BACKEND_URL}${path}`
    const res = await fetch(fullUrl, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => null)
    if (!data) return { error: 'Cannot reach the server.' }
    if (!res.ok) return { ...data, error: data.error || 'Server error. Please try again.' }
    return data
  } catch {
    return { error: 'Cannot reach the server. Is it running?' }
  }
}

const RELOGIN = { error: 'Please log out and log in again.', relogin: true }

export function bookedSlotsApi(date, courtId) {
  return apiRequest(`/api/slots/booked?date=${date}&court=${encodeURIComponent(courtId)}`)
}

export function createSlotApi(booking) {
  const headers = memberHeaders()
  return headers ? apiRequest('/api/slots', { method: 'POST', body: booking, headers }) : Promise.resolve(RELOGIN)
}

export function newSlotRefApi() {
  const headers = memberHeaders()
  return headers ? apiRequest('/api/slots/new-ref', { headers }) : Promise.resolve(RELOGIN)
}

export function updateSlotApi(id, booking) {
  const headers = memberHeaders()
  return headers ? apiRequest(`/api/slots/${id}`, { method: 'PUT', body: booking, headers }) : Promise.resolve(RELOGIN)
}

export function mySlotsApi() {
  const headers = memberHeaders()
  return headers ? apiRequest('/api/slots/mine', { headers }) : Promise.resolve(RELOGIN)
}

export function cancelSlotApi(id) {
  const headers = memberHeaders()
  return headers ? apiRequest(`/api/slots/${id}/cancel`, { method: 'POST', body: {}, headers }) : Promise.resolve(RELOGIN)
}

export function creditApi() {
  const headers = memberHeaders()
  return headers ? apiRequest('/api/credit', { headers }) : Promise.resolve(RELOGIN)
}

// Another player of the match confirms the score (the one who entered it can't)
export function confirmScoreApi(id) {
  const headers = memberHeaders()
  return headers ? apiRequest(`/api/slots/${id}/score/confirm`, { method: 'POST', headers }) : Promise.resolve(RELOGIN)
}
export function scoreSlotApi(id, sets) {
  const headers = memberHeaders()
  return headers ? apiRequest(`/api/slots/${id}/score`, { method: 'POST', body: { sets }, headers }) : Promise.resolve(RELOGIN)
}

// ── Admin ──
const ADMIN_TOKEN_KEY = 'padel_admin_token'
const adminHeaders = () => ({ 'x-admin-token': sessionStorage.getItem(ADMIN_TOKEN_KEY) || '' })

export async function adminLoginApi(email, password) {
  const data = await apiRequest('/api/admin/login', { method: 'POST', body: { email, password } })
  if (data.adminToken) {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, data.adminToken)
    sessionStorage.setItem('padel_admin', 'true')
  }
  return data
}

export function adminLogout() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY)
  sessionStorage.removeItem('padel_admin')
}

export const eventsApi = () => apiRequest('/api/events')
export const adminEventsApi = () => apiRequest('/api/admin/events', { headers: adminHeaders() })
export const adminSaveEventApi = ev => ev.id
  ? apiRequest(`/api/admin/events/${ev.id}`, { method: 'PUT', body: ev, headers: adminHeaders() })
  : apiRequest('/api/admin/events', { method: 'POST', body: ev, headers: adminHeaders() })
export const adminDeleteEventApi = id => apiRequest(`/api/admin/events/${id}`, { method: 'DELETE', headers: adminHeaders() })

export const adminSlotsApi = () => apiRequest('/api/admin/slots', { headers: adminHeaders() })
export const adminSetStatusApi = (id, status) => apiRequest(`/api/admin/slots/${id}/status`, { method: 'POST', body: { status }, headers: adminHeaders() })
export const adminSetPaymentApi = (id, received) => apiRequest(`/api/admin/slots/${id}/payment`, { method: 'POST', body: { received }, headers: adminHeaders() })
export const adminDeleteSlotApi = id => apiRequest(`/api/admin/slots/${id}`, { method: 'DELETE', headers: adminHeaders() })

// slotId: the saved booking — the server picks the email (in process / confirmed) from its payment status
export async function sendBookingEmailsApi(booking, slotId) {
  const user = getCurrentUser()
  if (!user?.token) return { error: 'Please log out and log in again.', relogin: true }
  return postJson('/api/booking-confirmation', { id: user.id, token: user.token, slotId, booking })
}

export async function uploadSlipApi(file, name) {
  const user = getCurrentUser()
  if (!user?.token) return { error: 'Please log out and log in again.', relogin: true }
  return postJson('/api/deposit-slip', { id: user.id, token: user.token, file, name })
}

export async function searchMembersApi(q, field) {
  const user = getCurrentUser()
  if (!user?.token) return { members: [], relogin: true }
  try {
    const res = await fetch(`${BACKEND_URL}/api/members/search?field=${field}&q=${encodeURIComponent(q)}`, {
      headers: { 'x-user-id': user.id, 'x-user-token': user.token },
    })
    return await res.json()
  } catch {
    return { members: [] }
  }
}

export async function updatePictureApi(picture) {
  const user = getCurrentUser()
  if (!user?.token) return { error: 'Please log out and log in again.', relogin: true }
  return authRequest('/api/profile/picture', { id: user.id, token: user.token, picture })
}

export function getCurrentUser() {
  const s = sessionStorage.getItem(SESSION_KEY)
  return s ? JSON.parse(s) : null
}

export function logoutUser() {
  sessionStorage.removeItem(SESSION_KEY)
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
export function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-')
  return `${parseInt(day)} ${MONTHS[parseInt(month) - 1]} ${year.slice(2)}`
}