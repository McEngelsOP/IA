import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { CAREER_KEYS, careerLabel } from '../data/careerOptions.js'
import '../styles/AdminPanel.css'

export default function AdminPanel({ onClose }) {
  const [activeTab, setActiveTab] = useState('users') // 'users' | 'moderation' | 'stats'
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Datos
  const [users, setUsers] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [commentsData, setCommentsData] = useState({ course_comments: [], tool_comments: [] })
  const [commentSearch, setCommentSearch] = useState('')
  const [stats, setStats] = useState(null)

  // Modales personalizados de diálogo
  const [carreraModalUser, setCarreraModalUser] = useState(null) // usuario a cambiar carrera
  const [selectedCarrera, setSelectedCarrera] = useState('')
  const [confirmDialog, setConfirmDialog] = useState(null) // { title, text, onConfirm }

  // Cargar datos según la pestaña activa
  const loadData = async () => {
    setLoading(true)
    setErrorMsg('')
    try {
      if (activeTab === 'users') {
        const { data, error } = await supabase.rpc('admin_get_users')
        if (error) throw error
        setUsers(data || [])
      } else if (activeTab === 'moderation') {
        const { data, error } = await supabase.rpc('admin_get_all_comments')
        if (error) throw error
        setCommentsData(data || { course_comments: [], tool_comments: [] })
      } else if (activeTab === 'stats') {
        const { data, error } = await supabase.rpc('admin_get_stats')
        if (error) throw error
        setStats(data || null)
      }
    } catch (err) {
      console.error('[AdminPanel]', err)
      setErrorMsg(err.message || 'Error al cargar datos de administración')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [activeTab])

  // Abrir modal de carrera
  const openCarreraModal = (u) => {
    setCarreraModalUser(u)
    setSelectedCarrera(u.carrera || '')
  }

  const handleSaveCarrera = async () => {
    if (!carreraModalUser) return
    const val = selectedCarrera.trim() || null
    try {
      const { error } = await supabase.rpc('admin_update_user_carrera', {
        target_id: carreraModalUser.id,
        new_carrera: val
      })
      if (error) throw error
      setSuccessMsg(`Carrera de ${carreraModalUser.student_code} actualizada a "${val || 'sin elegir'}"`)
      setTimeout(() => setSuccessMsg(''), 3500)
      setCarreraModalUser(null)
      loadData()
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  // Liberar alias
  const handleClearAlias = (u) => {
    if (!u.alias) return alert('El usuario no tiene un alias asignado')
    setConfirmDialog({
      title: 'Liberar Alias',
      text: `¿Seguro que deseas eliminar el alias "${u.alias}" de ${u.student_code}? Esta acción permitirá al alumno elegir un nuevo alias.`,
      onConfirm: async () => {
        try {
          const { error } = await supabase.rpc('admin_clear_user_alias', { target_id: u.id })
          if (error) throw error
          setSuccessMsg(`Alias de ${u.student_code} liberado correctamente`)
          setTimeout(() => setSuccessMsg(''), 3500)
          setConfirmDialog(null)
          loadData()
        } catch (err) {
          alert('Error: ' + err.message)
        }
      }
    })
  }

  // Eliminar comentario
  const handleDeleteComment = (commentId, type, authorCode) => {
    const isCourse = type === 'course'
    setConfirmDialog({
      title: `Eliminar ${isCourse ? 'Reseña de Curso' : 'Comentario de Herramienta'}`,
      text: `¿Seguro que deseas eliminar el comentario publicado por ${authorCode}? Esta acción no se puede deshacer.`,
      onConfirm: async () => {
        try {
          const { error } = await supabase.rpc('admin_delete_comment', {
            comment_id: commentId,
            comment_type: type
          })
          if (error) throw error
          setSuccessMsg('Comentario eliminado')
          setTimeout(() => setSuccessMsg(''), 3500)
          setConfirmDialog(null)
          loadData()
        } catch (err) {
          alert('Error: ' + err.message)
        }
      }
    })
  }

  // Filtros de búsqueda
  const filteredUsers = users.filter(u =>
    (u.student_code || '').toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.alias || '').toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.carrera || '').toLowerCase().includes(userSearch.toLowerCase())
  )

  const filteredCourseComments = (commentsData.course_comments || []).filter(c =>
    (c.student_code || '').toLowerCase().includes(commentSearch.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(commentSearch.toLowerCase()) ||
    (c.body || '').toLowerCase().includes(commentSearch.toLowerCase()) ||
    (c.course_id || '').toLowerCase().includes(commentSearch.toLowerCase())
  )

  const filteredToolComments = (commentsData.tool_comments || []).filter(c =>
    (c.student_code || '').toLowerCase().includes(commentSearch.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(commentSearch.toLowerCase()) ||
    (c.body || '').toLowerCase().includes(commentSearch.toLowerCase()) ||
    (c.tool_name || '').toLowerCase().includes(commentSearch.toLowerCase())
  )

  const totalComments = (commentsData.course_comments?.length || 0) + (commentsData.tool_comments?.length || 0)

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        
        {/* Header de Administración */}
        <div className="admin-header">
          <div className="admin-header-title">
            <div className="admin-header-icon">⚙️</div>
            <div>
              <h2>Panel de Administración</h2>
              <p>Gestiona alumnos, modera reseñas comunitarias y monitorea la app</p>
            </div>
          </div>
          <button className="admin-close-btn" onClick={onClose} title="Cerrar panel">✕</button>
        </div>

        {/* Pestañas de navegación */}
        <div className="admin-tabs">
          <button
            className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            <span>👥 Alumnos</span>
            <span className="admin-tab-count">{users.length}</span>
          </button>

          <button
            className={`admin-tab ${activeTab === 'moderation' ? 'active' : ''}`}
            onClick={() => setActiveTab('moderation')}
          >
            <span>🛡️ Moderación</span>
            <span className="admin-tab-count">{totalComments}</span>
          </button>

          <button
            className={`admin-tab ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab('stats')}
          >
            <span>📊 Estadísticas</span>
          </button>
        </div>

        {/* Cuerpo del modal */}
        <div className="admin-body">
          {errorMsg && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626', padding: '12px 16px', borderRadius: 12, marginBottom: 16, fontSize: '0.88rem' }}>
              ⚠️ {errorMsg}
            </div>
          )}

          {successMsg && (
            <div style={{ background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#059669', padding: '12px 16px', borderRadius: 12, marginBottom: 16, fontSize: '0.88rem' }}>
              ✅ {successMsg}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>🔄</div>
              <div>Cargando información del servidor...</div>
            </div>
          ) : activeTab === 'users' ? (
            <div>
              <div className="admin-search-wrapper">
                <span className="admin-search-icon">🔍</span>
                <input
                  type="text"
                  className="admin-search-input"
                  placeholder="Buscar por código de alumno, correo, carrera o alias..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                />
              </div>

              <div className="admin-table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Correo registrado</th>
                      <th>Carrera</th>
                      <th>Alias (Firma)</th>
                      <th>Rol</th>
                      <th style={{ textAlign: 'right' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
                          No se encontraron estudiantes registrados con ese criterio.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map(u => (
                        <tr key={u.id}>
                          <td style={{ fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                            {u.student_code}
                          </td>
                          <td style={{ color: '#64748b' }}>{u.email}</td>
                          <td>
                            <span className={`admin-badge ${u.carrera || 'none'}`}>
                              {careerLabel(u.carrera)}
                            </span>
                          </td>
                          <td style={{ fontStyle: u.alias ? 'italic' : 'normal', opacity: u.alias ? 1 : 0.4 }}>
                            {u.alias ? `"${u.alias}"` : '—'}
                          </td>
                          <td>
                            {u.is_admin ? (
                              <span style={{ color: '#0284c7', fontWeight: 700, fontSize: '0.8rem' }}>⭐ Admin</span>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Alumno</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="admin-action-btn"
                              onClick={() => openCarreraModal(u)}
                              title="Cambiar carrera"
                            >
                              ✏️ Carrera
                            </button>
                            <button
                              className="admin-action-btn danger"
                              onClick={() => handleClearAlias(u)}
                              title="Liberar alias"
                            >
                              🔄 Alias
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeTab === 'moderation' ? (
            <div>
              <div className="admin-search-wrapper">
                <span className="admin-search-icon">🔍</span>
                <input
                  type="text"
                  className="admin-search-input"
                  placeholder="Buscar en el contenido del comentario, código, correo o id de curso/herramienta..."
                  value={commentSearch}
                  onChange={e => setCommentSearch(e.target.value)}
                />
              </div>

              <h3 style={{ marginTop: 0, fontSize: '1rem', fontWeight: 700, color: '#38bdf8' }}>
                Reseñas de Cursos ({filteredCourseComments.length})
              </h3>
              {filteredCourseComments.length === 0 ? (
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', padding: 20, borderRadius: 12, textAlign: 'center', color: '#94a3b8', fontSize: '0.88rem', marginBottom: 24 }}>
                  No hay reseñas de cursos que coincidan.
                </div>
              ) : (
                filteredCourseComments.map(c => (
                  <div key={c.id} className="admin-comment-card">
                    <div className="admin-comment-header">
                      <span>
                        <strong className="admin-comment-author">{c.student_code}</strong> ({c.email}) · Alias: <em>{c.alias}</em> · Curso: <strong style={{ color: '#38bdf8' }}>{c.course_id}</strong>
                      </span>
                      <span>{new Date(c.created_at).toLocaleDateString('es-PE')}</span>
                    </div>
                    <div className="admin-comment-body">{c.body}</div>
                    <button
                      className="admin-action-btn danger"
                      onClick={() => handleDeleteComment(c.id, 'course', c.student_code)}
                    >
                      🗑️ Eliminar Reseña
                    </button>
                  </div>
                ))
              )}

              <h3 style={{ marginTop: 24, fontSize: '1rem', fontWeight: 700, color: '#c084fc' }}>
                Comentarios de Herramientas ({filteredToolComments.length})
              </h3>
              {filteredToolComments.length === 0 ? (
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', padding: 20, borderRadius: 12, textAlign: 'center', color: '#94a3b8', fontSize: '0.88rem' }}>
                  No hay comentarios de herramientas que coincidan.
                </div>
              ) : (
                filteredToolComments.map(t => (
                  <div key={t.id} className="admin-comment-card">
                    <div className="admin-comment-header">
                      <span>
                        <strong className="admin-comment-author">{t.student_code}</strong> ({t.email}) · Alias: <em>{t.alias}</em> · Herramienta: <strong style={{ color: '#c084fc' }}>{t.tool_name || t.tool_id}</strong>
                      </span>
                      <span>{new Date(t.created_at).toLocaleDateString('es-PE')}</span>
                    </div>
                    <div className="admin-comment-body">{t.body}</div>
                    <button
                      className="admin-action-btn danger"
                      onClick={() => handleDeleteComment(t.id, 'tool', t.student_code)}
                    >
                      🗑️ Eliminar Comentario
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : activeTab === 'stats' && stats ? (
            <div>
              <div className="admin-stats-grid">
                <div className="admin-stat-card">
                  <div className="admin-stat-icon blue">👥</div>
                  <div>
                    <div className="admin-stat-number">{stats.total_students || 0}</div>
                    <div className="admin-stat-label">Alumnos Registrados</div>
                  </div>
                </div>

                <div className="admin-stat-card">
                  <div className="admin-stat-icon purple">💬</div>
                  <div>
                    <div className="admin-stat-number">{stats.total_course_comments || 0}</div>
                    <div className="admin-stat-label">Reseñas de Cursos</div>
                  </div>
                </div>

                <div className="admin-stat-card">
                  <div className="admin-stat-icon amber">🛠️</div>
                  <div>
                    <div className="admin-stat-number">{stats.total_tool_comments || 0}</div>
                    <div className="admin-stat-label">Comentarios en Herramientas</div>
                  </div>
                </div>

                <div className="admin-stat-card">
                  <div className="admin-stat-icon emerald">👨‍🏫</div>
                  <div>
                    <div className="admin-stat-number">{stats.total_professors || 0}</div>
                    <div className="admin-stat-label">Profesores Registrados</div>
                  </div>
                </div>

                <div className="admin-stat-card">
                  <div className="admin-stat-icon rose">⭐</div>
                  <div>
                    <div className="admin-stat-number">{stats.total_difficulty_votes || 0}</div>
                    <div className="admin-stat-label">Votos de Dificultad</div>
                  </div>
                </div>
              </div>

              {/* Distribución por carrera */}
              <div className="admin-carrera-box">
                <h4>Distribución de Estudiantes por Carrera</h4>
                <div className="admin-carrera-list">
                  {Object.entries(stats.students_by_carrera || {}).map(([key, count]) => (
                    <div key={key} className="admin-carrera-item">
                      <span className={`admin-badge ${key}`}>
                        {careerLabel(key)}
                      </span>
                      <strong style={{ fontSize: '1.1rem', fontFamily: 'JetBrains Mono, monospace' }}>{count}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Modal para cambiar Carrera */}
      {carreraModalUser && (
        <div className="admin-dialog-overlay" onClick={() => setCarreraModalUser(null)}>
          <div className="admin-dialog" onClick={e => e.stopPropagation()}>
            <h3>Cambiar carrera de {carreraModalUser.student_code}</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: 16 }}>
              Selecciona la nueva carrera asignada a este alumno o déjala sin elegir:
            </p>
            <select
              className="admin-dialog-select"
              value={selectedCarrera}
              onChange={e => setSelectedCarrera(e.target.value)}
            >
              <option value="">Sin elegir (pantalla de selección)</option>
              {CAREER_KEYS.map(key => <option key={key} value={key}>{careerLabel(key)}</option>)}
            </select>
            <div className="admin-dialog-actions">
              <button className="admin-action-btn" onClick={() => setCarreraModalUser(null)}>Cancelar</button>
              <button className="admin-action-btn" style={{ background: '#0284c7', color: '#fff', borderColor: '#0284c7' }} onClick={handleSaveCarrera}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación genérico */}
      {confirmDialog && (
        <div className="admin-dialog-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="admin-dialog" onClick={e => e.stopPropagation()}>
            <h3>{confirmDialog.title}</h3>
            <p style={{ fontSize: '0.88rem', color: '#64748b', marginBottom: 20, lineHeight: 1.4 }}>
              {confirmDialog.text}
            </p>
            <div className="admin-dialog-actions">
              <button className="admin-action-btn" onClick={() => setConfirmDialog(null)}>Cancelar</button>
              <button className="admin-action-btn danger" onClick={confirmDialog.onConfirm}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
