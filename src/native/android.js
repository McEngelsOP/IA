import { Capacitor, CapacitorHttp, SystemBars, SystemBarsStyle } from '@capacitor/core'
export const isAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
export function setAndroidSystemBars(dark) {
  if (isAndroid()) void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {})
}
export const WEB_ORIGIN = 'https://l-esan.vercel.app'
// HTTPS fallback works with the existing Supabase redirect allowlist. A native
// callback can be enabled after adding app.lyra.campus://auth/callback there.
export function authCallback() {
  return isAndroid() ? (import.meta.env.VITE_ANDROID_AUTH_CALLBACK || WEB_ORIGIN + '/login.html') : new URL('./login.html', location.href).href
}
export function nativeAuthTarget(value, base) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'app.lyra.campus:' || url.host !== 'auth' || url.pathname !== '/callback') return null
    const target = new URL('./login.html', base)
    target.search = url.search; target.hash = url.hash
    return target.href
  } catch { return null }
}
export async function apiFetch(path, options = {}) {
  if (!isAndroid()) return fetch(path, options)
  if (!['/api/mailbox', '/api/communications'].includes(path)) throw new Error('Unsupported app endpoint')
  options.signal?.throwIfAborted()
  const result = await CapacitorHttp.request({ url: WEB_ORIGIN + path, method: options.method || 'GET',
    headers: Object.fromEntries(new Headers(options.headers)), data: options.body ? JSON.parse(options.body) : undefined,
    connectTimeout: 15000, readTimeout: 30000, responseType: 'json' })
  options.signal?.throwIfAborted()
  return new Response(JSON.stringify(result.data), { status: result.status, headers: result.headers })
}
let initialized = false
export async function initializeAndroid() {
  if (!isAndroid() || initialized) return
  initialized = true
  document.documentElement.dataset.native = 'android'
  const { App } = await import('@capacitor/app')
  const open = value => { const target = nativeAuthTarget(value, location.href); if (target) location.replace(target) }
  await App.addListener('appUrlOpen', ({ url }) => open(url))
  const launch = await App.getLaunchUrl()
  if (launch?.url) open(launch.url)
  await App.addListener('backButton', ({ canGoBack }) => {
    // Keep Android's back gesture aligned with the portal's existing history.
    if (document.body.dataset.state && document.body.dataset.state !== 'loginScreen') {
      document.querySelector('.stage > :not([hidden]) [data-view="loginScreen"]')?.click()
    } else if (canGoBack) history.back()
    else void App.minimizeApp()
  })
  document.addEventListener('click', async event => {
    const link = event.target.closest?.('a[href]')
    if (!link || link.download || event.defaultPrevented) return
    const url = new URL(link.href, location.href)
    if (url.origin === location.origin || !['https:', 'http:'].includes(url.protocol)) return
    event.preventDefault()
    try { const { Browser } = await import('@capacitor/browser'); await Browser.open({ url: url.href }) }
    catch { /* Keep the current form if the external browser cannot open. */ }
  })
}
