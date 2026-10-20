import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
process.env.VITE_SUPABASE_URL = 'https://setup-fixture.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'fixture'
const selected = process.argv.slice(2)
const checks = selected.length ? selected : ['assistantLocal', 'esanWorkspace', 'homeCompanion', 'initialSetup', 'webSession', 'sidebarMotion']
if (checks.some(name => !/^[a-zA-Z][\w-]*$/.test(name))) throw new Error('Nombre de prueba inválido')
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5181, strictPort: true } })
await server.listen()
try {
  for (const name of checks) {
    const child = spawn(process.execPath, [`tests/${name}.browser.mjs`], { cwd: root, stdio: 'inherit', env: process.env })
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
    if (code !== 0) { process.exitCode = code || 1; break }
  }
} finally { await server.close() }
