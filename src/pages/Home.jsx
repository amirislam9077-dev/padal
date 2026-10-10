import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Clock, Users, ArrowRight, MapPin, Phone, CheckCircle, Star, Shield, Zap } from 'lucide-react'
import { getCourts, RATE_PER_HOUR } from '../store'
import EventsSection from '../components/EventsSection'
import { OtLogo } from '../components/Layout'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const LAT = 24.9295
const LNG = 67.0591

function VenueMap() {
  const containerRef = useRef(null)

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [LNG, LAT],
      zoom: 16.5,
      pitch: 55,
      bearing: -20,
      antialias: true,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl(), 'bottom-left')

    map.on('load', () => {
      // 3D extruded buildings
      map.addLayer({
        id: '3d-buildings',
        source: 'openmaptiles',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['get', 'render_height'],
            0, '#c8d6e5', 20, '#a8becd', 100, '#7fa3be'
          ],
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 16, ['get', 'render_height']],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 16, ['get', 'render_min_height']],
          'fill-extrusion-opacity': 0.85,
        },
      })
    })

    // Pin marker in the theme's blue
    const el = document.createElement('div')
    el.style.cssText = 'cursor:pointer; filter:drop-shadow(0 4px 8px rgba(0,0,0,0.4));'
    el.innerHTML = `
      <svg width="44" height="56" viewBox="0 0 44 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M22 0C9.85 0 0 9.85 0 22C0 38.5 22 56 22 56C22 56 44 38.5 44 22C44 9.85 34.15 0 22 0Z" fill="#1438B8"/>
        <path d="M22 1.5C10.68 1.5 1.5 10.68 1.5 22C1.5 37.8 22 54.2 22 54.2C22 54.2 42.5 37.8 42.5 22C42.5 10.68 33.32 1.5 22 1.5Z" fill="#2F6BFF"/>
        <circle cx="22" cy="22" r="10" fill="white" opacity="0.95"/>
        <text x="22" y="27" text-anchor="middle" font-size="13" font-weight="800" font-family="Red Hat Display, system-ui" fill="#1438B8">NN</text>
      </svg>
    `
    new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([LNG, LAT])
      .setPopup(
        new maplibregl.Popup({ offset: 52, maxWidth: '240px' })
          .setHTML(`
            <div style="font-family:Red Hat Display,system-ui;padding:6px 4px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                <div style="width:32px;height:32px;border-radius:8px;background:#2F6BFF;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                  <span style="color:white;font-weight:900;font-size:10px">NN</span>
                </div>
                <div>
                  <div style="font-weight:800;font-size:13px;color:#070B18;line-height:1.2">NNG Gymkhana Trust</div>
                  <div style="font-size:11px;color:#64748B">Padel Courts</div>
                </div>
              </div>
              <div style="font-size:11px;color:#64748B;border-top:1px solid #EEF2F7;padding-top:6px;display:flex;align-items:center;gap:4px">
                <span>📍</span> North Nazimabad, Karachi, Pakistan
              </div>
            </div>
          `)
      )
      .addTo(map)

    return () => map.remove()
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}

// Try each src in order; if all fail, shows a gradient placeholder
function FallbackImg({ sources, alt, className, style, onAllFailed }) {
  const [idx, setIdx] = useState(0)
  const [failed, setFailed] = useState(false)

  if (failed) return null

  return (
    <img
      src={sources[idx]}
      alt={alt}
      className={className}
      style={style}
      onError={() => {
        if (idx + 1 < sources.length) setIdx(idx + 1)
        else { setFailed(true); onAllFailed?.() }
      }}
    />
  )
}

// Dark "OneText" palette
const BG = '#070B18'
const SURFACE = '#0E1220'
const CARD = '#141927'
const LINE = 'rgba(255,255,255,0.09)'
const BLUE = '#2F6BFF'
const TEXT = '#F4F6FB'
const MUTED = '#9AA3B5'

// Hero background: padel court photo — multiple fallbacks
const HERO_IMGS = [
  'https://res.cloudinary.com/playtomic/image/upload/c_scale,w_1920,q_80,f_auto/pro/tenants/da78dd3c-43b3-11e8-8674-52540049669c/ciudaddelaraqueta_0002',
  'https://res.cloudinary.com/playtomic/image/upload/c_scale,w_1920,q_80,f_auto/pro/tenants/da78dd3c-43b3-11e8-8674-52540049669c/ciudaddelaraqueta_0010',
  'https://images.unsplash.com/photo-1629818013255-6a26b4cd1d23?auto=format&fit=crop&w=1920&q=85',
]
const COURT1_IMGS = [
  'https://res.cloudinary.com/playtomic/image/upload/c_scale,w_1080,q_80,f_auto/pro/tenants/7039d452-331e-4931-ad16-5a21c63cdffe/1718360085843',
  'https://images.unsplash.com/photo-1629818013255-6a26b4cd1d23?auto=format&fit=crop&w=800&q=80',
]
const COURT2_IMGS = [
  'https://res.cloudinary.com/playtomic/image/upload/c_scale,w_1080,q_80,f_auto/pro/tenants/7039d452-331e-4931-ad16-5a21c63cdffe/1718360084566',
  'https://images.unsplash.com/photo-1613472988989-1e3d4dc9cc07?auto=format&fit=crop&w=800&q=80',
]

function SectionTitle({ kicker, title, sub }) {
  return (
    <div className="text-center mb-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] mb-2" style={{ color: '#7EA2FF' }}>{kicker}</p>
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: TEXT }}>{title}</h2>
      {sub && <p className="mt-2 text-sm" style={{ color: MUTED }}>{sub}</p>}
    </div>
  )
}

export default function Home() {
  const courts = getCourts().filter(c => c.isActive)
  const courtImgSets = [COURT1_IMGS, COURT2_IMGS]
  const [heroFailed, setHeroFailed] = useState(false)

  return (
    <div style={{ background: BG, color: TEXT }}>

      {/* ── HERO: the padel court photo with a dark-blue overlay, headline and stats on top ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          {!heroFailed && (
            <FallbackImg sources={HERO_IMGS} alt="Padel court" className="w-full h-full object-cover object-center"
              onAllFailed={() => setHeroFailed(true)} />
          )}
          {/* Dark overlay so the text stays readable; fades into the page at the bottom */}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(100deg, rgba(7,11,24,0.9) 0%, rgba(7,11,24,0.7) 45%, rgba(10,24,70,0.35) 100%)' }} />
          <div className="absolute inset-x-0 bottom-0 h-32" style={{ background: `linear-gradient(to top, ${BG}, transparent)` }} />
        </div>
        <div className="relative max-w-6xl mx-auto px-6 pt-10 pb-12 lg:pt-14 lg:pb-16">
          <div className="max-w-2xl">
            {/* Live badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold mb-5"
              style={{ background: 'rgba(255,255,255,0.06)', color: '#C9CFDB', border: `1px solid ${LINE}` }}>
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#22C55E', animation: 'pulse 1.5s infinite' }} />
              Now accepting bookings
            </div>

            <h1 className="font-semibold leading-[1.05] tracking-tight mb-4" style={{ fontSize: 'clamp(34px, 5vw, 60px)', color: 'white' }}>
              North Nazimabad<br />Gymkhana Trust.<br />
              <span style={{ color: '#7EA2FF' }}>Where Champions Play.</span>
            </h1>
            <p className="text-sm sm:text-base leading-relaxed mb-6" style={{ color: '#C9CFDB', maxWidth: '470px' }}>
              Karachi's premier padel destination. Book your court online instantly and experience world-class facilities.
            </p>

            {/* Stats */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-5 gap-y-4 pt-5" style={{ borderTop: `1px solid ${LINE}`, maxWidth: '560px' }}>
              {[
                { value: `${courts.length}`, label: 'Padel courts' },
                { value: '3pm', label: 'Opens daily' },
                { value: '12am', label: 'Last slot' },
                { value: '4', label: 'Players / court' },
                { value: `Rs ${RATE_PER_HOUR.toLocaleString()}`, unit: '/hr', label: 'Per hour' },
              ].map(({ value, unit, label }) => (
                <div key={label}>
                  <p className="text-xl sm:text-2xl font-bold text-white whitespace-nowrap">
                    {value}{unit && <span className="text-xs font-semibold ml-0.5" style={{ color: MUTED }}>{unit}</span>}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── QUICK BOOK BAR ── */}
      <div className="max-w-6xl mx-auto px-6">
        <div className="rounded-2xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap"
          style={{ background: CARD, border: `1px solid ${LINE}` }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(47,107,255,0.15)', border: '1px solid rgba(47,107,255,0.35)' }}>
              <Calendar size={17} color="#7EA2FF" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">Ready to play?</p>
              <p className="text-xs" style={{ color: MUTED }}>Pick a court, choose a slot, confirm in seconds.</p>
            </div>
          </div>
          <Link to="/book"
            className="ot-btn flex items-center gap-2 font-semibold px-5 py-2.5 rounded-lg text-sm whitespace-nowrap"
            style={{ background: BLUE, color: 'white' }}>
            Padel Court Booking
            <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'white', color: BLUE }}><ArrowRight size={12} strokeWidth={2.75} /></span>
          </Link>
        </div>
      </div>

      {/* ── MEMBERS ONLY NOTICE ── */}
      <div className="max-w-6xl mx-auto px-6 pt-4">
        <div className="rounded-2xl px-5 py-4 flex items-start gap-4"
          style={{ background: 'rgba(255,197,61,0.06)', border: '1px solid rgba(255,197,61,0.25)', borderLeft: '4px solid #FFC53D' }}>
          <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center mt-0.5" style={{ background: '#FFC53D' }}>
            <Shield size={18} color={BG} />
          </div>
          <div>
            <p className="font-bold text-base mb-1" style={{ color: '#FFC53D' }}>Exclusive Access — Members Only</p>
            <p className="text-sm leading-relaxed" style={{ color: '#C9CFDB' }}>
              Our padel courts are exclusively reserved for registered members of the North Nazimabad Gymkhana Trust.
              Access is strictly limited to active members and their accompanied guests.
              Non-members are not permitted to book or use the courts under any circumstances.
              To inquire about membership, please contact the Trust administration directly.
            </p>
          </div>
        </div>
      </div>

      {/* ── COURTS ── */}
      <section className="max-w-6xl mx-auto px-6 pt-12 pb-12">
        <SectionTitle kicker="Our facilities" title="Premium Padel Courts" sub="Professional-grade surfaces designed for the ultimate padel experience" />
        <div className="grid sm:grid-cols-2 gap-6">
          {courts.map((court, i) => (
            <div key={court.id} className="ot-card rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${LINE}` }}>
              <div className="relative h-56 overflow-hidden" style={{ background: 'linear-gradient(135deg, #1438B8 0%, #0A1650 100%)' }}>
                <FallbackImg
                  sources={courtImgSets[i] || courtImgSets[0]}
                  alt={court.name}
                  className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                />
                {/* Blue-tinted overlay so the photos match the theme */}
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(7,11,24,0.9) 0%, rgba(20,56,184,0.15) 60%, transparent 100%)' }} />
                <div className="absolute top-3 right-3">
                  <span className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'rgba(7,11,24,0.7)', color: 'white', border: `1px solid ${LINE}` }}>
                    ✓ Available
                  </span>
                </div>
                <div className="absolute bottom-3 left-4 right-4">
                  <h3 className="font-bold text-xl text-white">{court.name}</h3>
                  <p className="text-xs" style={{ color: '#C9CFDB' }}>{i === 0 ? 'Indoor · Premium Flooring' : 'Indoor · Professional Lighting'}</p>
                </div>
              </div>

              <div className="p-5">
                <p className="text-sm mb-4" style={{ color: MUTED }}>{court.description}</p>
                <div className="flex flex-wrap gap-4 mb-4 text-xs" style={{ color: MUTED }}>
                  <span className="flex items-center gap-1"><Users size={12} /> 4 Players</span>
                  <span className="flex items-center gap-1"><Clock size={12} /> Min 1 hour</span>
                  <span className="flex items-center gap-1"><CheckCircle size={12} /> Instant confirm</span>
                </div>
                <Link to={`/book?court=${court.id}`}
                  className="ot-btn flex items-center justify-center gap-2 w-full font-semibold text-sm py-3 rounded-lg"
                  style={{ background: BLUE, color: 'white' }}>
                  <Calendar size={14} /> Book {court.name}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── EVENTS & TOURNAMENTS ── */}
      <EventsSection dark />

      {/* ── WHY CHOOSE US ── */}
      <section style={{ background: SURFACE, borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
        <div className="max-w-6xl mx-auto px-6 py-10">
          <SectionTitle kicker="Why choose us" title="The Best Padel Experience in Karachi" />
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { icon: Zap,    title: 'Instant Booking',     desc: 'Book your court online in under 30 seconds. No calls, no waiting.', color: '#FFC53D' },
              { icon: Shield, title: 'Professional Courts', desc: 'World-class padel courts with premium flooring and glass walls.', color: '#7EA2FF' },
              { icon: Star,   title: 'Flexible Hours',      desc: 'Open from 3 PM to 12 AM every day so you can play after work or school.', color: '#FF8A1F' },
            ].map(({ icon: Icon, title, desc, color }) => (
              <div key={title} className="ot-card rounded-xl p-4 flex gap-3" style={{ background: CARD, border: `1px solid ${LINE}` }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}1F`, border: `1px solid ${color}55` }}>
                  <Icon size={17} color={color} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-white text-base leading-tight mb-1">{title}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: MUTED }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW TO BOOK ── */}
      <section className="max-w-6xl mx-auto px-6 py-14">
        <SectionTitle kicker="Simple process" title="Book in 3 Easy Steps" />
        <div className="grid sm:grid-cols-3 gap-5">
          {[
            { step: '01', title: 'Choose a Court', desc: 'Select Court 1 or Court 2 based on availability and preference.' },
            { step: '02', title: 'Pick Date & Time', desc: 'Browse available slots and choose your preferred date and time.' },
            { step: '03', title: 'Confirm Booking', desc: 'Enter your details and confirm. Your court is instantly reserved.' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="ot-card relative rounded-2xl p-6" style={{ background: CARD, border: `1px solid ${LINE}` }}>
              <p className="text-5xl font-black mb-4 tracking-tight"
                style={{ background: 'linear-gradient(135deg, #7EA2FF, #2F6BFF 45%, #FF8A1F)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
                {step}
              </p>
              <h3 className="font-bold text-lg mb-2 text-white">{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: MUTED }}>{desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-10">
          <Link to="/book"
            className="ot-btn inline-flex items-center gap-2 font-semibold px-7 py-3.5 rounded-lg text-sm"
            style={{ background: BLUE, color: 'white', boxShadow: '0 12px 30px -10px rgba(47,107,255,0.7)' }}>
            <Calendar size={16} /> Start Booking Now
            <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'white', color: BLUE }}><ArrowRight size={12} strokeWidth={2.75} /></span>
          </Link>
        </div>
      </section>

      {/* ── VENUE INFO ── */}
      <section style={{ background: SURFACE, borderTop: `1px solid ${LINE}` }}>
        <div className="max-w-6xl mx-auto px-6 py-14">
          <div className="grid sm:grid-cols-2 gap-10 items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] mb-2" style={{ color: '#7EA2FF' }}>Visit us</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4 text-white">Find Our Venue</h2>
              <p className="text-sm mb-7 leading-relaxed" style={{ color: MUTED }}>
                Conveniently located in North Nazimabad, our facility offers ample parking and easy access for all players.
              </p>
              <div className="space-y-4">
                {[
                  { icon: MapPin, label: 'Address', value: 'North Nazimabad, Karachi, Pakistan' },
                  { icon: Phone,  label: 'Phone',   value: '+92 21 0000 0000' },
                  { icon: Clock,  label: 'Hours',   value: '3:00 PM – 12:00 AM, Daily' },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(47,107,255,0.15)', border: '1px solid rgba(47,107,255,0.35)' }}>
                      <Icon size={16} color="#7EA2FF" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
                      <p className="font-semibold text-sm text-white">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Map */}
            <div className="rounded-2xl overflow-hidden" style={{ height: '420px', border: `1px solid ${LINE}`, boxShadow: '0 24px 60px -24px rgba(47,107,255,0.45)' }}>
              <VenueMap />
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: '#05070F', borderTop: `1px solid ${LINE}` }}>
        {/* Main row */}
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-wrap items-center gap-6 justify-between"
          style={{ borderBottom: `1px solid ${LINE}` }}>

          {/* Logo */}
          <div className="flex items-center gap-3">
            <OtLogo size={42} />
            <div>
              <p className="font-bold text-white text-sm leading-tight">North Nazimabad</p>
              <p className="text-xs font-semibold" style={{ color: '#7EA2FF' }}>Gymkhana Trust</p>
            </div>
          </div>

          {/* Nav */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {/* Admin link only on phones (wider screens have the Admin button in the header) */}
            {[['/', 'Home'], ['/book', 'Padel Booking'], ['/my-bookings', 'My Bookings'], ['/complaints', 'Complaints'], ['/admin', 'Admin', true]].map(([to, label, phoneOnly]) => (
              <Link key={to} to={to} className={`${phoneOnly ? 'sm:hidden ' : ''}text-sm font-medium whitespace-nowrap hover:text-white transition`}
                style={{ color: MUTED }}>{label}</Link>
            ))}
          </div>

          {/* Phone */}
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#C9CFDB' }}>
            <Phone size={14} style={{ color: BLUE }} />
            +92 21 0000 0000
          </div>

          {/* Address */}
          <div className="flex items-center gap-2 text-sm" style={{ color: MUTED, maxWidth: '240px' }}>
            <MapPin size={14} style={{ color: BLUE, flexShrink: 0 }} />
            North Nazimabad, Karachi, Pakistan
          </div>

          {/* Social */}
          <div className="flex items-center gap-3">
            <a href="#" className="btn-light w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#1877F2' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
            </a>
            <a href="#" className="btn-light w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                <circle cx="12" cy="12" r="4"/>
                <circle cx="17.5" cy="6.5" r="1" fill="white" stroke="none"/>
              </svg>
            </a>
            <a href="#" className="btn-light w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#25D366' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M11.999 2C6.477 2 2 6.477 2 12c0 1.9.52 3.677 1.428 5.202L2 22l4.948-1.395A9.953 9.953 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 11.999 2z"/>
              </svg>
            </a>
          </div>
        </div>

        {/* Bottom */}
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs" style={{ color: '#5E6678' }}>
            © 2026 North Nazimabad Gymkhana Trust. All rights reserved.
          </p>
          <p className="text-xs" style={{ color: '#4A5163' }}>Padel Court Booking System</p>
        </div>
      </footer>

    </div>
  )
}
