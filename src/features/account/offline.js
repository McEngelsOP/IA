import { readOfflineAccount } from '../../shared/lib/offlineStore.js'
import { eventsOn, todayLima } from '../../core/calendar/calendarModel.js'
import './system.css'
const root = document.querySelector('#offline')
const node = (tag, text) => { const el = document.createElement(tag); el.textContent = text; return el }
async function boot(){
try {
  const data = await readOfflineAccount()
  if (!data?.catalog) { root.append(node('h1', 'Aún no hay una copia disponible'), node('p', 'Abre Lyra con conexión e inicia sesión para preparar tus datos en este dispositivo.')) }
  else {
    root.append(node('h1', `Lyra · ${data.profile?.alias || 'Mi consulta sin conexión'}`), node('p', `Copia de consulta · actualizada el ${new Date(data.academicAt).toLocaleString('es-PE')}. No se guardan cambios aquí.`))
    const tabs = node('nav', ''), panel = node('section', '')
    function show(type) {
      panel.replaceChildren()
      tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === type)))
      if (type === 'Horario') {
        panel.append(node('h2', 'Horario de hoy'))
        if (!data.calendarAt) panel.append(node('p', 'El calendario todavía no se ha descargado.'))
        else {
          panel.append(node('p', `Agenda actualizada el ${new Date(data.calendarAt).toLocaleString('es-PE')}`))
          const list = eventsOn(data.events || [], todayLima())
          if (!list.length) panel.append(node('p', 'Sin eventos hoy.'))
          list.forEach(e => panel.append(node('p', `${e.start_time?.slice(0, 5) || 'Todo el día'} · ${e.title}${e.location ? ` · ${e.location}` : ''}`)))
          const details = node('details', ''); details.append(node('summary', 'Todos mis horarios'))
          ;(data.events || []).forEach(e => details.append(node('p', `${e.date || e.start_date} · ${e.start_time || ''} · ${e.title}${e.repeat_rule === 'weekly' ? ' · semanal' : ''}`)))
          panel.append(details)
        }
      } else if (type === 'Tareas') {
        panel.append(node('h2', 'Mis tareas'))
        if (!data.calendarAt) panel.append(node('p', 'Las tareas todavía no se han descargado.'))
        else if (!data.tasks?.length) panel.append(node('p', 'Sin tareas guardadas.'))
        ;(data.tasks || []).slice().sort((a,b) => String(a.due_date).localeCompare(String(b.due_date))).forEach(t => panel.append(node('p', `${t.completed ? 'Completada' : 'Pendiente'} · ${t.due_date} · ${t.title}`)))
      } else {
        panel.append(node('h2', data.catalog.nombre), node('p', `Plan: ${data.catalog.planName || 'Sin denominación oficial registrada'} · ${data.catalog.version}`))
        const done = new Set(data.done || [])
        const list = node('ul', '')
        data.catalog.cursos.forEach(c => list.append(node('li', `${done.has(c.id) ? 'Aprobado' : 'Pendiente'} · ${c.n} · ${c.cr} créditos${c.r?.length ? ` · Requiere: ${c.r.map(id => data.catalog.cursos.find(x => x.id === id)?.n || id).join(', ')}` : ''}`)))
        panel.append(list)
      }
    }
    ;['Horario', 'Tareas', 'Malla'].forEach(type => { const b = node('button', type); b.dataset.type = type; b.onclick = () => show(type); tabs.append(b) })
    root.append(tabs, panel); show('Horario')
  }
} catch { root.append(node('h1', 'No se pudo leer la copia'), node('p', 'Vuelve a abrir Lyra con conexión para actualizarla.')) }
window.addEventListener('storage',e=>{if(e.key==='lyra-offline-owner'){root.replaceChildren(node('h1','La cuenta cambió'),node('p','Vuelve a abrir la consulta desde Lyra.'))}});
const link = node('a', 'Volver a Lyra'); link.href = './pagina.html'; root.append(link)

}
void boot()
