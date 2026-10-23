import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAdvisorAnswer } from '../src/features/assistant/advisorFormatting.mjs'

test('converts the advisor response format to clean readable text', () => {
  const answer = [
    '### Recomendación',
    'Te sugiero matricular el **Electivo de Especialidad IV**.',
    '',
    '### Motivos',
    '- Otorga **3** créditos.',
    '- No registra prerrequisitos directos.',
    '',
    '### Qué revisar',
    '- Verifica el avance registrado.'
  ].join('\n')

  assert.equal(normalizeAdvisorAnswer(answer), [
    'Recomendación',
    'Te sugiero matricular el Electivo de Especialidad IV.',
    '',
    'Motivos',
    '• Otorga 3 créditos.',
    '• No registra prerrequisitos directos.',
    '',
    'Qué revisar',
    '• Verifica el avance registrado.'
  ].join('\n'))
})

test('removes common formatting markers from headings, emphasis, links and code', () => {
  assert.equal(
    normalizeAdvisorAnswer('## Revisión\n**Créditos:** 12\nConsulta [la malla](https://example.edu/plan).\n\x60créditos\x60'),
    'Revisión\nCréditos: 12\nConsulta la malla.\ncréditos'
  )
})

test('turns Markdown tables into readable bullet lines and drops separator rows', () => {
  assert.equal(
    normalizeAdvisorAnswer('| Curso | Créditos |\n| --- | ---: |\n| Cálculo | 4 |'),
    '• Curso: Créditos\n• Cálculo: 4'
  )
})

test('normalizes excessive blank lines and non-string input', () => {
  assert.equal(normalizeAdvisorAnswer('Una idea.\n\n\nOtra idea.'), 'Una idea.\n\nOtra idea.')
  assert.equal(normalizeAdvisorAnswer(null), '')
})
