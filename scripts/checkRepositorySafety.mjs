import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const failures = []
for (const path of paths) {
  if (!existsSync(path)) continue
  if ((/(^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/.test(path) && !path.endsWith('.example')) ||
      /\.(?:pem|key|dump|backup|bak)$/.test(path) ||
      /(^|\/)(?:\.vercel|\.supabase|\.impeccable|backups|private)\//.test(path) ||
      /^(?:ADMIN\.md|docs\/backend-activation\.md|supabase\/history\/)/.test(path)) {
    failures.push(`${path}: archivo restringido`)
    continue
  }
  const bytes = readFileSync(path)
  if (bytes.includes(0)) continue
  const source = bytes.toString('utf8')
  const secret = /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gsk_[A-Za-z0-9]{20,}|sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{15,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/
  if (secret.test(source)) failures.push(`${path}: posible credencial privada`)
  for (const token of source.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {
      if (JSON.parse(Buffer.from(token[1], 'base64url')).role === 'service_role') failures.push(`${path}: JWT privilegiado`)
    } catch { /* Un patrón incompleto no es un JWT válido. */ }
  }
}
if (failures.length) {
  console.error('Revisión del repositorio:\n' + failures.join('\n'))
  process.exitCode = 1
} else console.log('Repositorio: sin archivos restringidos ni credenciales privadas de los patrones comprobados.')
