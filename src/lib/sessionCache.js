// Short-lived private reads; scope is always the authenticated user id. Never
// cache failed reads, never persist to disk, and never revive invalidated data.
export function createSessionCache({ now = Date.now, limit = 40, ttl = 30000 } = {}) {
 const entries = new Map()
 const keyOf = (user, key) => JSON.stringify([user, key])
 return {
  read(user, key, load) {
   if (!user) return Promise.reject(new Error('NO_AUTH'))
   const id = keyOf(user,key), previous = entries.get(id)
   if(previous && (previous.pending || previous.until > now())) return previous.promise
   const record = { user, pending:true, until:0, promise:null }
   record.promise = Promise.resolve().then(load).then(value => {
    record.pending=false; record.until=now()+ttl; return value
   }).catch(error=>{if(entries.get(id)===record)entries.delete(id);throw error})
   entries.delete(id);entries.set(id,record)
   while(entries.size>limit)entries.delete(entries.keys().next().value)
   return record.promise
  },
  forgetPending(user,key) { const id=keyOf(user,key);if(entries.get(id)?.pending)entries.delete(id) },
  clear(user) { for(const [key,value] of entries)if(!user || value.user===user)entries.delete(key) },
  get size() { return entries.size }
 }
}
export const privateReads = createSessionCache()
