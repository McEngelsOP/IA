export const DEFAULT_MODELS = {
  gemini: 'gemini-3.5-flash-lite',
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'openrouter/free'
}

const SETTINGS = [
  { name: 'gemini', key: 'GEMINI_API_KEY', model: 'GEMINI_MODEL' },
  { name: 'groq', key: 'GROQ_API_KEY', model: 'GROQ_MODEL' },
  { name: 'openrouter', key: 'OPENROUTER_API_KEY', model: 'OPENROUTER_MODEL' }
]

const failure = error => ({ error, status: error === 'rate_limited' ? 429 : error === 'configuration_missing' ? 503 : 502 })

/**
 * @param {{ env: (name: string) => string | undefined, system: string, context: string,
 * history: Array<{role: string, content: string}>, fetchImpl?: typeof fetch, now?: () => number,
 * onFailure?: (details: {provider: string, model: string, error: string, status?: number}) => void }} options
 */
export async function askProviders({ env, system, context, history, fetchImpl = fetch, now = Date.now, onFailure = () => {} }) {
  const configured = SETTINGS.map(provider => ({ ...provider, apiKey: env(provider.key)?.trim() || '' })).filter(provider => provider.apiKey)
  if (!configured.length) return failure('configuration_missing')
  const deadline = now() + 28000
  let lastError = 'provider_unavailable'

  for (const provider of configured) {
    const remaining = deadline - now()
    if (remaining <= 0) return failure('provider_timeout')
    const model = (env(provider.model)?.trim() || DEFAULT_MODELS[provider.name]).replace(/^models\//, '')
    const reject = (error, status = undefined) => {
      lastError = error
      onFailure({ provider: provider.name, model, error, ...(status === undefined ? {} : { status }) })
    }
    if (model.length > 120 || !/^[a-zA-Z0-9._:/-]+$/.test(model)) {
      reject('invalid_model')
      continue
    }

    const isGemini = provider.name === 'gemini'
    const url = isGemini
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
      : provider.name === 'groq'
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions'
    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': 'application/json' }
    if (isGemini) headers['x-goog-api-key'] = provider.apiKey
    else headers.Authorization = `Bearer ${provider.apiKey}`
    const body = isGemini ? {
      systemInstruction: { parts: [{ text: system }] },
      contents: [...history.map(item => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] })), { role: 'user', parts: [{ text: context }] }],
      generationConfig: { temperature: 0.25, maxOutputTokens: 700 }
    } : {
      model,
      messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: context }],
      temperature: 0.25,
      max_tokens: 700,
      ...(provider.name === 'openrouter' ? { provider: { data_collection: 'deny' } } : {})
    }

    try {
      const response = await fetchImpl(url, {
        method: 'POST', headers, body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(8000, remaining))
      })
      if (!response.ok) {
        const status = response.status
        const error = [402, 429].includes(status) ? 'rate_limited'
          : status === 404 ? 'model_unavailable'
            : [401, 403].includes(status) ? 'provider_configuration'
              : status === 408 ? 'provider_timeout'
                : status >= 500 ? 'provider_unavailable' : 'provider_configuration'
        reject(error, status)
        // Invalid request formats should be corrected rather than sent again.
        if (status >= 400 && status < 500 && ![401, 402, 403, 404, 408, 429].includes(status)) return failure(error)
        continue
      }
      const result = await response.json()
      const answer = isGemini
        ? result?.candidates?.[0]?.content?.parts?.filter(part => !part?.thought && typeof part?.text === 'string').map(part => part.text).join('\n')
        : result?.choices?.[0]?.message?.content
      if (typeof answer !== 'string' || !answer.trim()) {
        reject('empty_response')
        continue
      }
      return { answer: answer.trim().slice(0, 8000), provider: provider.name, model }
    } catch (error) {
      reject(['TimeoutError', 'AbortError'].includes(error?.name) ? 'provider_timeout' : 'provider_unavailable')
    }
  }
  return failure(lastError)
}
