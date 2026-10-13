export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const DEFAULTS: Record<string, string> = {
  gemini: DEFAULT_GEMINI_MODEL,
  groq: "openai/gpt-oss-20b",
  openrouter: "openrouter/free",
};
const ENDPOINTS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};
const validModel = (model: string) => /^[a-zA-Z0-9._:/~-]{1,100}$/.test(model);
const refusalReasons = new Set([
  "SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY",
  "content_filter", "safety", "refusal",
]);
type Provider = { name: string; model: string; key: string };
type Gate = { allowed: boolean; retryAfterSeconds?: number };
type Outcome = {
  answer?: string; source?: string; model?: string; error?: string;
  retryAfterSeconds?: number; attempts: number;
};

export function configuredProviders(env: (name: string) => string | undefined): Provider[] {
  const order = (env("ADVISOR_PROVIDER_ORDER") || "gemini,groq,openrouter")
    .split(",").map((name) => name.trim().toLowerCase());
  return [...new Set(order)].flatMap((name) => {
    if (!Object.hasOwn(DEFAULTS, name)) return [];
    const key = env(`${name.toUpperCase()}_API_KEY`)?.trim();
    const configured = env(`${name.toUpperCase()}_MODEL`)?.trim() || DEFAULTS[name];
    const model = name === "gemini" ? configured.replace(/^models\//, "") : configured;
    if (!key || !validModel(model) || (name === "gemini" && !/^[a-zA-Z0-9._-]+$/.test(model))) return [];
    // OpenRouter solo utiliza modelos gratuitos salvo una habilitación explícita.
    if (name === "openrouter" && model !== "openrouter/free" &&
        !model.endsWith(":free") && env("ADVISOR_ALLOW_PAID_MODELS") !== "true") return [];
    return [{ name, model, key }];
  });
}

function retryAfter(response: Response, body: any): number {
  const header = response.headers.get("Retry-After");
  let wait = header ? Number(header) : NaN;
  if (header && !Number.isFinite(wait)) wait = (Date.parse(header) - Date.now()) / 1000;
  if (!Number.isFinite(wait)) {
    const detail = body?.error?.details?.find((item: any) => item?.retryDelay);
    wait = Number.parseFloat(detail?.retryDelay);
  }
  return Math.min(86400, Math.max(1, Math.ceil(Number.isFinite(wait) ? wait : 60)));
}

export async function generateAdvisorAnswer({
  providers, system, context, history, fetch, reserve, report, validateAnswer = () => true,
}: {
  providers: Provider[];
  system: string;
  context: string;
  history: { role: string; content: string }[];
  fetch: typeof globalThis.fetch;
  validateAnswer?: (answer: string) => boolean;
  reserve: (provider: string, model: string) => Promise<Gate | null>;
  report: (provider: string, model: string, status: string, wait: number, duration: number) => Promise<void>;
}): Promise<Outcome> {
  if (!providers.length) return { error: "configuration_missing", attempts: 0 };
  const deadline = Date.now() + 42000;
  let attempts = 0, lastError = "provider_unavailable";
  const waits: number[] = [];
  for (const provider of providers) {
    const models = provider.name === "gemini" && provider.model !== DEFAULT_GEMINI_MODEL
      ? [provider.model, DEFAULT_GEMINI_MODEL] : [provider.model];
    for (const model of models) {
      if (attempts >= 4 || Date.now() >= deadline) break;
      let gate: Gate | null;
      try { gate = await reserve(provider.name, model); }
      catch { gate = null; }
      if (!gate) return { error: "quota_unavailable", attempts };
      if (!gate.allowed) {
        waits.push(Math.max(1, gate.retryAfterSeconds || 60));
        lastError = "rate_limited";
        break;
      }
      attempts++;
      const started = Date.now();
      let status = "provider_unavailable", pause = 30;
      try {
        const gemini = provider.name === "gemini";
        const payload = gemini ? {
          systemInstruction: { parts: [{ text: system }] },
          contents: [
            ...history.map((item) => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.content }] })),
            { role: "user", parts: [{ text: context }] },
          ],
          generationConfig: { temperature: 0.25, maxOutputTokens: 1800 },
          safetySettings: ["HARASSMENT", "HATE_SPEECH", "SEXUALLY_EXPLICIT", "DANGEROUS_CONTENT"].map((category) => ({
            category: `HARM_CATEGORY_${category}`, threshold: "BLOCK_MEDIUM_AND_ABOVE",
          })),
        } : {
          model,
          messages: [{ role: "system", content: system }, ...history, { role: "user", content: context }],
          temperature: 0.25,
          max_completion_tokens: 1800,
          ...(provider.name === "groq" && model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low", include_reasoning: false } : {}),
          // Sin reintentos internos que cambien de modelo tras un rechazo de seguridad.
          ...(provider.name === "openrouter" ? { provider: { allow_fallbacks: false }, plugins: [] } : {}),
        };
        const response = await fetch(gemini
          ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
          : ENDPOINTS[provider.name], {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(gemini ? { "x-goog-api-key": provider.key } : { Authorization: `Bearer ${provider.key}` }),
            ...(provider.name === "openrouter" ? { "X-OpenRouter-Title": "LESAN" } : {}),
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(Math.max(1, Math.min(provider.name === "openrouter" ? 16000 : 12000, deadline - Date.now()))),
        });
        const body = await response.json();
        const choice = gemini ? body?.candidates?.[0] : body?.choices?.[0];
        const code = Number(body?.error?.code) || response.status;
        const blocked = !!body?.promptFeedback?.blockReason ||
          refusalReasons.has(choice?.finishReason || choice?.finish_reason) ||
          !!choice?.message?.refusal;
        if (blocked) {
          status = "content_blocked"; pause = 0;
          return { error: status, attempts };
        }
        if (!response.ok || body?.error) {
          status = code === 429 ? "rate_limited" : code === 402 ? "credits_exhausted"
            : [401, 403, 404, 410].includes(code) ? "provider_configuration" : "provider_unavailable";
          pause = code === 429 ? retryAfter(response, body) : [401, 402, 403, 404, 410].includes(code) ? 1800 : 30;
          // Un modelo Gemini retirado puede sustituirse por el predeterminado.
          if (code === 404 && model !== DEFAULT_GEMINI_MODEL && gemini) {
            pause = 0;
            continue;
          }
          lastError = status === "credits_exhausted" ? "provider_unavailable" : status;
          waits.push(pause);
          break;
        }
        const content = gemini ? choice?.content?.parts?.filter((part: any) => !part?.thought)
          .map((part: any) => typeof part?.text === "string" ? part.text : "").join("\n")
          : choice?.message?.content;
        const answer = typeof content === "string" ? content.trim().slice(0, 8000) : "";
        if (!answer) { status = "empty_response"; lastError = status; waits.push(pause); break; }
        // Una respuesta cortada no se presenta como una evaluación completa.
        if (["MAX_TOKENS", "length"].includes(choice?.finishReason || choice?.finish_reason)) {
          status = "incomplete_response"; lastError = status; waits.push(pause); break;
        }
        if (!validateAnswer(answer)) { status = "incomplete_response"; lastError = status; waits.push(pause); break; }
        status = "ok"; pause = 0;
        return { answer, source: provider.name, model: body?.model || model, attempts };
      } catch (error) {
        status = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
          ? "provider_timeout" : "provider_unavailable";
        lastError = status;
        waits.push(pause);
        break;
      } finally {
        // Solo metadatos de disponibilidad; nunca claves, mensajes o respuestas.
        try { await report(provider.name, model, status, pause, Date.now() - started); }
        catch { /* la reserva ya limitó el intento */ }
      }
    }
  }
  return { error: lastError, retryAfterSeconds: Math.max(1, waits.length ? Math.min(...waits) : 60), attempts };
}
