import { useEffect, useRef, useState } from 'react'
import OfficialIcon from '../../shared/components/OfficialIcon.jsx'
import { resourceUrl, resourceError, wordCount, resourceIconSources } from './resourceModel.js'
import './ResourceDirectory.css'

function ResourceLogo({ url }) {
  // Remount on URL changes so a previous failure cannot hide a new icon.
  return <ResourceLogoImage key={url} url={url}/>
}
function ResourceLogoImage({ url }) {
  const [sources] = useState(() => resourceIconSources(url))
  const [index, setIndex] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const source = sources[index]
  const advance = () => {
    setLoaded(false)
    setIndex(previous => previous === index ? previous + 1 : previous)
  }
  useEffect(() => {
    if (!source || loaded) return
    const timer = setTimeout(() => {
      setLoaded(false)
      setIndex(previous => previous === index ? previous + 1 : previous)
    }, 4500)
    return () => clearTimeout(timer)
  }, [source, index, loaded])
  return <span className="rc-logo" aria-hidden="true">
    {!loaded && <OfficialIcon name="link" size={20}/>}
    {source && <img key={source} src={source} alt="" width="24" height="24" decoding="async" referrerPolicy="no-referrer"
      style={loaded ? undefined : { display: 'none' }}
      onLoad={e => { if (e.currentTarget.naturalWidth > 1 && e.currentTarget.naturalHeight > 1) setLoaded(true); else advance() }}
      onError={advance}/>}
  </span>
}
export default function ResourceDirectory({ client, user, onBusy }) {
  const [items, setItems] = useState([]), [total, setTotal] = useState(0), [page, setPage] = useState(0)
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [sort, setSort] = useState('recent'), [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({ name: '', url: '', description: '' }), [editing, setEditing] = useState(null), [description, setDescription] = useState('')
  const alive = useRef(true), lock = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setPage(0) }, 250); return () => clearTimeout(timer) }, [query])
  useEffect(() => {
    let current = true
    if (!client || !user) { setLoading(false); return }
    setLoading(true); setError('')
    client.rpc('resource_page', { search_text: search, sort_order: sort, page_offset: page * 50 }).then(({ data, error }) => {
      if (!current) return
      if (error) { setError('No se pudieron cargar los recursos. Reintenta.'); return }
      setItems(data?.items || []); setTotal(data?.total || 0)
    }).catch(() => { if (current) setError('No se pudieron cargar los recursos. Reintenta.') }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [client, user?.id, search, sort, page, retry])
  async function mutate(work) {
    if (lock.current) return
    if (!user || !client) { setNotice(resourceError(new Error('NO_AUTH'))); return }
    lock.current = true; setBusy(true); onBusy(true); setNotice('')
    try {
      const verified = await client.auth.getUser()
      if (verified.error || verified.data.user?.id !== user.id) throw new Error('NO_AUTH')
      await work()
    } catch (e) { if (alive.current) setNotice(resourceError(e)) }
    finally { lock.current = false; onBusy(false); if (alive.current) setBusy(false) }
  }
  async function rpc(name, args) { const r = await client.rpc(name, args); if (r.error) throw r.error; return r.data }
  function publish(e) {
    e.preventDefault()
    mutate(async () => {
      if (wordCount(draft.description) > 25) throw new Error('RESOURCE_DESCRIPTION')
      await rpc('publish_resource', { resource_name: draft.name.trim(), resource_url: resourceUrl(draft.url), resource_description: draft.description.trim() })
      if (alive.current) { setDraft({ name: '', url: '', description: '' }); setQuery(''); setSearch(''); setPage(0); setSort('recent'); setRetry(n => n + 1); setNotice('Recurso publicado.') }
    })
  }
  function heart(item) {
    mutate(async () => {
      const result = await rpc('toggle_resource_heart', { resource_id: item.id })
      if (alive.current) setItems(previous => previous.map(r => r.id === item.id ? { ...r, ...result } : r))
    })
  }
  function saveDescription(e) {
    e.preventDefault(); const id = editing
    mutate(async () => {
      if (wordCount(description) > 25) throw new Error('RESOURCE_DESCRIPTION')
      await rpc('edit_resource_description', { resource_id: id, resource_description: description.trim() })
      if (alive.current) { setItems(previous => previous.map(r => r.id === id ? { ...r, description: description.trim() } : r)); setEditing(null); setNotice('Comentario actualizado.') }
    })
  }
  return <div className="rc-wrap"><h2 className="s-h">Recursos</h2><p className="s-sub">Sitios y herramientas que recomienda la comunidad.</p>
    <form className="blk rc-form" onSubmit={publish}><div className="rc-fh"><span className="rc-me"><OfficialIcon name="link" size={15}/></span><b>Comparte un recurso</b></div>
      {!user && <p className="rc-notice">Inicia sesión para compartir recursos y darles corazón.</p>}
      <fieldset disabled={busy || !user}><div className="rc-fg"><label>Nombre<input className="rc-in" required minLength={2} maxLength={60} value={draft.name} placeholder="Ej. Notion" onChange={e => setDraft(v => ({ ...v, name: e.target.value }))}/></label><label>Enlace<input className="rc-in" required maxLength={2048} value={draft.url} placeholder="Ej. notion.so" onChange={e => setDraft(v => ({ ...v, url: e.target.value }))}/></label></div>
        <label>¿Para qué sirve? <span className="rc-optional">Opcional</span><textarea className="rc-in" rows={2} maxLength={500} value={draft.description} aria-describedby="resource-word-count" onChange={e => setDraft(v => ({ ...v, description: e.target.value }))}/></label><div className="rc-fr"><small id="resource-word-count">{wordCount(draft.description)} / 25 palabras. Solo tú puedes editar este comentario.</small><button className="mk" type="submit" disabled={wordCount(draft.description) > 25}>{busy ? 'Guardando…' : 'Publicar'}</button></div>
      </fieldset>
    </form><p className="rc-status" role="status" aria-live="polite">{notice}</p>
    <label className="s-srch rc-srch"><OfficialIcon name="search"/><input type="search" aria-label="Buscar recursos" placeholder="Buscar un recurso o enlace" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button aria-label="Borrar búsqueda" onClick={() => setQuery('')}><OfficialIcon name="close" size={15}/></button>}</label>
    <div className="rc-sorts" role="group" aria-label="Ordenar recursos">{[['recent', 'Recientes'], ['hearts', 'Más corazones'], ['name', 'Nombre A–Z']].map(([id, label]) => <button key={id} className={`r-chip${sort === id ? ' on' : ''}`} aria-pressed={sort === id} onClick={() => { setSort(id); setPage(0) }}>{label}</button>)}</div>
    {loading ? <p role="status">Cargando recursos…</p> : error ? <div role="alert"><p>{error}</p><button className="h-btn" onClick={() => setRetry(n => n + 1)}>Reintentar</button></div> : <><p className="rc-meta" role="status">{total} {total === 1 ? 'recurso' : 'recursos'}{search ? ` para «${search}»` : ' disponibles'}</p><ol className="rc-list" start={page * 50 + 1}>{items.map((r, i) => <li className="rc-item" key={r.id}><span className="rc-rank">{page * 50 + i + 1}</span><ResourceLogo url={r.url}/><div className="rc-content"><h3><a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}<OfficialIcon name="arrow" size={14}/></a></h3><span className="rc-domain">{new URL(r.url).hostname.replace(/^www\./, '')}</span>{r.description && <p className="rc-description">{r.description}</p>}
        {r.is_owner && (editing === r.id ? <form className="rc-edit" onSubmit={saveDescription}><label>Comentario del autor<textarea className="rc-in" maxLength={500} rows={2} value={description} disabled={busy} onChange={e => setDescription(e.target.value)}/></label><small>{wordCount(description)} / 25 palabras</small><div><button type="submit" className="h-btn" disabled={busy || wordCount(description) > 25}>Guardar comentario</button><button type="button" className="h-btn" disabled={busy} onClick={() => setEditing(null)}>Cancelar</button></div></form> : <button className="rc-edit-link" disabled={busy} onClick={() => { setEditing(r.id); setDescription(r.description || '') }}>{r.description ? 'Editar comentario' : 'Añadir comentario'}</button>)}
      </div><button className={`rc-heart${r.liked ? ' on' : ''}`} disabled={busy || !user} aria-pressed={r.liked} aria-label={`${r.liked ? 'Quitar' : 'Dar'} corazón a ${r.name}`} onClick={() => heart(r)}><svg width="18" height="18" viewBox="0 0 24 24" fill={r.liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg><span>{r.hearts}</span></button><a className="rc-open" href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${r.name}`}><OfficialIcon name="link" size={17}/></a></li>)}</ol>
      {!items.length && <div className="rc-empty"><h3>{search ? 'No encontramos ese recurso' : 'Todavía no hay recursos compartidos'}</h3><p>{search ? 'Prueba con otro nombre o borra la búsqueda.' : 'Comparte el primer enlace para tu comunidad.'}</p></div>}
      {total > 50 && <nav className="rc-pagination" aria-label="Páginas de recursos"><button className="h-btn" disabled={!page} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page + 1} de {Math.ceil(total / 50)}</span><button className="h-btn" disabled={(page + 1) * 50 >= total} onClick={() => setPage(p => p + 1)}>Siguiente</button></nav>}</>}
  </div>
}
