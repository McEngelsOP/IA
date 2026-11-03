// Closed codes only. Never send stack traces, messages, titles or chat content.
export async function reportServiceFailure(client, userId, code) {
 if (!client || !userId) return
 try {
  const verified=await client.auth.getUser()
  if(verified.error||verified.data.user?.id!==userId)return
  await client.rpc('record_service_event',{p_code:code})
 }catch{/* Reporting must never hide a failure or prevent a retry. */}
}
