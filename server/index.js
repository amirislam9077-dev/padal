// API server — saves signups to the MySQL database `padalcreate`
import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import nodemailer from 'nodemailer'
import cors from 'cors'

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
const NO_ACCOUNT = 'No account found with this email. Please sign up first, then sign in.'
// Gmail SMTP — SMTP_PASS must be a Gmail App Password, not the normal password.
// Short timeouts so a blocked SMTP port fails in seconds instead of hanging for 2 minutes.
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
})
const MAIL_FROM_NAME = 'NNG Trust Padel'
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER

// Sends one email. Render's free plan blocks SMTP, so when BREVO_API_KEY is set the email goes
// through Brevo's HTTPS API instead (brevo.com, free 300/day; MAIL_FROM must be a verified sender).
async function sendMail({ to, subject, html, text }) {
  if (!process.env.BREVO_API_KEY)
    return mailer.sendMail({ from: `"${MAIL_FROM_NAME}" <${MAIL_FROM}>`, to, subject, html, text })
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: MAIL_FROM_NAME, email: MAIL_FROM },
      to: [{ email: to }],
      subject,
      ...(html && { htmlContent: html }),
      textContent: text,
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`)
}

async function sendEmail(to, code) {
  await sendMail({
    to,
    subject: `Your verification code: ${code}`,
    text: `Your NNG Trust verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
  })
}

// Twilio REST API — no SDK needed
async function sendSms(to, code) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  if (!sid || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM) throw new Error('Twilio is not set up')
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
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`)
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
      email_address VARCHAR(255) NOT NULL,        -- may be shared by family members
      phone_number VARCHAR(20) NOT NULL,          -- may be shared by family members
      picture VARCHAR(255) NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_member_name (membership_no, full_name), -- a name only once per membership
      KEY idx_email (email_address)
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
  // Score confirmation: who entered the score (player no. 1–4), who confirmed it ("2,3"), and its state.
  // score_status NULL with a score = an older score from before confirmations, treated as confirmed.
  const SCORE_COLUMNS = {
    score_status: "VARCHAR(12) NULL", score_by: 'TINYINT NULL', score_confirmed_by: 'VARCHAR(20) NULL', score_at: 'DATETIME NULL',
  }
  const [cols] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'slot'")
  const have = new Set(cols.map(c => c.COLUMN_NAME))
  for (const [name, type] of Object.entries(SCORE_COLUMNS))
    if (!have.has(name)) await pool.query(`ALTER TABLE slot ADD COLUMN ${name} ${type}`)
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
app.use(cors()) // lets the website call the API from another address (e.g. Vercel → Render)
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
      return res.status(409).json({ error: `${cleanName(name)} is already registered under ${membershipNo.trim()}. Please sign in instead.` })
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
    // Several accounts can share one email (family members): sign in to the one whose password matches
    for (const row of rows)
      if (await bcrypt.compare(password, row.password_hash)) return res.json({ user: toSession(row) })
    res.status(401).json({ error: 'Incorrect password. Please try again.' })
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

// Booking emails to every registered player, in two stages:
//   'processing' — sent when the member books (payment not yet approved)
//   'confirmed'  — sent when the admin approves the payment (or straight away when nothing is due)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const EMAIL_STAGES = {
  processing: {
    title: 'Padel booking received — in process ⏳',
    intro: 'your padel booking has been received and is <b>in process</b>. You will get another email as soon as the club confirms the payment.',
    introText: 'your padel booking has been received and is IN PROCESS. You will get another email as soon as the club confirms the payment.',
    status: 'In process', color: '#C2410C', subject: 'Padel booking in process',
  },
  confirmed: {
    title: 'Padel booking confirmed ✓',
    intro: 'your padel slot is <b>confirmed</b>. See you on the court!',
    introText: 'your padel slot is CONFIRMED. See you on the court!',
    status: 'Confirmed', color: '#047857', subject: 'Padel booking confirmed',
    thanks: 'Thank you for booking with North Nazimabad Gymkhana Trust and for your payment. We look forward to welcoming you and your team on the court — enjoy your game!',
  },
}

function bookingEmail(to, booking, bookedBy, stage) {
  const s = EMAIL_STAGES[stage] || EMAIL_STAGES.confirmed
  const rows = [
    ...(booking.slotRef ? [['Slot Ref No.', booking.slotRef]] : []),
    ['Status', s.status], ['Court', booking.court], ['Date', booking.date], ['Time', booking.time],
    ...(booking.duration ? [['Duration', booking.duration]] : []),
    ['Booked by', bookedBy],
    ...(booking.total ? [['Total', booking.total]] : []),
  ]
  // Padel is 2 vs 2: show Team 1 and Team 2
  const teamList = team => booking.players.filter(p => (p.team || 1) === team)
  const playerLine = p => `<b>${esc(p.name)}</b>${p.cmNo ? ` · ${esc(p.cmNo)}` : ''}`
  const players = [1, 2].map(team => `
    <li style="margin:4px 0"><span style="color:${team === 1 ? '#1B2E4B' : '#4A6FA5'};font-weight:800">Team ${team}:</span>
      ${teamList(team).map(playerLine).join(' &amp; ') || '<span style="color:#94A3B8">—</span>'}</li>`).join('')
  const cell = (k, v) => k === 'Status'
    ? `<span style="color:${s.color}">${esc(v)}</span>` : esc(v)
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;background:#FFFFFF;border:1px solid #DDE3EC;border-radius:14px;overflow:hidden">
    <div style="background:#1B2E4B;color:#fff;padding:18px 22px">
      <div style="font-size:12px;opacity:.6;letter-spacing:.08em">NORTH NAZIMABAD GYMKHANA TRUST</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px">${s.title}</div>
    </div>
    <div style="padding:20px 22px;color:#1B2E4B">
      <p style="margin:0 0 14px">Hi <b>${esc(to.name)}</b>, ${s.intro}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#94A3B8;border-bottom:1px solid #EEF2F7">${k}</td><td style="padding:6px 0;text-align:right;font-weight:700;border-bottom:1px solid #EEF2F7">${cell(k, v)}</td></tr>`).join('')}
      </table>
      <p style="margin:16px 0 6px;font-weight:700">Players — Team 1 vs Team 2</p>
      <ul style="margin:0;padding-left:18px;font-size:14px;list-style:none;padding:0">${players}</ul>
      ${s.thanks ? `<p style="margin:18px 0 0;padding:12px 14px;background:#ECFDF5;border-radius:10px;color:#065F46;font-size:14px">${s.thanks}<br><b>— NNG Trust Padel Team</b></p>` : ""}
    </div>
    <div style="background:#F8FAFC;padding:12px 22px;font-size:12px;color:#94A3B8">This is an automatic message from the NNG Trust padel booking system.</div>
  </div>`
  const text = `Hi ${to.name}, ${s.introText}\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\n' +
    [1, 2].map(team => `Team ${team}: ${teamList(team).map(p => `${p.name}${p.cmNo ? ` (${p.cmNo})` : ''}`).join(' & ') || '—'}`).join('\n') +
    (s.thanks ? `\n\n${s.thanks}\n— NNG Trust Padel Team` : '')
  return { html, text, subject: `${s.subject} — ${booking.date}, ${booking.time}, ${booking.court}` }
}

// Email every registered player of a booking. Player 1 is the booking member; others are found by membership no + name.
async function emailBookingPlayers(booking, booker, stage) {
  const recipients = [], skipped = []
  for (const [i, p] of booking.players.entries()) {
    let row = null
    if (i === 0) row = booker
    else if (p.cmNo && p.name) {
      const [rows] = await pool.query('SELECT full_name, email_address FROM padalcreate WHERE membership_no = ? AND full_name = ?',
        [String(p.cmNo).trim().toUpperCase(), cleanName(p.name)])
      row = rows[0]
    }
    if (!row?.email_address) { skipped.push({ name: p.name, reason: 'not a registered member' }); continue }
    if (recipients.some(r => r.email === row.email_address)) continue // same email only once
    recipients.push({ name: row.full_name, email: row.email_address })
  }
  const results = await Promise.allSettled(recipients.map(r => {
    const { html, text, subject } = bookingEmail(r, booking, booker?.full_name || booking.players[0]?.name || '—', stage)
    return sendMail({ to: r.email, subject, html, text })
  }))
  const sent = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') sent.push({ name: recipients[i].name })
    else { console.error(`Booking email (${stage}) failed:`, recipients[i].email, r.reason?.message); skipped.push({ name: recipients[i].name, reason: 'email could not be sent' }) }
  })
  return { sent, skipped }
}

// Sent by the booking page right after saving. Logged-in users only.
// Body: { id, token, slotId, booking: { court, date, time, duration, total, players: [{ name, cmNo, team }] } }
// The stage comes from the saved slot: payment not yet approved → 'processing', otherwise 'confirmed'.
app.post('/api/booking-confirmation', async (req, res) => {
  const { id, token, slotId, booking } = req.body || {}
  if (!id || !tokenValid(id, token))
    return res.status(401).json({ error: 'Your session has expired. Please log in again.', relogin: true })
  if (!booking?.players?.length || booking.players.length > 4)
    return res.status(400).json({ error: 'Invalid booking.' })

  try {
    const [[booker]] = await pool.query('SELECT * FROM padalcreate WHERE id = ?', [id])
    if (!booker) return res.status(404).json({ error: 'Account not found.' })
    let stage = 'processing', slotRef = null
    if (slotId) {
      const [[slot]] = await pool.query('SELECT slot_ref, payment_received FROM slot WHERE id = ? AND user_id = ?', [slotId, id])
      if (slot) { stage = slot.payment_received ? 'confirmed' : 'processing'; slotRef = slot.slot_ref || slotRefFor(slotId) }
    }
    res.json({ ...(await emailBookingPlayers({ ...booking, slotRef }, booker, stage)), stage })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not send booking emails.' })
  }
})

// Search members for the booking form (players 2–4). Logged-in users only.
// GET /api/members/search?q=ha&field=name|cm   headers: x-user-id, x-user-token
// An empty q lists every registered member (shown when the box is clicked before typing)
app.get('/api/members/search', async (req, res) => {
  if (!tokenValid(req.get('x-user-id'), req.get('x-user-token')))
    return res.status(401).json({ error: 'Please log in again.', relogin: true })
  const q = String(req.query.q || '').trim().replace(/\s+/g, ' ')
  const like = '%' + q.replace(/[\\%_]/g, c => '\\' + c) + '%'
  const column = req.query.field === 'cm' ? 'membership_no' : 'full_name'
  try {
    // Matches that start with the typed text come first
    const [rows] = await pool.query(
      `SELECT id, full_name, membership_no, picture FROM padalcreate
       WHERE ${column} LIKE ?
       ORDER BY (${column} LIKE ?) DESC, ${column}, full_name LIMIT ${q ? 20 : 500}`,
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
// Player numbers (1–4) who confirmed the current score
const scoreConfirmers = r => String(r.score_confirmed_by || '').split(',').map(Number).filter(n => n >= 1 && n <= 4)

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

// A `slot` row → the booking object the website uses
function slotToBooking(r) {
  const players = [1, 2, 3, 4]
    .map(n => ({ n, team: n <= 2 ? 1 : 2, name: r[`player${n}`], cmNo: r[`player${n}_cm`] }))
    .filter(p => p.name)
  return {
    id: String(r.id), slotRef: r.slot_ref || slotRefFor(r.id), courtId: r.court_id, courtName: r.court, date: r.date,
    startHour: timeToHour(r.time), endHour: timeToHour(r.end_time) ?? timeToHour(r.time) + (r.hour || 1),
    hours: r.hour, players, team1: r.team1, team2: r.team2,
    playerName: r.player1, playerPhone: r.phone, userId: r.user_id ? String(r.user_id) : null,
    payment: r.payment != null ? Number(r.payment) : null, junior: !!r.junior, depositSlip: r.deposit_slip, referenceNo: r.reference_no || null, bankName: r.bank_name || null, slipNo: r.slip_no || null,
    creditUsed: Number(r.credit_used || 0), creditRefunded: Number(r.credit_refunded || 0),
    amountDue: Math.max(0, Number(r.payment || 0) - Number(r.credit_used || 0)), refundable: refundableAmount(r),
    score: textToScore(r.score), status: r.status, createdAt: r.created_at,
    // 'pending' = waiting for another player to confirm; 'confirmed' (older scores without a state count as confirmed)
    scoreStatus: r.score ? (r.score_status === 'pending' ? 'pending' : 'confirmed') : null,
    scoreBy: r.score_by || null, scoreConfirmedBy: scoreConfirmers(r),
    // Admin approves the payment → Confirmed; until then the booking shows as Processing
    paymentReceived: !!r.payment_received, paymentReceivedAt: r.payment_received_at || null,
  }
}

// Booked hours for one court on one date (public: no names)
app.get('/api/slots/booked', async (req, res) => {
  const { date, court } = req.query
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !court) return res.status(400).json({ error: 'date and court are required.' })
  try {
    const [rows] = await pool.query(
      "SELECT time, end_time, hour FROM slot WHERE date = ? AND court_id = ? AND status <> 'cancelled'", [date, String(court)])
    res.json({ booked: rows.map(r => ({ startHour: timeToHour(r.time), endHour: timeToHour(r.end_time) ?? timeToHour(r.time) + (r.hour || 1) })) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not load booked slots.' })
  }
})

// Create a booking. Body: { courtId, courtName, date, startHour, hours, phone, depositSlip, players: [{ n, name, cmNo }] }
app.post('/api/slots', async (req, res) => {
  const userId = currentUserId(req)
  if (!userId) return res.status(401).json({ error: 'Please log in again to book.', relogin: true })
  const b = req.body || {}
  const start = Number(b.startHour), hours = Number(b.hours)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !b.courtId) return res.status(400).json({ error: 'Please choose a court and date.' })
  if (!Number.isInteger(start) || start < OPEN_HOUR || start >= CLOSE_HOUR || ![1, 2, 3].includes(hours) || start + hours > CLOSE_HOUR)
    return res.status(400).json({ error: 'Please choose a time between 3pm and 12am.' })
  if (b.date < localToday()) return res.status(400).json({ error: 'That date has already passed.' })
  // Price is worked out here, not trusted from the browser
  const freeHours = b.junior === true ? kidsFreeHours(start, hours) : 0
  const junior = freeHours > 0 // only marked under-18 when free hours actually apply
  const payment = (hours - freeHours) * RATE_PER_HOUR
  const slip = b.depositSlip && String(b.depositSlip).startsWith('/uploads/slips/') ? b.depositSlip : null
  // Bank / transfer reference printed on the deposit slip
  const refNo = String(b.referenceNo || '').trim().slice(0, 50) || null
  if (slip && !refNo) return res.status(400).json({ error: 'Please enter the reference no. of the deposit slip.' })
  const bank = String(b.bankName || '').trim().slice(0, 60) || null
  if (slip && !bank) return res.status(400).json({ error: 'Please enter the bank name of the deposit slip.' })
  const players = Array.isArray(b.players) ? b.players.filter(p => p?.name?.trim()).slice(0, 4) : []
  if (!players.length) return res.status(400).json({ error: 'Please add at least one player.' })

  const byN = Object.fromEntries(players.map((p, i) => [Number(p.n) || i + 1, { name: cleanName(p.name).slice(0, 100), cm: String(p.cmNo || '').trim().toUpperCase().slice(0, 20) || null }]))
  const teamName = ns => ns.map(n => byN[n]?.name).filter(Boolean).join(' & ').slice(0, 100) || null
  const end = start + hours

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // Lock this court/date and make sure the time is still free
    const [taken] = await conn.query(
      `SELECT time, end_time, hour FROM slot WHERE date = ? AND court_id = ? AND status <> 'cancelled' FOR UPDATE`,
      [b.date, String(b.courtId)])
    const clash = taken.some(r => {
      const s = timeToHour(r.time), e = timeToHour(r.end_time) ?? s + (r.hour || 1)
      return start < e && end > s
    })
    if (clash) { await conn.rollback(); return res.status(409).json({ error: 'Sorry — that time was just booked by someone else. Please choose another slot.' }) }

    // "Edit" on a cancelled booking: its deposit slip (with slip no., bank, reference no.) carries
    // over and pays for the new slot again; the old booking is removed afterwards
    let old = null, oldCover = 0
    if (b.rebookOf) {
      ;[[old]] = await conn.query('SELECT * FROM slot WHERE id = ? FOR UPDATE', [b.rebookOf])
      if (!old || old.user_id !== userId || old.status !== 'cancelled') {
        await conn.rollback(); return res.status(400).json({ error: 'That cancelled booking can no longer be replaced.' })
      }
      oldCover = refundableAmount(old)
      // Its money was put on the advance balance when cancelled: take back what's still unspent,
      // so the same payment isn't counted twice on this page
      const credited = Number(old.credit_refunded || 0)
      if (credited > 0) {
        const reclaim = Math.min(await creditBalance(conn, userId, true), credited)
        if (reclaim > 0) await conn.query('INSERT INTO credit_ledger (user_id, amount, reason, slot_id) VALUES (?, ?, ?, ?)',
          [userId, -reclaim, `Moved back to the edited booking #${old.id}`, old.id])
      }
    }
    const slipFinal = slip || old?.deposit_slip || null
    const coveredByOld = Math.min(oldCover, payment)
    // A cheaper new slot: the rest of the old payment goes to the advance balance
    const oldExtra = oldCover - coveredByOld

    // Then the member's advance balance; a slip is only needed for what's left to pay
    const creditUsed = Math.min(await creditBalance(conn, userId, true), payment - coveredByOld)
    if (payment - coveredByOld - creditUsed > 0 && !slip) {
      await conn.rollback()
      return res.status(400).json({ error: old
        ? `Please attach a new deposit slip for the remaining Rs. ${(payment - coveredByOld - creditUsed).toLocaleString()}.`
        : 'Please attach the deposit slip.' })
    }

    const [result] = await conn.query(
      `INSERT INTO slot (court_id, court, date, time, end_time, hour,
         player1, player1_cm, player2, player2_cm, player3, player3_cm, player4, player4_cm,
         team1, team2, payment, credit_used, junior, phone, deposit_slip, slip_no, reference_no, bank_name, status, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
      [String(b.courtId), String(b.courtName || '').slice(0, 50), b.date, hourToTime(start), hourToTime(end), hours,
        byN[1]?.name || null, byN[1]?.cm || null, byN[2]?.name || null, byN[2]?.cm || null,
        byN[3]?.name || null, byN[3]?.cm || null, byN[4]?.name || null, byN[4]?.cm || null,
        // No slip at all: the booking was paid from the advance (it gives that back if cancelled)
        teamName([1, 2]), teamName([3, 4]), payment, creditUsed + (slipFinal ? 0 : coveredByOld), junior ? 1 : 0,
        String(b.phone || '').slice(0, 20) || null, slipFinal, slip ? null : (old?.slip_no || null),
        slip ? refNo : (refNo || old?.reference_no || null),
        slip ? bank : (bank || old?.bank_name || null), userId])
    if (creditUsed > 0)
      await conn.query('INSERT INTO credit_ledger (user_id, amount, reason, slot_id) VALUES (?, ?, ?, ?)',
        [userId, -creditUsed, `Used for booking #${result.insertId} (${b.date})`, result.insertId])
    if (oldExtra > 0)
      await conn.query('INSERT INTO credit_ledger (user_id, amount, reason, slot_id) VALUES (?, ?, ?, ?)',
        [userId, oldExtra, `Left over from cancelled booking #${old.id} (cheaper new slot)`, result.insertId])
    if (old) await conn.query('DELETE FROM slot WHERE id = ?', [old.id]) // replaced by the new booking
    // Slot reference no. (SLOT-001 …) — an edited cancelled booking keeps its old one
    await conn.query('UPDATE slot SET slot_ref = ? WHERE id = ?', [old?.slot_ref || await takeSlotRef(conn, userId, b.slotRef), result.insertId])
    // Payment received: nothing new to collect (free / advance / old slip) — or the replaced booking was already approved
    const nothingNew = !slip && (payment - coveredByOld - creditUsed <= 0)
    if (nothingNew && (!old || old.payment_received || coveredByOld === 0))
      await conn.query('UPDATE slot SET payment_received = 1, payment_received_at = NOW() WHERE id = ?', [result.insertId])
    await conn.commit()
    const [[row]] = await pool.query('SELECT * FROM slot WHERE id = ?', [result.insertId])
    res.status(201).json({ booking: slotToBooking(row), replaced: old ? String(old.id) : null })
  } catch (err) {
    await conn.rollback().catch(() => {})
    console.error(err)
    res.status(500).json({ error: 'Could not save the booking. Please try again.' })
  } finally {
    conn.release()
  }
})

// Edit an upcoming booking (court, date, time, players, phone). Same body as creating one.
// What was already paid stays with the booking: a cheaper slot puts the difference on the
// advance balance; a dearer one uses the advance first, then needs a new slip for the rest.
app.put('/api/slots/:id', async (req, res) => {
  const userId = currentUserId(req)
  if (!userId) return res.status(401).json({ error: 'Please log in again to edit the booking.', relogin: true })
  const b = req.body || {}
  const start = Number(b.startHour), hours = Number(b.hours)
  const today = localToday()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !b.courtId) return res.status(400).json({ error: 'Please choose a court and date.' })
  if (!Number.isInteger(start) || start < OPEN_HOUR || start >= CLOSE_HOUR || ![1, 2, 3].includes(hours) || start + hours > CLOSE_HOUR)
    return res.status(400).json({ error: 'Please choose a time between 3pm and 12am.' })
  if (b.date < today) return res.status(400).json({ error: 'That date has already passed.' })
  const freeHours = b.junior === true ? kidsFreeHours(start, hours) : 0
  const junior = freeHours > 0
  const payment = (hours - freeHours) * RATE_PER_HOUR
  const slip = b.depositSlip && String(b.depositSlip).startsWith('/uploads/slips/') ? b.depositSlip : null
  // Bank / transfer reference printed on the deposit slip
  const refNo = String(b.referenceNo || '').trim().slice(0, 50) || null
  if (slip && !refNo) return res.status(400).json({ error: 'Please enter the reference no. of the deposit slip.' })
  const bank = String(b.bankName || '').trim().slice(0, 60) || null
  if (slip && !bank) return res.status(400).json({ error: 'Please enter the bank name of the deposit slip.' })
  const players = Array.isArray(b.players) ? b.players.filter(p => p?.name?.trim()).slice(0, 4) : []
  if (!players.length) return res.status(400).json({ error: 'Please add at least one player.' })
  const byN = Object.fromEntries(players.map((p, i) => [Number(p.n) || i + 1, { name: cleanName(p.name).slice(0, 100), cm: String(p.cmNo || '').trim().toUpperCase().slice(0, 20) || null }]))
  const teamName = ns => ns.map(n => byN[n]?.name).filter(Boolean).join(' & ').slice(0, 100) || null
  const end = start + hours

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query('SELECT * FROM slot WHERE id = ? FOR UPDATE', [req.params.id])
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Booking not found.' }) }
    if (row.user_id !== userId) { await conn.rollback(); return res.status(403).json({ error: 'Only the member who made the booking can edit it.' }) }
    if (row.status !== 'confirmed' || row.date < today) { await conn.rollback(); return res.status(400).json({ error: 'Only upcoming bookings can be edited.' }) }

    // The new time must be free (ignoring this booking itself)
    const [taken] = await conn.query(
      `SELECT time, end_time, hour FROM slot WHERE date = ? AND court_id = ? AND status <> 'cancelled' AND id <> ? FOR UPDATE`,
      [b.date, String(b.courtId), row.id])
    const clash = taken.some(r => {
      const s = timeToHour(r.time), e = timeToHour(r.end_time) ?? s + (r.hour || 1)
      return start < e && end > s
    })
    if (clash) { await conn.rollback(); return res.status(409).json({ error: 'Sorry — that time was just booked by someone else. Please choose another slot.' }) }

    const held = refundableAmount(row) // what this booking has already been paid
    let creditUsed = Number(row.credit_used || 0)
    if (payment < held) {
      const back = held - payment
      await conn.query('INSERT INTO credit_ledger (user_id, amount, reason, slot_id) VALUES (?, ?, ?, ?)',
        [userId, back, `Edited booking #${row.id} (cheaper slot)`, row.id])
    } else if (payment > held) {
      const fromCredit = Math.min(await creditBalance(conn, userId, true), payment - held)
      if (payment - held - fromCredit > 0 && !slip) {
        await conn.rollback()
        return res.status(400).json({ error: `Please attach a new deposit slip for the extra Rs. ${(payment - held - fromCredit).toLocaleString()}.` })
      }
      if (fromCredit > 0) {
        await conn.query('INSERT INTO credit_ledger (user_id, amount, reason, slot_id) VALUES (?, ?, ?, ?)',
          [userId, -fromCredit, `Used for edited booking #${row.id} (${b.date})`, row.id])
        creditUsed += fromCredit
      }
    }
    const slipFinal = slip || row.deposit_slip || null
    // No slip: the booking is paid fully from the advance, so that's what it gives back if cancelled
    creditUsed = slipFinal ? Math.min(creditUsed, payment) : payment

    await conn.query(
      `UPDATE slot SET court_id = ?, court = ?, date = ?, time = ?, end_time = ?, hour = ?,
         player1 = ?, player1_cm = ?, player2 = ?, player2_cm = ?, player3 = ?, player3_cm = ?, player4 = ?, player4_cm = ?,
         team1 = ?, team2 = ?, payment = ?, credit_used = ?, junior = ?, phone = ?, deposit_slip = ?, reference_no = ?, bank_name = ?,
         payment_received = IF(?, 0, payment_received), payment_received_at = IF(?, NULL, payment_received_at)
       WHERE id = ?`,
      [String(b.courtId), String(b.courtName || '').slice(0, 50), b.date, hourToTime(start), hourToTime(end), hours,
        byN[1]?.name || null, byN[1]?.cm || null, byN[2]?.name || null, byN[2]?.cm || null,
        byN[3]?.name || null, byN[3]?.cm || null, byN[4]?.name || null, byN[4]?.cm || null,
        teamName([1, 2]), teamName([3, 4]), payment, creditUsed, junior ? 1 : 0,
        String(b.phone || '').slice(0, 20) || null, slipFinal, slip ? refNo : (refNo || row.reference_no || null),
        slip ? bank : (bank || row.bank_name || null), slip ? 1 : 0, slip ? 1 : 0, row.id])
    await conn.commit()
    const [[updated]] = await pool.query('SELECT * FROM slot WHERE id = ?', [row.id])
    res.json({ booking: slotToBooking(updated), balance: await creditBalance(pool, userId) })
  } catch (err) {
    await conn.rollback().catch(() => {})
    console.error(err)
    res.status(500).json({ error: 'Could not save the changes. Please try again.' })
  } finally {
    conn.release()
  }
})

// Bookings for the logged-in member: ones they made, or where they are a player (name + CM No.)
app.get('/api/slots/mine', async (req, res) => {
  const userId = currentUserId(req)
  if (!userId) return res.status(401).json({ error: 'Please log in again.', relogin: true })
  try {
    const [[me]] = await pool.query('SELECT full_name, membership_no FROM padalcreate WHERE id = ?', [userId])
    const asPlayer = [1, 2, 3, 4].map(n => `(player${n} = ? AND player${n}_cm = ?)`).join(' OR ')
    const [rows] = await pool.query(
      `SELECT * FROM slot WHERE user_id = ? OR ${asPlayer} ORDER BY date, time`,
      [userId, ...[1, 2, 3, 4].flatMap(() => [me?.full_name || '', me?.membership_no || ''])])
    res.json({ bookings: rows.map(slotToBooking) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not load your bookings.' })
  }
})

// Load a slot the member is allowed to change (they booked it, or they play in it)
async function memberSlot(req, res) {
  const userId = currentUserId(req)
  if (!userId) { res.status(401).json({ error: 'Please log in again.', relogin: true }); return null }
  const [[row]] = await pool.query('SELECT * FROM slot WHERE id = ?', [req.params.id])
  if (!row) { res.status(404).json({ error: 'Booking not found.' }); return null }
  const [[me]] = await pool.query('SELECT full_name, membership_no FROM padalcreate WHERE id = ?', [userId])
  const plays = [1, 2, 3, 4].some(n => me && row[`player${n}`] === me.full_name && row[`player${n}_cm`] === me.membership_no)
  if (row.user_id !== userId && !plays) { res.status(403).json({ error: 'This is not your booking.' }); return null }
  return row
}

app.post('/api/slots/:id/cancel', async (req, res) => {
  try {
    const row = await memberSlot(req, res)
    if (!row) return
    if (row.user_id !== currentUserId(req)) return res.status(403).json({ error: 'Only the member who made the booking can cancel it.' })
    if (row.status === 'cancelled') return res.status(400).json({ error: 'This booking is already cancelled.' })
    if (row.date < localToday()) return res.status(400).json({ error: 'Past bookings can\'t be cancelled.' })
    // Cancel + move the paid amount to the advance balance, together
    const conn = await pool.getConnection()
    let creditAdded = 0
    try {
      await conn.beginTransaction()
      await conn.query("UPDATE slot SET status = 'cancelled' WHERE id = ?", [row.id])
      creditAdded = await refundToCredit(conn, row)
      await conn.commit()
    } catch (e) {
      await conn.rollback().catch(() => {}); throw e
    } finally { conn.release() }
    const [[updated]] = await pool.query('SELECT * FROM slot WHERE id = ?', [row.id])
    res.json({ booking: slotToBooking(updated), creditAdded, balance: await creditBalance(pool, row.user_id) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not cancel the booking.' })
  }
})

// ── Match score + confirmation by another player ──
// The player who enters the score can't confirm it; it's Confirmed once a player of Team 1 and a player of Team 2 confirm.
const slotPlayers = row => [1, 2, 3, 4]
  .map(n => ({ n, team: n <= 2 ? 1 : 2, name: row[`player${n}`], cmNo: row[`player${n}_cm`] }))
  .filter(p => p.name)
// The logged-in member's player number in this booking (the booker is player 1 when not found by name)
async function myPlayerNo(row, userId) {
  const [[me]] = await pool.query('SELECT full_name, membership_no FROM padalcreate WHERE id = ?', [userId])
  const p = slotPlayers(row).find(p => me && p.name === me.full_name && p.cmNo === me.membership_no)
  return p ? p.n : row.user_id === userId ? 1 : null
}
// Link token for one player and one score — a changed score makes the old links stop working
const scoreLinkToken = (slotId, n, score) =>
  crypto.createHmac('sha256', SESSION_SECRET).update(`score|${slotId}|${n}|${score}`).digest('hex')
const scoreTokenValid = (slotId, n, score, token) => {
  const a = Buffer.from(scoreLinkToken(slotId, n, score)), b = Buffer.from(String(token || ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
// Confirmed once at least one player of Team 1 AND one of Team 2 (players 1–2 / 3–4) confirmed — not counting
// the one who entered it. Only when a team has nobody besides that player does the entry count for that team.
const playerTeam = n => (n <= 2 ? 1 : 2)
function scoreFullyConfirmed(row, confirmers) {
  const others = slotPlayers(row).filter(p => p.n !== row.score_by)
  return [1, 2].every(team => others.some(p => p.team === team)
    ? confirmers.some(n => playerTeam(n) === team && n !== row.score_by)
    : playerTeam(row.score_by) === team)
}
// "Team 2" / "Team 1 and Team 2" — teams still missing a confirmation
function teamsStillToConfirm(row) {
  const confirmers = scoreConfirmers(row)
  const others = slotPlayers(row).filter(p => p.n !== row.score_by)
  return [1, 2].filter(team => others.some(p => p.team === team) && !confirmers.some(n => playerTeam(n) === team))
    .map(t => `Team ${t}`).join(' and ')
}
// Record a confirmation; returns the updated row
async function confirmScore(slotId, n) {
  const [[row]] = await pool.query('SELECT * FROM slot WHERE id = ?', [slotId])
  if (!row?.score || row.score_status !== 'pending' || n === row.score_by) return row || null
  const confirmers = [...new Set([...scoreConfirmers(row), n])].sort()
  const status = scoreFullyConfirmed(row, confirmers) ? 'confirmed' : 'pending'
  await pool.query('UPDATE slot SET score_confirmed_by = ?, score_status = ? WHERE id = ? AND score = ?', [confirmers.join(','), status, slotId, row.score])
  const [[updated]] = await pool.query('SELECT * FROM slot WHERE id = ?', [slotId])
  return updated
}

const emailRow = (k, v) => `<tr><td style="padding:6px 0;color:#94A3B8;border-bottom:1px solid #EEF2F7">${k}</td><td style="padding:6px 0;text-align:right;font-weight:700;border-bottom:1px solid #EEF2F7">${esc(v)}</td></tr>`

function scoreEmail(to, d, enteredBy, sets, link) {
  const teamNames = team => d.players.filter(p => p.team === team).map(p => esc(p.name)).join(' &amp; ') || '—'
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;background:#FFFFFF;border:1px solid #DDE3EC;border-radius:14px;overflow:hidden">
    <div style="background:#1B2E4B;color:#fff;padding:18px 22px">
      <div style="font-size:12px;opacity:.6;letter-spacing:.08em">NORTH NAZIMABAD GYMKHANA TRUST</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px">Please confirm the match score</div>
    </div>
    <div style="padding:20px 22px;color:#1B2E4B">
      <p style="margin:0 0 14px">Hi <b>${esc(to.name)}</b>, <b>${esc(enteredBy)}</b> entered the score for your padel match. Please check it and confirm.<br>
        <span style="font-size:12px;color:#64748B">The score is confirmed once at least one player from each team (Team 1 and Team 2) confirms it.</span></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${[['Slot Ref No.', d.slotRef], ['Court', d.court], ['Date', d.date], ['Time', d.time]].map(([k, v]) => emailRow(k, v)).join('')}
      </table>
      <p style="margin:16px 0 6px;font-weight:700">Team 1: ${teamNames(1)} &nbsp;vs&nbsp; Team 2: ${teamNames(2)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${sets.map(([a, b], i) => emailRow(`Set ${i + 1}`, `${a} – ${b}`)).join('')}
      </table>
      <p style="margin:22px 0 6px;text-align:center">
        <a href="${link}" style="display:inline-block;background:#1B2E4B;color:#fff;text-decoration:none;font-weight:800;padding:12px 26px;border-radius:10px">Confirm score</a>
      </p>
      <p style="margin:8px 0 0;font-size:12px;color:#94A3B8;text-align:center">Score not right? Don&#39;t confirm — log in and correct it from My Bookings.</p>
    </div>
    <div style="background:#F8FAFC;padding:12px 22px;font-size:12px;color:#94A3B8">This is an automatic message from the NNG Trust padel booking system.</div>
  </div>`
  const text = `Hi ${to.name}, ${enteredBy} entered the score for your padel match (${d.slotRef}, ${d.court}, ${d.date}, ${d.time}).\n\n` +
    sets.map(([a, b], i) => `Set ${i + 1}: ${a}-${b}`).join('\n') +
    `\n\nConfirm the score: ${link}\n\nScore not right? Don't confirm — log in and correct it from My Bookings.`
  return { html, text, subject: `Please confirm the score — ${d.slotRef}, ${d.date}` }
}

// Email the confirm link to every registered player except the one who entered the score
async function emailScoreConfirm(row, byNo, baseUrl) {
  const d = slotEmailDetails(row)
  const sets = textToScore(row.score).sets
  const players = slotPlayers(row)
  const enteredBy = players.find(p => p.n === byNo)?.name || 'A player'
  const sent = [], skipped = [], seen = new Set()
  for (const p of players) {
    if (p.n === byNo) continue
    let rec = null
    if (p.n === 1 && row.user_id) [[rec]] = await pool.query('SELECT full_name, email_address FROM padalcreate WHERE id = ?', [row.user_id])
    else if (p.cmNo) [[rec]] = await pool.query('SELECT full_name, email_address FROM padalcreate WHERE membership_no = ? AND full_name = ?',
      [String(p.cmNo).trim().toUpperCase(), cleanName(p.name)])
    if (!rec?.email_address) { skipped.push({ name: p.name, reason: 'not a registered member' }); continue }
    if (seen.has(rec.email_address)) continue
    seen.add(rec.email_address)
    const link = `${baseUrl}/api/score/confirm?s=${row.id}&p=${p.n}&t=${scoreLinkToken(row.id, p.n, row.score)}`
    const { html, text, subject } = scoreEmail({ name: rec.full_name }, d, enteredBy, sets, link)
    try {
      await sendMail({ to: rec.email_address, subject, html, text })
      sent.push({ name: rec.full_name })
    } catch (err) { console.error('Score email failed:', rec.email_address, err.message); skipped.push({ name: rec.full_name, reason: 'email could not be sent' }) }
  }
  return { sent, skipped }
}
// Where the confirm link points: PUBLIC_URL in .env, else the website that sent the request
const publicBaseUrl = req => (process.env.PUBLIC_URL || req.get('origin') || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')

// Body: { sets: [[6,4],[3,6]] } or { sets: null } to clear. A new score waits for another player's confirmation.
app.post('/api/slots/:id/score', async (req, res) => {
  const sets = req.body?.sets
  if (sets !== null && !(Array.isArray(sets) && sets.length >= 1 && sets.length <= 3 &&
    sets.every(s => Array.isArray(s) && s.length === 2 && s.every(g => Number.isInteger(g) && g >= 0 && g <= 7) && s[0] !== s[1])))
    return res.status(400).json({ error: 'Invalid score.' })
  try {
    const row = await memberSlot(req, res)
    if (!row) return
    if (row.status === 'cancelled') return res.status(400).json({ error: 'Cancelled bookings can\'t have a score.' })
    const text = scoreToText(sets)
    if (text === row.score) return res.json({ booking: slotToBooking(row), emails: null }) // unchanged
    const byNo = text ? await myPlayerNo(row, currentUserId(req)) : null
    await pool.query('UPDATE slot SET score = ?, score_status = ?, score_by = ?, score_confirmed_by = NULL, score_at = ? WHERE id = ?',
      [text, text ? 'pending' : null, byNo, text ? new Date() : null, row.id])
    const [[updated]] = await pool.query('SELECT * FROM slot WHERE id = ?', [row.id])
    const emails = text
      ? await emailScoreConfirm(updated, byNo, publicBaseUrl(req)).catch(err => {
        console.error('Score emails failed:', err.message); return { sent: [], skipped: [], error: true }
      })
      : null
    res.json({ booking: slotToBooking(updated), emails })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not save the score.' })
  }
})

// Confirm from inside the app (My Bookings) — any player of the booking except the one who entered the score
app.post('/api/slots/:id/score/confirm', async (req, res) => {
  try {
    const row = await memberSlot(req, res)
    if (!row) return
    if (!row.score || row.score_status !== 'pending') return res.status(400).json({ error: 'There is no score waiting for confirmation.' })
    const n = await myPlayerNo(row, currentUserId(req))
    if (!n) return res.status(403).json({ error: 'Only the players of this match can confirm the score.' })
    if (n === row.score_by) return res.status(403).json({ error: 'You entered this score — players of both teams have to confirm it.' })
    if (scoreConfirmers(row).includes(n)) return res.status(400).json({ error: `You already confirmed this score. Waiting for ${teamsStillToConfirm(row)}.` })
    res.json({ booking: slotToBooking(await confirmScore(row.id, n)) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not confirm the score.' })
  }
})

// Confirm link from the email. GET only shows the score with a button (so mail scanners that open links
// don't confirm by themselves); the button POSTs to the same link.
function scorePage(title, body, titleColor = '#FFFFFF') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
  <body style="margin:0;background:#F1F4F8;font-family:Segoe UI,Arial,sans-serif;color:#1B2E4B">
  <div style="max-width:460px;margin:40px auto;padding:0 16px"><div style="background:#fff;border:1px solid #DDE3EC;border-radius:16px;overflow:hidden">
  <div style="background:#1B2E4B;color:#fff;padding:16px 20px"><div style="font-size:11px;opacity:.6;letter-spacing:.08em">NORTH NAZIMABAD GYMKHANA TRUST</div>
  <div style="font-size:19px;font-weight:800;margin-top:4px;color:${titleColor}">${esc(title)}</div></div>
  <div style="padding:18px 20px;font-size:14px">${body}</div></div></div></body></html>`
}
async function scoreLinkRow(q) {
  const id = Number(q.s), n = Number(q.p)
  if (!Number.isInteger(id) || !(n >= 1 && n <= 4)) return { error: 'This link is not valid.' }
  const [[row]] = await pool.query('SELECT * FROM slot WHERE id = ?', [id])
  if (!row?.score) return { error: 'This booking has no score any more.' }
  if (!scoreTokenValid(id, n, row.score, q.t))
    return { error: 'This link has expired — the score was changed after this email was sent. Please use the newest email.' }
  return { row, n }
}
const matchHtml = row => {
  const d = slotEmailDetails(row)
  const team = t => d.players.filter(p => p.team === t).map(p => esc(p.name)).join(' &amp; ') || '—'
  const sets = textToScore(row.score).sets.map(([a, b], i) =>
    `<span style="display:inline-block;margin:2px;padding:4px 10px;border:1px solid #1B2E4B;border-radius:8px;font-weight:800">Set ${i + 1}: ${a}–${b}</span>`).join('')
  return `<p style="margin:0 0 6px"><b>${esc(d.slotRef)}</b> · ${esc(d.court)} · ${esc(d.date)} · ${esc(d.time)}</p>
    <p style="margin:0 0 12px">Team 1: <b>${team(1)}</b> vs Team 2: <b>${team(2)}</b></p><div style="margin-bottom:14px">${sets}</div>`
}
const OK_COLOR = '#6EE7B7', BAD_COLOR = '#FCA5A5'
const notOwnPage = row => scorePage('Waiting for the other players', `${matchHtml(row)}<p>You entered this score, so at least one player from each team has to confirm it.</p>`)
app.get('/api/score/confirm', async (req, res) => {
  try {
    const { row, n, error } = await scoreLinkRow(req.query)
    if (error) return res.status(400).send(scorePage('Link not valid', `<p>${esc(error)}</p>`, BAD_COLOR))
    if (row.score_status !== 'pending') return res.send(scorePage('Score already confirmed ✓', matchHtml(row), OK_COLOR))
    if (scoreConfirmers(row).includes(n))
      return res.send(scorePage('You already confirmed ✓', `${matchHtml(row)}<p>Waiting for a player of <b>${teamsStillToConfirm(row)}</b> to confirm.</p>`, OK_COLOR))
    if (n === row.score_by) return res.send(notOwnPage(row))
    const action = `/api/score/confirm?s=${row.id}&p=${n}&t=${encodeURIComponent(req.query.t)}`
    res.send(scorePage('Confirm the match score', `${matchHtml(row)}
      <form method="post" action="${esc(action)}" style="margin:0;text-align:center">
        <button type="submit" style="background:#1B2E4B;color:#fff;border:0;font-weight:800;font-size:15px;padding:12px 28px;border-radius:10px;cursor:pointer">Yes, the score is correct</button>
      </form>
      <p style="margin:12px 0 0;font-size:12px;color:#94A3B8;text-align:center">Score not right? Close this page and correct it from My Bookings.</p>`))
  } catch (err) {
    console.error(err)
    res.status(500).send(scorePage('Something went wrong', '<p>Please try again later.</p>', BAD_COLOR))
  }
})
app.post('/api/score/confirm', async (req, res) => {
  try {
    const { row, n, error } = await scoreLinkRow(req.query)
    if (error) return res.status(400).send(scorePage('Link not valid', `<p>${esc(error)}</p>`, BAD_COLOR))
    if (n === row.score_by) return res.status(403).send(notOwnPage(row))
    const updated = await confirmScore(row.id, n)
    if (updated.score_status === 'pending')
      return res.send(scorePage('Thank you — confirmation saved ✓', `${matchHtml(updated)}<p>The score is confirmed once a player of <b>${teamsStillToConfirm(updated)}</b> confirms it too.</p>`, OK_COLOR))
    res.send(scorePage('Score confirmed ✓', `${matchHtml(updated)}<p>Thank you! Both teams confirmed — the score now shows as <b>Confirmed</b> in My Bookings.</p>`, OK_COLOR))
  } catch (err) {
    console.error(err)
    res.status(500).send(scorePage('Something went wrong', '<p>Please try again later.</p>', BAD_COLOR))
  }
})

// ── Events & tournaments ──
const EVENT_TYPES = ['tournament', 'event']
const EVENT_STATUSES = ['open', 'full', 'closed']
const eventRow = r => ({
  id: String(r.id), title: r.title, type: r.type, date: r.date,
  startTime: r.start_time ? r.start_time.slice(0, 5) : '', endTime: r.end_time ? r.end_time.slice(0, 5) : '',
  venue: r.venue || '', entryFee: r.entry_fee != null ? Number(r.entry_fee) : null,
  maxTeams: r.max_teams, description: r.description || '', status: r.status,
})

// Check and clean an event from the admin form → [values, error]
function eventInput(b = {}) {
  const title = String(b.title || '').trim().slice(0, 120)
  if (!title) return [null, 'Please enter a title.']
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) return [null, 'Please choose a date.']
  const time = t => (t && /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : null)
  const fee = b.entryFee === '' || b.entryFee == null ? null : Number(b.entryFee)
  const teams = b.maxTeams === '' || b.maxTeams == null ? null : Number(b.maxTeams)
  if (fee != null && (!Number.isFinite(fee) || fee < 0)) return [null, 'Entry fee must be a positive number.']
  if (teams != null && (!Number.isInteger(teams) || teams < 1)) return [null, 'Max teams must be a whole number.']
  return [[title, EVENT_TYPES.includes(b.type) ? b.type : 'tournament', b.date, time(b.startTime), time(b.endTime),
    String(b.venue || '').trim().slice(0, 80) || null, fee, teams,
    String(b.description || '').trim().slice(0, 500) || null, EVENT_STATUSES.includes(b.status) ? b.status : 'open'], null]
}

// Public: upcoming events (today onwards)
app.get('/api/events', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM events WHERE date >= CURDATE() AND status <> 'closed' ORDER BY date, start_time LIMIT 12")
    res.json({ events: rows.map(eventRow) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not load events.' })
  }
})

// Admin: all events, add, edit, delete
app.get('/api/admin/events', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  const [rows] = await pool.query('SELECT * FROM events ORDER BY date DESC, start_time')
  res.json({ events: rows.map(eventRow) })
})
app.post('/api/admin/events', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  const [values, error] = eventInput(req.body)
  if (error) return res.status(400).json({ error })
  const [r] = await pool.query(
    'INSERT INTO events (title, type, date, start_time, end_time, venue, entry_fee, max_teams, description, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', values)
  const [[row]] = await pool.query('SELECT * FROM events WHERE id = ?', [r.insertId])
  res.status(201).json({ event: eventRow(row) })
})
app.put('/api/admin/events/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  const [values, error] = eventInput(req.body)
  if (error) return res.status(400).json({ error })
  await pool.query(
    'UPDATE events SET title = ?, type = ?, date = ?, start_time = ?, end_time = ?, venue = ?, entry_fee = ?, max_teams = ?, description = ?, status = ? WHERE id = ?',
    [...values, req.params.id])
  const [[row]] = await pool.query('SELECT * FROM events WHERE id = ?', [req.params.id])
  if (!row) return res.status(404).json({ error: 'Event not found.' })
  res.json({ event: eventRow(row) })
})
app.delete('/api/admin/events/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  await pool.query('DELETE FROM events WHERE id = ?', [req.params.id])
  res.json({ ok: true })
})

// ── Admin ──
// Body: { email, password }
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_EMAILS.length || !ADMIN_PASSWORD) return res.status(500).json({ error: 'Admin login is not set up (ADMIN_EMAIL / ADMIN_PASSWORD in .env).' })
  const same = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b))
    return x.length === y.length && crypto.timingSafeEqual(x, y)
  }
  const given = String(req.body?.email || '').trim().toLowerCase()
  const emailOk = ADMIN_EMAILS.some(e => same(given, e))
  const passOk = same(req.body?.password || '', ADMIN_PASSWORD)
  if (!emailOk || !passOk) return res.status(401).json({ error: 'Incorrect email or password. Please try again.' })
  res.json({ adminToken: adminToken() })
})

app.get('/api/admin/slots', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  try {
    const [rows] = await pool.query('SELECT * FROM slot ORDER BY created_at DESC, id DESC')
    res.json({ bookings: rows.map(slotToBooking) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not load bookings.' })
  }
})

app.post('/api/admin/slots/:id/status', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  const status = req.body?.status
  if (!['confirmed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status.' })
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query('SELECT * FROM slot WHERE id = ? FOR UPDATE', [req.params.id])
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Booking not found.' }) }
    if (row.status === status) { await conn.rollback(); return res.json({ ok: true }) }
    if (status === 'confirmed') {
      // Restoring: the time must still be free
      const s = timeToHour(row.time), e = timeToHour(row.end_time) ?? s + (row.hour || 1)
      const [others] = await conn.query(
        "SELECT time, end_time, hour FROM slot WHERE date = ? AND court_id = ? AND status <> 'cancelled' AND id <> ?", [row.date, row.court_id, row.id])
      if (others.some(o => { const os = timeToHour(o.time), oe = timeToHour(o.end_time) ?? os + (o.hour || 1); return s < oe && e > os })) {
        await conn.rollback(); return res.status(409).json({ error: 'Can\'t restore: that time has been booked by someone else.' })
      }
    }
    await conn.query('UPDATE slot SET status = ? WHERE id = ?', [status, row.id])
    const credit = status === 'cancelled' ? await refundToCredit(conn, row) : -(await reverseRefund(conn, row))
    await conn.commit()
    res.json({ ok: true, credit })
  } catch (err) {
    await conn.rollback().catch(() => {})
    console.error(err)
    res.status(500).json({ error: 'Could not update the booking.' })
  } finally { conn.release() }
})

// Advance balance + history for the logged-in member
app.get('/api/credit', async (req, res) => {
  const userId = currentUserId(req)
  if (!userId) return res.status(401).json({ error: 'Please log in again.', relogin: true })
  const [history] = await pool.query(
    'SELECT amount, reason, slot_id, created_at FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 20', [userId])
  res.json({ balance: await creditBalance(pool, userId), history: history.map(h => ({ ...h, amount: Number(h.amount) })) })
})

// Booking details for the emails, from a saved slot row ("Sat, 17 October 2026", "6pm–7pm")
const hourText = h => { const x = ((h % 24) + 24) % 24; return `${x % 12 || 12}${x < 12 ? 'am' : 'pm'}` }
function slotEmailDetails(row) {
  const b = slotToBooking(row)
  const d = new Date(`${b.date}T00:00`)
  const date = isNaN(d) ? String(b.date) : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
  const hours = b.endHour - b.startHour
  return {
    slotRef: b.slotRef, court: b.courtName, date, time: `${hourText(b.startHour)}–${hourText(b.endHour)}`,
    duration: `${hours} ${hours === 1 ? 'hour' : 'hours'}`,
    total: b.payment != null ? `Rs. ${Number(b.payment).toLocaleString()}` : null,
    players: b.players.map(p => ({ name: p.name, cmNo: p.cmNo, team: p.team })),
  }
}

// Body: { received: true | false } — admin approves (or un-approves) the booking's payment.
// Approving sends the "booking confirmed" email to every registered player.
app.post('/api/admin/slots/:id/payment', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  const received = req.body?.received === true
  try {
    const [[before]] = await pool.query('SELECT payment_received FROM slot WHERE id = ?', [req.params.id])
    if (!before) return res.status(404).json({ error: 'Booking not found.' })
    await pool.query('UPDATE slot SET payment_received = ?, payment_received_at = ? WHERE id = ?',
      [received ? 1 : 0, received ? new Date() : null, req.params.id])
    const [[row]] = await pool.query('SELECT * FROM slot WHERE id = ?', [req.params.id])
    let emails = null
    if (received && !before.payment_received && row.status !== 'cancelled') {
      const [[booker]] = row.user_id ? await pool.query('SELECT * FROM padalcreate WHERE id = ?', [row.user_id]) : [[null]]
      emails = await emailBookingPlayers(slotEmailDetails(row), booker, 'confirmed')
        .catch(err => { console.error('Confirmed emails failed:', err.message); return { sent: [], skipped: [], error: true } })
    }
    res.json({ booking: slotToBooking(row), emails })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not update the payment.' })
  }
})

app.delete('/api/admin/slots/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  await pool.query('DELETE FROM slot WHERE id = ?', [req.params.id])
  res.json({ ok: true })
})

// Health check (Render → Settings → Health Check Path: /api/health)
app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, database: DB_NAME }) }
  catch (err) { res.status(500).json({ ok: false, error: err.code || 'database error' }) }
})

app.listen(PORT, () => console.log(`API server on http://localhost:${PORT} (database: ${DB_NAME})`))
