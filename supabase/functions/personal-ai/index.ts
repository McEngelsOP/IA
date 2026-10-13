import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import { generateAdvisorAnswer } from '../study-advisor/providers.ts';
import { loadAiRoute } from '../study-advisor/aiRouting.ts';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ message: 'Método no permitido.' }, 405);
  try {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return json({ message: 'Inicia sesión para configurar tu IA.' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json({ message: 'Tu sesión venció. Vuelve a iniciar sesión.' }, 401);
    const raw = await req.text();
    if (raw.length > 3000) return json({ message: 'Solicitud demasiado larga.' }, 413);
    let body; try { body = JSON.parse(raw); } catch { return json({ message: 'Solicitud inválida.' }, 400); }
    if (!body || !['list','save','delete','toggle','mode','test'].includes(body.action)) return json({ message: 'Acción inválida.' }, 400);
    if (['save','delete','toggle','test'].includes(body.action) && !['gemini','groq','openrouter'].includes(body.provider)) return json({ message: 'Elige un proveedor disponible.' }, 400);
    if (body.action === 'save' && (typeof body.key !== 'string' || body.key.trim().length < 20 || body.key.trim().length > 512 || /\s/.test(body.key.trim()))) return json({ message: 'La clave debe tener entre 20 y 512 caracteres y no contener espacios.' }, 400);
    if (body.action === 'mode' && !['system','personal'].includes(body.mode)) return json({ message: 'Elige un modo válido.' }, 400);
    if (body.action === 'toggle' && typeof body.enabled !== 'boolean') return json({ message: 'Configuración inválida.' }, 400);
    const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.action === 'test') {
      const moderation = await client.rpc('advisor_check_moderation', { p_is_profane: false, p_severity: 1, p_bad_words: [] });
      if (moderation.error || moderation.data?.allowed !== true) return json({ message: 'La IA no está disponible para tu cuenta en este momento.' }, 403);
      const route = await loadAiRoute({ client, server, userId: user.id, env: name => Deno.env.get(name) });
      // Test only the student's chosen key, never the app's credentials.
      if (!route.personal) return json({ message: 'Activa «Mis claves» para probar tu proveedor.' }, 400);
      const provider = route.providers.find(p => p.name === body.provider);
      if (!provider) return json({ message: 'Guarda y activa primero una clave de este proveedor.' }, 400);
      const quota = await route.usage(true);
      if (!quota?.allowed) return json({ message: 'Alcanzaste el límite de pruebas. Reintenta más tarde.' }, 429);
      const result = await generateAdvisorAnswer({ providers: [provider], system: 'Responde únicamente OK.', context: 'Prueba de disponibilidad de mi clave.', history: [], fetch, reserve: route.reserve, report: route.report });
      return json({ status: result.answer ? 'ok' : result.error, provider: provider.name, message: result.answer ? 'Tu clave respondió correctamente.' : result.error === 'provider_configuration' ? 'El proveedor rechazó la clave o el modelo. Revisa tu clave.' : result.error === 'rate_limited' ? 'Tu proveedor alcanzó su cuota o está en pausa. Reintenta más tarde.' : 'Tu proveedor no respondió. Puedes usar otra clave o cambiar al servicio de la app.' });
    }
    const result = await server.rpc('ai_key_manage', { p_user_id: user.id, p_action: body.action, p_provider: body.provider || null, p_key: body.action === 'save' ? body.key.trim() : null, p_enabled: body.action === 'toggle' ? body.enabled : null, p_mode: body.action === 'mode' ? body.mode : null });
    if (result.error || !result.data) return json({ message: 'No se pudo guardar la configuración. Reintenta.' }, 503);
    return json(result.data);
  } catch { return json({ message: 'No pudimos completar la operación. Reintenta.' }, 503); }
});
