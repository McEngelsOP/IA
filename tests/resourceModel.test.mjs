import test from 'node:test'
import assert from 'node:assert/strict'
import { resourceUrl, resourceError } from '../src/features/resources/resourceModel.js'

test('enlaces mal escritos muestran el mismo aviso que esquemas o credenciales rechazados', () => {
  for (const input of ['', 'bad url', 'https://', 'http://[broken', 'javascript:alert(1)', 'https://user:password@example.com']) {
    assert.throws(() => resourceUrl(input), error => {
      assert.equal(error.message, 'INVALID_RESOURCE_URL', input)
      assert.equal(resourceError(error), 'Escribe un enlace válido de un sitio web, sin usuario ni contraseña.')
      return true
    })
  }
})

test('un enlace válido conserva su ruta y consulta, añade https y elimina fragmentos', () => {
  assert.equal(resourceUrl(' example.com/path?q=study#top '), 'https://example.com/path?q=study')
  assert.equal(resourceUrl('http://example.com/path'), 'http://example.com/path')
})
