import { useState, useEffect } from 'react'
import { Trophy, PartyPopper, Clock, MapPin, Users, Ticket } from 'lucide-react'
import { format } from 'date-fns'
import { eventsApi } from '../store'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const GOLD = '#B7791F'

// "19:00" → "7pm", "09:30" → "9:30am"
function shortTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 && h < 24 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${suffix}`
}

const TYPE = {
  tournament: { label: 'Tournament', icon: Trophy, color: GOLD, bg: '#FEF3C7' },
  event: { label: 'Event', icon: PartyPopper, color: '#4A6FA5', bg: '#E3EAF4' },
}

// Upcoming events & tournaments (from MySQL `events`); hidden when there are none
export default function EventsSection() {
  const [events, setEvents] = useState(null)

  useEffect(() => {
    let cancelled = false
    eventsApi().then(r => { if (!cancelled) setEvents(r.events || []) })
    return () => { cancelled = true }
  }, [])

  if (!events?.length) return null

  return (
    <section style={{ background: 'white', borderTop: `1px solid ${BORDER}` }}>
      <div className="max-w-6xl mx-auto px-6 py-9">
        <div className="text-center mb-6">
          <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: '#6B8CAE' }}>What's On</p>
          <h2 className="text-2xl font-black" style={{ color: NAVY }}>Upcoming Events &amp; Tournaments</h2>
          <p className="mt-1 text-sm" style={{ color: '#64748B' }}>Compete, socialise and meet other members on court</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {events.map(ev => {
            const type = TYPE[ev.type] || TYPE.event
            const Icon = type.icon
            const date = new Date(ev.date + 'T00:00')
            const time = ev.startTime ? `${shortTime(ev.startTime)}${ev.endTime ? `–${shortTime(ev.endTime)}` : ''}` : ''
            const full = ev.status === 'full'
            return (
              <div key={ev.id} className="flex rounded-2xl overflow-hidden"
                style={{ border: `1px solid ${BORDER}`, background: '#FBFCFE', boxShadow: '0 1px 6px rgba(27,46,75,0.06)' }}>
                {/* Date block */}
                <div className="w-20 shrink-0 flex flex-col items-center justify-center text-white py-3" style={{ background: NAVY }}>
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#8FA9C8' }}>{format(date, 'MMM')}</span>
                  <span className="text-3xl font-black leading-none my-0.5">{format(date, 'd')}</span>
                  <span className="text-[10px] font-bold uppercase" style={{ color: '#8FA9C8' }}>{format(date, 'EEE')}</span>
                </div>

                <div className="flex-1 min-w-0 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{ background: type.bg, color: type.color }}>
                      <Icon size={11} /> {type.label}
                    </span>
                    <span className="ml-auto text-[10px] font-black uppercase tracking-wider"
                      style={{ color: full ? '#DC2626' : '#047857' }}>
                      {full ? 'Full' : 'Open'}
                    </span>
                  </div>
                  <p className="font-black leading-snug" style={{ color: NAVY }}>{ev.title}</p>
                  <p className="text-xs mt-1 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: '#64748B' }}>
                    {time && <span className="flex items-center gap-1"><Clock size={11} />{time}</span>}
                    {ev.venue && <span className="flex items-center gap-1"><MapPin size={11} />{ev.venue}</span>}
                  </p>
                  {ev.description && (
                    <p className="text-xs mt-1.5 leading-relaxed" style={{ color: LGRAY, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {ev.description}
                    </p>
                  )}
                  {(ev.entryFee != null || ev.maxTeams) && (
                    <p className="text-xs mt-2 pt-2 flex flex-wrap gap-x-3 font-semibold" style={{ color: NAVY, borderTop: '1px solid #EEF2F7' }}>
                      {ev.entryFee != null && (
                        <span className="flex items-center gap-1"><Ticket size={11} />{ev.entryFee ? `Rs. ${ev.entryFee.toLocaleString()} / team` : 'Free entry'}</span>
                      )}
                      {ev.maxTeams && <span className="flex items-center gap-1"><Users size={11} />{ev.maxTeams} teams</span>}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-center text-xs mt-4" style={{ color: LGRAY }}>
          To enter an event, please contact the Trust office or speak to the front desk.
        </p>
      </div>
    </section>
  )
}
