import { configuredProviders, DEFAULTS, type Provider } from './providers.ts';
export type AIResource = 'chat' | 'tasks' | 'schedule' | 'key_test';
export const POLICY_MESSAGES: Record<string,string> = {
 personal_key_required: 'Esta cuenta necesita una clave propia. Configura un proveedor en Mi IA; no se usarán claves de Lyra como respaldo.',
 ai_policy_unavailable: 'No se pudo comprobar tu acceso a la IA. Reintenta; no se consumió una consulta.',
 ai_mode_changed: 'Tu servicio de IA cambió en otro dispositivo. Actualiza Mi IA y vuelve a enviar.',
 request_in_progress: 'Ya hay una consulta de esta cuenta en curso. Espera a que termine antes de enviar otra.',
 duplicate_request: 'Esta solicitud ya fue recibida. Revisa la conversación antes de volver a enviar.',
 user_rate_limited: 'Alcanzaste el límite de consultas de los últimos 15 minutos.',
 daily_limit: 'Alcanzaste el límite diario de esta cuenta. Se restablece a medianoche de Lima.',
 resource_limit: 'Alcanzaste el límite diario de esta herramienta. Puedes continuar trabajando manualmente.',
 test_rate_limited: 'Alcanzaste el límite de pruebas de claves. Espera antes de probar otra vez.',
 global_rate_limited: 'La cuota compartida de Lyra está agotada temporalmente. Puedes usar una clave propia.',
 quota_unavailable: 'No se pudo comprobar la cuota. Reintenta; no se enviará la consulta al proveedor.'
};
export function policyMessage(reason: string) { return POLICY_MESSAGES[reason] || 'No se pudo completar la consulta. Revisa Mi IA y vuelve a intentarlo.'; }
// Eligibility and effective mode come exclusively from protected database records.
export async function loadAiRoute({ client, server, userId, env, resource = 'chat', forcePersonal = false }: { client: any; server: any; userId: string; env: (name: string) => string | undefined; resource?: AIResource; forcePersonal?: boolean }) {
  const { data, error } = await server.rpc('ai_key_read', { p_user_id: userId });
  if (error || !data || !['system','personal'].includes(data.mode) || typeof data.access?.sharedEligible !== 'boolean') throw new Error('ai_policy_unavailable');
  const personal = forcePersonal || !data.access.sharedEligible || data.mode === 'personal';
  const source = personal ? 'personal' : 'system';
  const owned = new Map((data.providers || []).map((p: any) => [p.name, p.key]));
  const providers: Provider[] = personal ? configuredProviders(name => {
    const provider = name.replace(/_(API_KEY|MODEL)$/, '').toLowerCase();
    if (name.endsWith('_API_KEY')) return owned.get(provider) as string | undefined;
    if (name.endsWith('_MODEL')) return DEFAULTS[provider];
    return undefined;
  }) : configuredProviders(env);
  const requestId = crypto.randomUUID(); let begun = false, finished = false, succeeded = false;
  const usage = async (consume: boolean) => {
    const r = consume
      ? await server.rpc('ai_request_begin', { p_user_id: userId, p_source: source, p_resource: resource, p_request_id: requestId })
      : await server.rpc('ai_usage', { p_user_id: userId, p_source: source, p_resource: resource });
    if (r.error || !r.data) return null;
    if (consume && r.data.allowed) begun = true;
    return { ...r.data, source, access: data.access };
  };
  const reserve = async (provider: string, model: string) => {
    const r = personal ? await server.rpc('ai_personal_reserve', { p_user_id: userId, p_provider: provider }) : await server.rpc('advisor_provider_reserve', { p_provider: provider, p_model: model });
    return r.error || !r.data ? null : r.data;
  };
  const report = async (provider: string, model: string, status: string, wait: number, duration: number) => {
    const r = personal ? await server.rpc('ai_personal_report', { p_user_id: userId, p_provider: provider, p_status: status, p_wait: wait }) : await server.rpc('advisor_provider_report', { p_provider: provider, p_model: model, p_status: status, p_retry_after_seconds: wait, p_duration_ms: duration });
    if (r.error) throw new Error('provider_report_failed');
    if (status === 'ok') succeeded = true;
  };
  const finish = async () => {
    if (!begun || finished) return;
    finished = true;
    try { await server.rpc('ai_request_finish', { p_user_id: userId, p_request_id: requestId, p_success: succeeded }); } catch { /* The server lease expires even if cleanup cannot reach it. */ }
  };
  return { personal, source, access: data.access, providers, usage, reserve, report, finish };
}
