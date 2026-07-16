import '../styles/ConfirmDialog.css'

// Panel de confirmación para borrados con impacto (herramientas,
// profesores, comentarios, reseñas). Se controla con un objeto:
//   data = { message, detail?, onConfirm } · null = cerrado
// El botón rojo ejecuta onConfirm y cierra; Cancelar o el fondo solo cierran.
export default function ConfirmDialog({ data, onClose }) {
  if (!data) return null
  return (
    <div className="cfm-backdrop" onClick={onClose}>
      <div className="cfm-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <p className="cfm-msg">{data.message}</p>
        {data.detail && <p className="cfm-detail">{data.detail}</p>}
        <div className="cfm-actions">
          <button className="cfm-cancel" onClick={onClose}>Cancelar</button>
          <button className="cfm-del" onClick={() => { data.onConfirm(); onClose() }}>
            Sí, eliminar
          </button>
        </div>
      </div>
    </div>
  )
}
