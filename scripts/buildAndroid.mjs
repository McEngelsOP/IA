import { build, loadEnv } from 'vite'
import { copyFile, rm } from 'node:fs/promises'
const env = { ...loadEnv('android', process.cwd(), ''), ...process.env }
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.VITE_SUPABASE_URL || '') || !env.VITE_SUPABASE_ANON_KEY) throw new Error('Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.android.local antes de generar el APK.')
try { if (JSON.parse(Buffer.from(env.VITE_SUPABASE_ANON_KEY.split('.')[1], 'base64url')).role !== 'anon') throw new Error('Solo se permite la clave pública anon.') } catch (error) { if (!env.VITE_SUPABASE_ANON_KEY.startsWith('sb_publishable_')) throw error }
await build({ mode: 'android', build: { outDir: 'dist-android' } })
await copyFile('dist-android/login.html', 'dist-android/index.html')
// The mobile portal already hides Arcade. Do not package its desktop games.
await rm('dist-android/juegos', { recursive: true, force: true })
console.log('Interfaz Android preparada. Usa npx cap sync android para copiarla al proyecto nativo.')
