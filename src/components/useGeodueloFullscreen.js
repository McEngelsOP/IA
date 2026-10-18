import { useEffect, useRef, useState } from 'react'

// Keep the mounted game in place: entering fullscreen must never reconnect a room.
export default function useGeodueloFullscreen(root) {
  const [fullscreen, setFullscreen] = useState(false)
  const active = useRef(false), fallback = useRef(false), restore = useRef(null), trigger = useRef(null)
  function finish() {
    active.current = false
    if (fallback.current) {
      fallback.current = false
      root.current?.removeAttribute('data-geo-fixed')
      restore.current?.(); restore.current = null
    }
    setFullscreen(false)
    trigger.current?.isConnected && trigger.current.focus({ preventScroll: true })
  }
  function exit() {
    if (document.fullscreenElement === root.current) document.exitFullscreen().catch(finish)
    else finish()
  }
  async function toggle(event) {
    if (active.current) { exit(); return }
    const element = root.current
    if (!element) return
    trigger.current = event.currentTarget
    try {
      if (!element.requestFullscreen) throw new Error('Use immersive view')
      await element.requestFullscreen()
      active.current = true; setFullscreen(true)
    } catch {
      if (!element.isConnected) return
      fallback.current = true; active.current = true; setFullscreen(true)
      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      const siblings = []
      for (let node = element; node?.parentElement; node = node.parentElement) {
        for (const sibling of node.parentElement.children) if (sibling !== node && sibling instanceof HTMLElement) {
          siblings.push([sibling, sibling.inert]); sibling.inert = true
        }
      }
      restore.current = () => { document.body.style.overflow = previousOverflow; for (const [node, inert] of siblings) node.inert = inert }
      element.setAttribute('data-geo-fixed', '')
    }
  }
  const exitRef = useRef(exit); exitRef.current = exit
  useEffect(() => {
    const windows = new Set(), frames = new Map()
    const keydown = event => {
      if (!active.current) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); exitRef.current() }
      if (event.key === 'Tab' && event.currentTarget === window) {
        event.stopImmediatePropagation()
        const all = [...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),iframe')].filter(n => n.getClientRects().length)
        if (event.shiftKey && document.activeElement === all[0]) { event.preventDefault(); all.at(-1)?.focus() }
        else if (!event.shiftKey && document.activeElement === all.at(-1)) { event.preventDefault(); all[0]?.focus() }
      }
    }
    function bindWindow(target) { if (target) { target.removeEventListener('keydown', keydown, true); target.addEventListener('keydown', keydown, true); windows.add(target) } }
    function bindFrames() {
      for (const frame of root.current?.querySelectorAll('iframe') || []) if (!frames.has(frame)) {
        const load = () => { try { bindWindow(frame.contentWindow) } catch {} }
        frame.addEventListener('load', load); frames.set(frame, load); load()
      }
      for (const [frame, load] of frames) if (!frame.isConnected) {
        frame.removeEventListener('load', load)
        try { const w = frame.contentWindow; w?.removeEventListener('keydown', keydown, true); windows.delete(w) } catch {}
        frames.delete(frame)
      }
    }
    bindWindow(window); bindFrames()
    const observer = new MutationObserver(bindFrames); observer.observe(root.current, { childList: true, subtree: true })
    const change = () => { if (!document.fullscreenElement && !fallback.current && active.current) finish() }
    document.addEventListener('fullscreenchange', change)
    return () => {
      observer.disconnect(); document.removeEventListener('fullscreenchange', change)
      for (const target of windows) { try { target.removeEventListener('keydown', keydown, true) } catch {} }
      for (const [frame, load] of frames) frame.removeEventListener('load', load)
      restore.current?.(); active.current = false
      if (document.fullscreenElement === root.current) document.exitFullscreen().catch(() => {})
    }
  }, [])
  return { fullscreen, toggle }
}
