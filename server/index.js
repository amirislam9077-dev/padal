// API server — saves signups to the MySQL database `padalcreate`
import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import nodemailer from 'nodemailer'

const DB_NAME = process.env.DB_NAME || 'padalcreate'
const PORT = process.env.PORT || 5000

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  // Online MySQL (Aiven, TiDB Cloud, Railway…) needs an encrypted connection: set DB_SSL=true.
  // The provider's CA certificate (Aiven gives one): DB_SSL_CA_FILE = path to the .pem file
  // (e.g. server/aiven-ca.pem), or DB_SSL_CA = the certificate text itself.
  ...(process.env.DB_SSL === 'true' ? {
    ssl: {
      minVersion: 'TLSv1.2', rejectUnauthorized: true,
      ...(process.env.DB_SSL_CA_FILE ? { ca: readFileSync(path.resolve(process.env.DB_SSL_CA_FILE), 'utf8') }
        : process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}),
    },
  } : {}),
}

const OTP_TTL_MINUTES = 10
const OTP_MAX_ATTEMPTS = 5
const OTP_RESEND_SECONDS = 30
const UPLOADS_DIR = path.join(import.meta.dirname, 'uploads')
const SLIPS_DIR = path.join(UPLOADS_DIR, 'slips')
const MAX_PICTURE_BYTES = 2 * 1024 * 1024
const PICTURE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const EMAIL_TAKEN = 'An account with this email already exists. Please sign in instead.'
const NO_ACCOUNT = 'No account found with this email. Please sign up first, then sign in.'
// Gmail SMTP — SMTP_PASS must be a Gmail App Password, not the normal password
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
})

async function sendEmail(to, code) {
  await mailer.sendMail({
    from: `"NNG Trust Padel" <${process.env.SMTP_USER}>`,
    to,
    subject: `Your verification code: ${code}`,
    text: `Your NNG Trust verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
  })
}

// Twilio REST API — no SDK needed
async function sendSms(to, code) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: to,
      From: process.env.TWILIO_FROM,
      Body: `Your NNG Trust verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
    }),
  })
  if (!res.ok) throw new Error(`Twilio ${res.status}:${await res.text()}`)
}

// "0300 1234567" / "92300..." / "+92 300..." -> "+923001234567"
function toE164(phone) {
  const digits = phone.replace(/\D/g, '')
  if (phone.trim().startsWith('+')) return '+' + digits
  if (digits.startsWith('0')) return '+92' + digits.slice(1)
  if (digits.startsWith('92')) return '+' + digits
  return '+92' + digits
}

async function initDb() {
  const conn = await mysql.createConnection(dbConfig)
  try { await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``) }
  catch (e) { console.warn(`Could not create database ${DB_NAME} (${e.code}) — using it as it is.`) }
  await conn.end()

  // dateStrings: DATE/TIME columns come back as plain strings ('2026-10-14', '19:00:00')
  const pool = mysql.createPool({ ...dbConfig, database: DB_NAME, connectionLimit: 10, dateStrings: true })
  // Signup accounts are stored in the `padalcreate` table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS padalcreate (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(150) NOT NULL,
      membership_no VARCHAR(20) NOT NULL, -- shared by family members
      email_address VARCHAR(255) NOT NULL UNIQUE, -- one account per email
      phone_number VARCHAR(20) NOT NULL,          -- may be shared by family members
      picture VARCHAR(255) NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_member_name (membership_no, full_name) -- a name only once per membership
    )
  `)
  // Advance balance: money from cancelled bookings, used on the next booking (+ added, − used)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      reason VARCHAR(120) NOT NULL,
      slot_id INT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_credit_user (user_id)
    )
  `)
  // Events & tournaments shown on the home page, managed by the admin
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      type VARCHAR(20) NOT NULL DEFAULT 'tournament', -- 'tournament' | 'event'
      date DATE NOT NULL,
      start_time TIME NULL,
      end_time TIME NULL,
      venue VARCHAR(80) NULL,
      entry_fee DECIMAL(10,2) NULL,
      max_teams INT NULL,
      description VARCHAR(500) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open', -- 'open' | 'full' | 'closed'
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_events_date (date)
    )
  `)
  // Bookings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slot (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      slot_ref VARCHAR(20) NULL,
      court_id VARCHAR(20) NULL, court VARCHAR(50) NULL,
      date DATE NULL, time TIME NULL, end_time TIME NULL, hour INT NULL,
      player1 VARCHAR(100) NULL, player1_cm VARCHAR(20) NULL,
      player2 VARCHAR(100) NULL, player2_cm VARCHAR(20) NULL,
      player3 VARCHAR(100) NULL, player3_cm VARCHAR(20) NULL,
      player4 VARCHAR(100) NULL, player4_cm VARCHAR(20) NULL,
      team1 VARCHAR(100) NULL, team2 VARCHAR(100) NULL,
      payment DECIMAL(10,2) NULL,
      credit_used DECIMAL(10,2) NOT NULL DEFAULT 0, credit_refunded DECIMAL(10,2) NOT NULL DEFAULT 0,
      payment_received TINYINT(1) NOT NULL DEFAULT 0, payment_received_at DATETIME NULL,
      junior TINYINT(1) NOT NULL DEFAULT 0,
      phone VARCHAR(20) NULL,
      deposit_slip VARCHAR(255) NULL, slip_no VARCHAR(30) NULL, reference_no VARCHAR(50) NULL, bank_name VARCHAR(60) NULL,
      score VARCHAR(20) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
      user_id INT UNSIGNED NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_slot_ref (slot_ref),
      KEY idx_slot_lookup (date, court_id, status)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      email VARCHAR(150) PRIMARY KEY,
      code_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      sent_at DATETIME NOT NULL
    )
  `)
  return pool
}

// Signed token given out at login/signup; required to change your own profile.
// Set SESSION_SECRET in .env so tokens survive a server restart.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
const signToken = id => crypto.createHmac('sha256', SESSION_SECRET).update(String(id)).digest('hex')
function tokenValid(id, token) {
  const expected = Buffer.from(signToken(id))
  const given = Buffer.from(String(token || ''))
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

function toSession(row) {
  return { id: String(row.id), name: row.full_name, email: row.email_address, phone: row.phone_number, membershipNo: row.membership_no, picture: row.picture, token: signToken(row.id) }
}

// Remove a picture file that belongs only to this account (e.g. /uploads/12-ab12cd34.png)
async function deleteOwnPicture(id, picturePath) {
  if (!picturePath?.startsWith(`/uploads/${id}-`)) return // shared placeholders stay
  await fs.rm(path.join(UPLOADS_DIR, path.basename(picturePath)), { force: true })
}

// "data:image/png;base64,..." -> { buffer, ext }, or { error }
function parsePicture(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl)
  const ext = m && PICTURE_TYPES[m[1]]
  if (!ext) return { error: 'Picture must be a JPG, PNG or WEBP image.' }
  const buffer = Buffer.from(m[2], 'base64')
  if (buffer.length > MAX_PICTURE_BYTES) return { error: 'Picture must be 2 MB or smaller.' }
  return { buffer, ext }
}

let pool
try {
  pool = await initDb()
} catch (err) {
  console.error(`\n✖ Cannot connect to MySQL at ${dbConfig.host}:${dbConfig.port} (${err.code || err.message}).`)
  if (['localhost', '127.0.0.1'].includes(dbConfig.host) && process.env.RENDER)
    console.error('  On Render there is no MySQL on localhost. Set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD (and DB_NAME, DB_SSL=true)\n  in Render → your service → Environment, pointing to an online MySQL database.')
  else console.error('  Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME and DB_SSL.')
  process.exit(1)
}
await fs.mkdir(SLIPS_DIR, { recursive: true })
const app = express()
app.use(cors())
app.use(express.json({ limit: '8mb' })) // fits a 5 MB deposit slip sent as base64
app.use('/uploads', express.static(UPLOADS_DIR))

// "  ali   khan " -> "ali khan" (the table collation already ignores upper/lower case)
const cleanName = name => name.trim().replace(/\s+/g, ' ')

// Returns an error message if this name is already registered on this membership number
async function nameTaken(membershipNo, name) {
  const [rows] = await pool.query(
    'SELECT full_name FROM padalcreate WHERE membership_no = ? AND full_name = ?', [membershipNo.trim(), cleanName(name)])
  return rows.length
    ? `${rows[0].full_name} is already registered under ${membershipNo.trim()}. Please sign in instead.`
    : null
}

function validateSignup({ name, email, phone, membershipNo, password }) {
  if (!name?.trim() || !email?.trim() || !phone?.trim() || !membershipNo?.trim() || !password) return 'Please fill in all required fields.'
  if (!/^NNG-\d{1,16}$/.test(membershipNo.trim())) return 'Membership number must be NNG- followed by numbers.'
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) return 'Please enter a valid email address.'
  if (!/^\+\d{10,15}$/.test(toE164(phone))) return 'Please enter a valid phone number.'
  if (password.length < 6) return 'Password must be at least 6 characters.'
  return null
}

// Live check from the signup form: is this membership number already registered?
app.get('/api/check-membership', async (req, res) => {
  const no = String(req.query.no || '').trim()
  if (!/^NNG-\d{1,16}$/.test(no)) return res.status(400).json({ error: 'Invalid membership number.' })
  try {
    const [rows] = await pool.query('SELECT id, full_name FROM padalcreate WHERE membership_no = ? ORDER BY id', [no])
    res.json({ members: rows.map(r => ({ id: r.id, name: r.full_name })) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not check membership number.' })
  }
})

// Live check from the login form: is this email registered?
app.get('/api/check-email', async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' })
  try {
    const [rows] = await pool.query('SELECT 1 FROM padalcreate WHERE email_address = ?', [email])
    res.json({ exists: rows.length > 0 })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not check email.' })
  }
})

app.post('/api/send-otp', async (req, res) => {
  const body = req.body || {}
  const invalid = validateSignup(body)
  if (invalid) return res.status(400).json({ error: invalid })
  const email = body.email.trim().toLowerCase()
  const phone = toE164(body.phone)

  try {
    const [existing] = await pool.query('SELECT 1 FROM padalcreate WHERE email_address = ?', [email])
    if (existing.length) return res.status(409).json({ error: EMAIL_TAKEN })
    const taken = await nameTaken(body.membershipNo, body.name)
    if (taken) return res.status(409).json({ error: taken })

    const [recent] = await pool.query(
      'SELECT 1 FROM otp_codes WHERE email = ? AND sent_at > NOW() - INTERVAL ? SECOND', [email, OTP_RESEND_SECONDS])
    if (recent.length) return res.status(429).json({ error: `Please wait ${OTP_RESEND_SECONDS} seconds before requesting a new code.` })

    const code = String(crypto.randomInt(100000, 1000000))
    const results = await Promise.allSettled([sendEmail(email, code), sendSms(phone, code)])
    const [emailRes, smsRes] = results
    if (emailRes.status === 'rejected') console.error('Email send failed:', emailRes.reason)
    if (smsRes.status === 'rejected') console.error('SMS send failed:', smsRes.reason)
    if (emailRes.status === 'rejected' && smsRes.status === 'rejected')
      return res.status(502).json({ error: 'Could not send the verification code. Please try again later.' })

    await pool.query(
      `REPLACE INTO otp_codes (email, code_hash, expires_at, attempts, sent_at)
       VALUES (?, ?, NOW() + INTERVAL ? MINUTE, 0, NOW())`,
      [email, await bcrypt.hash(code, 10), OTP_TTL_MINUTES]
    )
    res.json({ email: emailRes.status === 'fulfilled', sms: smsRes.status === 'fulfilled' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not send the verification code. Please try again.' })
  }
})

app.post('/api/signup', async (req, res) => {
  const body = req.body || {}
  const { name, phone, membershipNo, password, otp } = body
  const invalid = validateSignup(body)
  if (invalid) return res.status(400).json({ error: invalid })
  if (!/^\d{6}$/.test(otp || '')) return res.status(400).json({ error: 'Please enter all 6 digits.', otpError: true })
  const email = body.email.trim().toLowerCase()
  const picture = body.picture ? parsePicture(body.picture) : null
  if (picture?.error) return res.status(400).json({ error: picture.error })

  try {
    const taken = await nameTaken(membershipNo, name)
    if (taken) return res.status(409).json({ error: taken })

    const [codes] = await pool.query('SELECT * FROM otp_codes WHERE email = ? AND expires_at > NOW()', [email])
    const row = codes[0]
    if (!row || row.attempts >= OTP_MAX_ATTEMPTS)
      return res.status(400).json({ error: 'Code expired. Please resend a new code.', otpError: true })
    if (!(await bcrypt.compare(otp, row.code_hash))) {
      await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ?', [email])
      return res.status(400).json({ error: 'Incorrect code. Please try again.', otpError: true })
    }

    const hash = await bcrypt.hash(password, 10)
    const [result] = await pool.query(
      'INSERT INTO padalcreate (full_name, membership_no, email_address, phone_number, password_hash) VALUES (?, ?, ?, ?, ?)',
      [cleanName(name), membershipNo.trim(), email, toE164(phone), hash]
    )
    await pool.query('DELETE FROM otp_codes WHERE email = ?', [email])
    if (picture) {
      const file = `${result.insertId}-${crypto.randomBytes(4).toString('hex')}.${picture.ext}`
      await fs.writeFile(path.join(UPLOADS_DIR, file), picture.buffer)
      await pool.query('UPDATE padalcreate SET picture = ? WHERE id = ?', [`/uploads/${file}`, result.insertId])
    }
    const [rows] = await pool.query('SELECT * FROM padalcreate WHERE id = ?', [result.insertId])
    res.status(201).json({ user: toSession(rows[0]) })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({
        error: err.message.includes('uniq_member_name')
          ? `${cleanName(name)} is already registered under ${membershipNo.trim()}. Please sign in instead.`
          : EMAIL_TAKEN,
      })
    console.error(err)
    res.status(500).json({ error: 'Could not create account. Please try again.' })
  }
})

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email?.trim() || !password)
    return res.status(400).json({ error: 'Please enter your email and password.' })
  try {
    const [rows] = await pool.query('SELECT * FROM padalcreate WHERE email_address = ?', [email.trim().toLowerCase()])
    if (!rows.length)
      return res.status(404).json({ error: NO_ACCOUNT, noAccount: true })
    if (!(await bcrypt.compare(password, rows[0].password_hash)))
      return res.status(401).json({ error: 'Incorrect password. Please try again.' })
    res.json({ user: toSession(rows[0]) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not sign in. Please try again.' })
  }
})

// Upload a deposit slip for a booking (image or PDF, max 5 MB). Logged-in users only.
// Body: { id, token, file: dataURL, name } → { path, name, type }
const SLIP_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
const MAX_SLIP_BYTES = 5 * 1024 * 1024
app.post('/api/deposit-slip', async (req, res) => {
  const { id, token, file, name = '' } = req.body || {}
  if (!id || !tokenValid(id, token))
    return res.status(401).json({ error: 'Your session has expired. Please log in again.', relogin: true })
  const m = /^data:([a-z]+\/[a-z.+-]+);base64,(.+)$/.exec(file || '')
  const ext = m && SLIP_TYPES[m[1]]
  if (!ext) return res.status(400).json({ error: 'Deposit slip must be a JPG, PNG, WEBP or PDF file.' })
  const buffer = Buffer.from(m[2], 'base64')
  if (buffer.length > MAX_SLIP_BYTES) return res.status(400).json({ error: 'Deposit slip must be 5 MB or smaller.' })
  try {
    // Random, hard-to-guess file name so slips can't be found by guessing
    const fileName = `slip-${id}-${crypto.randomBytes(12).toString('hex')}.${ext}`
    await fs.writeFile(path.join(SLIPS_DIR, fileName), buffer)
    res.json({ path: `/uploads/slips/${fileName}`, name: String(name).slice(0, 120), type: m[1] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not upload the deposit slip. Please try again.' })
  }
})

// Email a booking confirmation to every registered player. Logged-in users only.
// Body: { id, token, booking: { court, date, time, duration, total, players: [{ name, cmNo }] } }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function confirmationEmail(to, booking, bookedBy) {
  const rows = [['Court', booking.court], ['Date', booking.date], ['Time', booking.time], ['Duration', booking.duration], ['Booked by', bookedBy], ['Total', booking.total]]
  // Padel is 2 vs 2: show Team 1 and Team 2
  const teamList = team => booking.players.filter(p => (p.team || 1) === team)
  const playerLine = p => `<b>${esc(p.name)}</b>${p.cmNo ? ` · ${esc(p.cmNo)}` : ''}`
  const players = [1, 2].map(team => `
    <li style="margin:4px 0"><span style="color:${team === 1 ? '#1B2E4B' : '#4A6FA5'};font-weight:800">Team ${team}:</span>
      ${teamList(team).map(playerLine).join(' &amp; ') || '<span style="color:#94A3B8">—</span>'}</li>`).join('')
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #DDE3EC;border-radius:14px;overflow:hidden">
    <div style="background:#1B2E4B;color:#fff;padding:18px 22px">
      <div style="font-size:12px;opacity:.6;letter-spacing:.08em">NORTH NAZIMABAD GYMKHANA TRUST</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px">Padel court booking confirmed ✓</div>
    </div>
    <div style="padding:20px 22px;color:#1B2E4B">
      <p style="margin:0 0 14px">Hi <b>${esc(to.name)}</b>, your padel slot is confirmed. See you on the court!</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#94A3B8;border-bottom:1px solid #EEF2F7">${k}</td><td style="padding:6px 0;text-align:right;font-weight:700;border-bottom:1px solid #EEF2F7">${esc(v)}</td></tr>`).join('')}
      </table>
      <p style="margin:16px 0 6px;font-weight:700">Teams — Team 1 vs Team 2</p>
      <ul style="margin:0;padding-left:18px;font-size:14px;list-style:none;padding:0">${players}</ul>
    </div>
    <div style="background:#F8FAFC;padding:12px 22px;font-size:12px;color:#94A3B8">This is an automatic message from the NNG Trust padel booking system.</div>
  </div>`
  const text = `Hi ${to.name}, your padel slot is confirmed.\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\n' +
    [1, 2].map(team => `Team ${team}: ${teamList(team).map(p => `${p.name}${p.cmNo ? ` (${p.cmNo})` : ''}`).join(' & ') || '—'}`).join('\n')
  return { html, text }
}

app.post('/api/booking-confirmation', async (req, res) => {
  const { id, token, booking } = req.body || {}
  if (!id || !tokenValid(id, token))
    return res.status(401).json({ error: 'Your session has expired. Please log in again.', relogin: true })
  if (!booking?.players?.length || booking.players.length > 4)
    return res.status(400).json({ error: 'Invalid booking.' })

  try {
    const [[booker]] = await pool.query('SELECT * FROM padalcreate WHERE id = ?', [id])
    if (!booker) return res.status(404).json({ error: 'Account not found.' })

    // Find each player's email: Player 1 is the logged-in member, others by membership no + name
    const recipients = [], skipped = []
    for (const [i, p] of booking.players.entries()) {
      let row = null
      if (i === 0) row = booker
      else if (p.cmNo && p.name) {
        const [rows] = await pool.query('SELECT full_name, email_address FROM padalcreate WHERE membership_no = ? AND full_name = ?',
          [String(p.cmNo).trim().toUpperCase(), cleanName(p.name)])
        row = rows[0]
      }
      if (!row) { skipped.push({ name: p.name, reason: 'not a registered member' }); continue }
      if (recipients.some(r => r.email === row.email_address)) continue // same email only once
      recipients.push({ name: row.full_name, email: row.email_address })
    }

    const subject = `Padel booking confirmed — ${booking.date}, ${booking.time}, ${booking.court}`
    const results = await Promise.allSettled(recipients.map(r => {
      const { html, text } = confirmationEmail(r, booking, booker.full_name)
      return mailer.sendMail({ from: `"NNG Trust Padel" <${process.env.SMTP_USER}>`, to: r.email, subject, html, text })
    }))
    const sent = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') sent.push({ name: recipients[i].name })
      else { console.error('Confirmation email failed:', recipients[i].email, r.reason?.message); skipped.push({ name: recipients[i].name, reason: 'email could not be sent' }) }
    })
    res.json({ sent, skipped })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not send confirmation emails.' })
  }
})

// Search members for the booking form (players 2–4). Logged-in users only.
// GET /api/members/search?q=ha&field=name|cm  headers: x-user-id, x-user-token
app.get('/api/members/search', async (req, res) => {
  if (!tokenValid(req.get('x-user-id'), req.get('x-user-token')))
    return res.status(401).json({ error: 'Please log in again.', relogin: true })
  const q = String(req.query.q || '').trim().replace(/\s+/g, ' ')
  if (!q) return res.json({ members: [] })
  const like = '%' + q.replace(/[\\%_]/g, c => '\\' + c) + '%'
  const column = req.query.field === 'cm' ? 'membership_no' : 'full_name'
  try {
    // Matches that start with the typed text come first
    const [rows] = await pool.query(
      `SELECT id, full_name, membership_no, picture FROM padalcreate
       WHERE ${column} LIKE ?
       ORDER BY (${column} LIKE ?) DESC, ${column}, full_name LIMIT 8`,
      [like, like.slice(1)])
    res.json({ members: rows.map(r => ({ id: String(r.id), name: r.full_name, membershipNo: r.membership_no, picture: r.picture })) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Search failed.' })
  }
})

// Change or remove your own profile picture. Body: { id, token, picture: dataURL | null }
app.post('/api/profile/picture', async (req, res) => {
  const { id, token, picture } = req.body || {}
  if (!id || !tokenValid(id, token))
    return res.status(401).json({ error: 'Your session has expired. Please log in again.', relogin: true })
  const parsed = picture ? parsePicture(picture) : null
  if (parsed?.error) return res.status(400).json({ error: parsed.error })

  try {
    const [[row]] = await pool.query('SELECT * FROM padalcreate WHERE id = ?', [id])
    if (!row) return res.status(404).json({ error: 'Account not found.', relogin: true })

    let newPath = null
    if (parsed) {
      const file = `${row.id}-${crypto.randomBytes(4).toString('hex')}.${parsed.ext}`
      await fs.writeFile(path.join(UPLOADS_DIR, file), parsed.buffer)
      newPath = `/uploads/${file}`
    }
    await pool.query('UPDATE padalcreate SET picture = ? WHERE id = ?', [newPath, row.id])
    await deleteOwnPicture(row.id, row.picture)
    res.json({ user: toSession({ ...row, picture: newPath }) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not update your picture. Please try again.' })
  }
})

// ══ Bookings: the `slot` table ══
const RATE_PER_HOUR = Number(process.env.RATE_PER_HOUR || 1000)
// Opening hours 3pm–12am (same as src/store.js)
const OPEN_HOUR = 15, CLOSE_HOUR = 24
// Under-18 players play free from 3pm to 6pm (same rule as src/store.js)
const KIDS_FREE_FROM = 15, KIDS_FREE_TO = 18
const kidsFreeHours = (start, hours) => {
  let n = 0
  for (let h = start; h < start + hours; h++) if (h >= KIDS_FREE_FROM && h < KIDS_FREE_TO) n++
  return n
}
// Admin panel login — set in .env (ADMIN_EMAIL can list several emails, comma-separated)
const ADMIN_EMAILS = String(process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
const ADMIN_EMAIL = ADMIN_EMAILS.join(',')
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
// Tied to the admin email + password, so changing them logs out old admin sessions
const adminToken = () => crypto.createHmac('sha256', SESSION_SECRET).update(`admin|${ADMIN_EMAIL}|${ADMIN_PASSWORD}`).digest('hex')
const hourToTime = h => `${String(h).padStart(2, '0')}:00:00`
const timeToHour = t => (t ? Number(String(t).split(':')[0]) : null)

// Logged-in member from headers x-user-id / x-user-token, or null
function currentUserId(req) {
  const id = req.get('x-user-id')
  return id && tokenValid(id, req.get('x-user-token')) ? Number(id) : null
}
function isAdmin(req) {
  const given = Buffer.from(String(req.get('x-admin-token') || ''))
  const expected = Buffer.from(adminToken())
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

// "6-4 3-6 7-5" <-> [[6,4],[3,6],[7,5]]
const scoreToText = sets => sets?.length ? sets.map(([a, b]) => `${a}-${b}`).join(' ') : null
const textToScore = text => text ? { sets: String(text).trim().split(/\s+/).map(s => s.split('-').map(Number)) } : null

// ── Advance balance (credit) ──
// Current balance; pass a transaction connection + lock=true when about to spend it
async function creditBalance(db, userId, lock = false) {
  const [[r]] = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_ledger WHERE user_id = ?${lock ? ' FOR UPDATE' : ''}`, [userId])
  return Number(r.balance)
}
// What a cancelled booking gives back: the full price if a slip was paid, otherwise only the advance it used
const refundableAmount = r => (r.deposit_slip ? Number(r.payment || 0) : Number(r.credit_used || 0))

// Booking cancelled → its paid amount goes to the booker's advance balance (only once)
async function refundToCredit(db, row) {
  const amount = refundableAmount(row)
  if (!row.user_id || amount <= 0 || Number(row.credit_refunded) > 0) return 0
  await db.query('INSERT INTO credit_ledger (user_id, amount, reason, slot_id) VALUES (?, ?, ?, ?)',
    [row.user_id, amount, `Cancelled booking #${row.id} (${row.date})`, row.id])
  await db.query('UPDATE slot SET credit_refunded = ? WHERE id = ?', [amount, row.id])
  return amount
}
// Cancelled booking restored by the admin → take its credit back
async function reverseRefund(db, row) {
  const amount = Number(row.credit_refunded || 0)
  if (!row.user_id || amount <= 0) return 0
  await db.query('INSERT INTO credit_ledger (user_id, amount, reason, slot_id) VALUES (?, ?, ?, ?)',
    [row.user_id, -amount, `Booking #${row.id} restored`, row.id])
  await db.query('UPDATE slot SET credit_refunded = 0 WHERE id = ?', [row.id])
  return amount
}

// Today's date on this computer's clock (Pakistan time) as YYYY-MM-DD — toISOString() would give the UTC date
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const slotRefFor = n => `SLOT-${String(n).padStart(3, '0')}`

// Slot reference numbers: each one is reserved from this sequence table, so it is unique and can be
// shown on the booking page before the booking is saved. Starts after the highest number already used.
await pool.query(`CREATE TABLE IF NOT EXISTS slot_ref_seq (
  id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, KEY idx_user_unused (user_id, used_at))`)
{
  const [[m]] = await pool.query(`SELECT GREATEST(
    COALESCE((SELECT MAX(CAST(SUBSTRING(slot_ref, 6) AS UNSIGNED)) FROM slot WHERE slot_ref LIKE 'SLOT-%'), 0),
    COALESCE((SELECT MAX(id) FROM slot), 0),
    COALESCE((SELECT MAX(id) FROM slot_ref_seq), 0)) AS top`)
  await pool.query(`ALTER TABLE slot_ref_seq AUTO_INCREMENT = ${Number(m.top) + 1}`)
}
// Reserve a number for this member (reuses one they reserved earlier but never booked with)
async function reserveSlotRef(db, userId) {
  const [[free]] = await db.query('SELECT id FROM slot_ref_seq WHERE user_id = ? AND used_at IS NULL ORDER BY id LIMIT 1', [userId])
  if (free) return slotRefFor(free.id)
  const [r] = await db.query('INSERT INTO slot_ref_seq (user_id) VALUES (?)', [userId])
  return slotRefFor(r.insertId)
}
// The number shown on the booking page, if it really is this member's unused reservation
async function takeSlotRef(db, userId, ref) {
  const n = /^SLOT-(\d+)$/.exec(String(ref || ''))?.[1]
  if (n) {
    const [r] = await db.query('UPDATE slot_ref_seq SET used_at = NOW() WHERE id = ? AND user_id = ? AND used_at IS NULL', [Number(n), userId])
    if (r.affectedRows) return slotRefFor(Number(n))
  }
  const fresh = await reserveSlotRef(db, userId)
  await db.query('UPDATE slot_ref_seq SET used_at = NOW() WHERE id = ?', [Number(fresh.slice(5))])
  return fresh
}

app.get('/api/slots/new-ref', async (req, res) => {
  const userId = currentUserId(req)
  if (!userId) return res.status(401).json({ error: 'Please log in again.', relogin: true })
  try {
    res.json({ slotRef: await reserveSlotRef(pool, userId) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not create a slot reference no.' })
  }
})