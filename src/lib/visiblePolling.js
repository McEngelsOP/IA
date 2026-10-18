// One timer, no overlap and no wakeups in hidden tabs. Focus and visibility
// events are coalesced, rather than spawning a second request on return.
export function visiblePolling(read, { doc = document, win = window, delay = 10000, now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
 let timer=null, disposed=false, running=false, last=-Infinity
 const stop=()=>{cancel(timer);timer=null}
 const queue=(wait=delay)=>{stop();if(!disposed&&!doc.hidden)timer=schedule(tick,wait)}
 async function tick(){
  stop();if(disposed||doc.hidden||running)return
  running=true;last=now()
  try{await read()}finally{running=false;queue()}
 }
 const resume=()=>{if(doc.hidden)stop();else if(!running)queue(Math.max(0,3000-(now()-last)))}
 doc.addEventListener('visibilitychange',resume);win.addEventListener('focus',resume);queue()
 return ()=>{disposed=true;stop();doc.removeEventListener('visibilitychange',resume);win.removeEventListener('focus',resume)}
}
