import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Clock, Users, ArrowRight, MapPin, Phone, CheckCircle, Star, Shield, Zap } from 'lucide-react'
import { getCourts, RATE_PER_HOUR } from '../store'
import EventsSection from '../components/EventsSection'
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

    // Professional SVG pin marker
    const el = document.createElement('div')
    el.style.cssText = 'cursor:pointer; filter:drop-shadow(0 4px 8px rgba(0,0,0,0.4));'
    el.innerHTML = `
      <svg width="44" height="56" viewBox="0 0 44 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M22 0C9.85 0 0 9.85 0 22C0 38.5 22 56 22 56C22 56 44 38.5 44 22C44 9.85 34.15 0 22 0Z" fill="#1B2E4B"/>
        <path d="M22 1.5C10.68 1.5 1.5 10.68 1.5 22C1.5 37.8 22 54.2 22 54.2C22 54.2 42.5 37.8 42.5 22C42.5 10.68 33.32 1.5 22 1.5Z" fill="#243C60"/>
        <circle cx="22" cy="22" r="10" fill="white" opacity="0.95"/>
        <text x="22" y="27" text-anchor="middle" font-size="13" font-weight="800" font-family="system-ui" fill="#1B2E4B">NN</text>
      </svg>
    `
    new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([LNG, LAT])
      .setPopup(
        new maplibregl.Popup({ offset: 52, maxWidth: '240px' })
          .setHTML(`
            <div style="font-family:system-ui;padding:6px 4px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                <div style="width:32px;height:32px;border-radius:8px;background:#1B2E4B;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                  <span style="color:white;font-weight:900;font-size:10px">NN</span>
                </div>
                <div>
                  <div style="font-weight:800;font-size:13px;color:#1B2E4B;line-height:1.2">NNG Gymkhana Trust</div>
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

const NAVY = '#1B2E4B'
const NAVY2 = '#243C60'

// Padel court images — multiple fallbacks per slot
const HERO_IMGS = [
  'https://res.cloudinary.com/playtomic/image/upload/c_scale,w_1920,q_80,f_auto/pro/tenants/da78dd3c-43b3-11e8-8674-52540049669c/ciudaddelaraqueta_0001',
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

export default function Home() {
  const courts = getCourts().filter(c => c.isActive)
  const [heroFailed, setHeroFailed] = useState(false)
  const courtImgSets = [COURT1_IMGS, COURT2_IMGS]

  return (
    <div style={{ background: '#F1F4F8' }}>

      {/* ── HERO ── */}
      {/* Compact photo banner: height follows the content */}
      <section className="relative overflow-hidden" style={{ display: 'flex', alignItems: 'center' }}>

        {/* Background photo */}
        <div className="absolute inset-0">
          {!heroFailed && (
            <FallbackImg
              sources={HERO_IMGS}
              alt="Padel Court"
              className="w-full h-full object-cover object-center"
              onAllFailed={() => setHeroFailed(true)}
            />
          )}
          {/* Dark overlay so text stays readable */}
          <div className="absolute inset-0"
            style={{ background: 'linear-gradient(110deg, rgba(10,22,40,0.92) 0%, rgba(27,46,75,0.82) 50%, rgba(10,22,40,0.65) 100%)' }} />
        </div>

        {/* Decorative court lines */}
        <div className="absolute inset-0 opacity-8 pointer-events-none">
          <svg width="100%" height="100%" viewBox="0 0 900 600" preserveAspectRatio="xMidYMid slice">
            <rect x="120" y="60" width="660" height="480" rx="6" fill="none" stroke="white" strokeWidth="1.5"/>
            <line x1="450" y1="60" x2="450" y2="540" stroke="white" strokeWidth="1"/>
            <rect x="280" y="60" width="340" height="230" fill="none" stroke="white" strokeWidth="1"/>
            <rect x="280" y="310" width="340" height="230" fill="none" stroke="white" strokeWidth="1"/>
            <circle cx="450" cy="300" r="55" fill="none" stroke="white" strokeWidth="1"/>
            <line x1="120" y1="300" x2="780" y2="300" stroke="white" strokeWidth="1"/>
          </svg>
        </div>

        {/* Glow */}
        <div className="absolute pointer-events-none"
          style={{ bottom: 0, left: 0, right: 0, height: '200px', background: 'linear-gradient(to top, rgba(10,22,40,0.6), transparent)' }} />

        <div className="relative max-w-6xl mx-auto px-6 py-7 w-full">
          <div className="max-w-xl">
            {/* Live badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest mb-3"
              style={{ background: 'rgba(255,255,255,0.1)', color: '#8FA9C8', border: '1px solid rgba(255,255,255,0.18)' }}>
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block" style={{ animation: 'pulse 1.5s infinite' }} />
              Now Accepting Bookings
            </div>

            <h1 className="font-black text-white leading-none mb-2"
              style={{ fontSize: 'clamp(30px, 3.6vw, 46px)', letterSpacing: '-1.5px' }}>
              North Nazimabad
            </h1>
            <h1 className="font-black leading-none mb-3"
              style={{ fontSize: 'clamp(30px, 3.6vw, 46px)', letterSpacing: '-1.5px', color: '#8FA9C8' }}>
              Gymkhana Trust
            </h1>
            <p className="text-sm font-bold uppercase tracking-[0.2em] mb-2" style={{ color: '#5A7FA8' }}>
              Where Champions Play
            </p>
            <p className="text-base mb-5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)', maxWidth: '430px' }}>
              Karachi's premier padel destination. Book your court online instantly and experience world-class facilities.
            </p>

            {/* Stats */}
            <div className="flex gap-8 mt-6 pt-4 flex-wrap sm:flex-nowrap sm:w-max"
              style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              {[
                { value: `${courts.length}`, label: 'Padel Courts' },
                { value: '3pm', label: 'Opens Daily' },
                { value: '12am', label: 'Last Slot' },
                { value: '4', label: 'Players / Court' },
                { value: `Rs ${RATE_PER_HOUR.toLocaleString()}`, unit: '/hr', label: 'Per Hour' },
              ].map(({ value, unit, label }) => (
                <div key={label}>
                  <p className="text-2xl font-black text-white">
                    {value}
                    {unit && <span className="text-sm font-bold ml-0.5" style={{ color: '#8FA9C8' }}>{unit}</span>}
                  </p>
                  <p className="text-xs uppercase tracking-widest mt-0.5" style={{ color: '#5A7FA8' }}>{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── QUICK BOOK BAR ── */}
      <div style={{ background: NAVY2 }}>
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <Calendar size={16} color="white" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">Ready to play?</p>
              <p className="text-xs" style={{ color: '#8FA9C8' }}>Pick a court, choose a slot, confirm in seconds.</p>
            </div>
          </div>
          <Link to="/book"
            className="btn-light flex items-center gap-2 font-black px-6 py-2.5 rounded-xl text-sm whitespace-nowrap"
            style={{ background: '#FFFFFF', color: NAVY }}>
            Padel Court Booking <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* ── MEMBERS ONLY NOTICE ── */}
      <div style={{ background: '#FFF8E7', borderTop: '3px solid #D4A017', borderBottom: '3px solid #D4A017' }}>
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-start gap-4">
          <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center mt-0.5"
            style={{ background: '#D4A017' }}>
            <Shield size={18} color="white" />
          </div>
          <div>
            <p className="font-black text-base mb-1" style={{ color: '#7A5500' }}>
              Exclusive Access — Members Only
            </p>
            <p className="text-sm leading-relaxed" style={{ color: '#8A6820' }}>
              Our padel courts are exclusively reserved for registered members of the North Nazimabad Gymkhana Trust.
              Access is strictly limited to active members and their accompanied guests.
              Non-members are not permitted to book or use the courts under any circumstances.
              To inquire about membership, please contact the Trust administration directly.
            </p>
          </div>
        </div>
      </div>

      {/* ── COURTS ── */}
      {/* Heading starts just under the yellow members line */}
      <section className="max-w-6xl mx-auto px-6 pt-5 pb-12">
        <div className="text-center mb-8">
          <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#6B8CAE' }}>Our Facilities</p>
          <h2 className="text-3xl font-black" style={{ color: NAVY }}>Premium Padel Courts</h2>
          <p className="mt-2 text-sm" style={{ color: '#64748B' }}>Professional-grade surfaces designed for the ultimate padel experience</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          {courts.map((court, i) => (
            <div key={court.id} className="rounded-2xl overflow-hidden shadow-md"
              style={{ background: 'white', border: '1px solid #DDE3EC' }}>
              <div className="relative h-56 overflow-hidden"
                style={{ background: `linear-gradient(135deg, ${NAVY} 0%, #243C60 100%)` }}>
                <FallbackImg
                  sources={courtImgSets[i] || courtImgSets[0]}
                  alt={court.name}
                  className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                />
                {/* Overlay */}
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(10,22,40,0.65) 0%, transparent 60%)' }} />
                <div className="absolute top-3 right-3">
                  <span className="text-xs font-bold px-3 py-1.5 rounded-full"
                    style={{ background: 'rgba(255,255,255,0.9)', color: NAVY }}>
                    ✓ Available
                  </span>
                </div>
                <div className="absolute bottom-3 left-4 right-4">
                  <h3 className="font-black text-xl text-white">{court.name}</h3>
                  <p className="text-xs text-white opacity-70">{i === 0 ? 'Indoor · Premium Flooring' : 'Indoor · Professional Lighting'}</p>
                </div>
              </div>

              <div className="p-5">
                <p className="text-sm mb-4" style={{ color: '#64748B' }}>{court.description}</p>
                <div className="flex gap-4 mb-4 text-xs" style={{ color: '#94A3B8' }}>
                  <span className="flex items-center gap-1"><Users size={12} /> 4 Players</span>
                  <span className="flex items-center gap-1"><Clock size={12} /> Min 1 hour</span>
                  <span className="flex items-center gap-1"><CheckCircle size={12} /> Instant confirm</span>
                </div>
                <Link to={`/book?court=${court.id}`}
                  className="btn flex items-center justify-center gap-2 w-full font-black text-sm py-3 rounded-xl"
                  style={{ background: NAVY, color: 'white' }}>
                  <Calendar size={14} /> Book {court.name}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── EVENTS & TOURNAMENTS ── */}
      <EventsSection />

      {/* ── WHY CHOOSE US ── */}
      <section style={{ background: NAVY }}>
        <div className="max-w-6xl mx-auto px-6 py-9">
          <div className="text-center mb-6">
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: '#4A6FA5' }}>Why Choose Us</p>
            <h2 className="text-2xl font-black text-white">The Best Padel Experience in Karachi</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { icon: Zap,    title: 'Instant Booking',      desc: 'Book your court online in under 30 seconds. No calls, no waiting.' },
              { icon: Shield, title: 'Professional Courts',  desc: 'World-class padel courts with premium flooring and glass walls.' },
              { icon: Star,   title: 'Flexible Hours',       desc: 'Open from 3 PM to 12 AM every day so you can play after work or school.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl p-4 flex gap-3"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  <Icon size={17} color="white" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-black text-white text-base leading-tight mb-1">{title}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW TO BOOK ── */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#6B8CAE' }}>Simple Process</p>
          <h2 className="text-3xl font-black" style={{ color: NAVY }}>Book in 3 Easy Steps</h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-5">
          {[
            { step: '01', title: 'Choose a Court', desc: 'Select Court 1 or Court 2 based on availability and preference.' },
            { step: '02', title: 'Pick Date & Time', desc: 'Browse available slots and choose your preferred date and time.' },
            { step: '03', title: 'Confirm Booking', desc: 'Enter your details and confirm. Your court is instantly reserved.' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="relative bg-white rounded-2xl p-6 shadow-sm" style={{ border: '1px solid #DDE3EC' }}>
              <p className="text-5xl font-black mb-4" style={{ color: '#EEF2F7', letterSpacing: '-2px' }}>{step}</p>
              <h3 className="font-black text-lg mb-2" style={{ color: NAVY }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: '#64748B' }}>{desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-10">
          <Link to="/book"
            className="btn inline-flex items-center gap-2 font-black px-8 py-4 rounded-xl text-sm tracking-wide"
            style={{ background: NAVY, color: 'white', boxShadow: '0 8px 24px rgba(27,46,75,0.25)' }}>
            <Calendar size={16} /> Start Booking Now <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* ── VENUE INFO ── */}
      <section style={{ background: '#E8EDF4' }}>
        <div className="max-w-6xl mx-auto px-6 py-14">
          <div className="grid sm:grid-cols-2 gap-10 items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#6B8CAE' }}>Visit Us</p>
              <h2 className="text-3xl font-black mb-4" style={{ color: NAVY }}>Find Our Venue</h2>
              <p className="text-sm mb-7 leading-relaxed" style={{ color: '#64748B' }}>
                Conveniently located in North Nazimabad, our facility offers ample parking and easy access for all players.
              </p>
              <div className="space-y-4">
                {[
                  { icon: MapPin, label: 'Address', value: 'North Nazimabad, Karachi, Pakistan' },
                  { icon: Phone,  label: 'Phone',   value: '+92 21 0000 0000' },
                  { icon: Clock,  label: 'Hours',   value: '3:00 PM – 12:00 AM, Daily' },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: NAVY }}>
                      <Icon size={16} color="white" />
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#94A3B8' }}>{label}</p>
                      <p className="font-semibold text-sm" style={{ color: NAVY }}>{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Map */}
            <div className="rounded-2xl overflow-hidden shadow-lg" style={{ height: '420px' }}>
              <VenueMap />
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: '#0D1B2A' }}>
        {/* Main row */}
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-wrap items-center gap-6 justify-between"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>

          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
              style={{ background: 'white', color: NAVY }}>NN</div>
            <div>
              <p className="font-black text-white text-sm leading-tight">North Nazimabad</p>
              <p className="text-xs font-semibold" style={{ color: '#4A6FA5' }}>Gymkhana Trust</p>
            </div>
          </div>

          {/* Nav */}
          <div className="flex items-center gap-6">
            {[['/', 'Home'], ['/book', 'Padel Booking'], ['/my-bookings', 'My Bookings'], ['/complaints', 'Complaints']].map(([to, label]) => (
              <Link key={to} to={to} className="text-sm font-medium hover:text-white transition"
                style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</Link>
            ))}
          </div>

          {/* Phone */}
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>
            <Phone size={14} style={{ color: '#4A6FA5' }} />
            +92 21 0000 0000
          </div>

          {/* Address */}
          <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.45)', maxWidth: '240px' }}>
            <MapPin size={14} style={{ color: '#4A6FA5', flexShrink: 0 }} />
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
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
            © 2026 North Nazimabad Gymkhana Trust. All rights reserved.
          </p>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.15)' }}>Padel Court Booking System</p>
        </div>
      </footer>

    </div>
  )
}
