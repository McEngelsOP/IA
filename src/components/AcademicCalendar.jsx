import { useState, useEffect, useMemo } from 'react'
import { CALENDARIO_POR_UNI, TIPOS_EVENTO, COLORES_PERSONAL } from '../data/calendario'
import useMediaQuery from '../lib/useMediaQuery'
import '../styles/AcademicCalendar.css'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

// Máximo de pastillas visibles por celda; el resto se agrupa en «+N más»
const MAX_PILLS = 3

const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate()

// Día de la semana en que empieza el mes, con lunes como 0
const getFirstDayOfMonth = (year, month) => {
  const day = new Date(year, month, 1).getDay()
  return day === 0 ? 6 : day - 1
}

const toDateString = (year, month, day) =>
  `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

// «viernes 23 de octubre» para popups y listas
const fmtLargo = dateStr => {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long'
  })
}

const fechaDeEvento = e => e.date
  ? fmtLargo(e.date)
  : `Del ${fmtLargo(e.start)} al ${fmtLargo(e.end)}`

export default function AcademicCalendar({ user, uni, onClose }) {
  // Cada universidad ve SOLO su calendario oficial (la PUCP aún no tiene:
  // sus alumnos usan el calendario solo para eventos personales)
  const cal = CALENDARIO_POR_UNI[uni] || { titulo: 'Calendario', eventos: [] }

  // En pantallas chicas los eventos se ven como puntos de color y tocar
  // el día abre su lista completa (las celdas no dan para texto legible)
  const isMobile = useMediaQuery('(max-width: 720px)')

  const hoy = new Date()
  const hoyStr = toDateString(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const [currentDate, setCurrentDate] = useState(new Date(hoy.getFullYear(), hoy.getMonth(), 1))
  // { mode: 'view'|'create'|'edit'|'day', event?, date? }
  const [modalConfig, setModalConfig] = useState(null)
  const [formColor, setFormColor] = useState('gris') // color elegido para el evento personal

  // Eventos personales: por usuario y solo en este dispositivo (localStorage)
  const storageKey = `malla-cal-${user?.id || 'guest'}`
  const [customEvents, setCustomEvents] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored ? JSON.parse(stored) : []
    } catch { return [] }
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(customEvents))
    } catch { /* almacenamiento lleno o bloqueado */ }
  }, [customEvents, storageKey])

  // Escape cierra el popup abierto; si no hay ninguno, cierra el calendario
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return
      setModalConfig(prev => {
        if (prev) return null
        onClose()
        return prev
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))
  const goToday = () => setCurrentDate(new Date(hoy.getFullYear(), hoy.getMonth(), 1))

  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(year, month)
    const firstDay = getFirstDayOfMonth(year, month)
    const allEvents = [...cal.eventos, ...customEvents]
    const days = []

    for (let i = 0; i < firstDay; i++) days.push({ empty: true })

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = toDateString(year, month, d)
      const dayEvents = allEvents.filter(e => {
        if (e.date === dateStr) return true
        if (e.start && e.end) return dateStr >= e.start && dateStr <= e.end
        return false
      })
      days.push({ date: d, dateStr, events: dayEvents })
    }

    return days
  }, [year, month, customEvents, cal.eventos])

  const openCreate = dateStr => {
    setFormColor('gris')
    setModalConfig({ mode: 'create', date: dateStr })
  }

  // Móvil: tocar un día con eventos abre su lista; sin eventos, crea uno
  const handleCellTap = d => {
    if (d.empty) return
    if (isMobile && d.events.length > 0) {
      setModalConfig({ mode: 'day', date: d.dateStr, events: d.events })
    } else {
      openCreate(d.dateStr)
    }
  }

  const openEvent = e => {
    if (e.type === 'custom') {
      setFormColor(e.color || 'gris')
      setModalConfig({ mode: 'edit', event: e })
    } else {
      setModalConfig({ mode: 'view', event: e })
    }
  }

  const handleSaveCustom = e => {
    e.preventDefault()
    const form = new FormData(e.target)
    const title = form.get('title').trim()
    const desc = form.get('desc').trim()
    if (!title) return

    if (modalConfig.mode === 'create') {
      setCustomEvents([...customEvents, {
        id: `custom-${Date.now()}`,
        title,
        desc,
        date: modalConfig.date,
        type: 'custom',
        color: formColor
      }])
    } else if (modalConfig.mode === 'edit') {
      setCustomEvents(customEvents.map(ev =>
        ev.id === modalConfig.event.id ? { ...ev, title, desc, color: formColor } : ev
      ))
    }
    setModalConfig(null)
  }

  const handleDeleteCustom = () => {
    if (modalConfig?.mode !== 'edit') return
    setCustomEvents(customEvents.filter(ev => ev.id !== modalConfig.event.id))
    setModalConfig(null)
  }

  // Clase de color de una pastilla: tipo oficial (t-*) o color personal (c-*)
  const pillClass = e => e.type === 'custom'
    ? `acad-cal-pill is-custom c-${e.color || 'gris'}`
    : `acad-cal-pill t-${e.type}`

  // Tipos presentes en el calendario oficial, para la leyenda
  const tiposEnUso = useMemo(() => {
    const set = new Set(cal.eventos.map(e => e.type))
    return Object.keys(TIPOS_EVENTO).filter(t => set.has(t) || t === 'custom')
  }, [cal.eventos])

  return (
    <div className="acad-cal-backdrop">
      <div className="acad-cal-container">
        <header className="acad-cal-header">
          <div className="acad-cal-title-box">
            <button className="acad-cal-back" onClick={onClose} aria-label="Volver">←</button>
            <div className="acad-cal-title">
              <span className="acad-cal-icon">📅</span>
              <h1>{cal.titulo}</h1>
            </div>
          </div>

          <div className="acad-cal-controls">
            <span className="acad-cal-current-month">
              {MESES[month]} de {year}
            </span>
            <div className="acad-cal-nav">
              <button onClick={goToday}>Hoy</button>
              <button onClick={prevMonth} aria-label="Mes anterior">‹</button>
              <button onClick={nextMonth} aria-label="Mes siguiente">›</button>
            </div>
          </div>
        </header>

        <div className="acad-cal-legend">
          {tiposEnUso.map(t => (
            <span key={t} className="acad-cal-legend-item">
              <span className={`acad-cal-dot ${t === 'custom' ? 'c-gris' : 't-' + t}`} />
              {TIPOS_EVENTO[t].label}
            </span>
          ))}
          {cal.eventos.length === 0 && (
            <span className="acad-cal-legend-hint">
              Tu universidad aún no tiene fechas oficiales cargadas: usa el calendario para tus propios eventos.
            </span>
          )}
        </div>

        <div className="acad-cal-grid-header">
          <span>Lun</span>
          <span>Mar</span>
          <span>Mié</span>
          <span>Jue</span>
          <span>Vie</span>
          <span>Sáb</span>
          <span>Dom</span>
        </div>

        <div className="acad-cal-grid">
          {calendarDays.map((d, i) => (
            <div
              key={i}
              className={`acad-cal-cell ${d.empty ? 'empty' : 'clickable'}${!d.empty && d.dateStr < hoyStr ? ' past' : ''}`}
              onClick={() => handleCellTap(d)}
            >
              {!d.empty && (
                <>
                  <button
                    className="acad-cal-add"
                    onClick={ev => { ev.stopPropagation(); openCreate(d.dateStr) }}
                    title="Agregar evento personal"
                    aria-label={`Agregar evento el ${fmtLargo(d.dateStr)}`}
                  >+</button>
                  <span className={`acad-cal-date-num${d.dateStr === hoyStr ? ' today' : ''}`}>
                    {d.date}
                  </span>
                  <div className="acad-cal-events">
                    {d.events.slice(0, isMobile ? 8 : MAX_PILLS).map(e => (
                      <div
                        key={e.id}
                        className={`${pillClass(e)}${e.start && d.dateStr !== e.start ? ' cont' : ''}${isMobile ? ' dot-mode' : ''}`}
                        onClick={isMobile ? undefined : ev => { ev.stopPropagation(); openEvent(e) }}
                        title={e.title}
                      >
                        {isMobile ? '' : e.title}
                      </div>
                    ))}
                    {!isMobile && d.events.length > MAX_PILLS && (
                      <button
                        className="acad-cal-more"
                        onClick={ev => {
                          ev.stopPropagation()
                          setModalConfig({ mode: 'day', date: d.dateStr, events: d.events })
                        }}
                      >
                        +{d.events.length - MAX_PILLS} más
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {modalConfig && (
          <div className="acad-cal-popup-backdrop" onClick={() => setModalConfig(null)}>
            <div className="acad-cal-popup" onClick={e => e.stopPropagation()}>

              {modalConfig.mode === 'view' && (
                <>
                  <header className="acad-cal-popup-head">
                    <span className={`acad-cal-popup-type t-${modalConfig.event.type}`}>
                      {TIPOS_EVENTO[modalConfig.event.type].label}
                    </span>
                    <button className="acad-cal-popup-close" onClick={() => setModalConfig(null)} aria-label="Cerrar">×</button>
                  </header>
                  <h2 className="acad-cal-popup-title">{modalConfig.event.title}</h2>
                  <div className="acad-cal-popup-date">📅 {fechaDeEvento(modalConfig.event)}</div>
                  <p className="acad-cal-popup-desc">{modalConfig.event.desc}</p>
                  <p className="acad-cal-popup-note">Fecha oficial de la universidad · no se puede editar</p>
                </>
              )}

              {modalConfig.mode === 'day' && (
                <>
                  <header className="acad-cal-popup-head">
                    <h3 className="acad-cal-form-title">{fmtLargo(modalConfig.date)}</h3>
                    <button className="acad-cal-popup-close" onClick={() => setModalConfig(null)} aria-label="Cerrar">×</button>
                  </header>
                  <div className="acad-cal-day-list">
                    {modalConfig.events.map(e => (
                      <button key={e.id} className={pillClass(e) + ' block'} onClick={() => openEvent(e)}>
                        {e.title}
                      </button>
                    ))}
                  </div>
                  <div className="acad-cal-form-actions">
                    <div className="spacer" />
                    <button type="button" className="acad-cal-btn-save" onClick={() => openCreate(modalConfig.date)}>
                      + Evento personal
                    </button>
                  </div>
                </>
              )}

              {(modalConfig.mode === 'create' || modalConfig.mode === 'edit') && (
                <form onSubmit={handleSaveCustom} className="acad-cal-form">
                  <header className="acad-cal-popup-head">
                    <h3 className="acad-cal-form-title">
                      {modalConfig.mode === 'create' ? 'Nuevo evento personal' : 'Editar evento'}
                    </h3>
                    <button type="button" className="acad-cal-popup-close" onClick={() => setModalConfig(null)} aria-label="Cerrar">×</button>
                  </header>

                  <div className="acad-cal-popup-date">
                    📅 {fmtLargo(modalConfig.mode === 'create' ? modalConfig.date : modalConfig.event.date)}
                  </div>

                  <div className="acad-cal-form-group">
                    <label>Título del evento</label>
                    <input
                      name="title"
                      required
                      maxLength={80}
                      defaultValue={modalConfig.mode === 'edit' ? modalConfig.event.title : ''}
                      placeholder="Ej. Entrega de proyecto"
                      autoFocus
                    />
                  </div>

                  <div className="acad-cal-form-group">
                    <label>Descripción (opcional)</label>
                    <textarea
                      name="desc"
                      rows={3}
                      maxLength={300}
                      defaultValue={modalConfig.mode === 'edit' ? modalConfig.event.desc : ''}
                      placeholder="Detalles adicionales…"
                    />
                  </div>

                  <div className="acad-cal-form-group">
                    <label>Color</label>
                    <div className="acad-cal-swatches">
                      {COLORES_PERSONAL.map(c => (
                        <button
                          key={c.key}
                          type="button"
                          className={`acad-cal-swatch c-${c.key}${formColor === c.key ? ' sel' : ''}`}
                          title={c.label}
                          aria-label={c.label}
                          onClick={() => setFormColor(c.key)}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="acad-cal-form-actions">
                    {modalConfig.mode === 'edit' && (
                      <button type="button" className="acad-cal-btn-delete" onClick={handleDeleteCustom}>Eliminar</button>
                    )}
                    <div className="spacer" />
                    <button type="button" className="acad-cal-btn-cancel" onClick={() => setModalConfig(null)}>Cancelar</button>
                    <button type="submit" className="acad-cal-btn-save">Guardar</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
