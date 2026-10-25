import { useEffect, useState } from 'react'

const PAGE_SIZE = 20

export default function ResourceComments({ resourceId, client, user }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(0), [retry, setRetry] = useState(0)
  const [comments, setComments] = useState([]), [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  useEffect(() => {
    if (!open || !client || !user) return
    let current = true
    setLoading(true); setError('')
    // Explicit public columns preserve the aliases' anonymity. Never select author_id.
    Promise.resolve(client.from('tool_comments').select('id,alias,body,created_at')
      .eq('tool_id', resourceId).order('created_at', { ascending: false }).order('id')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)).then(({ data, error }) => {
      if (!current) return
      if (error) throw error
      setComments((data || []).slice(0, PAGE_SIZE)); setHasMore((data || []).length > PAGE_SIZE)
    }).catch(() => { if (current) setError('No se pudieron cargar los comentarios. Reintenta.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [open, client, user?.id, resourceId, page, retry])

  return <details className="rc-comments" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Comentarios de la comunidad</summary>
    {!user ? <p>Inicia sesión para leer los comentarios.</p> : loading ? <p role="status">Cargando comentarios…</p>
      : error ? <div role="alert"><p>{error}</p><button type="button" className="h-btn" onClick={() => setRetry(n => n + 1)}>Reintentar comentarios</button></div>
        : <><ul className="rc-comment-list">{comments.map(comment => <li key={comment.id}>
          <strong>{comment.alias}</strong><p>{comment.body}</p>
        </li>)}</ul>
          {!comments.length && <p>Todavía no hay comentarios sobre esta herramienta.</p>}
          {(page > 0 || hasMore) && <nav className="rc-comment-pages" aria-label="Páginas de comentarios">
            <button type="button" className="h-btn" disabled={!page} onClick={() => setPage(n => n - 1)}>Comentarios anteriores</button>
            <span>Página {page + 1}</span>
            <button type="button" className="h-btn" disabled={!hasMore} onClick={() => setPage(n => n + 1)}>Más comentarios</button>
          </nav>}
        </>}
  </details>
}
