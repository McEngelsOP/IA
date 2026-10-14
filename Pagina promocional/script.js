(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  // Set data-app-url on body if this folder is hosted on a separate domain.
  const appUrl = document.body.dataset.appUrl ||
    (location.protocol === 'file:' ? 'https://lesan-pink.vercel.app/login.html' : '/login.html');
  $$('[data-app-link]').forEach((link) => { link.href = appUrl; });
  const menuButton = $('.menu-toggle'), navigation = $('#navigation');
  function closeMenu() {
    menuButton.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('is-open');
  }
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    navigation.classList.toggle('is-open', open);
  });
  navigation.addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      closeMenu(); menuButton.focus();
    }
  });
  const tabs = $$('[role="tab"]');
  function activateTab(tab, moveFocus = false) {
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    });
    if (moveFocus) tab.focus();
    if (tab.id !== 'tab-focus' && running) pauseFocus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault(); activateTab(tabs[next], true);
    });
  });
  function updatePlan() {
    const selected = $$('input[name="course"]:checked');
    const credits = selected.reduce((sum, course) => sum + Number(course.dataset.credits), 0);
    $('#credit-total').textContent = String(credits);
    $('#plan-feedback').textContent = selected.length
      ? selected.length + (selected.length === 1 ? ' curso' : ' cursos') + ' en tu plan de ejemplo.'
      : 'Selecciona un curso para empezar.';
  }
  $$('input[name="course"]').forEach((input) => input.addEventListener('change', updatePlan));
  updatePlan();
  const answers = {
    carga: { question: '¿Cómo reviso mi carga?', parts: [
      ['Recomendación', 'Revisa los créditos de tu plan junto con el tiempo que podrás dedicar al estudio.'],
      ['Motivos', 'Los créditos y la dificultad reportada aportan contexto; también cuentan tus horarios y responsabilidades.'],
      ['Siguiente paso', 'Ajusta tu selección en la malla y consulta al asesor con tu plan actualizado.']
    ] },
    ruta: { question: '¿Cómo planifico los próximos ciclos?', parts: [
      ['Recomendación', 'Parte de tus cursos llevados y de los que estás cursando. Explora las rutas de Brújula antes de elegir.'],
      ['Motivos', 'La proyección compara ritmos de carga y respeta las relaciones de prerrequisitos registradas en la malla.'],
      ['Siguiente paso', 'Revisa una ruta ligera, equilibrada o intensiva y valida su primer ciclo antes de añadirlo a tu plan.']
    ] }
  };
  $$('[data-question]').forEach((button) => button.addEventListener('click', () => {
    $$('[data-question]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    const answer = answers[button.dataset.question]; $('#advisor-question').textContent = answer.question;
    const fragment = document.createDocumentFragment();
    answer.parts.forEach(([title, content]) => {
      const heading = document.createElement('h4'); heading.textContent = title;
      const paragraph = document.createElement('p'); paragraph.textContent = content;
      fragment.append(heading, paragraph);
    });
    $('#advisor-answer').replaceChildren(fragment);
  }));
  const duration = 25 * 60;
  let remaining = duration, running = false, deadline = 0, interval = null;
  function renderClock() {
    const minutes = Math.floor(remaining / 60), seconds = remaining % 60;
    $('#focus-clock').textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    $('#focus-clock').setAttribute('aria-label', minutes + ' minutos y ' + seconds + ' segundos restantes');
  }
  function pauseFocus() {
    if (running) remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    running = false; clearInterval(interval); interval = null;
    $('#focus-toggle').textContent = remaining === duration ? 'Iniciar sesión' : 'Continuar sesión';
    $('#focus-status').textContent = 'Sesión en pausa. Retómala cuando estés listo.';
    $('#focus-course').disabled = false; renderClock();
  }
  function tick() {
    remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); renderClock();
    if (remaining === 0) {
      running = false; clearInterval(interval); interval = null;
      $('#focus-toggle').textContent = 'Nueva sesión';
      $('#focus-status').textContent = 'Bloque terminado. Toma un descanso antes de continuar.';
      $('#focus-course').disabled = false;
    }
  }
  $('#focus-toggle').addEventListener('click', () => {
    if (running) { pauseFocus(); return; }
    if (remaining === 0) remaining = duration;
    deadline = Date.now() + remaining * 1000; running = true;
    $('#focus-toggle').textContent = 'Pausar sesión';
    $('#focus-status').textContent = 'Ahora: ' + $('#focus-course').value + '. Un paso a la vez.';
    $('#focus-course').disabled = true; interval = setInterval(tick, 250); tick();
  });
  $('#focus-reset').addEventListener('click', () => {
    running = false; clearInterval(interval); interval = null; remaining = duration;
    $('#focus-toggle').textContent = 'Iniciar sesión';
    $('#focus-status').textContent = 'Un bloque. Un curso. Un poco más de avance.';
    $('#focus-course').disabled = false; renderClock();
  });
  window.addEventListener('pagehide', () => { clearInterval(interval); interval = null; });
  window.addEventListener('pageshow', () => { if (running && interval === null) { interval = setInterval(tick, 250); tick(); } });
  $('#task-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = $('#task-input').value.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
    const tasks = [...new Set(raw)].slice(0, 12), list = $('#task-results');
    list.replaceChildren();
    if (!tasks.length) {
      $('#task-status').textContent = 'Escribe al menos un pendiente para organizarlo.';
      $('#task-input').focus(); return;
    }
    const fragment = document.createDocumentFragment();
    tasks.forEach((task) => {
      const li = document.createElement('li'), label = document.createElement('label');
      const input = document.createElement('input'); input.type = 'checkbox';
      const span = document.createElement('span'); span.textContent = task;
      label.append(input, span); li.append(label); fragment.append(li);
    });
    list.append(fragment);
    $('#task-status').textContent = tasks.length + (tasks.length === 1 ? ' pendiente organizado' : ' pendientes organizados') +
      (raw.length > 12 ? ' (se muestran hasta 12)' : '') + '. Puedes marcarlos al completar.';
  });
})();
