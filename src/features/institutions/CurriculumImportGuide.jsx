import { useId, useRef, useState } from 'react'
import { CURRICULUM_PROMPT } from './curriculumPrompt.js'

export function CurriculumImportGuide() {
  const [message, setMessage] = useState('')
  const promptField = useRef(null)
  const promptId = useId()

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(CURRICULUM_PROMPT)
      setMessage('Prompt copiado. Pégalo junto con tu malla en la IA que elijas.')
    } catch {
      promptField.current?.focus()
      promptField.current?.select()
      setMessage('Seleccionamos el prompt. Usa la opción Copiar de tu dispositivo o Ctrl+C / Cmd+C.')
    }
  }

  return <details className="ci-guide">
    <summary>¿Tu archivo no se lee bien? Prepáralo con otra IA</summary>
    <p>Puedes subir tu malla directamente aquí. Si los cursos salen desordenados, faltan datos o el PDF es una imagen, sigue estos pasos para preparar una versión legible.</p>
    <ol>
      <li>Busca la malla oficial de tu universidad, carrera y versión del plan. Guarda el original para comparar los resultados y, si lo tienes, su enlace institucional.</li>
      <li>Adjunta el documento en ChatGPT, Claude u otra IA que pueda leer archivos. Copia el prompt de abajo y envíalo junto con la malla. Comparte únicamente información académica pública, sin datos personales.</li>
      <li>Pide el archivo <strong>malla-lyra.md</strong>. Markdown es un archivo de texto con una tabla: conserva mejor las columnas para esta importación. Si la IA no permite descargarlo, copia la tabla que te entregue y pégala directamente en <strong>Texto de la malla</strong>.</li>
      <li>Compara el resultado con el original: universidad, carrera, plan, cursos, códigos, créditos, ciclos y requisitos. Completa el nombre, los créditos y el ciclo de cada curso. Los códigos y prerrequisitos son opcionales: déjalos vacíos si no aparecen en el original. La IA no debe inventarlos.</li>
      <li>Vuelve aquí, sube el archivo .md en <strong>Archivo de la malla</strong> o pega la tabla, y pulsa <strong>Convertir y extraer datos</strong>. Revisa las filas, añade el enlace institucional si lo tienes y confirma la revisión antes de guardar.</li>
    </ol>
    <p>Formatos admitidos: <strong>.md, .txt, .csv, .tsv, .xlsx y PDF con texto seleccionable</strong>. Hasta 8 MB, 400 cursos y 180 000 caracteres; los PDF admiten hasta 60 páginas. Los PDF escaneados necesitan reconocimiento de texto (OCR). Para este procedimiento, solicita .md en lugar de Word (.doc/.docx) o un nuevo PDF.</p>
    <label htmlFor={promptId}>Prompt para copiar</label><textarea id={promptId} ref={promptField} className="ci-guide-prompt" readOnly rows={12} value={CURRICULUM_PROMPT} spellCheck={false}/>
    <button className="h-btn" type="button" onClick={copyPrompt}>Copiar prompt</button>
    <p role="status" aria-live="polite">{message}</p>
    <p>Preparar el archivo con otra IA ayuda a leerlo. El resultado seguirá pasando por la revisión de Lyra; no garantiza su aprobación.</p>
  </details>
}
