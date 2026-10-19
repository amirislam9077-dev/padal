// Money helpers for vouchers: "Rs. 11,111.00" and "Rupees Eleven Thousand One Hundred Eleven Only"
// (Pakistani numbering: thousand, lakh, crore)

export const rs2 = n => `Rs. ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

// 0–99
const twoDigits = n => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`)
// 0–999
const threeDigits = n => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', twoDigits(n % 100)].filter(Boolean).join(' ')

// Whole number → words (crore, lakh, thousand, hundred)
function wholeToWords(n) {
  if (n === 0) return 'Zero'
  const parts = []
  const crore = Math.floor(n / 10000000)
  if (crore) parts.push(`${wholeToWords(crore)} Crore`)
  n %= 10000000
  const lakh = Math.floor(n / 100000)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  n %= 100000
  const thousand = Math.floor(n / 1000)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  n %= 1000
  if (n) parts.push(threeDigits(n))
  return parts.join(' ')
}

// 11111 → "Rupees Eleven Thousand One Hundred Eleven Only"; 250.5 → "Rupees Two Hundred Fifty and Fifty Paisa Only"
export function amountInWords(amount) {
  const value = Math.round((Number(amount) || 0) * 100)
  if (value <= 0) return ''
  const rupees = Math.floor(value / 100), paisa = value % 100
  return `Rupees ${wholeToWords(rupees)}${paisa ? ` and ${twoDigits(paisa)} Paisa` : ''} Only`
}
