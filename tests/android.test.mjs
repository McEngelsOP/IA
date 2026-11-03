import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nativeAuthTarget, apiFetch, isAndroid } from '../src/native/android.js'

test('Android callbacks keep credentials local and accept only the app auth route', () => {
  const base = 'https://localhost/index.html'
  assert.equal(nativeAuthTarget('app.lyra.campus://auth/callback#access_token=fixture&refresh_token=fixture&type=recovery', base), 'https://localhost/login.html#access_token=fixture&refresh_token=fixture&type=recovery')
  assert.equal(nativeAuthTarget('app.lyra.campus://auth/callback?code=fixture', base), 'https://localhost/login.html?code=fixture')
  for (const url of ['https://evil.example/callback#access_token=fixture','app.lyra.campus://evil/callback','app.lyra.campus://auth/pagina.html','javascript:alert(1)','bad']) assert.equal(nativeAuthTarget(url,base),null)
})
test('web API requests retain their existing relative URL, token and abort signal', async () => {
  assert.equal(isAndroid(), false)
  const previous = globalThis.fetch, controller = new AbortController()
  let seen
  globalThis.fetch = async (path, options) => { seen = { path, options }; return new Response('{"ok":true}') }
  try {
    const options = { method:'POST', headers:{Authorization:'Bearer fixture'},body:'{"message":"fixture"}',signal:controller.signal }
    assert.deepEqual(await (await apiFetch('/api/mailbox',options)).json(), {ok:true})
    assert.equal(seen.path,'/api/mailbox');assert.equal(seen.options,options)
  } finally { globalThis.fetch = previous }
})
test('Android release forbids plaintext traffic and device backups; shares only generated exports', () => {
  const manifest=readFileSync('android/app/src/main/AndroidManifest.xml','utf8')
  assert.match(manifest,/android:allowBackup="false"/)
  assert.match(manifest,/android:usesCleartextTraffic="false"/)
  assert(!manifest.includes('READ_EXTERNAL_STORAGE')&&!manifest.includes('WRITE_EXTERNAL_STORAGE'))
  const provider=readFileSync('android/app/src/main/res/xml/file_paths.xml','utf8')
  assert.match(provider,/path="exports\/"/);assert(!provider.includes('external-path'))
  const config=JSON.parse(readFileSync('capacitor.config.json','utf8'))
  assert.equal(config.appId,'app.lyra.campus');assert(!config.server.url)
})
