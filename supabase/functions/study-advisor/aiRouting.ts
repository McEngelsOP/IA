import { configuredProviders, DEFAULTS, type Provider } from './providers.ts';

// Identity is always obtained from auth.getUser in the calling Edge Function.
export async function loadAiRoute({ client, server, userId, env }: { client: any; server: any; userId: string; env: (name: string) => string | undefined }) {
  const { data, error } = await server.rpc('ai_key_read', { p_user_id: userId });
  if (error || !data || !['system','personal'].includes(data.mode)) throw new Error('credentials_unavailable');
  const personal = data.mode === 'personal';
  const owned = new Map((data.providers || []).map((p: any) => [p.name, p.key]));
  const providers: Provider[] = personal ? configuredProviders(name => {
    const provider = name.replace(/_(API_KEY|MODEL)$/, '').toLowerCase();
    if (name.endsWith('_API_KEY')) return owned.get(provider) as string | undefined;
    if (name.endsWith('_MODEL')) return DEFAULTS[provider];
    return undefined;
  }) : configuredProviders(env);
  const usage = async (consume: boolean) => {
    const r = personal ? await server.rpc('ai_personal_usage', { p_user_id: userId, p_consume: consume }) : await client.rpc('advisor_usage', { p_consume: consume });
    return r.error || !r.data ? null : r.data;
  };
  const reserve = async (provider: string, model: string) => {
    const r = personal ? await server.rpc('ai_personal_reserve', { p_user_id: userId, p_provider: provider }) : await server.rpc('advisor_provider_reserve', { p_provider: provider, p_model: model });
    return r.error || !r.data ? null : r.data;
  };
  const report = async (provider: string, model: string, status: string, wait: number, duration: number) => {
    const r = personal ? await server.rpc('ai_personal_report', { p_user_id: userId, p_provider: provider, p_status: status, p_wait: wait }) : await server.rpc('advisor_provider_report', { p_provider: provider, p_model: model, p_status: status, p_retry_after_seconds: wait, p_duration_ms: duration });
    if (r.error) throw new Error('provider_report_failed');
  };
  return { personal, providers, usage, reserve, report };
}
