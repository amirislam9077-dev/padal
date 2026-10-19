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
const NO_ACCOUNT = 'No account found with this User ID. Please sign up first, then sign in.'
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
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || process.env.ADMIN_EMAIL

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
      username VARCHAR(30) NULL,                  -- "User ID", unique
      membership_no VARCHAR(20) NOT NULL, -- shared by family members
      email_address VARCHAR(255) NOT NULL,        -- may be shared by family members
      phone_number VARCHAR(20) NOT NULL,          -- may be shared by family members
      date_of_birth DATE NULL,
      picture VARCHAR(255) NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_member_name (membership_no, full_name),
      KEY idx_email (email_address),
      UNIQUE KEY uniq_username (username)
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
  // Signup: User ID (unique, NULL for accounts made before it existed) and date of birth
  const [accCols] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'padalcreate'")
  const accHave = new Set(accCols.map(c => c.COLUMN_NAME))
  if (!accHave.has('username'))
    await pool.query('ALTER TABLE padalcreate ADD COLUMN username VARCHAR(30) NULL AFTER full_name, ADD UNIQUE KEY uniq_username (username)')
  // Signup: the same full name may be registered more than once on a membership (was unique before)
  const [nameIdx] = await pool.query("SHOW INDEX FROM padalcreate WHERE Key_name = 'uniq_member_name'")
  if (nameIdx.length)
    await pool.query('ALTER TABLE padalcreate DROP INDEX uniq_member_name, ADD INDEX idx_member_name (membership_no, full_name)')
  if (!accHave.has('date_of_birth'))
    await pool.query('ALTER TABLE padalcreate ADD COLUMN date_of_birth DATE NULL AFTER phone_number')
  // Signup approval: new accounts wait as 'pending' until the admin approves them (older accounts count as approved)
  if (!accHave.has('status'))
    await pool.query("ALTER TABLE padalcreate ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'approved' AFTER password_hash")
  // Member dues (Rs.), entered by the admin; at or above DUES_LIMIT the member can't book
  if (!accHave.has('dues'))
    await pool.query('ALTER TABLE padalcreate ADD COLUMN dues DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER status')
  // Suspended by the admin: the member can't book
  if (!accHave.has('suspended'))
    await pool.query('ALTER TABLE padalcreate ADD COLUMN suspended TINYINT(1) NOT NULL DEFAULT 0 AFTER dues')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      email VARCHAR(150) PRIMARY KEY,
      code_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      sent_at DATETIME NOT NULL
    )
  `)
  // A time a member has picked and is still booking ("processing"): others can't pick it until it's
  // booked, released, or the hold runs out (renewed every minute while the booking page is open)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slot_holds (
      court_id VARCHAR(20) NOT NULL,
      date DATE NOT NULL,
      hour TINYINT NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      expires_at DATETIME NOT NULL,
      PRIMARY KEY (court_id, date, hour),
      KEY idx_hold_user (user_id)
    )
  `)
  // Expense vouchers entered by the admin (salary, electricity, maintenance …) — used by Profit & Loss
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      date DATE NOT NULL,
      category VARCHAR(50) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      paid_to VARCHAR(100) NULL,
      method VARCHAR(30) NULL,
      notes VARCHAR(255) NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_voucher_date (date)
    )
  `)
  // Admin-added choices for the voucher form: kind 'category' (Salary, …) or 'payee' (Secretary, …)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voucher_options (
      id INT AUTO_INCREMENT PRIMARY KEY,
      kind VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_option (kind, name)
    )
  `)
  // Cheque number when a voucher is paid by cheque
  const [vCols] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vouchers'")
  if (!vCols.some(c => c.COLUMN_NAME === 'cheque_no'))
    await pool.query('ALTER TABLE vouchers ADD COLUMN cheque_no VARCHAR(30) NULL AFTER method')
  // Voucher reference no. (VCH-2026-0005): made when the voucher is saved, unique, never changes
  if (!vCols.some(c => c.COLUMN_NAME === 'voucher_no'))
    await pool.query('ALTER TABLE vouchers ADD COLUMN voucher_no VARCHAR(20) NULL AFTER id, ADD UNIQUE KEY uniq_voucher_no (voucher_no)')
  await pool.query("UPDATE vouchers SET voucher_no = CONCAT('VCH-', YEAR(COALESCE(created_at, NOW())), '-', LPAD(id, 4, '0')) WHERE voucher_no IS NULL")
  if (!vCols.some(c => c.COLUMN_NAME === 'bank_name'))
    await pool.query('ALTER TABLE vouchers ADD COLUMN bank_name VARCHAR(60) NULL AFTER cheque_no')
  // Forgot User ID / Forgot password codes (kept apart from signup codes so the two never overwrite each other)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recovery_codes (
      email VARCHAR(255) PRIMARY KEY,
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
  return { id: String(row.id), name: row.full_name, username: row.username, dob: row.date_of_birth, email: row.email_address, phone: row.phone_number, membershipNo: row.membership_no, picture: row.picture, token: signToken(row.id) }
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

// User ID: 3–30 letters, numbers, dot or underscore (unique; the collation ignores upper/lower case)
const USERNAME_RE = /^[A-Za-z0-9._]{3,30}$/
const USERNAME_RULE = 'User ID must be 3–30 letters, numbers, dots or underscores (no spaces).'
const USERNAME_TAKEN = 'This User ID is already taken. Please choose another one.'

// "YYYY-MM-DD", a real date, not in the future and not before 1900
function validDob(dob) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return false
  const d = new Date(dob + 'T00:00:00Z')
  return !isNaN(d) && d.toISOString().slice(0, 10) === dob && dob >= '1900-01-01' && d <= new Date()
}

function validateSignup({ name, username, dob, email, phone, membershipNo, password }) {
  if (!name?.trim() || !username?.trim() || !dob || !email?.trim() || !phone?.trim() || !membershipNo?.trim() || !password) return 'Please fill in all required fields.'
  if (!USERNAME_RE.test(username.trim())) return USERNAME_RULE
  if (!validDob(dob)) return 'Please enter a valid date of birth.'
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

const usernameTaken = async username =>
  (await pool.query('SELECT 1 FROM padalcreate WHERE username = ?', [username.trim()]))[0].length > 0

// Live check from the signup form (is this User ID free?) and the login form (does it exist,
// and is that member under 18? Only the yes/no is sent, never the date of birth)
app.get('/api/check-username', async (req, res) => {
  const username = String(req.query.username || '').trim()
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: USERNAME_RULE })
  try {
    const [[row]] = await pool.query(
      'SELECT TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) AS age FROM padalcreate WHERE username = ?', [username])
    res.json({ taken: !!row, under18: row?.age != null && row.age < 18 })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not check User ID.' })
  }
})


app.post('/api/send-otp', async (req, res) => {
  const body = req.body || {}
  const invalid = validateSignup(body)
  if (invalid) return res.status(400).json({ error: invalid })
  const email = body.email.trim().toLowerCase()
  const phone = toE164(body.phone)

  try {
    if (await usernameTaken(body.username)) return res.status(409).json({ error: USERNAME_TAKEN, usernameTaken: true })

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
  const { name, username, dob, phone, membershipNo, password, otp } = body
  const invalid = validateSignup(body)
  if (invalid) return res.status(400).json({ error: invalid })
  if (!/^\d{6}$/.test(otp || '')) return res.status(400).json({ error: 'Please enter all 6 digits.', otpError: true })
  const email = body.email.trim().toLowerCase()
  const picture = body.picture ? parsePicture(body.picture) : null
  if (picture?.error) return res.status(400).json({ error: picture.error })

  try {
    if (await usernameTaken(username)) return res.status(409).json({ error: USERNAME_TAKEN, usernameTaken: true })

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
      "INSERT INTO padalcreate (full_name, username, membership_no, email_address, phone_number, date_of_birth, password_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
      [cleanName(name), username.trim(), membershipNo.trim(), email, toE164(phone), dob, hash]
    )
    await pool.query('DELETE FROM otp_codes WHERE email = ?', [email])
    if (picture) {
      const file = `${result.insertId}-${crypto.randomBytes(4).toString('hex')}.${picture.ext}`
      await fs.writeFile(path.join(UPLOADS_DIR, file), picture.buffer)
      await pool.query('UPDATE padalcreate SET picture = ? WHERE id = ?', [`/uploads/${file}`, result.insertId])
    }
    // No session yet: the member can sign in only after the admin approves the account
    res.status(201).json({ pending: true, email })
    notifyAdminOfSignup({ name: cleanName(name), username: username.trim(), membershipNo: membershipNo.trim(), email })
      .catch(err => console.error('New-signup email to admin failed:', err))
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: USERNAME_TAKEN, usernameTaken: true }) // User ID is the only unique field left
    console.error(err)
    res.status(500).json({ error: 'Could not create account. Please try again.' })
  }
})

app.post('/api/login', async (req, res) => {
  const userId = String(req.body?.userId || '').trim()
  const { password } = req.body || {}
  if (!userId || !password)
    return res.status(400).json({ error: 'Please enter your User ID and password.' })
  if (!USERNAME_RE.test(userId)) return res.status(400).json({ error: USERNAME_RULE })
  try {
    const [[row]] = await pool.query('SELECT * FROM padalcreate WHERE username = ?', [userId])
    if (!row)
      return res.status(404).json({ error: NO_ACCOUNT, noAccount: true })
    if (!(await bcrypt.compare(password, row.password_hash)))
      return res.status(401).json({ error: 'Incorrect password. Please try again.' })
    if (row.status === 'pending')
      return res.status(403).json({ error: 'Your sign-up is waiting for admin approval. You will get an email once it is approved.', pending: true })
    if (row.status === 'rejected')
      return res.status(403).json({ error: 'Your sign-up was not approved. Please contact the club office.', rejected: true })
    res.json({ user: toSession(row) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not sign in. Please try again.' })
  }
})

// ── Forgot User ID / Forgot password ───────────────────────────
// Both send a 6-digit code to the account's email. Forgot User ID: email → code → list of the
// accounts on that email (an account made before User IDs existed can set one here).
// Forgot password: User ID → code (to that account's email) → new password.
const maskEmail = email => email[0] + '***@' + email.split('@')[1]

async function sendRecoveryCode(email) {
  const [recent] = await pool.query(
    'SELECT 1 FROM recovery_codes WHERE email = ? AND sent_at > NOW() - INTERVAL ? SECOND', [email, OTP_RESEND_SECONDS])
  if (recent.length) return `Please wait ${OTP_RESEND_SECONDS} seconds before requesting a new code.`
  const code = String(crypto.randomInt(100000, 1000000))
  await sendMail({
    to: email,
    subject: `Your NNG Trust account recovery code: ${code}`,
    text: `Your NNG Trust account recovery code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.\n\nIf you did not ask for this, you can ignore this email.`,
  })
  await pool.query(
    `REPLACE INTO recovery_codes (email, code_hash, expires_at, attempts, sent_at)
     VALUES (?, ?, NOW() + INTERVAL ? MINUTE, 0, NOW())`,
    [email, await bcrypt.hash(code, 10), OTP_TTL_MINUTES])
  return null
}

// Returns an error message, or null when the code is right (the code stays valid until it expires)
async function checkRecoveryCode(email, code) {
  if (!/^\d{6}$/.test(code || '')) return 'Please enter the 6-digit code.'
  const [[row]] = await pool.query('SELECT * FROM recovery_codes WHERE email = ? AND expires_at > NOW()', [email])
  if (!row || row.attempts >= OTP_MAX_ATTEMPTS) return 'Code expired. Please request a new code.'
  if (!(await bcrypt.compare(code, row.code_hash))) {
    await pool.query('UPDATE recovery_codes SET attempts = attempts + 1 WHERE email = ?', [email])
    return 'Incorrect code. Please try again.'
  }
  return null
}

const cleanEmail = email => String(email || '').trim().toLowerCase()
const accountsByEmail = async email =>
  (await pool.query('SELECT id, full_name, membership_no, username FROM padalcreate WHERE email_address = ? ORDER BY id', [email]))[0]
    .map(r => ({ id: String(r.id), name: r.full_name, membershipNo: r.membership_no, username: r.username }))

// Body: { email } (forgot User ID) or { userId } (forgot password) → { sentTo: masked email }
app.post('/api/forgot/send-code', async (req, res) => {
  const { email: rawEmail, userId: rawUserId } = req.body || {}
  try {
    let email
    if (rawUserId !== undefined) {
      const userId = String(rawUserId).trim()
      if (!USERNAME_RE.test(userId)) return res.status(400).json({ error: USERNAME_RULE })
      const [[row]] = await pool.query('SELECT email_address FROM padalcreate WHERE username = ?', [userId])
      if (!row) return res.status(404).json({ error: NO_ACCOUNT, noAccount: true })
      email = row.email_address
    } else {
      email = cleanEmail(rawEmail)
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' })
      if (!(await accountsByEmail(email)).length)
        return res.status(404).json({ error: 'No account found with this email.', noAccount: true })
    }
    const wait = await sendRecoveryCode(email)
    if (wait) return res.status(429).json({ error: wait })
    res.json({ sentTo: maskEmail(email) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not send the code. Please try again.' })
  }
})

// Body: { email, code } → { accounts: [{ id, name, membershipNo, username }] }
app.post('/api/forgot/accounts', async (req, res) => {
  const email = cleanEmail(req.body?.email)
  try {
    const wrong = await checkRecoveryCode(email, req.body?.code)
    if (wrong) return res.status(400).json({ error: wrong })
    res.json({ accounts: await accountsByEmail(email) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not look up your accounts. Please try again.' })
  }
})

// Body: { email, code, id, username } → { accounts } — gives a User ID to an account that has none
app.post('/api/forgot/set-userid', async (req, res) => {
  const email = cleanEmail(req.body?.email)
  const username = String(req.body?.username || '').trim()
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: USERNAME_RULE })
  try {
    const wrong = await checkRecoveryCode(email, req.body?.code)
    if (wrong) return res.status(400).json({ error: wrong })
    const [result] = await pool.query(
      'UPDATE padalcreate SET username = ? WHERE id = ? AND email_address = ? AND username IS NULL',
      [username, Number(req.body?.id), email])
    if (!result.affectedRows) return res.status(400).json({ error: 'This account already has a User ID.' })
    res.json({ accounts: await accountsByEmail(email) })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: USERNAME_TAKEN, usernameTaken: true })
    console.error(err)
    res.status(500).json({ error: 'Could not save the User ID. Please try again.' })
  }
})

// Body: { userId, code, password } → { user } (signed in with the new password)
app.post('/api/forgot/reset-password', async (req, res) => {
  const userId = String(req.body?.userId || '').trim()
  const { password } = req.body || {}
  if (!USERNAME_RE.test(userId)) return res.status(400).json({ error: USERNAME_RULE })
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' })
  try {
    const [[row]] = await pool.query('SELECT * FROM padalcreate WHERE username = ?', [userId])
    if (!row) return res.status(404).json({ error: NO_ACCOUNT, noAccount: true })
    const wrong = await checkRecoveryCode(row.email_address, req.body?.code)
    if (wrong) return res.status(400).json({ error: wrong })
    await pool.query('UPDATE padalcreate SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 10), row.id])
    await pool.query('DELETE FROM recovery_codes WHERE email = ?', [row.email_address])
    // Not signed in until the admin has approved the account
    if (row.status === 'pending')
      return res.status(403).json({ error: 'Your password has been changed, but your sign-up is still waiting for admin approval. You can sign in once it is approved.', pending: true })
    if (row.status === 'rejected')
      return res.status(403).json({ error: 'Your password has been changed, but your sign-up was not approved. Please contact the club office.', rejected: true })
    res.json({ user: toSession(row) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not reset your password. Please try again.' })
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
       WHERE status = 'approved' AND ${req.query.u18 === '1' ? 'date_of_birth IS NOT NULL AND TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) < 18 AND ' : ''}${column} LIKE ?
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

// Website address used in emails (sign-in link)
const SITE_URL = (process.env.SITE_URL || 'https://padal-olive.vercel.app').replace(/\/+$/, '')

// A new member signed up: let the admin(s) know there is a sign-up to approve
async function notifyAdminOfSignup({ name, username, membershipNo, email }) {
  if (!ADMIN_EMAILS.length) return
  const text = `New sign-up waiting for approval:\n\nName: ${name}\nUser ID: ${username}\nMembership No.: ${membershipNo}\nEmail: ${email}\n\n`
    + `Approve or reject it in the admin panel → Signed-up Members: ${SITE_URL}/admin/members`
  await Promise.all(ADMIN_EMAILS.map(to => sendMail({ to, subject: `New sign-up to approve: ${name} (${membershipNo})`, text })))
}

// Tells the member their sign-up was approved (they can sign in and book) or not approved
async function sendSignupDecision(row, status) {
  const approved = status === 'approved'
  const subject = approved ? 'Your NNG Trust sign-up is approved' : 'Your NNG Trust sign-up was not approved'
  const text = approved
    ? `Dear ${row.full_name},\n\nYour sign-up for NNG Trust Padel has been approved. You can now sign in with your User ID (${row.username}) and start booking courts.\n\nSign in: ${SITE_URL}/login\n\nNorth Nazimabad Gymkhana Trust`
    : `Dear ${row.full_name},\n\nSorry, your sign-up for NNG Trust Padel was not approved. Please contact the club office for details.\n\nNorth Nazimabad Gymkhana Trust`
  await sendMail({ to: row.email_address, subject, text })
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
// Password asked again before the admin edits or deletes a booking or a member
// (ADMIN_ACTION_PASSWORD in .env; the admin login password when it isn't set)
const ACTION_PASSWORD = process.env.ADMIN_ACTION_PASSWORD || ADMIN_PASSWORD
function actionPasswordOk(req) {
  const given = Buffer.from(String(req.get('x-admin-password') || req.body?.password || ''))
  const expected = Buffer.from(ACTION_PASSWORD)
  return !!ACTION_PASSWORD && given.length === expected.length && crypto.timingSafeEqual(given, expected)
}
const WRONG_PASSWORD = { error: 'Incorrect password. The change was not made.', badPassword: true }
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

// Booked hours for one court on one date (public: no names), plus hours another member is
// booking right now ("held"; the asking member's own hold is left out)
app.get('/api/slots/booked', async (req, res) => {
  const { date, court } = req.query
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !court) return res.status(400).json({ error: 'date and court are required.' })
  try {
    const [rows] = await pool.query(
      "SELECT time, end_time, hour FROM slot WHERE date = ? AND court_id = ? AND status <> 'cancelled'", [date, String(court)])
    const [holds] = await pool.query(
      'SELECT hour FROM slot_holds WHERE court_id = ? AND date = ? AND expires_at > NOW() AND user_id <> ?',
      [String(court), date, currentUserId(req) || 0])
    res.json({
      booked: rows.map(r => ({ startHour: timeToHour(r.time), endHour: timeToHour(r.end_time) ?? timeToHour(r.time) + (r.hour || 1) })),
      held: holds.map(h => h.hour),
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not load booked slots.' })
  }
})

// Booked hours on every court between two dates (public: no names) — for the "Balance Booking Slots" report.
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (at most 62 days) → { booked: [{ date, courtId, startHour, endHour }] }
app.get('/api/slots/availability', async (req, res) => {
  const { from, to } = req.query
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to)
    return res.status(400).json({ error: 'Please choose a valid date range.' })
  if ((new Date(to) - new Date(from)) / 86400000 > 62) return res.status(400).json({ error: 'Please choose at most 2 months.' })
  try {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d, court_id, time, end_time, hour FROM slot
       WHERE date BETWEEN ? AND ? AND status <> 'cancelled'`, [from, to])
    res.json({ booked: rows.map(r => ({ date: r.d, courtId: String(r.court_id), startHour: timeToHour(r.time),
      endHour: timeToHour(r.end_time) ?? timeToHour(r.time) + (r.hour || 1) })) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not load the slots.' })
  }
})

// ── Slot holds ("processing") ──────────────────────────────────
const HOLD_MINUTES = 5
const PROCESSING = 'This time is in processing — another member is booking it right now. Please choose another time or try again in a few minutes.'

// Hours [start, end) on this court/date held by someone other than userId (pass a transaction to lock them)
async function heldByOthers(db, courtId, date, start, end, userId, lock = false) {
  const [rows] = await db.query(
    `SELECT hour FROM slot_holds WHERE court_id = ? AND date = ? AND hour >= ? AND hour < ? AND user_id <> ? AND expires_at > NOW()${lock ? ' FOR UPDATE' : ''}`,
    [String(courtId), date, start, end, userId])
  return rows.length > 0
}

// Hold (or renew the hold on) the time the member has picked. Body: { courtId, date, startHour, hours }
// Picking a new time releases the member's old hold. → { ok } or 409 { processing }
app.post('/api/slots/hold', async (req, res) => {
  const userId = currentUserId(req)
  if (!userId) return res.status(401).json({ error: 'Please log in again to book.', relogin: true })
  const b = req.body || {}
  const start = Number(b.startHour), hours = Number(b.hours)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !b.courtId || !Number.isInteger(start) || ![1, 2, 3].includes(hours))
    return res.status(400).json({ error: 'Please choose a court, date and time.' })
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM slot_holds WHERE expires_at <= NOW()')
    if (await heldByOthers(conn, b.courtId, b.date, start, start + hours, userId, true)) {
      await conn.rollback(); return res.status(409).json({ error: PROCESSING, processing: true })
    }
    await conn.query('DELETE FROM slot_holds WHERE user_id = ?', [userId])
    for (let h = start; h < start + hours; h++)
      await conn.query('INSERT INTO slot_holds (court_id, date, hour, user_id, expires_at) VALUES (?, ?, ?, ?, NOW() + INTERVAL ? MINUTE)',
        [String(b.courtId), b.date, h, userId, HOLD_MINUTES])
    await conn.commit()
    res.json({ ok: true })
  } catch (err) {
    await conn.rollback().catch(() => {})
    // Two members clicked the same free hour at the same moment: the second one loses
    if (err.code === 'ER_DUP_ENTRY' || err.code === 'ER_LOCK_DEADLOCK') return res.status(409).json({ error: PROCESSING, processing: true })
    console.error(err)
    res.status(500).json({ error: 'Could not reserve this time. Please try again.' })
  } finally {
    conn.release()
  }
})

// Let go of the member's hold (picked another date/court, or left the page)
app.delete('/api/slots/hold', async (req, res) => {
  const userId = currentUserId(req)
  if (!userId) return res.status(401).json({ error: 'Please log in again.', relogin: true })
  try {
    await pool.query('DELETE FROM slot_holds WHERE user_id = ?', [userId])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not release the time.' })
  }
})

// The same time slot (e.g. 8–9 PM) can be booked at most twice per week (Monday–Sunday, by the slot's date)
// by one member — both courts counted together. Each time slot has its own limit. Cancelled bookings don't
// count; excludeId = the booking being edited. Returns an error message, or null.
const SAME_TIME_PER_WEEK = 2
async function weekLimitError(db, userId, date, start, excludeId = 0) {
  const [rows] = await db.query(
    `SELECT id, slot_ref, date, court FROM slot
     WHERE user_id = ? AND status <> 'cancelled' AND YEARWEEK(date, 1) = YEARWEEK(?, 1) AND time = ? AND id <> ?
     ORDER BY date FOR UPDATE`, [userId, date, hourToTime(start), excludeId])
  if (rows.length < SAME_TIME_PER_WEEK) return null
  const list = rows.map(r => {
    const d = new Date(`${r.date instanceof Date ? localDate(r.date) : String(r.date).slice(0, 10)}T00:00`)
    return `${r.slot_ref || slotRefFor(r.id)} ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`
  }).join(', ')
  return `You have already booked ${hourText(start)}–${hourText(start + 1)} ${rows.length === 2 ? 'twice' : `${rows.length} times`} this week (${list}). The same time can be booked only twice a week (Monday–Sunday). Please choose another time or another week.`
}

// The 4 players of a booking must be different people (same name + CM No. twice is refused).
// Returns the repeated player's name, or null.
function duplicatePlayer(players) {
  const seen = new Set()
  for (const p of players) {
    const key = `${cleanName(p.name).toLowerCase()}|${String(p.cmNo || '').trim().toUpperCase()}`
    if (seen.has(key)) return cleanName(p.name)
    seen.add(key)
  }
  return null
}

// Member dues (entered by the admin on Signed-up Members): at or above this amount the member can't make a new booking
const DUES_LIMIT = 20000
const duesText = dues => `Your booking cannot be made because you have payment dues of Rs. ${Number(dues).toLocaleString('en-US')}. Please clear your dues with the club office, then book again.`
const SUSPENDED_TEXT = 'Your booking cannot be made because your membership is suspended. Please contact the club office.'
// { dues, suspended } of a member — either one can block new bookings
async function memberBlock(userId) {
  const [[row]] = await pool.query('SELECT dues, suspended FROM padalcreate WHERE id = ?', [userId])
  return { dues: Number(row?.dues || 0), suspended: !!row?.suspended }
}

// 3pm–6pm is for under-18 members only (age from date_of_birth in padalcreate; no date of birth = not allowed)
const KIDS_ONLY = 'You are not applicable to book this slot. Only under-18 players can book this slot.'
async function adultInKidsTime(userId, start, hours) {
  if (!kidsFreeHours(start, hours)) return false
  const [[row]] = await pool.query(
    'SELECT TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) AS age FROM padalcreate WHERE id = ?', [userId])
  return !(row?.age != null && row.age < 18)
}

// Under-18 free time: every player must be a registered member under 18 (found by name + CM No.).
// Returns the name of the first player who isn't, or null.
async function adultPlayerInKidsTime(players, start, hours) {
  if (!kidsFreeHours(start, hours)) return null
  for (const p of players) {
    const [[row]] = await pool.query(
      `SELECT TIMESTAMPDIFF(YEAR, date_of_birth, CURDATE()) AS age FROM padalcreate
       WHERE membership_no = ? AND full_name = ? AND status = 'approved' ORDER BY (date_of_birth IS NULL) LIMIT 1`,
      [String(p.cmNo || '').trim().toUpperCase(), cleanName(String(p.name || ''))])
    if (!(row?.age != null && row.age < 18)) return cleanName(String(p.name || ''))
  }
  return null
}
const kidsPlayerText = name => `${name} is not under 18. In the under-18 free time (3pm–6pm) all 4 players must be under-18 members.`

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
  try {
    const { dues, suspended } = await memberBlock(userId)
    if (suspended) return res.status(403).json({ error: SUSPENDED_TEXT, suspended: true })
    if (dues >= DUES_LIMIT) return res.status(403).json({ error: duesText(dues), duesBlocked: true })
    if (await adultInKidsTime(userId, start, hours)) return res.status(403).json({ error: KIDS_ONLY, kidsOnly: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Could not save the booking. Please try again.' })
  }
  // Price is worked out here, not trusted from the browser
  // Only under-18 members can get this far with 3pm–6pm hours (adultInKidsTime above), so those hours are always free
  const freeHours = kidsFreeHours(start, hours)
  const junior = freeHours > 0 // only marked under-18 when free hours actually apply
  const payment = (hours - freeHours) * RATE_PER_HOUR
  const slip = b.depositSlip && String(b.depositSlip).startsWith('/uploads/slips/') ? b.depositSlip : null
  // Bank / transfer reference of the deposit slip (optional — the booking form no longer asks for it)
  const refNo = String(b.referenceNo || '').trim().slice(0, 50) || null
  const bank = String(b.bankName || '').trim().slice(0, 60) || null
  const players = Array.isArray(b.players) ? b.players.filter(p => p?.name?.trim()).slice(0, 4) : []
  if (!players.length) return res.status(400).json({ error: 'Please add at least one player.' })
  // Padel is 2 vs 2: members must enter all 4 players, each with a CM No.
  if (players.length < 4 || players.some(p => !String(p.cmNo || '').trim())) return res.status(400).json({ error: 'All 4 players are required — please enter the name and CM No. of each player.' })
  const twice = duplicatePlayer(players)
  if (twice) return res.status(400).json({ error: `${twice} is entered more than once. Each player must be a different person.` })
  try {
    const adult = await adultPlayerInKidsTime(players, start, hours)
    if (adult) return res.status(403).json({ error: kidsPlayerText(adult), kidsOnly: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Could not save the booking. Please try again.' })
  }

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
    if (await heldByOthers(conn, b.courtId, b.date, start, end, userId, true)) {
      await conn.rollback(); return res.status(409).json({ error: PROCESSING, processing: true })
    }
    // Same time slot at most twice a week per member (Monday–Sunday)
    const weekErr = await weekLimitError(conn, userId, b.date, start)
    if (weekErr) { await conn.rollback(); return res.status(409).json({ error: weekErr, weekLimit: true }) }

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
    await conn.query('DELETE FROM slot_holds WHERE user_id = ?', [userId]) // booked: no longer "processing"
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
  try {
    if (await adultInKidsTime(userId, start, hours)) return res.status(403).json({ error: KIDS_ONLY, kidsOnly: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Could not save the booking. Please try again.' })
  }
  // Only under-18 members can get this far with 3pm–6pm hours (adultInKidsTime above), so those hours are always free
  const freeHours = kidsFreeHours(start, hours)
  const junior = freeHours > 0
  const payment = (hours - freeHours) * RATE_PER_HOUR
  const slip = b.depositSlip && String(b.depositSlip).startsWith('/uploads/slips/') ? b.depositSlip : null
  // Bank / transfer reference of the deposit slip (optional — the booking form no longer asks for it)
  const refNo = String(b.referenceNo || '').trim().slice(0, 50) || null
  const bank = String(b.bankName || '').trim().slice(0, 60) || null
  const players = Array.isArray(b.players) ? b.players.filter(p => p?.name?.trim()).slice(0, 4) : []
  if (!players.length) return res.status(400).json({ error: 'Please add at least one player.' })
  // Padel is 2 vs 2: members must enter all 4 players, each with a CM No.
  if (players.length < 4 || players.some(p => !String(p.cmNo || '').trim())) return res.status(400).json({ error: 'All 4 players are required — please enter the name and CM No. of each player.' })
  const twice = duplicatePlayer(players)
  if (twice) return res.status(400).json({ error: `${twice} is entered more than once. Each player must be a different person.` })
  try {
    const adult = await adultPlayerInKidsTime(players, start, hours)
    if (adult) return res.status(403).json({ error: kidsPlayerText(adult), kidsOnly: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Could not save the booking. Please try again.' })
  }
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
    if (await heldByOthers(conn, b.courtId, b.date, start, end, userId, true)) {
      await conn.rollback(); return res.status(409).json({ error: PROCESSING, processing: true })
    }
    // Same time slot at most twice a week for whoever made this booking (this booking itself doesn't count)
    if (row.user_id) {
      const weekErr = await weekLimitError(conn, row.user_id, b.date, start, row.id)
      if (weekErr) { await conn.rollback(); return res.status(409).json({ error: weekErr, weekLimit: true }) }
    }

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
    // Moved to a free slot (under-18 kids time): nothing to pay, so it's confirmed straight away
    if (payment === 0) await conn.query('UPDATE slot SET payment_received = 1, payment_received_at = COALESCE(payment_received_at, NOW()) WHERE id = ?', [row.id])
    await conn.query('DELETE FROM slot_holds WHERE user_id = ?', [userId]) // saved: no longer "processing"
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
// Has this booking's start time (in Pakistan, UTC+5) arrived?
function matchStarted(row) {
  const day = row.date instanceof Date ? localDate(row.date) : String(row.date).slice(0, 10)
  const start = new Date(`${day}T${String(timeToHour(row.time)).padStart(2, '0')}:00:00+05:00`)
  return !isNaN(start) && start.getTime() <= Date.now()
}

app.post('/api/slots/:id/score', async (req, res) => {
  const sets = req.body?.sets
  if (sets !== null && !(Array.isArray(sets) && sets.length >= 1 && sets.length <= 3 &&
    sets.every(s => Array.isArray(s) && s.length === 2 && s.every(g => Number.isInteger(g) && g >= 0 && g <= 7) && s[0] !== s[1])))
    return res.status(400).json({ error: 'Invalid score.' })
  try {
    const row = await memberSlot(req, res)
    if (!row) return
    if (row.status === 'cancelled') return res.status(400).json({ error: 'Cancelled bookings can\'t have a score.' })
    // A score only once the match has started (Pakistan time, so it's right on a UTC server too)
    if (!matchStarted(row)) return res.status(400).json({ error: 'The score can be added once the match has started — this match hasn\'t been played yet.', notStarted: true })
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
  // dues / duesLimit / suspended: the booking page shows a "can't book" notice when the member is blocked
  const { dues, suspended } = await memberBlock(userId)
  res.json({ balance: await creditBalance(pool, userId), history: history.map(h => ({ ...h, amount: Number(h.amount) })),
    dues, duesLimit: DUES_LIMIT, suspended })
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

// Admin ledger: every booking from the slot table, plus the advance-balance ledger (credit_ledger)
// with each member's totals. → { bookings, entries, members }
app.get('/api/admin/ledger', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  try {
    const [rows] = await pool.query(
      `SELECT l.id, l.user_id, l.amount, l.reason, l.slot_id, l.created_at,
              p.full_name, p.username, p.membership_no, s.slot_ref
       FROM credit_ledger l
       LEFT JOIN padalcreate p ON p.id = l.user_id
       LEFT JOIN slot s ON s.id = l.slot_id
       ORDER BY l.id DESC`)
    const entries = rows.map(r => ({
      id: String(r.id), userId: String(r.user_id), name: r.full_name || `Member #${r.user_id}`, username: r.username,
      membershipNo: r.membership_no, amount: Number(r.amount), reason: r.reason,
      slotId: r.slot_id ? String(r.slot_id) : null, slotRef: r.slot_ref || (r.slot_id ? slotRefFor(r.slot_id) : null),
      createdAt: r.created_at,
    }))
    const byMember = new Map()
    for (const e of entries) {
      const m = byMember.get(e.userId) || { userId: e.userId, name: e.name, username: e.username, membershipNo: e.membershipNo, credited: 0, used: 0, balance: 0, count: 0 }
      if (e.amount > 0) m.credited += e.amount; else m.used += -e.amount
      m.balance += e.amount; m.count++
      byMember.set(e.userId, m)
    }
    // Every booking from the slot table (newest date first), with who booked it
    const [slots] = await pool.query(
      `SELECT s.*, p.full_name AS booker_name, p.username AS booker_username, p.membership_no AS booker_membership
       FROM slot s LEFT JOIN padalcreate p ON p.id = s.user_id
       ORDER BY s.date DESC, s.time DESC, s.id DESC`)
    const bookings = slots.map(r => ({
      ...slotToBooking(r),
      bookerName: r.booker_name || r.player1, bookerUsername: r.booker_username || null, bookerMembership: r.booker_membership || null,
    }))
    res.json({ bookings, entries, members: [...byMember.values()].sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name)) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not load the ledger.' })
  }
})

// ── Signed-up members (padalcreate) for the admin ──────────────
// Everything except the password, plus age (from date of birth) and how many bookings they made (not cancelled)
app.get('/api/admin/members', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.full_name, p.username, p.membership_no, p.email_address, p.phone_number, p.date_of_birth, p.picture, p.created_at, p.status, p.dues, p.suspended,
              TIMESTAMPDIFF(YEAR, p.date_of_birth, CURDATE()) AS age,
              (SELECT COUNT(*) FROM slot s WHERE s.user_id = p.id AND s.status <> 'cancelled') AS bookings
       FROM padalcreate p ORDER BY (p.status = 'pending') DESC, p.id DESC`)
    res.json({ members: rows.map(r => ({
      id: String(r.id), name: r.full_name, username: r.username || '', membershipNo: r.membership_no, email: r.email_address,
      phone: r.phone_number, dob: r.date_of_birth instanceof Date ? localDate(r.date_of_birth) : (r.date_of_birth ? String(r.date_of_birth).slice(0, 10) : ''),
      age: r.age == null ? null : Number(r.age), picture: r.picture || null, createdAt: r.created_at, bookings: Number(r.bookings),
      status: r.status || 'approved', dues: Number(r.dues || 0), suspended: !!r.suspended,
    })) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not load members.' })
  }
})

// Admin edits a member. Body: { name, username, membershipNo, email, phone, dob } — the password is not changed here.
app.put('/api/admin/members/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  if (!actionPasswordOk(req)) return res.status(403).json(WRONG_PASSWORD)
  const b = req.body || {}
  const name = cleanName(String(b.name || ''))
  const username = String(b.username || '').trim()
  const membershipNo = String(b.membershipNo || '').trim().toUpperCase()
  const email = String(b.email || '').trim().toLowerCase()
  const phone = toE164(String(b.phone || ''))
  const dob = String(b.dob || '').trim()
  if (!name) return res.status(400).json({ error: 'Please enter the full name.' })
  if (username && !USERNAME_RE.test(username)) return res.status(400).json({ error: USERNAME_RULE })
  if (!/^NNG-\d{1,16}$/.test(membershipNo)) return res.status(400).json({ error: 'Membership number must be NNG- followed by numbers.' })
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' })
  if (!/^\+\d{10,15}$/.test(phone)) return res.status(400).json({ error: 'Please enter a valid phone number.' })
  if (dob && !validDob(dob)) return res.status(400).json({ error: 'Please enter a valid date of birth.' })
  try {
    const [r] = await pool.query(
      'UPDATE padalcreate SET full_name = ?, username = ?, membership_no = ?, email_address = ?, phone_number = ?, date_of_birth = ? WHERE id = ?',
      [name.slice(0, 150), username || null, membershipNo, email, phone, dob || null, req.params.id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Member not found.' })
    res.json({ ok: true })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: USERNAME_TAKEN, usernameTaken: true })
    console.error(err)
    res.status(500).json({ error: 'Could not save the member.' })
  }
})

// The edit / delete password pop-up checks the password here first. Body: { password }
app.post('/api/admin/verify-password', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  if (!actionPasswordOk(req)) return res.status(403).json({ error: 'Incorrect password.', badPassword: true })
  res.json({ ok: true })
})

// Admin sets a member's dues (Rs.). Body: { dues } — at or above DUES_LIMIT the member can't make new bookings
app.put('/api/admin/members/:id/dues', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  const dues = Number(req.body?.dues)
  if (!Number.isFinite(dues) || dues < 0 || dues > 99999999) return res.status(400).json({ error: 'Please enter the dues as an amount of 0 or more.' })
  try {
    const [r] = await pool.query('UPDATE padalcreate SET dues = ? WHERE id = ?', [Math.round(dues * 100) / 100, req.params.id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Member not found.' })
    res.json({ ok: true, dues, blocked: dues >= DUES_LIMIT })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not save the dues.' })
  }
})

// Admin suspends / un-suspends a member. Body: { suspended: true | false } — a suspended member can't book
app.put('/api/admin/members/:id/suspend', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  const suspended = req.body?.suspended === true
  try {
    const [r] = await pool.query('UPDATE padalcreate SET suspended = ? WHERE id = ?', [suspended ? 1 : 0, req.params.id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Member not found.' })
    res.json({ ok: true, suspended })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not save the suspension.' })
  }
})

// Counts for the admin sidebar badges: sign-ups waiting for approval, and bookings whose payment
// isn't ticked as received yet ("Processing" — not cancelled)
app.get('/api/admin/counts', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  try {
    const [[m]] = await pool.query("SELECT COUNT(*) AS n FROM padalcreate WHERE status = 'pending'")
    const [[b]] = await pool.query("SELECT COUNT(*) AS n FROM slot WHERE status = 'confirmed' AND payment_received = 0")
    res.json({ pendingMembers: Number(m.n), processingBookings: Number(b.n) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not load the counts.' })
  }
})

// Admin approves or rejects a sign-up; the member gets an email either way.
// 'pending' (tick removed) puts the account back to waiting — no email, and the member can't sign in.
// Body: { status: 'approved' | 'rejected' | 'pending' }
app.post('/api/admin/members/:id/status', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  const status = req.body?.status
  if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'Status must be approved, rejected or pending.' })
  try {
    const [[row]] = await pool.query('SELECT * FROM padalcreate WHERE id = ?', [req.params.id])
    if (!row) return res.status(404).json({ error: 'Member not found.' })
    await pool.query('UPDATE padalcreate SET status = ? WHERE id = ?', [status, row.id])
    let emailed = true
    if (status !== 'pending')
      try { await sendSignupDecision(row, status) } catch (err) { emailed = false; console.error('Sign-up decision email failed:', err) }
    res.json({ ok: true, status, emailed })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not update the member.' })
  }
})

// Admin deletes a member's account. Their bookings and advance-balance history stay (as records);
// the booking still shows the player names typed on it.
app.delete('/api/admin/members/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  if (!actionPasswordOk(req)) return res.status(403).json(WRONG_PASSWORD)
  try {
    const [r] = await pool.query('DELETE FROM padalcreate WHERE id = ?', [req.params.id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Member not found.' })
    await pool.query('DELETE FROM slot_holds WHERE user_id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not delete the member.' })
  }
})

// ── Vouchers (expenses) ────────────────────────────────────────
// Reference no. stored in the database (voucher_no); the fallback only covers a row saved before it existed
const voucherNo = r => r.voucher_no || `VCH-${String(r.id).padStart(4, '0')}`
const toVoucher = r => ({
  id: String(r.id), voucherNo: voucherNo(r), date: r.date instanceof Date ? localDate(r.date) : String(r.date).slice(0, 10),
  category: r.category, amount: Number(r.amount), paidTo: r.paid_to || '', method: r.method || '', chequeNo: r.cheque_no || '', bankName: r.bank_name || '',
  notes: r.notes || '', createdAt: r.created_at,
})
const VOUCHER_METHODS = ['Cash', 'Cheque']
const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Body: { date (issue date), category, amount, paidTo, method: Cash | Cheque, chequeNo, notes } → error message or null
function voucherInvalid(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '')) return 'Please choose the issue date.'
  if (!String(v.category || '').trim()) return 'Please choose a category.'
  const amount = Number(v.amount)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999) return 'Please enter an amount greater than 0.'
  if (!String(v.paidTo || '').trim()) return 'Please enter who it is paid to.'
  if (!VOUCHER_METHODS.includes(v.method)) return 'Please choose Cash or Cheque.'
  if (v.method === 'Cheque' && !String(v.chequeNo || '').trim()) return 'Please enter the cheque number.'
  if (v.method === 'Cheque' && !String(v.bankName || '').trim()) return 'Please enter the bank name of the cheque.'
  return null
}
const voucherValues = v => [v.date, String(v.category).trim().slice(0, 50), Math.round(Number(v.amount) * 100) / 100,
  String(v.paidTo || '').trim().slice(0, 100) || null, v.method,
  v.method === 'Cheque' ? String(v.chequeNo).trim().toUpperCase().slice(0, 30) : null,
  v.method === 'Cheque' ? String(v.bankName).trim().slice(0, 60) : null, String(v.notes || '').trim().slice(0, 255) || null]

// Choices for the voucher form: built-in ones + ones the admin added + any already used on a voucher
const VOUCHER_DEFAULTS = {
  category: ['Salary', 'Maintenance', 'Entertainment', 'Electricity', 'Water', 'Equipment (balls, rackets)', 'Cleaning', 'Repairs', 'Rent', 'Internet / phone', 'Other'],
  payee: ['Secretary', 'Coach', 'Court attendant', 'Guard', 'Cleaner', 'Accountant', 'K-Electric', 'KWSC (water)'],
}
async function voucherOptions() {
  const [added] = await pool.query('SELECT kind, name FROM voucher_options ORDER BY name')
  const [used] = await pool.query('SELECT DISTINCT category, paid_to FROM vouchers')
  const list = (kind, extra) => {
    const seen = new Set(), out = []
    for (const n of [...VOUCHER_DEFAULTS[kind], ...added.filter(a => a.kind === kind).map(a => a.name), ...extra])
      if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n) }
    return out
  }
  return { categories: list('category', used.map(u => u.category)), payees: list('payee', used.map(u => u.paid_to)) }
}

app.get('/api/admin/voucher-options', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  try { res.json(await voucherOptions()) } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not load the lists.' })
  }
})

// Body: { kind: 'category' | 'payee', name } → { categories, payees }
app.post('/api/admin/voucher-options', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  const kind = req.body?.kind
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ')
  if (!['category', 'payee'].includes(kind)) return res.status(400).json({ error: 'Invalid list.' })
  if (!name || name.length > (kind === 'category' ? 50 : 100)) return res.status(400).json({ error: 'Please type a name (not too long).' })
  try {
    await pool.query('INSERT IGNORE INTO voucher_options (kind, name) VALUES (?, ?)', [kind, name])
    res.json(await voucherOptions())
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not add it. Please try again.' })
  }
})

app.get('/api/admin/vouchers', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  try {
    const [rows] = await pool.query('SELECT * FROM vouchers ORDER BY date DESC, id DESC')
    res.json({ vouchers: rows.map(toVoucher) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not load vouchers.' })
  }
})

app.post('/api/admin/vouchers', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  const bad = voucherInvalid(req.body || {})
  if (bad) return res.status(400).json({ error: bad })
  const conn = await pool.getConnection()
  try {
    // Saved together with its reference no. (VCH-<year>-<id>), so a voucher never exists without one
    await conn.beginTransaction()
    const [r] = await conn.query('INSERT INTO vouchers (date, category, amount, paid_to, method, cheque_no, bank_name, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', voucherValues(req.body))
    await conn.query("UPDATE vouchers SET voucher_no = CONCAT('VCH-', YEAR(NOW()), '-', LPAD(id, 4, '0')) WHERE id = ?", [r.insertId])
    await conn.commit()
    const [[row]] = await pool.query('SELECT * FROM vouchers WHERE id = ?', [r.insertId])
    res.status(201).json({ voucher: toVoucher(row) })
  } catch (err) {
    await conn.rollback().catch(() => {})
    console.error(err)
    res.status(500).json({ error: 'Could not save the voucher.' })
  } finally {
    conn.release()
  }
})

app.put('/api/admin/vouchers/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  const bad = voucherInvalid(req.body || {})
  if (bad) return res.status(400).json({ error: bad })
  try {
    const [r] = await pool.query('UPDATE vouchers SET date = ?, category = ?, amount = ?, paid_to = ?, method = ?, cheque_no = ?, bank_name = ?, notes = ? WHERE id = ?',
      [...voucherValues(req.body), req.params.id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Voucher not found.' })
    const [[row]] = await pool.query('SELECT * FROM vouchers WHERE id = ?', [req.params.id])
    res.json({ voucher: toVoucher(row) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not save the voucher.' })
  }
})

app.delete('/api/admin/vouchers/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  try {
    await pool.query('DELETE FROM vouchers WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not delete the voucher.' })
  }
})

// Profit & Loss between two dates (inclusive). Income = payment of bookings that are not cancelled and
// whose payment is received (by booking date); expenses = vouchers (by voucher date).
// ?from=YYYY-MM-DD&to=YYYY-MM-DD → { months: [{ month, income, expenses, bookings, vouchers }], byCourt, byCategory, pendingIncome }
app.get('/api/admin/pnl', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  const { from, to } = req.query
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to)
    return res.status(400).json({ error: 'Please choose a valid date range.' })
  try {
    const [income] = await pool.query(
      `SELECT DATE_FORMAT(date, '%Y-%m') AS month, court, COUNT(*) AS n, SUM(payment) AS total
       FROM slot WHERE date BETWEEN ? AND ? AND status <> 'cancelled' AND payment_received = 1 AND payment > 0
       GROUP BY month, court`, [from, to])
    const [[pending]] = await pool.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(payment), 0) AS total FROM slot
       WHERE date BETWEEN ? AND ? AND status <> 'cancelled' AND payment_received = 0 AND payment > 0`, [from, to])
    const [expenses] = await pool.query(
      `SELECT DATE_FORMAT(date, '%Y-%m') AS month, category, COUNT(*) AS n, SUM(amount) AS total
       FROM vouchers WHERE date BETWEEN ? AND ? GROUP BY month, category`, [from, to])

    const months = new Map()
    for (let d = new Date(`${from.slice(0, 7)}-01T00:00`); localDate(d).slice(0, 7) <= to.slice(0, 7); d.setMonth(d.getMonth() + 1))
      months.set(localDate(d).slice(0, 7), { month: localDate(d).slice(0, 7), income: 0, expenses: 0, bookings: 0, vouchers: 0 })
    const byCourt = {}, byCategory = {}
    for (const r of income) {
      const m = months.get(r.month); if (m) { m.income += Number(r.total); m.bookings += Number(r.n) }
      byCourt[r.court || 'Other'] = (byCourt[r.court || 'Other'] || 0) + Number(r.total)
    }
    for (const r of expenses) {
      const m = months.get(r.month); if (m) { m.expenses += Number(r.total); m.vouchers += Number(r.n) }
      byCategory[r.category] = (byCategory[r.category] || 0) + Number(r.total)
    }
    res.json({
      months: [...months.values()],
      byCourt: Object.entries(byCourt).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
      byCategory: Object.entries(byCategory).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
      pendingIncome: { count: Number(pending.n), total: Number(pending.total) },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not work out profit & loss.' })
  }
})

// Admin edits a booking: court, date, start time, players and phone. Length and payment stay as
// they are. Body: { courtId, courtName, date, startHour, phone, players: [{ n, name, cmNo }] } → { booking }
app.put('/api/admin/slots/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  if (!actionPasswordOk(req)) return res.status(403).json(WRONG_PASSWORD)
  const b = req.body || {}
  const start = Number(b.startHour)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !b.courtId) return res.status(400).json({ error: 'Please choose a court and date.' })
  const players = Array.isArray(b.players) ? b.players.filter(p => p?.name?.trim()).slice(0, 4) : []
  if (!players.length) return res.status(400).json({ error: 'Please add at least one player.' })
  const twice = duplicatePlayer(players)
  if (twice) return res.status(400).json({ error: `${twice} is entered more than once. Each player must be a different person.` })
  const byN = Object.fromEntries(players.map((p, i) => [Number(p.n) || i + 1, { name: cleanName(p.name).slice(0, 100), cm: String(p.cmNo || '').trim().toUpperCase().slice(0, 20) || null }]))
  if (!byN[1]) return res.status(400).json({ error: 'Player 1 is required.' })
  const teamName = ns => ns.map(n => byN[n]?.name).filter(Boolean).join(' & ').slice(0, 100) || null

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query('SELECT * FROM slot WHERE id = ? FOR UPDATE', [req.params.id])
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Booking not found.' }) }
    const hours = (timeToHour(row.end_time) ?? timeToHour(row.time) + (row.hour || 1)) - timeToHour(row.time)
    const end = start + hours
    if (!Number.isInteger(start) || start < OPEN_HOUR || end > CLOSE_HOUR) {
      await conn.rollback(); return res.status(400).json({ error: `This ${hours}-hour booking must fit between 3pm and 12am.` })
    }
    const [others] = await conn.query(
      "SELECT time, end_time, hour FROM slot WHERE date = ? AND court_id = ? AND status <> 'cancelled' AND id <> ? FOR UPDATE",
      [b.date, String(b.courtId), row.id])
    if (others.some(o => { const s = timeToHour(o.time), e = timeToHour(o.end_time) ?? s + (o.hour || 1); return start < e && end > s })) {
      await conn.rollback(); return res.status(409).json({ error: 'That time is already booked on this court. Choose another time.' })
    }
    await conn.query(
      `UPDATE slot SET court_id = ?, court = ?, date = ?, time = ?, end_time = ?,
         player1 = ?, player1_cm = ?, player2 = ?, player2_cm = ?, player3 = ?, player3_cm = ?, player4 = ?, player4_cm = ?,
         team1 = ?, team2 = ?, phone = ? WHERE id = ?`,
      [String(b.courtId), String(b.courtName || '').slice(0, 50) || row.court, b.date, hourToTime(start), hourToTime(end),
        byN[1]?.name || null, byN[1]?.cm || null, byN[2]?.name || null, byN[2]?.cm || null,
        byN[3]?.name || null, byN[3]?.cm || null, byN[4]?.name || null, byN[4]?.cm || null,
        teamName([1, 2]), teamName([3, 4]), String(b.phone ?? row.phone ?? '').slice(0, 20) || null, row.id])
    await conn.commit()
    const [[updated]] = await pool.query('SELECT * FROM slot WHERE id = ?', [row.id])
    res.json({ booking: slotToBooking(updated) })
  } catch (err) {
    await conn.rollback().catch(() => {})
    console.error(err)
    res.status(500).json({ error: 'Could not save the booking.' })
  } finally { conn.release() }
})

app.delete('/api/admin/slots/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.', relogin: true })
  if (!actionPasswordOk(req)) return res.status(403).json(WRONG_PASSWORD)
  await pool.query('DELETE FROM slot WHERE id = ?', [req.params.id])
  res.json({ ok: true })
})

// Health check (Render → Settings → Health Check Path: /api/health)
app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, database: DB_NAME }) }
  catch (err) { res.status(500).json({ ok: false, error: err.code || 'database error' }) }
})

app.listen(PORT, () => console.log(`API server on http://localhost:${PORT} (database: ${DB_NAME})`))
