const DB_NAME = 'lyra-assistant-local-v1'
const STORE = 'chats'
const MAX_MESSAGES = 300
const MAX_CHATS = 40
let opening
function openDB() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('local_storage_unavailable'))
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: ['owner', 'id'] })
      store.createIndex('owner', 'owner')
    }
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null }; resolve(db) }
    request.onerror = () => { opening = null; reject(request.error) }
    request.onblocked = () => { opening = null; reject(new Error('local_storage_blocked')) }
  })
  return opening
}
async function transaction(mode, action) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    let value
    tx.oncomplete = () => resolve(value)
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('local_storage_failed'))
    action(tx.objectStore(STORE), result => { value = result })
  })
}
export function freshChat() { return { id: crypto.randomUUID(), messages: [], draft: '', updatedAt: Date.now() } }
export function selectHistory(messages) {
  let remaining = 6000
  const selected = []
  for (const message of messages.slice(-8).reverse()) {
    if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') continue
    const content = message.content.slice(0, Math.min(1800, remaining))
    if (!content) break
    selected.unshift({ role: message.role, content }); remaining -= content.length
    if (!remaining) break
  }
  return selected
}
export async function listChats(owner) {
  if (!owner) return []
  const rows = await transaction('readonly', (store, done) => {
    const request = store.index('owner').getAll(owner)
    request.onsuccess = () => done(request.result)
  })
  return rows.sort((a,b) => b.updatedAt-a.updatedAt)
}
export async function saveChat(owner, chat) {
  if (!owner) throw new Error('owner_required')
  if (chat.messages.length > MAX_MESSAGES) throw new Error('chat_limit')
  return transaction('readwrite', (store, done) => {
    const request = store.index('owner').getAll(owner)
    request.onsuccess = () => {
      if (!request.result.some(c => c.id === chat.id) && request.result.length >= MAX_CHATS) {
        // Keep existing chats; never silently evict a conversation.
        done(false); return
      }
      store.put({ ...chat, owner, updatedAt: Date.now(), title: chat.messages.find(m => m.role === 'user')?.content.slice(0,70) || 'Nuevo chat' }); done(true)
    }
  })
}
export async function deleteChat(owner, id) {
  if (owner) await transaction('readwrite', store => store.delete([owner, id]))
}
export async function deleteAllChats(owner) {
  if (!owner) return
  await transaction('readwrite', store => {
    const request = store.index('owner').openCursor(owner)
    request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue() } }
  })
}
