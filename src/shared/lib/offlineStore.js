const DB = 'lyra-offline-v1', ACTIVE = 'lyra-offline-owner'
const open = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 1)
  request.onupgradeneeded = () => request.result.createObjectStore('accounts')
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
async function transaction(mode, action) {
  const db = await open()
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('accounts', mode), request = action(tx.objectStore('accounts'))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
  }) } finally { db.close() }
}
export async function saveOfflineAccount(userId, patch) {
  if (!userId) return
  // A late response from the previous account must never reactivate its snapshot.
  if (localStorage.getItem(ACTIVE) !== userId) return
  const db=await open()
  try { await new Promise((resolve,reject)=>{
    const tx=db.transaction('accounts','readwrite'),store=tx.objectStore('accounts'),read=store.get(userId)
    read.onsuccess=()=>{if(localStorage.getItem(ACTIVE)!==userId){tx.abort();return}store.put({...read.result,...patch,userId,updatedAt:new Date().toISOString()},userId)}
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)
  }) } finally { db.close() }
}
export function activateOfflineAccount(userId) { localStorage.setItem(ACTIVE, userId) }
export async function readOfflineAccount() {
  const id = localStorage.getItem(ACTIVE)
  if (!id) return null
  const data = await transaction('readonly', store => store.get(id))
  return localStorage.getItem(ACTIVE) === id ? data || null : null
}
export async function clearOfflineAccount() {
  localStorage.removeItem(ACTIVE)
  await transaction('readwrite', store => store.clear())
}
