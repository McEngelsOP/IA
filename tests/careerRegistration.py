"""Registro y secciones por carrera con Supabase simulado; no crea cuentas reales.
Usa el mismo servidor de fixtures y Chromium descritos en accessViewport.py.
"""
from playwright.sync_api import sync_playwright, expect
from pathlib import Path
from urllib.parse import urlparse
import base64, json, os, subprocess, time

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('ACCESS_BASE_URL', 'http://127.0.0.1:5181')
CAREERS = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', "import {CARRERAS} from './src/data/carreras.js';console.log(JSON.stringify(CARRERAS))"], cwd=ROOT))
PROJECT=os.environ.get('ACCESS_FIXTURE_PROJECT','access-fixture')
errors = []
encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=').decode()

def fixture(browser, key, legacy=False):
    career = CAREERS[key]
    code = '20101823' if key == 'pucp-mecatronica' else '25101823'
    user = {'id':'11111111-1111-4111-8111-111111111111', 'email':'test@example.invalid', 'identities':[{'id':'fixture'}], 'app_metadata':{'provider':'email'}, 'user_metadata':{'student_code':code, 'carrera':key}}
    token = encode({'alg':'HS256','typ':'JWT'}) + '.' + encode({'sub':user['id'],'exp':int(time.time())+3600,'aud':'authenticated'}) + '.fixture'
    session = {'access_token':token,'refresh_token':'fixture-refresh','expires_in':3600,'expires_at':int(time.time())+3600,'token_type':'bearer','user':user}
    flags = {'signup':False,'profile':None if legacy else key,'saved':False}
    context = browser.new_context(viewport={'width':1536,'height':730}, reduced_motion='reduce')
    def route(r):
        request = r.request; path = urlparse(request.url).path
        body = request.post_data_json if request.post_data else {}
        if request.method == 'OPTIONS':
            r.fulfill(status=200,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}); return
        if path == '/functions/v1/auth-by-code':
            assert body['action'] == 'exists'
            data = {'ok':True,'exists':False}
        elif path == '/auth/v1/signup':
            assert body['data']['carrera'] == key
            assert body['data']['student_code'] == code
            flags['signup'] = True; data = session
        elif path == '/auth/v1/user': data = user
        elif path == '/auth/v1/token': data = session
        elif path == '/rest/v1/profiles':
            if request.method == 'PATCH':
                assert legacy and flags['profile'] is None and body == {'carrera':key}
                assert 'carrera=is.null' in request.url
                flags['profile'] = key; flags['saved'] = True
            data = [{'carrera':flags['profile'],'created_at':'2026-10-01T00:00:00Z'}]
        elif path == '/rest/v1/student_setup': data = [{'draft':{},'preferences':{},'completed_at':'2026-10-01T00:00:00Z'}]
        elif path == '/rest/v1/course_status':
            data = [{'course_id':c['id'],'status':'matriculado','times_taken':1,'passed_at':None} for c in career['cursos'] if c['cr'] > 0][:3]
        elif path in ['/rest/v1/progress','/rest/v1/grades','/rest/v1/logros','/rest/v1/calendar_events','/rest/v1/calendar_tasks','/rest/v1/game_scores']: data = []
        elif path == '/rest/v1/rpc/focus_active_session': data = None
        elif path == '/rest/v1/rpc/focus_daily_summary': data = {'seconds':0,'completed_count':0,'interrupted_count':0,'sessions':[]}
        elif path == '/rest/v1/rpc/list_study_rooms':
            assert set(body['course_ids']) == {c['id'] for c in career['cursos']}
            data = []
        else: raise AssertionError((request.method,path,body))
        r.fulfill(status=200,json=data,headers={'access-control-allow-origin':'*'})
    context.route('https://'+PROJECT+'.supabase.co/**',route)
    if legacy: context.add_init_script("localStorage.setItem('sb-"+PROJECT+"-auth-token:web-activity:v1:'+"+json.dumps(user['id'])+",JSON.stringify({at:Date.now()}));")
    if legacy: context.add_init_script("localStorage.setItem('sb-"+PROJECT+"-auth-token',"+json.dumps(json.dumps(session))+');')
    page = context.new_page()
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('console',lambda message:errors.append(message.type+': '+message.text) if message.type in ['warning','error'] else None)
    return context,page,flags,code

def options(page, selector, courses):
    expect(page.locator(selector)).to_be_visible()
    expected = {course['id'] for course in courses}
    actual = set(page.locator(selector+' option').evaluate_all('options=>options.map(o=>o.value).filter(Boolean)'))
    assert actual == expected,(selector,actual ^ expected)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True,executable_path=os.environ.get('ACCESS_BROWSER','/usr/bin/chromium'),args=['--no-sandbox','--disable-gpu'])
    for key,career in CAREERS.items():
        context,page,flags,code = fixture(browser,key)
        page.goto(BASE+'/login.html')
        expect(page.locator('#studentCode')).to_be_enabled(timeout=15000)
        page.get_by_role('button',name='Crea tu cuenta',exact=True).click()
        options(page,'#registerCareer',[{'id':k} for k in CAREERS])
        page.locator('#registerCareer').select_option(key)
        page.locator('#registerCode').fill(code); page.locator('#registerEmail').fill('test@example.invalid')
        page.locator('#registerPassword').fill('fixturePass12!');page.locator('#registerConfirm').fill('fixturePass12!')
        page.get_by_role('button',name='Crear cuenta y entrar',exact=True).click()
        expect(page).to_have_url(BASE+'/pagina.html',timeout=15000)
        expect(page.locator('.h-head')).to_contain_text(career['nombre'],timeout=15000)
        assert flags['signup'] and page.locator('#complete').count() == 0
        page.locator('#nav [data-n="Malla Curricular"]').click()
        expect(page.locator('.oc-name')).to_have_count(len(career['cursos']),timeout=15000)
        assert set(page.locator('[data-course]').evaluate_all('nodes=>nodes.map(n=>n.dataset.course)')) == {c['id'] for c in career['cursos']}
        page.locator('#nav [data-n="Calendario/Horarios"]').click()
        page.get_by_role('button',name='Crear evento',exact=True).click()
        options(page,'select[aria-label="Curso (opcional)"]',career['cursos'])
        page.get_by_role('button',name='Cancelar',exact=True).click()
        page.locator('#nav [data-n="Grupos de estudio"]').click()
        options(page,'select[aria-label="Filtrar salas por curso"]',career['cursos'])
        expect(page.get_by_text('Todavía no hay salas de estudio',exact=True)).to_be_visible()
        page.locator('#nav [data-n="Mod Focus"]').click()
        enrolled = [c for c in career['cursos'] if c['cr'] > 0][:3]
        options(page,'#kcs',enrolled)
        page.locator('#nav [data-n="Herramientas"]').click()
        page.locator('#nav [data-k="Brújula IA"]').click()
        expect(page.get_by_role('navigation',name='Vistas de Brújula')).to_be_visible()
        context.close(); print('PASS',key,'registro → Inicio; malla, calendario, grupos, Focus y Brújula',flush=True)
    context,page,flags,_ = fixture(browser,'software',legacy=True)
    page.goto(BASE+'/pagina.html')
    options(page,'#h-career',[{'id':key} for key in CAREERS])
    page.locator('#h-career').select_option('software')
    page.get_by_role('button',name='Guardar carrera',exact=True).click()
    expect(page.locator('.h-head')).to_contain_text(CAREERS['software']['nombre'])
    assert flags['saved'];context.close();browser.close()
assert not errors,errors
print('PASS perfil anterior sin carrera y cero errores/warnings de consola')
