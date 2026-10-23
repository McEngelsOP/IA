const KEY = 'esan-navigation-v1'
export function createWebNavigation({ win = window, scroller, initial, valid, restore, ready = () => true }) {
  const history = win.history
  history.scrollRestoration = 'manual'
  let applying = false, frame = 0, pendingScroll = null
  const state = () => history.state?.[KEY]
  const write = (snapshot, replace) => {
    const url = new URL(win.location.href)
    url.hash = 'view=' + encodeURIComponent(snapshot.page) + (snapshot.kid ? '&section=' + encodeURIComponent(snapshot.kid) : '')
    history[replace ? 'replaceState' : 'pushState']({ ...history.state, [KEY]: snapshot }, '', url)
  }
  const capture = () => {
    if (applying || pendingScroll !== null) return
    const current = state()
    if (current) history.replaceState({ ...history.state, [KEY]: { ...current, scroll: scroller.scrollTop } }, '')
  }
  function apply(snapshot) {
    applying = true
    restore(snapshot)
    pendingScroll = snapshot.scroll || 0
    refresh()
  }
  function refresh() {
    win.requestAnimationFrame(() => {
      if (pendingScroll !== null && ready()) { scroller.scrollTop = pendingScroll; pendingScroll = null }
      applying = false
    })
  }
  const previous = state()
  if (previous && valid(previous)) {
    apply(previous)
  } else {
    const referrer = win.document.referrer
    const login = new URL('./login.html', win.location.href)
    const cameFromLogin = referrer && new URL(referrer).origin === login.origin &&
      new URL(referrer).pathname === login.pathname
    const appUrl = win.location.href
    if (!cameFromLogin) {
      history.replaceState({ esanLoginEntry: true }, '', login)
      history.pushState({ [KEY]: initial }, '', appUrl)
    }
    write(initial, true)
  }
  const onScroll = () => {
    if (frame || applying) return
    frame = win.requestAnimationFrame(() => { frame = 0; capture() })
  }
  const onPop = event => {
    const snapshot = event.state?.[KEY]
    if (snapshot && valid(snapshot)) apply(snapshot)
    else if (event.state?.esanLoginEntry) win.location.replace(new URL('./login.html', win.location.href).href)
  }
  scroller.addEventListener('scroll', onScroll, { passive: true })
  win.addEventListener('popstate', onPop)
  win.addEventListener('pagehide', capture)
  return {
    capture, refresh,
    push(snapshot) { capture(); pendingScroll = null; applying = false; write(snapshot, false) },
    current: state,
    dispose() {
      win.cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', onScroll)
      win.removeEventListener('popstate', onPop)
      win.removeEventListener('pagehide', capture)
    },
  }
}
