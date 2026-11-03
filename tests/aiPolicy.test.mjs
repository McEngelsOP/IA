import test from 'node:test'
import assert from 'node:assert/strict'
import { accessDescription } from '../src/features/assistant/aiPolicy.js'

test('AI access explains the difference between ESAN registration, verification and personal mode', () => {
  assert.match(accessDescription({ verificationStatus: 'pending' }), /registrada en ESAN.*pendiente de verificación/)
  assert.match(accessDescription({ verificationStatus: 'expired' }), /venció/)
  assert.match(accessDescription({ verificationStatus: 'revoked' }), /revocado/)
  assert.match(accessDescription({ verificationStatus: 'external' }), /clave de API propia/)
  assert.match(accessDescription({ sharedEligible: true }), /servicio de Lyra o tus propias claves/)
})
