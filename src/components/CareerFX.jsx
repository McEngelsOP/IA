// Fondo decorativo de la pantalla de elección de carrera: iconos que
// flotan suavemente hacia arriba, en el mismo espíritu lúdico del arcade
// pero temáticos de las cuatro carreras (IA, industrial, marketing y
// mecatrónica) más matemáticas/datos que comparten. Es puramente
// decorativo — no captura clics (pointer-events: none en CSS).

// Config fija (no aleatoria en cada render, así los iconos no saltan):
// e = emoji · x = posición horizontal % · s = tamaño rem
// d = retraso s · t = duración s (a mayor, más lento el ascenso)
const ICONOS = [
  { e: '🤖', x: 6, s: 2.4, d: 0, t: 20 },
  { e: '⚙️', x: 15, s: 1.7, d: 6, t: 26 },
  { e: '📊', x: 24, s: 2.0, d: 12, t: 22 },
  { e: '🧠', x: 33, s: 2.6, d: 3, t: 24 },
  { e: '📣', x: 42, s: 1.8, d: 9, t: 19 },
  { e: '🔧', x: 51, s: 2.1, d: 15, t: 27 },
  { e: '📈', x: 60, s: 1.9, d: 2, t: 21 },
  { e: '💡', x: 69, s: 2.2, d: 11, t: 25 },
  { e: '🦾', x: 78, s: 2.3, d: 5, t: 23 },
  { e: '📱', x: 87, s: 1.7, d: 14, t: 28 },
  { e: '🏭', x: 94, s: 2.0, d: 8, t: 24 },
  { e: '🎯', x: 10, s: 1.9, d: 17, t: 20 },
  { e: '💻', x: 30, s: 2.1, d: 20, t: 26 },
  { e: '🔌', x: 48, s: 1.8, d: 4, t: 22 },
  { e: '🧮', x: 66, s: 2.0, d: 13, t: 27 },
  { e: '🛰️', x: 82, s: 2.2, d: 18, t: 25 },
  { e: '∑', x: 20, s: 2.3, d: 7, t: 23 },
  { e: 'π', x: 56, s: 2.4, d: 16, t: 21 },
  { e: '∫', x: 73, s: 2.2, d: 10, t: 24 },
  { e: '📐', x: 38, s: 1.9, d: 21, t: 28 }
]

export default function CareerFX() {
  return (
    <div className="cs-fx" aria-hidden="true">
      {ICONOS.map((it, i) => (
        <span
          key={i}
          className="cs-fx-icon"
          style={{
            left: `${it.x}%`,
            fontSize: `${it.s}rem`,
            animationDelay: `${it.d}s`,
            animationDuration: `${it.t}s`
          }}
        >
          {it.e}
        </span>
      ))}
    </div>
  )
}
