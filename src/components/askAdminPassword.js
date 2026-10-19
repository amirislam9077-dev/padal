import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import PasswordDialog from './PasswordDialog'

// Asks for the admin password before an edit or delete. Resolves with the password once the server
// has accepted it, or null when cancelled. The password is then sent with the edit / delete itself.
export function askAdminPassword(title, { danger = false } = {}) {
  return new Promise(resolve => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = value => { root.unmount(); host.remove(); resolve(value) }
    root.render(createElement(PasswordDialog, { title, danger, onDone: done }))
  })
}
