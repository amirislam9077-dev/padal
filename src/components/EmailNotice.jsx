import { useEffect } from 'react'
import { Mail, X } from 'lucide-react'

// Short notice about emails just sent. Default text: admin approved a payment → who got the "booking confirmed" email;
// pass note.title for any other message (e.g. a score waiting for confirmation).
// note: { title?, ok?, slotRef, sent: [{ name }], skipped: [{ name, reason }], error? } — closes itself after 8 seconds
export default function EmailNotice({ note, onClose }) {
  useEffect(() => {
    if (!note) return
    const t = setTimeout(onClose, 8000)
    return () => clearTimeout(t)
  }, [note, onClose])
  if (!note) return null
  const ok = note.ok ?? (!note.error && note.sent?.length > 0) // green unless something went wrong
  return (
    <div role="status" className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-96 z-50 rounded-xl px-4 py-3 text-sm flex gap-3 shadow-lg print:hidden"
      style={ok
        ? { background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46' }
        : { background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
      <Mail size={16} className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {note.title || (
            <>
              {note.slotRef ? `${note.slotRef} confirmed. ` : ''}
              {ok ? <>"Booking confirmed" email sent to <b>{note.sent.map(s => s.name).join(', ')}</b>.</> : 'No confirmation email was sent.'}
            </>
          )}
        </p>
        {note.skipped?.length > 0 && (
          <p className="text-xs mt-1">Not emailed: {note.skipped.map(s => `${s.name} (${s.reason})`).join(', ')}.</p>
        )}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 self-start opacity-60 hover:opacity-100"><X size={14} /></button>
    </div>
  )
}
