export const WEB_IDLE_MS = 30 * 60 * 1000

function identity(session) {
  try {
    const part = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(part))
    return claims.session_id || claims.sub || session.user?.id
  } catch { return session?.user?.id || null }
}

// Only the Official web entry points install this guard. Token refreshes and
// background requests are deliberately not evidence of user activity.
export function createWebSessionGuard(client, {
  authKey, storage = window.localStorage, win = window, doc = document,
  now = Date.now, schedule = setTimeout, cancel = clearTimeout,
  onLock = () => {}, onExpired = () => {}, onSuspend = () => {}, onResume = () => {},
} = {}) {
  let active = null, timer = null, closing = false, expiry = Promise.resolve(), lastWrite = 0, lastMoveCheck = -Infinity
  const activityKey = id => `${authKey}:web-activity:v1:${id}`
  const read = () => {
    try { return JSON.parse(storage.getItem(activityKey(active))) } catch { return null }
  }
  const clearAuth = () => {
    for (const key of [authKey, `${authKey}-user`, `${authKey}-code-verifier`]) {
      try { storage.removeItem(key) } catch { /* Fail closed in the view even if storage is unavailable. */ }
    }
  }
  function expire(reason = 'inactivity') {
    if (closing) return expiry
    closing = true; cancel(timer); onLock()
    // Mask private content first, even if offline, a save is pending, or the
    // browser has resumed after suspending timers overnight.
    expiry = (async () => {
      let deadline
      try {
        client.auth.stopAutoRefresh()
        await Promise.race([
          client.auth.signOut({ scope: 'local' }).catch(() => {}),
          new Promise(resolve => { deadline = schedule(resolve, 1500) }),
        ])
      } finally {
        cancel(deadline); clearAuth(); active = null; onExpired(reason)
      }
    })()
    return expiry
  }
  function check() {
    if (closing) return false
    if (!active) return true
    const record = read(), time = now()
    if (!record || !Number.isFinite(record.at) || record.at > time || time - record.at >= WEB_IDLE_MS) {
      expire(); return false
    }
    cancel(timer); timer = schedule(check, WEB_IDLE_MS - (time - record.at))
    return true
  }
  function restore(session) {
    if (closing) return false
    active = identity(session)
    if (!active) { expire(); return false }
    return check()
  }
  function begin(session) {
    active = identity(session); closing = false; lastWrite = 0
    if (!active) { expire(); return false }
    try { storage.setItem(activityKey(active), JSON.stringify({ at: now() })) }
    catch { expire(); return false }
    return check()
  }
  function activity(event) {
    if (event.type === 'pointermove') { const time = now(); if (time - lastMoveCheck < 250) return; lastMoveCheck = time }
    if (!check()) {
      if (event.cancelable) event.preventDefault()
      event.stopImmediatePropagation(); return
    }
    if (!active || !event.isTrusted || doc.hidden) return
    const time = now()
    // Avoid writing storage on every pixel of pointer movement.
    if (time - lastWrite < 1000) return
    lastWrite = time
    try { storage.setItem(activityKey(active), JSON.stringify({ at: time })) }
    catch { expire(); return }
    check()
  }
  const listeners = []
  const listen = (target, name, fn, options) => {
    target.addEventListener(name, fn, options)
    listeners.push(() => target.removeEventListener(name, fn, options))
  }
  for (const name of ['pointerdown', 'pointermove', 'keydown', 'input', 'scroll', 'touchstart']) {
    listen(doc, name, activity, { capture: true })
  }
  const resume = event => { if (check()) onResume(); else event.stopImmediatePropagation() }
  listen(win, 'focus', resume, true)
  listen(win, 'pageshow', resume, true)
  listen(win, 'pagehide', () => { if (active) onSuspend() })
  listen(doc, 'visibilitychange', event => { if (doc.hidden) { if (active) onSuspend() } else resume(event) }, true)
  listen(win, 'storage', event => {
    if (!active || closing) return
    if ((event.key === authKey && !event.newValue) || event.key === null) expire('signed-out')
    else if (event.key === activityKey(active)) check()
  })
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    // Supabase callbacks may hold its auth lock. Never await signOut here.
    if (!active || closing) return
    if (event === 'SIGNED_OUT') schedule(() => expire('signed-out'), 0)
    else if (session && ['SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) schedule(() => restore(session), 0)
  })
  return {
    begin, restore, check, expire, get settled() { return expiry },
    dispose() { cancel(timer); listeners.forEach(remove => remove()); subscription.unsubscribe() },
  }
}

export function webAuthStorageKey() {
  return `sb-${new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`
}
