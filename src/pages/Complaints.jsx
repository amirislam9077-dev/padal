import { useState } from 'react'
import LoginRequired from '../components/LoginRequired'
import { getCurrentUser } from '../store'
import { MessageSquare, Send, CheckCircle, AlertCircle, Clock, Lock } from 'lucide-react'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'

const inputStyle = {
  width: '100%', border: `1.5px solid ${BORDER}`, borderRadius: '10px',
  padding: '10px 13px', fontSize: '14px', outline: 'none',
  color: NAVY, background: '#F8FAFC', fontFamily: 'inherit', transition: 'border-color 0.2s',
}
const labelStyle = {
  fontSize: '11px', fontWeight: '700', color: LGRAY, marginBottom: '6px',
  display: 'block', letterSpacing: '0.07em', textTransform: 'uppercase',
}

function generateComplaintNumber() {
  const key = 'padel_complaints'
  const existing = JSON.parse(localStorage.getItem(key) || '[]')
  const year = new Date().getFullYear()
  const seq = String(existing.length + 1).padStart(4, '0')
  return `CMP-${year}-${seq}`
}

function saveComplaint(data) {
  const key = 'padel_complaints'
  const existing = JSON.parse(localStorage.getItem(key) || '[]')
  existing.push({ ...data, createdAt: new Date().toISOString() })
  localStorage.setItem(key, JSON.stringify(existing))
}

export default function Complaints() {
  const [form, setForm] = useState({ name: '', phone: '', subject: '', message: '' })
  const [submitted, setSubmitted] = useState(false)
  const [complaintNo, setComplaintNo] = useState('')
  const [submittedAt, setSubmittedAt] = useState('')
  const [error, setError] = useState('')

  function handleChange(e) {
    setForm(p => ({ ...p, [e.target.name]: e.target.value }))
    if (error) setError('')
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.message.trim()) {
      setError('Please fill in your name and message before submitting.')
      return
    }
    const no = generateComplaintNumber()
    const now = new Date()
    saveComplaint({ ...form, complaintNo: no })
    setComplaintNo(no)
    setSubmittedAt(now.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }))
    setSubmitted(true)
    setError('')
  }

  if (!getCurrentUser()) return <LoginRequired message="Please log in to send a complaint" icon={MessageSquare} />

  if (submitted) {
    return (
      <div className="max-w-md mx-auto px-4 py-14 text-center">

        {/* Success icon */}
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg"
          style={{ background: NAVY }}>
          <CheckCircle size={38} color="white" strokeWidth={2.5} />
        </div>

        <h2 className="text-2xl font-black mb-2" style={{ color: NAVY }}>Complaint Submitted</h2>
        <p className="text-sm leading-relaxed mb-8" style={{ color: LGRAY }}>
          Thank you for reaching out. Your complaint has been received and will be reviewed
          by the Trust administration. We aim to respond within 2–3 working days.
        </p>

        {/* Reference card */}
        <div className="rounded-2xl overflow-hidden mb-6 shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
          <div className="py-3 px-5" style={{ background: NAVY }}>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Complaint Reference Number
            </p>
          </div>
          <div className="py-6 px-5" style={{ background: '#F8FAFC' }}>
            <p className="text-3xl font-black tracking-widest mb-1" style={{ color: NAVY }}>{complaintNo}</p>
            <p className="text-xs" style={{ color: LGRAY }}>Submitted on {submittedAt}</p>
          </div>
          <div className="py-3 px-5 flex items-center gap-2" style={{ background: '#EEF2F7', borderTop: `1px solid ${BORDER}` }}>
            <Lock size={11} style={{ color: LGRAY }} />
            <p className="text-xs" style={{ color: LGRAY }}>Keep this number for future reference and follow-ups.</p>
          </div>
        </div>

        <button
          onClick={() => { setSubmitted(false); setComplaintNo(''); setSubmittedAt(''); setForm({ name: '', phone: '', subject: '', message: '' }) }}
          className="btn font-bold px-8 py-3 rounded-xl text-sm"
          style={{ background: NAVY, color: 'white', boxShadow: '0 4px 14px rgba(27,46,75,0.2)' }}>
          Submit Another Complaint
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Page banner */}
      <div style={{ background: NAVY, paddingTop: '32px', paddingBottom: '32px' }}>
        <div className="max-w-xl mx-auto px-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}>
            <MessageSquare size={22} color="white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white leading-tight">Complaints & Remarks</h1>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Share your feedback or raise a concern with the Trust administration
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8">

        {/* Info strip */}
        <div className="flex items-center gap-3 rounded-xl px-4 py-3 mb-6"
          style={{ background: '#EEF2F7', border: `1px solid ${BORDER}` }}>
          <Clock size={14} style={{ color: '#4A6FA5', flexShrink: 0 }} />
          <p className="text-xs" style={{ color: '#4A6FA5' }}>
            All complaints are reviewed within <strong>2–3 working days.</strong> A reference number will be issued upon submission.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-sm"
          style={{ border: `1px solid ${BORDER}` }}>

          {/* Form header */}
          <div className="px-6 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <p className="font-black text-base" style={{ color: NAVY }}>Complaint Form</p>
            <p className="text-xs mt-0.5" style={{ color: LGRAY }}>Fields marked * are required</p>
          </div>

          <div className="px-6 py-5 space-y-5">

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label style={labelStyle}>Full Name *</label>
                <input
                  type="text" name="name" placeholder="e.g. Ahmed Khan"
                  value={form.name} onChange={handleChange} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Phone Number</label>
                <input
                  type="tel" name="phone" placeholder="+92 300 0000000"
                  value={form.phone} onChange={handleChange} style={inputStyle} />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Category</label>
              <select name="subject" value={form.subject} onChange={handleChange} style={inputStyle}>
                <option value="">— Select a category —</option>
                <option value="Court Condition">Court Condition</option>
                <option value="Booking Issue">Booking Issue</option>
                <option value="Staff Behaviour">Staff Behaviour</option>
                <option value="Facilities">Facilities</option>
                <option value="Membership">Membership</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Details *</label>
              <textarea
                name="message"
                placeholder="Please describe your complaint or remark in detail. Include relevant dates, times, or court numbers if applicable."
                value={form.message} onChange={handleChange} rows={5}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: '1.6' }} />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
                style={{ background: '#FEF2F2', border: '1px solid #FEE2E2' }}>
                <AlertCircle size={14} style={{ color: '#DC2626', flexShrink: 0 }} />
                <p className="text-sm font-semibold" style={{ color: '#DC2626' }}>{error}</p>
              </div>
            )}

            <button type="submit"
              className="btn w-full py-3.5 rounded-xl font-black text-sm flex items-center justify-center gap-2"
              style={{ background: NAVY, color: 'white', boxShadow: '0 4px 14px rgba(27,46,75,0.25)', letterSpacing: '0.04em' }}>
              <Send size={15} /> Submit Complaint
            </button>
          </div>

          {/* Form footer */}
          <div className="px-6 py-3 flex items-center gap-2 rounded-b-2xl" style={{ background: '#F8FAFC', borderTop: `1px solid ${BORDER}` }}>
            <Lock size={11} style={{ color: LGRAY }} />
            <p className="text-xs" style={{ color: LGRAY }}>
              Your submission is confidential and will only be seen by Trust administration.
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
