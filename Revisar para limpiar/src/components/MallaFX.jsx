import './MallaFX.css'

// Fondo decorativo de la malla: iconos que derivan muy lento por detrás del
// grafo, distintos según la carrera. Va DENTRO de la tarjeta (.frame), detrás
// del grafo y con pointer-events: none (ver MallaFX.css) — asoma solo en los
// espacios vacíos entre nodos, nunca captura clics ni tapa texto. Solo se
// monta en escritorio (la malla lo decide con isMobile).

// Set de iconos por carrera (clave = data/carreras.js)
const ICONS = {
  ia: ['🤖', '🧠', '⚡', '🔮', '💻', '∑', 'π'],
  industrial: ['⚙️', '🏭', '📊', '📈', '🔩', '📦'],
  marketing: ['📣', '📱', '🎯', '💡', '📸', '🛍️'],
  'pucp-mecatronica': ['🔧', '🦾', '🔌', '🛰️', '🤖', '⚡']
}

// Posiciones fijas (no aleatorias, así no saltan) sesgadas a las zonas SIN
// bloque: la banda superior (detrás del título, subtítulo y leyenda) y las
// franjas laterales. Las que caigan bajo una tarjeta quedan tapadas por ella.
// x/y en % · s tamaño rem · d retraso s · t duración s de la deriva
const SPOTS = [
  { x: 5, y: 9, s: 2.2, d: 0, t: 15 },
  { x: 19, y: 5, s: 1.7, d: 4, t: 18 },
  { x: 33, y: 11, s: 2.0, d: 8, t: 14 },
  { x: 49, y: 6, s: 1.8, d: 2, t: 17 },
  { x: 63, y: 10, s: 2.3, d: 6, t: 19 },
  { x: 77, y: 5, s: 1.9, d: 9, t: 15 },
  { x: 90, y: 12, s: 2.0, d: 12, t: 13 },
  { x: 12, y: 32, s: 1.9, d: 3, t: 17 },
  { x: 45, y: 36, s: 1.7, d: 7, t: 20 },
  { x: 71, y: 31, s: 2.1, d: 5, t: 16 },
  { x: 2, y: 56, s: 2.0, d: 10, t: 18 },
  { x: 97, y: 60, s: 1.9, d: 11, t: 15 },
  { x: 2, y: 84, s: 1.8, d: 6, t: 20 },
  { x: 97, y: 86, s: 2.1, d: 13, t: 16 }
]

export default function MallaFX({ carrera }) {
  const set = ICONS[carrera] || ICONS.ia
  return (
    <div className="mfx-layer" aria-hidden="true">
      {SPOTS.map((sp, i) => (
        <span
          key={i}
          className="mfx-icon"
          style={{
            left: `${sp.x}%`,
            top: `${sp.y}%`,
            fontSize: `${sp.s}rem`,
            animationDelay: `${sp.d}s`,
            animationDuration: `${sp.t}s`
          }}
        >
          {set[i % set.length]}
        </span>
      ))}
    </div>
  )
}
