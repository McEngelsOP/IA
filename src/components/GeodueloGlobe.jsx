import { memo, useEffect, useRef, useState } from 'react'
function GeodueloGlobe({ map, selected, round, onPoint }) {
  const frame = useRef(null), callback = useRef(onPoint), config = useRef(null)
  const [session] = useState(() => crypto.randomUUID())
  callback.current = onPoint; config.current = { type:'esan:geoduelo-map',session,action:'configure',config:map,selected,round }
  const send = () => frame.current?.contentWindow?.postMessage(config.current, location.origin)
  useEffect(() => {
    const message = e => {
      const m=e.data
      if(e.source!==frame.current?.contentWindow||e.origin!==location.origin||m?.type!=='esan:geoduelo-map'||m.session!==session)return
      if(m.action==='ready')send()
      if(m.action==='point'&&m.round===config.current.round&&Array.isArray(m.point)&&m.point.length===2&&m.point.every(Number.isFinite))callback.current?.(m.point)
    }
    addEventListener('message',message);return()=>removeEventListener('message',message)
  },[session])
  useEffect(send,[map,selected,round,session])
  return <iframe className="geo-online-globe" ref={frame} title="Globo interactivo de la pregunta" src={`./juegos/geoduelo/online-map.html#session=${session}`} onLoad={send}/>
}

export default memo(GeodueloGlobe)
