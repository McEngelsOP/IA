import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { jsPDF } from 'jspdf'

const browser = await chromium.launch({ headless: true, executablePath: process.env.SETUP_BROWSER, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.goto((process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181') + '/tests/fixtures/empty.html')
  const doc = new jsPDF()
  doc.text('Codigo;Curso;Creditos;Ciclo;Tipo;Requisitos', 10, 15)
  doc.text('001;Algebra;4;1;curso;Ninguno', 10, 25)
  const extract = bytes => page.evaluate(async bytes => {
    const { readCurriculum } = await import('/src/features/institutions/readCurriculum.js')
    const { extractCurriculum, validateRows } = await import('/src/features/institutions/curriculumMarkdown.js')
    try {
      const text = await readCurriculum(new File([new Uint8Array(bytes)], 'malla.pdf', { type: 'application/pdf' }))
      const { rows } = extractCurriculum(text)
      return { rows, issue: validateRows(rows) }
    } catch (error) { return { error: error.message } }
  }, [...new Uint8Array(bytes)])
  const result = await extract(doc.output('arraybuffer'))
  assert(!result.error, result.error)
  assert.equal(result.issue, '')
  assert.deepEqual(result.rows, [{ code: '001', name: 'Algebra', credits: '4', cycle: '1', type: 'curso', requirements: 'Ninguno' }])
  assert.match((await extract(new jsPDF().output('arraybuffer'))).error, /escaneado/)
  for (let i = 1; i < 61; i++) doc.addPage()
  assert.match((await extract(doc.output('arraybuffer'))).error, /60 páginas/)
  console.log('PASS: current PDF reader and worker extract curriculum codes and enforce scan/page limits')
} finally { await browser.close() }
