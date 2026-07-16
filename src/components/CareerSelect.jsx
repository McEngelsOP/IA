import { CARRERAS, CARRERA_KEYS } from '../data/carreras'
import '../styles/CareerSelect.css'

// Pantalla de elección de carrera. Dos usos:
// - Cuenta creada antes de que existieran carreras: elige una vez y queda fija.
// - Modo visitante (guest): elige la malla a explorar, puede cambiarla luego.
export default function CareerSelect({ onSelect, saving, error, guest, onBack }) {
  return (
    <div className="cs-page">
      <div className="cs-card">
        <p className="cs-eyebrow mono">MALLA CURRICULAR INTERACTIVA</p>
        <h1 className="cs-title">¿Cuál es tu carrera?</h1>
        <p className="cs-sub">
          {guest
            ? 'Elige la malla que quieres explorar. Como visitante puedes cambiar de carrera cuando quieras.'
            : 'Con tu carrera armamos tu malla, tu avance y tus notas. Quedará fija en tu cuenta — si eliges mal, escribe a hernandengels@gmail.com para corregirla.'}
        </p>

        <div className="cs-options">
          {CARRERA_KEYS.map(k => (
            <button
              key={k}
              type="button"
              className="cs-option"
              disabled={saving}
              onClick={() => onSelect(k)}
            >
              <span className="cs-name">{CARRERAS[k].nombre}</span>
              <span className="cs-meta mono">{CARRERAS[k].uni.toUpperCase()} · {CARRERAS[k].total} CRÉDITOS · 10 CICLOS</span>
            </button>
          ))}
        </div>

        {saving && <p className="cs-note mono">GUARDANDO…</p>}
        {error && <p className="cs-error">{error}</p>}
        {guest && onBack && (
          <button type="button" className="cs-back" onClick={onBack}>
            ← Volver al inicio de sesión
          </button>
        )}
      </div>
    </div>
  )
}
