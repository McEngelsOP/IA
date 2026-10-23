export const MODES = [
  { id: 'country', name: 'Encuentra el país', category: 'Ubicar' },
  { id: 'cap', name: 'Ubica la capital', category: 'Ubicar' },
  { id: 'place', name: 'Lugares del mundo', category: 'Ubicar' },
  { id: 'who', name: 'Reconoce el país', category: 'Elegir' },
  { id: 'cap4', name: 'Capitales', category: 'Elegir' },
  { id: 'cur', name: 'Monedas', category: 'Elegir' },
  { id: 'lang', name: 'Idiomas', category: 'Elegir' },
  { id: 'falso', name: 'Detecta el error', category: 'Elegir' },
  { id: 'dist', name: 'Distancias', category: 'Calcular' },
  { id: 'tz', name: 'Husos horarios', category: 'Calcular' },
  { id: 'rank', name: 'Ordena los países', category: 'Calcular' },
  { id: 'mixto', name: 'Duelo mixto', category: 'Todos' }
]
export const LEVELS = [{ id: 'facil', name: 'Fácil' }, { id: 'medio', name: 'Media' }, { id: 'dificil', name: 'Difícil' }]
export const DEFAULT_SETTINGS = { mode: 'cap4', level: 'medio' }
export const modeName = id => MODES.find(m => m.id === id)?.name || 'Capitales'
