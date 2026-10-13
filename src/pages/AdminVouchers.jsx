import { useState, useEffect } from 'react'
import { Receipt, Pencil, Trash2, X, Search, Printer, AlertCircle, Banknote, FileText, Check, Save } from 'lucide-react'
import { format } from 'date-fns'
import { adminVouchersApi, adminSaveVoucherApi, adminDeleteVoucherApi, adminVoucherOptionsApi, adminAddVoucherOptionApi } from '../store'

const NAVY = '#1B2E4B'
const BORDER = '#DDE3EC'
const LGRAY = '#94A3B8'
const RED = '#DC2626'
const GREEN = '#047857'

// Shown until the lists load from the server (which adds the admin's own entries)
const VOUCHER_CATEGORIES = ['Salary', 'Maintenance', 'Entertainment', 'Electricity', 'Water', 'Equipment (balls, rackets)', 'Cleaning', 'Repairs', 'Rent', 'Internet / phone', 'Other']
const PAYEES = ['Secretary', 'Coach', 'Court attendant', 'Guard', 'Cleaner', 'Accountant', 'K-Electric', 'KWSC (water)']
const BANKS = ['Habib Bank (HBL)', 'MCB Bank', 'United Bank (UBL)', 'Allied Bank (ABL)', 'Meezan Bank', 'Bank Alfalah', 'Bank AL Habib',
  'Faysal Bank', 'Askari Bank', 'Habib Metropolitan Bank', 'Standard Chartered', 'National Bank (NBP)', 'The Bank of Punjab (BOP)', 'Soneri Bank', 'JS Bank', 'Dubai Islamic Bank']

const rs = n => `Rs. ${(Number(n) || 0).toLocaleString()}`
const day = d => { const x = new Date(`${d}T00:00`); return isNaN(x) ? d : format(x, 'EEE d MMM yyyy') }
const input = { width: '100%', border: `1.5px solid #CBD5E1`, borderRadius: '8px', height: '38px', padding: '0 10px', fontSize: '13px', outline: 'none', color: NAVY, background: 'white', fontFamily: 'inherit', fontWeight: 600 }
const filterInput = { ...input, width: 'auto', height: '32px', fontSize: '12px', fontWeight: 500, border: `1.5px solid ${BORDER}` }
const label = 'block text-[11px] font-extrabold uppercase tracking-wide mb-1'
const blank = () => ({ date: format(new Date(), 'yyyy-MM-dd'), category: '', amount: '', paidTo: '', method: 'Cash', chequeNo: '', bankName: '', notes: '' })

// Drop-down with "+ Add new…" at the bottom: picking it shows a box to type a new name, which is
// saved to the database (voucher_options) and then selected
function OptionPicker({ value, options, onChange, onAdd, placeholder, addLabel }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function add() {
    const n = name.trim()
    if (!n) { setErr('Type a name first.'); return }
    setBusy(true)
    const e = await onAdd(n)
    setBusy(false)
    if (e) { setErr(e); return }
    onChange(n); setAdding(false); setName(''); setErr('')
  }

  if (adding) return (
    <div>
      <div className="flex gap-1.5">
        <input value={name} autoFocus maxLength={100} placeholder={addLabel}
          onChange={e => { setName(e.target.value); setErr('') }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } if (e.key === 'Escape') setAdding(false) }}
          style={{ ...input, borderColor: '#3B82F6' }} />
        <button type="button" onClick={add} disabled={busy} className="h-[38px] px-3 rounded-lg text-xs font-black shrink-0"
          style={{ background: GREEN, color: 'white', opacity: busy ? 0.7 : 1 }}>{busy ? '…' : 'Add'}</button>
        <button type="button" onClick={() => { setAdding(false); setName(''); setErr('') }} title="Cancel"
          className="h-[38px] px-2 rounded-lg shrink-0" style={{ color: '#475569', border: `1.5px solid ${BORDER}` }}><X size={14} /></button>
      </div>
      {err && <p className="text-[11px] mt-1 font-semibold" style={{ color: RED }}>{err}</p>}
    </div>
  )
  return (
    <select value={value} onChange={e => (e.target.value === '__new' ? setAdding(true) : onChange(e.target.value))} style={input}>
      <option value="">{placeholder}</option>
      {[...new Set([...options, value].filter(Boolean))].map(o => <option key={o} value={o}>{o}</option>)}
      <option value="__new">＋ Add new…</option>
    </select>
  )
}

// The voucher form, on the page itself: a new voucher, or the one being edited
function VoucherForm({ voucher, options, onAddOption, onSaved, onCancel }) {
  const [v, setV] = useState(voucher)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, val) => { setV(p => ({ ...p, [k]: val })); setError('') }
  const editing = !!v.id
  const cheque = v.method === 'Cheque'

  async function save(e) {
    e.preventDefault()
    if (!v.date) { setError('Please choose the issue date.'); return }
    if (!v.category) { setError('Please choose a category.'); return }
    if (!v.paidTo.trim()) { setError('Please enter who it is paid to.'); return }
    if (!(Number(v.amount) > 0)) { setError('Please enter the amount.'); return }
    if (cheque && !String(v.chequeNo || '').trim()) { setError('Please enter the cheque number.'); return }
    if (cheque && !String(v.bankName || '').trim()) { setError('Please enter the bank name of the cheque.'); return }
    setSaving(true)
    const r = await adminSaveVoucherApi(v)
    setSaving(false)
    if (r.error) { setError(r.error); return }
    onSaved(r.voucher)
  }

  return (
    <form onSubmit={save} className="print:hidden bg-white rounded-2xl shadow-sm overflow-hidden"
      style={{ border: `2px solid ${editing ? '#F59E0B' : '#93C5FD'}` }}>
      <div className="flex items-center justify-between px-5 py-3" style={{ background: editing ? '#FFFBEB' : '#EFF6FF', borderBottom: `1px solid ${editing ? '#FDE68A' : '#BFDBFE'}` }}>
        <p className="font-black text-base flex items-center gap-2" style={{ color: editing ? '#B45309' : '#1D4ED8' }}>
          {editing ? <><Pencil size={16} /> Edit Voucher {v.voucherNo}</> : <><Receipt size={16} /> New Voucher</>}
        </p>
        <span className="flex items-center gap-3">
          {/* Reference no.: made by the database when the voucher is saved, can't be changed */}
          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg" style={{ background: 'white', border: `1.5px solid ${editing ? '#FDE68A' : '#BFDBFE'}`, color: '#475569' }}>
            Voucher Ref No.:
            {editing
              ? <span className="font-black" style={{ color: NAVY, fontFamily: 'Consolas, monospace' }}>{v.voucherNo}</span>
              : <span className="font-semibold italic" style={{ color: LGRAY }}>auto-generated on save</span>}
          </span>
          {editing && (
            <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 text-xs font-bold" style={{ color: '#B45309' }}>
              <X size={14} /> Cancel edit
            </button>
          )}
        </span>
      </div>

      <div className="px-4 sm:px-5 py-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={label} style={{ color: NAVY }}>Issue Date *</label>
          <input type="date" value={v.date} onChange={e => set('date', e.target.value)} style={input} />
        </div>
        <div>
          <label className={label} style={{ color: NAVY }}>Category *</label>
          <OptionPicker value={v.category} options={options.categories} onChange={c => set('category', c)}
            onAdd={n => onAddOption('category', n)} placeholder="Select category" addLabel="New category, e.g. Transport" />
        </div>
        <div>
          <label className={label} style={{ color: NAVY }}>{v.category === 'Salary' ? 'Employee name / post *' : 'Paid to (name) *'}</label>
          <OptionPicker value={v.paidTo} options={options.payees} onChange={p => set('paidTo', p)}
            onAdd={n => onAddOption('payee', n)} placeholder={v.category === 'Salary' ? 'Select employee / post' : 'Select who it is paid to'}
            addLabel={v.category === 'Salary' ? 'e.g. Secretary — Ahmed Khan' : 'e.g. ABC Electricals'} />
        </div>
        <div>
          <label className={label} style={{ color: NAVY }}>Amount (Rs.) *</label>
          <input type="number" min="1" step="1" value={v.amount} placeholder="0" onChange={e => set('amount', e.target.value)}
            style={{ ...input, fontWeight: 800, fontSize: '15px', color: RED }} />
        </div>

        {/* Payment: Cash or Cheque — a cheque needs its number and bank */}
        <div className="sm:col-span-2 md:col-span-1">
          <label className={label} style={{ color: NAVY }}>Payment by *</label>
          <div className="grid grid-cols-2 gap-2">
            {[['Cash', Banknote], ['Cheque', FileText]].map(([m, Icon]) => (
              <button key={m} type="button" onClick={() => set('method', m)}
                className="h-[38px] rounded-lg inline-flex items-center justify-center gap-1.5 text-sm font-black"
                style={v.method === m ? { background: NAVY, color: 'white', border: `2px solid ${NAVY}` } : { background: 'white', color: '#475569', border: `2px solid ${BORDER}` }}>
                <Icon size={15} /> {m}
              </button>
            ))}
          </div>
        </div>
        {cheque && <>
          <div>
            <label className={label} style={{ color: NAVY }}>Cheque No. *</label>
            <input value={v.chequeNo || ''} maxLength={30} placeholder="e.g. 00123456"
              onChange={e => set('chequeNo', e.target.value.toUpperCase())} style={{ ...input, fontFamily: 'Consolas, monospace' }} />
          </div>
          <div>
            <label className={label} style={{ color: NAVY }}>Bank Name *</label>
            <input value={v.bankName || ''} maxLength={60} list="voucher-banks" placeholder="e.g. Meezan Bank"
              onChange={e => set('bankName', e.target.value)} style={input} />
            <datalist id="voucher-banks">{BANKS.map(b => <option key={b} value={b} />)}</datalist>
          </div>
        </>}
        <div className={cheque ? 'sm:col-span-2 md:col-span-1' : 'sm:col-span-2 md:col-span-3'}>
          <label className={label} style={{ color: NAVY }}>Notes</label>
          <input value={v.notes} maxLength={255} placeholder={v.category === 'Salary' ? 'e.g. Salary for October 2026' : 'e.g. October bill'}
            onChange={e => set('notes', e.target.value)} style={input} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3" style={{ borderTop: `1px solid ${BORDER}`, background: '#F8FAFC' }}>
        {error ? (
          <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: RED }}><AlertCircle size={15} /> {error}</p>
        ) : <span className="text-xs" style={{ color: LGRAY }}>* required — saved to the database and shown in the list below</span>}
        <button type="submit" disabled={saving} className="h-10 px-6 rounded-xl text-sm font-black inline-flex items-center gap-2"
          style={{ background: GREEN, color: 'white', opacity: saving ? 0.7 : 1, boxShadow: '0 4px 12px rgba(4,120,87,0.25)' }}>
          <Save size={16} /> {saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Voucher'}
        </button>
      </div>
    </form>
  )
}

export default function AdminVouchers() {
  const [vouchers, setVouchers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(blank) // the voucher in the form (new, or one being edited)
  const [formKey, setFormKey] = useState(0) // bump to reset the form
  const [justSaved, setJustSaved] = useState(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [payee, setPayee] = useState('')
  const [method, setMethod] = useState('')
  const [bank, setBank] = useState('')

  // Category and Paid-to lists (built-in + added by the admin), from the database
  const [options, setOptions] = useState({ categories: VOUCHER_CATEGORIES, payees: PAYEES })

  useEffect(() => {
    let cancelled = false
    adminVouchersApi().then(r => {
      if (cancelled) return
      setLoading(false)
      if (r.error) setError(r.error)
      else setVouchers(r.vouchers)
    })
    adminVoucherOptionsApi().then(r => { if (!cancelled && !r.error) setOptions(r) })
    return () => { cancelled = true }
  }, [])

  // "+ Add new…" in the form → saved to the database; returns an error message or null
  async function addOption(kind, name) {
    const r = await adminAddVoucherOptionApi(kind, name)
    if (r.error) return r.error
    setOptions({ categories: r.categories, payees: r.payees })
    return null
  }

  function openForm(v) { setForm(v); setFormKey(k => k + 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  function saved(v) {
    setVouchers(list => [v, ...list.filter(x => x.id !== v.id)].sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id)))
    setJustSaved(v)
    openForm(blank()) // ready for the next one
    setTimeout(() => setJustSaved(s => (s === v ? null : s)), 6000)
  }
  async function remove(v) {
    if (!confirm(`Delete voucher ${v.voucherNo} (${v.category}, ${v.paidTo}, ${rs(v.amount)})?`)) return
    const r = await adminDeleteVoucherApi(v.id)
    if (r.error) { alert(r.error); return }
    setVouchers(list => list.filter(x => x.id !== v.id))
    if (form.id === v.id) openForm(blank())
  }

  const q = search.trim().toLowerCase()
  const shown = vouchers.filter(v => (!from || v.date >= from) && (!to || v.date <= to) && (!category || v.category === category)
    && (!payee || v.paidTo === payee) && (!method || v.method === method) && (!bank || v.bankName === bank)
    && (!q || [v.voucherNo, v.category, v.paidTo, v.method, v.chequeNo, v.bankName, v.notes].some(x => (x || '').toLowerCase().includes(q))))
  const total = shown.reduce((s, v) => s + v.amount, 0)
  const categories = [...new Set([...options.categories, ...vouchers.map(v => v.category)])]

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <h1 className="text-2xl font-black flex items-center gap-2" style={{ color: NAVY }}><Receipt size={22} /> Vouchers</h1>
        <p className="text-sm mt-0.5" style={{ color: LGRAY }}>Club expenses (salary, maintenance, entertainment …) — used in Profit &amp; Loss</p>
      </div>

      <VoucherForm key={formKey} voucher={form} options={options} onAddOption={addOption} onSaved={saved} onCancel={() => openForm(blank())} />

      {justSaved && (
        <div className="print:hidden flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: '#ECFDF5', border: '1px solid #6EE7B7', color: GREEN }}>
          <Check size={16} strokeWidth={3} /> Voucher {justSaved.voucherNo} saved — {justSaved.category}, {justSaved.paidTo}, {rs(justSaved.amount)}
        </div>
      )}

      {error && <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#FEF2F2', color: RED, border: '1px solid #FEE2E2' }}>{error}</div>}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
        <div className="print:hidden px-4 py-3 flex flex-wrap items-center gap-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <span className="text-sm font-black mr-2" style={{ color: NAVY }}>Saved vouchers</span>
          <span className="text-xs font-semibold" style={{ color: LGRAY }}>From</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={filterInput} />
          <span className="text-xs font-semibold" style={{ color: LGRAY }}>To</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={filterInput} />
          <select value={category} onChange={e => setCategory(e.target.value)} style={filterInput}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={payee} onChange={e => setPayee(e.target.value)} style={filterInput} aria-label="Paid to">
            <option value="">All names / posts</option>
            {[...new Set(vouchers.map(v => v.paidTo).filter(Boolean))].sort().map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={method} onChange={e => { setMethod(e.target.value); if (e.target.value === 'Cash') setBank('') }} style={filterInput} aria-label="Payment">
            <option value="">Cash &amp; Cheque</option>
            <option value="Cash">Cash only</option>
            <option value="Cheque">Cheque only</option>
          </select>
          {method !== 'Cash' && (
            <select value={bank} onChange={e => setBank(e.target.value)} style={filterInput} aria-label="Bank">
              <option value="">All banks</option>
              {[...new Set(vouchers.map(v => v.bankName).filter(Boolean))].sort().map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: LGRAY }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Ref no., cheque no., notes…" style={{ ...filterInput, paddingLeft: '28px', width: '190px' }} />
          </div>
          {(from || to || category || payee || method || bank || search) && (
            <button type="button" onClick={() => { setFrom(''); setTo(''); setCategory(''); setPayee(''); setMethod(''); setBank(''); setSearch('') }}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-bold" style={{ color: '#475569', border: `1.5px solid ${BORDER}` }}>
              <X size={12} /> Clear filters
            </button>
          )}
          <span className="ml-auto text-sm font-black" style={{ color: RED }}>{shown.length} {shown.length === 1 ? 'voucher' : 'vouchers'} · Total: {rs(total)}</span>
          <button type="button" onClick={() => window.print()} disabled={!shown.length}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold" style={{ background: NAVY, color: 'white', opacity: shown.length ? 1 : 0.4 }}>
            <Printer size={13} /> Print / PDF
          </button>
        </div>
        {/* Only on paper / PDF */}
        <div className="hidden print:block px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <p className="text-lg font-black" style={{ color: NAVY }}>North Nazimabad Gymkhana Trust — Expense Vouchers</p>
          <p className="text-xs" style={{ color: '#475569' }}>
            {from || to ? `${from ? day(from) : 'start'} – ${to ? day(to) : 'today'}` : 'All dates'}{category ? ` · ${category}` : ''}{payee ? ` · ${payee}` : ''}{method ? ` · ${method}` : ''}{bank ? ` · ${bank}` : ''} · {shown.length} vouchers · Total {rs(total)} · printed {format(new Date(), 'd MMM yyyy')}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: '#F5F7FA' }}>
              <tr>{['Voucher Ref No.', 'Issue Date', 'Category', 'Paid to', 'Payment', 'Notes', 'Amount', ''].map((h, i) => (
                <th key={i} className={`px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${h ? '' : 'print:hidden'}`} style={{ color: LGRAY }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {shown.map(v => (
                <tr key={v.id} className="text-xs" style={{ borderTop: '1px solid #EEF2F7', background: justSaved?.id === v.id ? '#ECFDF5' : form.id === v.id ? '#FFFBEB' : 'white' }}>
                  <td className="px-3 py-2 font-bold whitespace-nowrap" style={{ color: NAVY, fontFamily: 'Consolas, monospace' }}>{v.voucherNo}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-semibold" style={{ color: NAVY }}>{day(v.date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className="px-2 py-0.5 rounded-full font-bold text-[11px]" style={{ background: '#F1F5F9', color: '#334155' }}>{v.category}</span></td>
                  <td className="px-3 py-2 font-semibold" style={{ color: NAVY }}>{v.paidTo || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: '#475569' }}>
                    {v.method === 'Cheque' ? (
                      <>
                        <span className="font-bold" style={{ color: NAVY }}>Cheque</span> <span style={{ fontFamily: 'Consolas, monospace' }}>#{v.chequeNo}</span>
                        {v.bankName && <span className="block text-[11px]" style={{ color: '#64748B' }}>{v.bankName}</span>}
                      </>
                    ) : <span className="font-bold" style={{ color: NAVY }}>{v.method || '—'}</span>}
                  </td>
                  <td className="px-3 py-2" style={{ color: '#64748B', maxWidth: '220px' }}>{v.notes || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-black" style={{ color: RED }}>{rs(v.amount)}</td>
                  <td className="px-3 py-2 whitespace-nowrap print:hidden">
                    <span className="inline-flex gap-1">
                      <button type="button" onClick={() => openForm(v)} title="Edit voucher" className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] font-bold"
                        style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}><Pencil size={12} /> Edit</button>
                      <button type="button" onClick={() => remove(v)} title="Delete voucher" className="inline-flex items-center h-7 px-2 rounded-lg"
                        style={{ background: '#FEF2F2', color: RED, border: '1px solid #FECACA' }}><Trash2 size={12} /></button>
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && !shown.length && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm" style={{ color: LGRAY }}>
                  {vouchers.length ? 'No vouchers match' : 'No vouchers yet — fill in the form above and click “Save Voucher”'}
                </td></tr>
              )}
              {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: LGRAY }}>Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
