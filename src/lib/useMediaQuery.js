import { useState, useEffect } from 'react'

// ¿La pantalla cumple la media query? Se actualiza al girar o
// redimensionar el dispositivo (no es un sniff de user-agent).
export default function useMediaQuery(q) {
  const [match, setMatch] = useState(() => {
    try { return window.matchMedia(q).matches } catch { return false }
  })
  useEffect(() => {
    const mq = window.matchMedia(q)
    const fn = e => setMatch(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [q])
  return match
}
