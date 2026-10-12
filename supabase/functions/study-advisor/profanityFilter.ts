// Filtro de lenguaje ofensivo para LESAN (Edge Function Deno / Supabase).
// Diseñado con límites de palabra para evitar el problema de Scunthorpe (computación, análisis, etc.).

interface BadWordRule {
  word: string;
  severity: number;
}

export interface ProfanityResult {
  isProfane: boolean;
  matches: string[];
  severity: number;
}

const RAW_BAD_WORDS: BadWordRule[] = [
  // Severidad 3: Insultos graves, discriminación, ofensas directas
  { word: "conchatumadre", severity: 3 },
  { word: "conchadesumadre", severity: 3 },
  { word: "ctm", severity: 3 },
  { word: "csm", severity: 3 },
  { word: "hdp", severity: 3 },
  { word: "hijo de puta", severity: 3 },
  { word: "hijodeputa", severity: 3 },
  { word: "malparido", severity: 3 },
  { word: "chucha", severity: 3 },
  { word: "chupapinga", severity: 3 },
  { word: "maricon", severity: 3 },
  { word: "nigger", severity: 3 },
  { word: "cunt", severity: 3 },
  { word: "motherfucker", severity: 3 },

  // Severidad 2: Vulgaridades y hostilidad
  { word: "puta", severity: 2 },
  { word: "puto", severity: 2 },
  { word: "mierda", severity: 2 },
  { word: "mierd", severity: 2 },
  { word: "carajo", severity: 2 },
  { word: "ptm", severity: 2 },
  { word: "verga", severity: 2 },
  { word: "pendejo", severity: 2 },
  { word: "pendeja", severity: 2 },
  { word: "huevon", severity: 2 },
  { word: "weon", severity: 2 },
  { word: "huevada", severity: 2 },
  { word: "cojudo", severity: 2 },
  { word: "cojudez", severity: 2 },
  { word: "pinga", severity: 2 },
  { word: "culiao", severity: 2 },
  { word: "fuck", severity: 2 },
  { word: "fucking", severity: 2 },
  { word: "shit", severity: 2 },
  { word: "bitch", severity: 2 },
  { word: "asshole", severity: 2 },
  { word: "dick", severity: 2 },
  { word: "pussy", severity: 2 },

  // Severidad 1: Términos soeces menores
  { word: "estupido", severity: 1 },
  { word: "estupida", severity: 1 },
  { word: "idiota", severity: 1 },
  { word: "imbecil", severity: 1 },
  { word: "tarado", severity: 1 },
  { word: "maldito", severity: 1 },
  { word: "crap", severity: 1 },
  { word: "damn", severity: 1 }
];

export function normalizeText(text: string): string {
  if (!text || typeof text !== "string") return "";
  let s = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // remover tildes

  // Reemplazar leetspeak común
  s = s
    .replace(/@/g, "a")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/\$/g, "s");

  // Reducir caracteres repetidos consecutivos (ej. "mieeeerda" -> "mierda")
  s = s.replace(/([a-z])\1{2,}/g, "$1");

  return s;
}

export function checkProfanity(rawText: string): ProfanityResult {
  if (!rawText || typeof rawText !== "string") {
    return { isProfane: false, matches: [], severity: 0 };
  }

  const normalized = normalizeText(rawText);
  // Versión sin puntuación separadora
  const collapsedPunctuation = normalized.replace(/[\._\-]/g, "");

  const matches: string[] = [];
  let maxSeverity = 0;

  for (const item of RAW_BAD_WORDS) {
    const term = item.word;

    // Patrón flexible: permite que las vocales estén sustituidas por * o # (ej. f*ck, p*ta, m*erda)
    const vowelFlexibleTerm = term.replace(/[aeiou]/g, "[aeiou\\*#]");
    const regex = new RegExp(`(^|[^a-z0-9])${vowelFlexibleTerm}([^a-z0-9]|$)`, "i");

    if (regex.test(normalized) || regex.test(collapsedPunctuation)) {
      matches.push(term);
      if (item.severity > maxSeverity) maxSeverity = item.severity;
    }
  }

  return {
    isProfane: matches.length > 0,
    matches: [...new Set(matches)],
    severity: maxSeverity
  };
}

