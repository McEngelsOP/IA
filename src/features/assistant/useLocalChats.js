import { useEffect, useRef, useState } from 'react'
import { deleteAllChats, deleteChat, freshChat, listChats, saveChat } from './localChats.mjs'
export function useLocalChats(owner) {
  const [chat, setChat] = useState(freshChat), [chats,setChats] = useState([])
  const [ready,setReady] = useState(false), [storageError,setStorageError] = useState('')
  const revision = useRef(0), queue = useRef(Promise.resolve())
  useEffect(() => {
    const generation = ++revision.current
    setReady(false); setChat(freshChat()); setChats([]); setStorageError('')
    if (!owner) return
    listChats(owner).then(rows => {
      if (generation !== revision.current) return
      setChats(rows); setChat(rows[0] || freshChat()); setReady(true)
    }).catch(() => { if (generation===revision.current) { setStorageError('No se pudo abrir el historial local. Puedes conversar, pero los mensajes podrían perderse al salir.'); setReady(true) } })
    return () => { revision.current++ }
  },[owner])
  useEffect(() => {
    if (!owner || !ready || (!chat.messages.length && !chat.draft)) return
    const generation=revision.current
    // Serial writes prevent an old save from overwriting a newer message or draft.
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      if(generation!==revision.current)return
      try {
        const saved=await saveChat(owner,chat)
        if(!saved)throw Error('chat_limit')
        const rows=await listChats(owner)
        if(generation===revision.current){setChats(rows);setStorageError('')}
      }catch(e){if(generation===revision.current)setStorageError(e.message==='chat_limit'?'Alcanzaste el límite local de chats. Elimina uno para guardar otro.':'No se pudo guardar en este dispositivo. Conserva una copia del texto antes de salir.')}
    })
  },[chat,owner,ready])
  const run = async action => {
    const generation=revision.current
    await queue.current.catch(()=>{})
    try { await action(); const rows=await listChats(owner); if(generation===revision.current){setChats(rows);setStorageError('')} }
    catch { if(generation===revision.current)setStorageError('No se pudo actualizar el historial local. Reintenta.') }
  }
  return {chat,setChat,chats,ready,storageError,
    flush:async()=>{await queue.current.catch(()=>{});if(!await saveChat(owner,chat))throw Error('storage_failed')},
    newChat:()=>setChat(freshChat()),
    openChat:id=>{const row=chats.find(c=>c.id===id);if(row)setChat(row)},
    removeChat:id=>run(async()=>{await deleteChat(owner,id);if(chat.id===id)setChat(freshChat())}),
    clearChats:()=>run(async()=>{await deleteAllChats(owner);setChat(freshChat())})}
}
