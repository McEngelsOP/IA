// Generado por scripts/generateCurricula.mjs. El acceso no carga los grafos.
export const CAREER_OPTIONS = {
  "ia": {
    "key": "ia",
    "uni": "Universidad ESAN",
    "nombre": "Ingeniería en Inteligencia Artificial",
    "total": 200,
    "source": "Malla_Ingenieria_en_Inteligencia_Artificial.md"
  },
  "industrial": {
    "key": "industrial",
    "uni": "Universidad ESAN",
    "nombre": "Ingeniería Industrial y Comercial",
    "total": 215,
    "source": "Mallas_Pregrado_2024_xlsx_-_INGICO_2024.md"
  },
  "marketing": {
    "key": "marketing",
    "uni": "Universidad ESAN",
    "nombre": "Comunicación Empresarial y Marketing Digital",
    "total": 215,
    "source": "COMUNICACION_EMPRESARIAL_Y_MARKETING_DIGITAL.md"
  },
  "administracion": {
    "key": "administracion",
    "uni": "Universidad ESAN",
    "nombre": "Administración",
    "total": 200,
    "source": "Mallas_Pregrado_2024_xlsx_-_ADM_2024_1.md"
  },
  "administracion-finanzas": {
    "key": "administracion-finanzas",
    "uni": "Universidad ESAN",
    "nombre": "Administración y Finanzas",
    "total": 215,
    "source": "ADMINISTRACION_Y_FINANZAS.md"
  },
  "administracion-marketing": {
    "key": "administracion-marketing",
    "uni": "Universidad ESAN",
    "nombre": "Administración y Marketing",
    "total": 212,
    "source": "Mallas_Pregrado_2024_xlsx_-_ADYMA_2024.md"
  },
  "administracion-negocios-internacionales": {
    "key": "administracion-negocios-internacionales",
    "uni": "Universidad ESAN",
    "nombre": "Administración y Negocios Internacionales",
    "total": 215,
    "source": "ADMINISTRACION_Y_NEGOCIOS_INTERNACIONALES.md"
  },
  "contabilidad": {
    "key": "contabilidad",
    "uni": "Universidad ESAN",
    "nombre": "Contabilidad",
    "total": 200,
    "source": "CONTABILIDAD.md"
  },
  "derecho": {
    "key": "derecho",
    "uni": "Universidad ESAN",
    "nombre": "Derecho",
    "total": 202,
    "source": "Mallas_2026_-_excel_-_DER_2026_1.md"
  },
  "derecho-corporativo": {
    "key": "derecho-corporativo",
    "uni": "Universidad ESAN",
    "nombre": "Derecho Corporativo",
    "total": 251,
    "source": "Mallas_Pregrado_2024_xlsx_-_DECO_2024_2.md"
  },
  "economia": {
    "key": "economia",
    "uni": "Universidad ESAN",
    "nombre": "Economía",
    "total": 200,
    "source": "ECONOMIA_-_ECO_.md"
  },
  "economia-finanzas": {
    "key": "economia-finanzas",
    "uni": "Universidad ESAN",
    "nombre": "Economía y Finanzas",
    "total": 220,
    "source": "Mallas_Pregrado_2024_xlsx_-_ECOYFI_2024_5.md"
  },
  "economia-negocios-internacionales": {
    "key": "economia-negocios-internacionales",
    "uni": "Universidad ESAN",
    "nombre": "Economía y Negocios Internacionales",
    "total": 220,
    "source": "Mallas_Pregrado_2024_xlsx_-_ECYNI_2024_2.md"
  },
  "ambiental": {
    "key": "ambiental",
    "uni": "Universidad ESAN",
    "nombre": "Ingeniería Ambiental",
    "total": 200,
    "source": "Mallas_2026_-_excel_-_INGAMB_2026.md"
  },
  "ciencia-datos": {
    "key": "ciencia-datos",
    "uni": "Universidad ESAN",
    "nombre": "Ingeniería en Ciencia de Datos",
    "total": 200,
    "source": "Mallas_2026_-_excel_-_INGCD_2026_2.md"
  },
  "software": {
    "key": "software",
    "uni": "Universidad ESAN",
    "nombre": "Ingeniería de Software",
    "total": 200,
    "source": "Mallas_2026_-_excel_-_INGSO_2026_1.md"
  },
  "sistemas": {
    "key": "sistemas",
    "uni": "Universidad ESAN",
    "nombre": "Ingeniería de Tecnologías de Información y Sistemas",
    "total": 213,
    "source": "Mallas_Pregrado_2024_xlsx_-_INGITIS_2024.md"
  },
  "psicologia": {
    "key": "psicologia",
    "uni": "Universidad ESAN",
    "nombre": "Psicología",
    "total": 225,
    "source": "Mallas_2026_-_excel_-_PSIC_2026_1.md"
  },
  "pucp-mecatronica": {
    "key": "pucp-mecatronica",
    "uni": "PUCP",
    "nombre": "Ingeniería Mecatrónica",
    "total": 208.75
  }
}
export const CAREER_KEYS = Object.keys(CAREER_OPTIONS).sort((a, b) => Number(CAREER_OPTIONS[a].uni === 'PUCP') - Number(CAREER_OPTIONS[b].uni === 'PUCP') || CAREER_OPTIONS[a].nombre.localeCompare(CAREER_OPTIONS[b].nombre, 'es'))
export const careerLabel = key => CAREER_OPTIONS[key] ? CAREER_OPTIONS[key].nombre + ' (' + (CAREER_OPTIONS[key].uni === 'PUCP' ? 'PUCP' : 'ESAN') + ')' : 'Sin elegir'
