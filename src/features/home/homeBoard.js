import { HOME_BLOCKS, HOME_SIZES, frameFromBounds, normalizeLayout, packBlocks, readLayout, writeLayout, layoutKey, isLayoutSaved, movePackedBlock } from './homeLayout.js'
import './HomeBoard.css'

const SIZE_NAMES = {compact:'Pequeño',medium:'Mediano',wide:'Completo'}
const grip = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="5" r="1.5"/><circle cx="16" cy="5" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="19" r="1.5"/><circle cx="16" cy="19" r="1.5"/></svg>'
const optionsIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--panel)"/><circle cx="15" cy="17" r="3" fill="var(--panel)"/></svg>'
const resizeIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 19h14V5M10 14h4v-4"/></svg>'
const reduced = () => matchMedia('(prefers-reduced-motion:reduce)').matches
const cards = grid => [...grid.querySelectorAll(':scope > .hw')]
const cleanClone = node => {
  const clone = node.cloneNode(true)
  clone.classList.remove('hw');clone.removeAttribute('data-w');clone.removeAttribute('id');clone.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'))
  clone.inert = true;clone.setAttribute('aria-hidden','true')
  return clone
}

/** Owns one board at a time. Account changes and navigation cancel gestures and release listeners. */
export function createHomeBoard({ owner, registered, announce, navigate, closeMenu = () => {}, onSave = () => {} }) {
  let root, grid, toolbar, state, scope, resize, editing = false, currentOwner, popover, anchor, drag, sizing, undo, ignoreResizeClickUntil = 0
  const nodes = new Map(), motion = new Map(), ghosts = new Set()
  const save = () => {
    const ok = writeLayout(currentOwner || owner(), state)
    onSave(state)
    syncRestore()
    syncUndo()
    const status=toolbar?.querySelector('[data-home-save-state]')
    if(status)status.textContent=ok?'Tus cambios se sincronizan con tu cuenta':'Los cambios solo se conservan durante esta sesión. No se pudieron guardar en el navegador.'
    if (!ok) announce('Los cambios se conservan en esta sesión. Este navegador no permite guardarlos para la próxima visita.')
    return ok
  }
  function syncUndo() {
    const button=toolbar?.querySelector('[data-home-undo]')
    if(!button)return
    button.hidden=!undo||undo.owner!==currentOwner
    button.textContent=undo?.label?`Deshacer · ${undo.label}`:'Deshacer'
  }
  function syncRestore() {
    const menu = document.getElementById('menu')
    if (!menu) return
    const count = registered() ? readLayout(owner()).hidden.length : 0
    let button = menu.querySelector('[data-home-restore]')
    if (!count) { button?.remove(); return }
    if (!button) { button = document.createElement('button');button.type='button';button.className='it';button.setAttribute('role','menuitem');button.dataset.homeRestore='';menu.append(button) }
    const text = `Recuperar bloques de Inicio (${count})`
    if (button.textContent !== text) button.textContent = text
  }
  function snapshot() { return new Map(cards(grid).map(n=>[n.dataset.w,n.getBoundingClientRect()])) }
  function animateFrom(before, skip) {
    if (reduced()) return
    for (const n of cards(grid)) {
      if (n === skip) continue
      const old = before.get(n.dataset.w)
      motion.get(n)?.cancel()
      const next = n.getBoundingClientRect()
      if (!old || !next.width || !next.height) continue
      const x = old.left-next.left, y = old.top-next.top, sx = old.width/next.width, sy = old.height/next.height
      if (Math.abs(x)+Math.abs(y)+Math.abs(old.width-next.width)+Math.abs(old.height-next.height)<1) continue
      const animation = n.animate([{transform:`translate(${x}px,${y}px) scale(${sx},${sy})`,transformOrigin:'top left'},{transform:'none',transformOrigin:'top left'}],{duration:280,easing:'cubic-bezier(.16,1,.3,1)'})
      motion.set(n,animation)
      animation.finished.catch(()=>{}).finally(()=>{if(motion.get(n)===animation)motion.delete(n)})
    }
  }
  function preview(n) {
    const make = n?.__preview
    if (!make) return
    const existing = n.querySelector('.hw-preview')
    const content = make()
    const p = document.createElement('div');p.className='hw-preview blk';p.hidden=n.dataset.compact==='false'||(!n.dataset.compact&&state.sizes[n.dataset.w]==='wide')
    const heading=document.createElement('h3');heading.textContent=n.dataset.n;p.append(heading)
    for (const [tag, text, cls] of [['strong',content.value,'hw-value'],['p',content.label,'hw-label'],['p',content.detail,'hw-detail']]) {
      if (!text) continue
      const el=document.createElement(tag);el.className=cls;el.textContent=text;p.append(el)
    }
    const button=document.createElement('button');button.type='button';button.className='h-btn';button.dataset.homeExpand='';button.textContent='Ampliar';button.setAttribute('aria-label',`Ampliar bloque «${n.dataset.n}»`);p.append(button)
    if (existing) existing.replaceWith(p); else n.append(p)
  }
  function arrange(animate=true) {
    if (!root?.isConnected || !grid) return
    const before=animate?snapshot():null, focus=document.activeElement
    const columns=root.clientWidth>=880?4:2
    grid.style.setProperty('--home-columns',12)
    grid.dataset.columns=columns
    const visible=state.order.filter(id=>nodes.has(id)&&!state.hidden.includes(id))
    const packed=packBlocks(visible,state.sizes,columns,state.frames)
    for (const [id,n] of nodes) {
      if (state.hidden.includes(id)) { n.remove();continue }
      const frame=state.frames[id], custom=state.sizes[id]==='custom'
      const actualWidth=custom?Math.max(1,Math.round(frame.span/12*columns))/columns*root.clientWidth:root.clientWidth
      const small=custom?(frame.height<360||actualWidth<Math.min(360,root.clientWidth)):state.sizes[id]!=='wide'
      n.dataset.size=state.sizes[id];n.dataset.compact=String(small)
      if(custom)n.style.setProperty('--home-height',frame.height+'px');else n.style.removeProperty('--home-height')
      n.querySelector('.hw-size-label').textContent=custom?'A medida':SIZE_NAMES[state.sizes[id]]
      n.querySelector('.hw-content').hidden=small
      n.querySelector('.hw-preview').hidden=!small
      n.querySelectorAll('[data-home-size]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.homeSize===state.sizes[id])))
    }
    packed.forEach(({id,row,fitCol,fitSpan},i)=>{
      const n=nodes.get(id)
      n.style.gridColumn=`${fitCol} / span ${fitSpan}`;n.style.gridRow=String(row)
      n.querySelector('.w-grip').setAttribute('aria-description',`Posición ${i+1} de ${packed.length}. Flechas para ordenar; Inicio y Fin para mover a los extremos.`)
      if (grid.children[i]!==n) grid.insertBefore(n,grid.children[i]||null)
    })
    root.dataset.editing=String(editing)
    toolbar.querySelector('[data-home-edit]').textContent=editing?'Listo':'Personalizar Inicio'
    toolbar.querySelector('[data-home-edit]').setAttribute('aria-pressed',String(editing))
    toolbar.querySelector('[data-home-instructions]').hidden=!editing
    toolbar.querySelector('[data-home-reset]').hidden=!editing
    syncUndo()
    let empty=grid.querySelector('.hw-empty')
    if (!packed.length&&!empty) {empty=document.createElement('p');empty.className='hw-empty';empty.textContent='Tu Inicio está despejado. Recupera los bloques desde Perfil cuando quieras.';grid.append(empty)}
    if (packed.length) empty?.remove()
    if (focus?.isConnected&&document.activeElement!==focus) focus.focus({preventScroll:true})
    if (before) animateFrom(before,drag?.node)
    drag?.capture?.();sizing?.capture?.();positionPopover()
  }
  function closePopover(focus=false) {
    popover?.remove();popover=null
    anchor?.setAttribute('aria-expanded','false');anchor?.removeAttribute('aria-controls')
    if (focus&&anchor?.isConnected) anchor.focus({preventScroll:true})
    anchor=null
  }
  function positionPopover() {
    if (!popover||!anchor?.isConnected) return
    const r=anchor.getBoundingClientRect(),v=window.visualViewport,w=v?.width||innerWidth,h=v?.height||innerHeight,top=v?.offsetTop||0
    popover.style.left=Math.max(10,Math.min(r.right-popover.offsetWidth,w-popover.offsetWidth-10))+'px'
    popover.style.top=Math.max(top+10,Math.min(r.bottom+8,top+h-popover.offsetHeight-100))+'px'
  }
  function openOptions(n) {
    const b=n.querySelector('.w-options')
    if (anchor===b) {closePopover(true);return}
    closePopover();anchor=b;b.setAttribute('aria-expanded','true')
    popover=document.createElement('div');popover.className='hw-options';popover.id='home-block-options';b.setAttribute('aria-controls',popover.id);popover.setAttribute('role','dialog');popover.setAttribute('aria-label',`Opciones del bloque ${n.dataset.n}`)
    const title=document.createElement('h3');title.textContent=n.dataset.n;popover.append(title)
    const sizes=document.createElement('div');sizes.className='hw-sizes';sizes.setAttribute('role','group');sizes.setAttribute('aria-label','Tamaño del bloque')
    HOME_SIZES.forEach(size=>{const item=document.createElement('button');item.type='button';item.dataset.homeSize=size;item.textContent=SIZE_NAMES[size];item.setAttribute('aria-pressed',String(state.sizes[n.dataset.w]===size));item.addEventListener('click',()=>changeSize(n,size));sizes.append(item)})
    popover.append(sizes)
    const steps=document.createElement('div');steps.className='hw-option-actions'
    for (const [direction,label] of [[-1,'Subir'],[1,'Bajar']]) {
      const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',`${label} bloque «${n.dataset.n}»`);button.addEventListener('click',()=>moveStep(n,direction));steps.append(button)
    }
    const remove=document.createElement('button');remove.type='button';remove.textContent='Eliminar bloque';remove.setAttribute('aria-label',`Eliminar bloque «${n.dataset.n}»`);remove.addEventListener('click',()=>hide(n));steps.append(remove);popover.append(steps)
    const hint=document.createElement('p');hint.textContent='Los bloques pequeños se encajan automáticamente cuando hay espacio.';popover.append(hint)
    document.body.append(popover);positionPopover();(sizes.querySelector('[aria-pressed=true]')||sizes.firstElementChild).focus({preventScroll:true})
    if(!reduced())popover.animate([{opacity:0,transform:'translateY(-5px) scale(.985)'},{opacity:1,transform:'none'}],{duration:160,easing:'cubic-bezier(.16,1,.3,1)'})
  }
  function changeSize(n,size) {
    if (!HOME_SIZES.includes(size)) return
    const before=snapshot()
    undo={layout:normalizeLayout(state),owner:currentOwner,label:'Tamaño'}
    state.sizes[n.dataset.w]=size;state.compact=Object.keys(state.sizes).filter(id=>state.sizes[id]==='compact')
    delete state.frames[n.dataset.w]
    const focus=anchor
    closePopover();arrange(false);save();animateFrom(before)
    focus?.focus({preventScroll:true});announce(`Bloque «${n.dataset.n}» en tamaño ${SIZE_NAMES[size].toLowerCase()}. Los bloques se acomodaron automáticamente.`)
  }
  function announcePosition(n) {
    const order=cards(grid)
    announce(`Bloque «${n.dataset.n}» en posición ${order.indexOf(n)+1} de ${order.length}.`)
  }
  function moveStep(n,direction,edge) {
    const visible=cards(grid).map(c=>c.dataset.w),i=visible.indexOf(n.dataset.w),next=edge==='start'?0:edge==='end'?visible.length-1:i+direction
    if(next<0||next>=visible.length){announce(`Bloque «${n.dataset.n}» ya está ${direction<0?'al inicio':'al final'}.`);return}
    undo={layout:normalizeLayout(state),owner:currentOwner,label:'Orden'}
    state=movePackedBlock(state,visible,n.dataset.w,visible[next],next>i,Number(grid.dataset.columns));arrange();save();announcePosition(n)
    n.querySelector('.w-grip').focus({preventScroll:true});n.scrollIntoView({block:'nearest',behavior:'instant'})
  }
  function hide(n) {
    const id=n.dataset.w
    closePopover();undo={layout:normalizeLayout(state),owner:currentOwner,label:n.dataset.n}
    state.hidden.push(id)
    const before=snapshot(),r=n.getBoundingClientRect()
    if(!reduced()) {
      const ghost=cleanClone(n);ghost.classList.add('hw-ghost');Object.assign(ghost.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});document.body.append(ghost);ghosts.add(ghost)
      ghost.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.96)'}],{duration:160,easing:'ease-out'}).finished.catch(()=>{}).finally(()=>{ghost.remove();ghosts.delete(ghost)})
    }
    arrange(false);save();animateFrom(before)
    const button=toolbar.querySelector('[data-home-undo]');button.hidden=false;button.textContent=`Deshacer · ${n.dataset.n}`;button.focus({preventScroll:true})
    announce(`Bloque «${n.dataset.n}» eliminado. Puedes deshacerlo o recuperarlo desde Perfil.`)
  }
  function setEditing(on) {
    if (!registered()) return
    if (drag) drag.stop(true)
    sizing?.stop(true)
    closePopover();editing=on;arrange()
    announce(on?'Personalización activada. Arrastra desde el asa para ordenar y desde la esquina para ajustar tamaño. También puedes usar los botones y el teclado.':'Personalización guardada.')
  }
  function applyFrame(node, frame, animateSelf=false) {
    const id=node.dataset.w, before=snapshot()
    state.sizes[id]='custom';state.frames[id]=frame
    arrange(false);animateFrom(before,animateSelf?null:node)
    const label=node.querySelector('.hw-size-label')
    label.textContent=`${Math.round(node.offsetWidth)} × ${frame.height}`
  }
  function resizeKey(node, key) {
    motion.get(node)?.finish()
    const box=node.getBoundingClientRect(), content=node.querySelector(node.dataset.compact==='true'?'.hw-preview':'.hw-content').getBoundingClientRect()
    const columns=Number(grid.dataset.columns), unit=root.clientWidth/columns
    const current=state.frames[node.dataset.w], horizontal=key==='ArrowRight'||key==='ArrowLeft'
    undo={layout:normalizeLayout(state),owner:currentOwner,label:'Tamaño'}
    const baseWidth=current?Math.max(1,Math.round(current.span/12*columns))*unit:box.width
    const width=baseWidth+(key==='ArrowRight'?unit:key==='ArrowLeft'?-unit:0), height=(current?.height||content.height)+(key==='ArrowDown'?24:key==='ArrowUp'?-24:0)
    const frame=frameFromBounds(width,height,root.clientWidth,columns)
    if(current&&!horizontal)frame.span=current.span
    applyFrame(node,frame,true);save()
    announce(`Tamaño de «${node.dataset.n}»: ${Math.round(node.getBoundingClientRect().width)} por ${state.frames[node.dataset.w].height} píxeles.`)
  }
  function resizeDown(event) {
    const handle=event.target.closest('.w-resize')
    if(!handle||!editing||event.button>0||event.isPrimary===false||drag||sizing)return
    event.preventDefault();closePopover();handle.focus({preventScroll:true})
    const node=handle.closest('.hw');motion.get(node)?.finish()
    const pid=event.pointerId,start=normalizeLayout(state),box=node.getBoundingClientRect()
    const content=node.querySelector(node.dataset.compact==='true'?'.hw-preview':'.hw-content').getBoundingClientRect(),columns=Number(grid.dataset.columns),width=root.clientWidth
    let x=event.clientX,y=event.clientY,frame=0,active=false,finished=false
    const listeners=new AbortController(),listen=(target,name,fn)=>target.addEventListener(name,fn,{signal:listeners.signal})
    const capture=()=>{try{handle.setPointerCapture(pid)}catch{}}
    function update() {
      frame=0;if(finished)return
      if(!active&&Math.hypot(x-event.clientX,y-event.clientY)<4)return
      active=true;node.dataset.resizing='true'
      applyFrame(node,frameFromBounds(box.width+x-event.clientX,content.height+y-event.clientY,width,columns))
    }
    function stop(cancel=false) {
      if(finished)return
      if(!cancel&&frame)update()
      finished=true;cancelAnimationFrame(frame);listeners.abort();sizing=null;node.removeAttribute('data-resizing')
      try{handle.releasePointerCapture(pid)}catch{}
      if(cancel){state=start;arrange();if(active)announce('Ajuste cancelado. Se conservó el tamaño anterior.')}
      else if(active){undo={layout:start,owner:currentOwner,label:'Tamaño'};save();announce(`Tamaño de «${node.dataset.n}» guardado.`)}
      if(active)ignoreResizeClickUntil=performance.now()+500
    }
    sizing={node,stop,capture};capture()
    listen(handle,'pointermove',e=>{if(e.pointerId===pid){x=e.clientX;y=e.clientY;if(!frame)frame=requestAnimationFrame(update)}})
    listen(handle,'pointerup',e=>{if(e.pointerId===pid)stop()})
    listen(handle,'pointercancel',()=>stop(true));listen(handle,'lostpointercapture',()=>stop(true))
    listen(window,'blur',()=>stop(true));listen(window,'resize',()=>stop(true))
    listen(document,'keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();stop(true)}})
  }
  function pointerDown(event) {
    const handle=event.target.closest('.w-grip')
    if (!handle||!editing||event.button>0||event.isPrimary===false||drag||sizing) return
    event.preventDefault();closePopover()
    const node=handle.closest('.hw'),pid=event.pointerId,start=normalizeLayout(state),r=node.getBoundingClientRect(),page=document.getElementById('page')
    let x=event.clientX,y=event.clientY,active=false,ghost,frame=0,lastTime=0,lastX=x,lastY=y,lastScroll=page.scrollTop,lastTarget='',finished=false
    handle.focus({preventScroll:true})
    try{handle.setPointerCapture(pid)}catch{}
    const stop=(cancel=false)=>{
      if(finished)return;finished=true;cancelAnimationFrame(frame);listeners.abort();drag=null
      try{handle.releasePointerCapture(pid)}catch{}
      node.classList.remove('drag');node.removeAttribute('data-dragging')
      if(cancel){state=start;arrange();if(active)announce('Movimiento cancelado. Se conservó el orden anterior.')}
      else if(active){undo={layout:start,owner:currentOwner,label:'Orden'};save();announcePosition(node)}
      if(ghost){ghosts.delete(ghost);if(!cancel&&!reduced()&&node.isConnected){const end=node.getBoundingClientRect(),from=ghost.getBoundingClientRect();Object.assign(ghost.style,{left:from.left+'px',top:from.top+'px',transform:'none'});const a=ghost.animate([{transform:'none',opacity:1},{transform:`translate(${end.left-from.left}px,${end.top-from.top}px)`,opacity:0}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'});ghosts.add(ghost);a.finished.catch(()=>{}).finally(()=>{ghost.remove();ghosts.delete(ghost)})}else ghost.remove()}
    }
    const listeners=new AbortController(),listen=(target,name,fn)=>target.addEventListener(name,fn,{signal:listeners.signal})
    drag={node,stop,capture:()=>{try{handle.setPointerCapture(pid)}catch{}}}
    function tick(time){
      frame=0;if(finished||!node.isConnected){stop(true);return}
      if(!active&&Math.hypot(x-event.clientX,y-event.clientY)>6){
        active=true;node.classList.add('drag');node.dataset.dragging='true';ghost=cleanClone(node);ghost.classList.remove('drag');ghost.removeAttribute('data-dragging');ghost.classList.add('hw-ghost');Object.assign(ghost.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});document.body.append(ghost);ghosts.add(ghost);announce(`Moviendo «${node.dataset.n}». Suelta para colocar o pulsa Escape para cancelar.`)
      }
      if(active){
        const pr=page.getBoundingClientRect(),zone=64,dt=lastTime?Math.min(32,time-lastTime):16
        const speed=y<pr.top+zone?-Math.min(1,(pr.top+zone-y)/zone):y>pr.bottom-zone?Math.min(1,(y-pr.bottom+zone)/zone):0
        if(speed)page.scrollTop+=speed*dt*.8
        ghost.style.transform=`translate3d(${x-event.clientX}px,${y-event.clientY}px,0) scale(1.015)`
        if(Math.hypot(x-lastX,y-lastY)>10||Math.abs(page.scrollTop-lastScroll)>18){
          let target,best=Infinity
          for(const n of cards(grid)){if(n===node)continue;const box=n.getBoundingClientRect(),distance=Math.hypot(Math.max(box.left-x,0,x-box.right),Math.max(box.top-y,0,y-box.bottom));if(distance<best){best=distance;target=n}}
          if(target&&best<48){
            const tr=target.getBoundingClientRect(),sameRow=Math.abs(node.getBoundingClientRect().top-tr.top)<40
            const after=sameRow?x>tr.left+tr.width/2:y>tr.top+tr.height/2,key=target.dataset.w+':'+after
            if(key!==lastTarget){const visible=cards(grid).map(n=>n.dataset.w);state=movePackedBlock(state,visible,node.dataset.w,target.dataset.w,after,Number(grid.dataset.columns));arrange();lastTarget=key}
          }
          lastX=x;lastY=y;lastScroll=page.scrollTop
        }
      }
      lastTime=time;frame=requestAnimationFrame(tick)
    }
    listen(handle,'pointermove',e=>{if(e.pointerId===pid){x=e.clientX;y=e.clientY}})
    listen(handle,'pointerup',e=>{if(e.pointerId!==pid)return;const box=grid.getBoundingClientRect();stop(x<box.left-32||x>box.right+32||y<box.top-32||y>box.bottom+32)})
    listen(handle,'pointercancel',()=>stop(true));listen(handle,'lostpointercapture',()=>stop(true))
    listen(window,'blur',()=>stop(true));listen(window,'resize',()=>stop(true))
    listen(document,'keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();stop(true)}})
    frame=requestAnimationFrame(tick)
  }
  function detach() {
    drag?.stop(true);sizing?.stop(true);scope?.abort();resize?.disconnect();closePopover()
    motion.forEach(a=>a.cancel());motion.clear();ghosts.forEach(g=>g.remove());ghosts.clear();nodes.clear();root=null;grid=null;toolbar=null
  }
  function mount(home,items) {
    detach()
    if(currentOwner!==owner()){editing=false;undo=null}
    currentOwner=owner();root=home;state=registered()?readLayout(currentOwner):normalizeLayout()
    grid=document.createElement('div');grid.className='hw-grid';grid.setAttribute('role','group');grid.setAttribute('aria-label','Bloques de Inicio');home.insertBefore(grid,home.querySelector(':scope > .h-foot'))
    if (!registered()) {items.forEach(({elements})=>elements.forEach(n=>grid.append(n)));grid.classList.add('hw-visitor');return}
    items.forEach(({id,name,elements,summary})=>{
      if(!elements.length)return
      const n=document.createElement('section');n.className='hw';n.dataset.w=id;n.dataset.n=name;n.__preview=summary;n.tabIndex=-1;n.setAttribute('aria-label',name)
      const controls=document.createElement('div');controls.className='hw-controls'
      const g=document.createElement('button');g.type='button';g.className='w-grip';g.innerHTML=grip;g.setAttribute('aria-label',`Mover bloque «${name}»`);g.title='Arrastra para mover. También puedes usar las flechas.'
      const options=document.createElement('button');options.type='button';options.className='w-options';options.innerHTML=optionsIcon;options.setAttribute('aria-label',`Opciones del bloque «${name}»`);options.setAttribute('aria-expanded','false')
      const sizeLabel=document.createElement('span');sizeLabel.className='hw-size-label';sizeLabel.setAttribute('aria-hidden','true')
      controls.append(g,sizeLabel,options);n.append(controls)
      const content=document.createElement('div');content.className='hw-content';elements.forEach(el=>content.append(el));n.append(content);nodes.set(id,n);preview(n)
      const handle=document.createElement('button');handle.type='button';handle.className='w-resize';handle.innerHTML=resizeIcon;handle.setAttribute('aria-label',`Ajustar tamaño de «${name}»`);handle.setAttribute('aria-description','Arrastra la esquina para ajustar ancho y alto. Las flechas también cambian el tamaño. Escape cancela el ajuste.');handle.title='Arrastra para ajustar tamaño';n.append(handle)
    })
    toolbar=document.createElement('div');toolbar.className='hw-toolbar';toolbar.innerHTML='<div><strong>Tu Inicio, a tu ritmo</strong><p data-home-save-state>Tus cambios se sincronizan con tu cuenta</p><p data-home-instructions hidden>Arrastra el asa para ordenar y la esquina para ajustar tamaño en vivo. También puedes usar las opciones o las flechas del teclado.</p></div><div class="hw-toolbar-actions"><button type="button" class="h-btn" data-home-undo hidden>Deshacer</button><button type="button" class="h-btn" data-home-reset hidden>Restablecer diseño</button><button type="button" class="h-btn" data-home-edit aria-pressed="false">Personalizar Inicio</button></div>';grid.before(toolbar)
    if(!isLayoutSaved(currentOwner))toolbar.querySelector('[data-home-save-state]').textContent='Los cambios solo se conservan durante esta sesión. No se pudieron guardar en el navegador.'
    const button=toolbar.querySelector('[data-home-undo]');button.hidden=!undo||undo.owner!==currentOwner
    scope=new AbortController();const listen=(target,name,fn,extra={})=>target.addEventListener(name,fn,{signal:scope.signal,...extra})
    listen(home,'click',e=>{
      const b=e.target.closest('button');if(!b)return
      if(b.hasAttribute('data-home-edit'))setEditing(!editing)
      if(b.hasAttribute('data-home-undo')&&undo?.owner===currentOwner){state=normalizeLayout(undo.layout);undo=null;b.hidden=true;arrange();save();announce('Cambio deshecho.')}
      if(b.hasAttribute('data-home-reset')){undo={layout:normalizeLayout(state),owner:currentOwner,label:'Diseño'};state=normalizeLayout();arrange();save();announce('Diseño original recuperado. Puedes deshacerlo.')}
      if(b.matches('.w-options'))openOptions(b.closest('.hw'))
      if(b.matches('.w-resize')&&performance.now()>ignoreResizeClickUntil)openOptions(b.closest('.hw'))
      if(b.hasAttribute('data-home-expand')){const n=b.closest('.hw');changeSize(n,'wide');n.focus({preventScroll:true});n.scrollIntoView({block:'nearest',behavior:reduced()?'instant':'smooth'})}
    })
    listen(home,'pointerdown',resizeDown);listen(home,'pointerdown',pointerDown)
    listen(home,'keydown',e=>{
      const sizeHandle=e.target.closest('.w-resize')
      if(sizeHandle&&editing&&!sizing&&!drag&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();resizeKey(sizeHandle.closest('.hw'),e.key);return}
      const handle=e.target.closest('.w-grip')
      if(!handle||!editing||drag||e.altKey||e.ctrlKey||e.metaKey)return
      if(['ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();moveStep(handle.closest('.hw'),['ArrowUp','ArrowLeft'].includes(e.key)?-1:1,e.key==='Home'?'start':e.key==='End'?'end':undefined)}
    })
    listen(document,'pointerdown',e=>{if(popover&&!popover.contains(e.target)&&!anchor?.contains(e.target))closePopover()})
    listen(document,'keydown',e=>{if(e.key==='Escape'&&popover){e.preventDefault();closePopover(true)}})
    listen(document,'focusin',e=>{if(popover&&!popover.contains(e.target)&&!anchor?.contains(e.target))closePopover()})
    listen(document,'scroll',positionPopover,{passive:true,capture:true});listen(window,'resize',positionPopover)
    // Long press enters editing without intercepting ordinary scrolling or form controls.
    let press,pressStart,longPressed=false
    const cancelPress=()=>{clearTimeout(press);press=null}
    listen(home,'pointerdown',e=>{longPressed=false;const n=e.target.closest('.hw');if(editing||e.pointerType!=='touch'||!n||e.target.closest('button,a,input,select,textarea,summary'))return;pressStart={x:e.clientX,y:e.clientY};press=setTimeout(()=>{press=null;longPressed=true;setEditing(true);openOptions(n)},450)})
    listen(home,'pointermove',e=>{if(press&&Math.hypot(e.clientX-pressStart.x,e.clientY-pressStart.y)>8)cancelPress()},{passive:true})
    listen(home,'pointerup',cancelPress);listen(home,'pointercancel',cancelPress);scope.signal.addEventListener('abort',cancelPress)
    listen(home,'contextmenu',e=>{if(press||longPressed){e.preventDefault();cancelPress();const n=e.target.closest('.hw');if(n&&!longPressed){longPressed=true;setEditing(true);openOptions(n)}}})
    let previousColumns=0
    resize=new ResizeObserver(()=>{const c=home.clientWidth>=880?4:2;if(c!==previousColumns){previousColumns=c;drag?.stop(true);sizing?.stop(true);arrange(false)}});resize.observe(home)
    arrange(false);syncRestore()
  }
  new MutationObserver(syncRestore).observe(document.getElementById('menu'),{childList:true})
  addEventListener('lyra-home-layout-updated',()=>{syncRestore();if(root?.isConnected){drag?.stop(true);sizing?.stop(true);state=readLayout(owner());closePopover();arrange()}})
  addEventListener('storage',event=>{if(event.key===layoutKey(owner())){syncRestore();if(root?.isConnected){drag?.stop(true);sizing?.stop(true);state=readLayout(owner());undo=null;closePopover();arrange()}}})
  document.addEventListener('click',event=>{if(event.target.closest('[data-home-restore]')){state=readLayout(owner());state.hidden=[];undo=null;writeLayout(owner(),state);onSave(state);syncRestore();closeMenu();if(root?.isConnected){arrange();toolbar.querySelector('[data-home-edit]').focus({preventScroll:true})}else navigate('Inicio');announce('Bloques de Inicio recuperados.')}})
  return {mount,detach,syncRestore,
    refresh:id=>{if(nodes.has(id))preview(nodes.get(id))},
    reveal:id=>{if(!registered())return;state=readLayout(owner());state.hidden=state.hidden.filter(v=>v!==id);state.sizes[id]='wide';delete state.frames[id];writeLayout(owner(),state);onSave(state);syncRestore();if(root?.isConnected){preview(nodes.get(id));arrange()}},
    reset:()=>{if(!registered())return false;state=readLayout(owner());state.order=[...HOME_BLOCKS];writeLayout(owner(),state);onSave(state);syncRestore();if(root?.isConnected)arrange();else navigate('Inicio');announce('Orden de Inicio restablecido.');return true}
  }
}
