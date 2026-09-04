import React from 'react'
import '../styles/MallaSidebar.css'

export default function MallaSidebar({
  mode,
  onSelectMode,
  isGuest,
  areas = {},
  activeAreas = [],
  selectedArea,
  onSelectArea,
  collapsed,
  onToggleCollapse
}) {
  const MODOS = [
    { id: 'open', label: 'Qué abre', desc: 'Desbloqueos en cadena' },
    { id: 'req', label: 'Qué requiere', desc: 'Prerrequisitos previos' },
    { id: 'done', label: 'Marcar llevados', desc: 'Actualizar avance propio' },
    { id: 'noreq', label: 'Qué puedo llevar', desc: 'Disponibles con tus llevados' },
    { id: 'plan', label: 'Planificar ciclo', desc: 'Armar tu próximo ciclo' },
    ...(!isGuest ? [{ id: 'ficha', label: 'Ficha del curso', desc: 'Notas, profes y reseñas' }] : [])
  ]

  // Si no se especifica activeAreas, usar todas las de areas
  const areaKeys = activeAreas.length > 0 ? activeAreas : Object.keys(areas)

  return (
    <aside className={`aa-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Navegación e índice">
      <div className="aa-sidebar-content">
        <div className="aa-sidebar-section">
          <div className="aa-sidebar-title mono">
            {collapsed ? '■' : '■ MODOS DE VISTA'}
          </div>
          <nav className="aa-sidebar-nav">
            {MODOS.map(m => {
              const isActive = mode === m.id
              return (
                <button
                  key={m.id}
                  className={`aa-sidebar-item ${isActive ? 'active' : ''}`}
                  onClick={() => onSelectMode(m.id)}
                  title={`${m.label}: ${m.desc}`}
                >
                  <span className="aa-bullet" aria-hidden="true">■</span>
                  {!collapsed && <span className="aa-label">{m.label}</span>}
                </button>
              )
            })}
          </nav>
        </div>

        {areaKeys.length > 0 && (
          <div className="aa-sidebar-section">
            <div className="aa-sidebar-title mono">
              {collapsed ? '■' : '■ ÁREAS TEMÁTICAS'}
            </div>
            {!collapsed && selectedArea && (
              <button
                className="aa-clear-area"
                onClick={() => onSelectArea(null)}
              >
                × Ver todas las áreas
              </button>
            )}
            <div className="aa-sidebar-nav">
              {areaKeys.map(k => {
                const a = areas[k]
                if (!a) return null
                const isSelected = selectedArea === k
                return (
                  <button
                    key={k}
                    className={`aa-sidebar-item area-item ${isSelected ? 'active' : ''}`}
                    onClick={() => onSelectArea(isSelected ? null : k)}
                    title={a.label}
                  >
                    <span
                      className="aa-bullet"
                      style={{ color: a.color }}
                      aria-hidden="true"
                    >
                      ■
                    </span>
                    {!collapsed && <span className="aa-label">{a.label}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="aa-sidebar-footer">
        <button
          className="aa-collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expandir índice' : 'Colapsar índice'}
          aria-label={collapsed ? 'Expandir índice' : 'Colapsar índice'}
        >
          {collapsed ? '»' : '« Contraer índice'}
        </button>
      </div>
    </aside>
  )
}
