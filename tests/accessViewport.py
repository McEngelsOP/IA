"""Acceso: matriz de viewport y navegación con Supabase simulado.
Servidor Vite con URL https://access-fixture.supabase.co y clave ficticia;
ACCESS_BASE_URL, ACCESS_REVIEW_DIR y ACCESS_BROWSER permiten ajustar el entorno.
Ninguna llamada de autenticación llega a una base real.
"""
from playwright.sync_api import sync_playwright, expect
import json, base64, time, os
from pathlib import Path
BASE=os.environ.get('ACCESS_BASE_URL','http://127.0.0.1:5181')
USER={'id':'11111111-1111-4111-8111-111111111111','email':'test@example.invalid','identities':[{'id':'fixture'}],'app_metadata':{'provider':'email'},'user_metadata':{'student_code':'25101823','carrera':'ia'}}
enc=lambda x:base64.urlsafe_b64encode(json.dumps(x).encode()).rstrip(b'=').decode()
TOKEN=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':USER['id'],'exp':int(time.time())+3600,'aud':'authenticated'})+'.fixture'
SESSION={'access_token':TOKEN,'refresh_token':'fixture-refresh','expires_in':3600,'expires_at':int(time.time())+3600,'token_type':'bearer','user':USER}
OUT=Path(os.environ.get('ACCESS_REVIEW_DIR','/tmp/ia-access-review'))
OUT.mkdir(parents=True,exist_ok=True)
PROJECT=os.environ.get('ACCESS_FIXTURE_PROJECT','access-fixture')
errors=[]

def context(browser,recovery=False,mobile=False,size=(1440,1000),motion="reduce"):
    ctx=browser.new_context(viewport={'width':size[0],'height':size[1]}, reduced_motion=motion,has_touch=True)
    flags={'exists':False,'unknown':False,'fail':False,'signup_session':False,'fail_update':False,'unconfirmed':False,'calls':[]}
    def route(r):
        request=r.request; url=request.url; body=request.post_data_json if request.post_data else {}
        if request.method=='OPTIONS': r.fulfill(status=200,headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'}); return
        flags['calls'].append((request.method,url,body))
        if flags['fail']: flags['fail']=False;r.abort('failed');return
        if '/functions/v1/auth-by-code' in url:
            action=body['action']
            if action=='exists': data={'ok':True,'exists':flags['exists']}
            elif action=='recover': data={'ok':False,'error':'fixture-unavailable'} if flags.get('recover_reject') else {'ok':False,'error':'code_not_found'} if flags['unknown'] else {'ok':True,'masked':'te•••@example.invalid'}
            elif action=='resend': data={'ok':True,'masked':'te•••@example.invalid'}
            elif action=='login': data={'ok':False,'error':'email_not_confirmed'} if flags['unconfirmed'] else {'ok':True,'session':{'access_token':TOKEN,'refresh_token':'fixture-refresh'}}
            else: raise AssertionError(action)
        elif '/auth/v1/signup' in url:
            assert body['data']['carrera']=='ia';assert body['data']['student_code']=='25101823';assert body['email']=='test@example.invalid'
            assert 'login.html' in url or body.get('email_redirect_to') or 'redirect_to' in url
            data=SESSION if flags['signup_session'] else {'user':USER,'session':None}
        elif '/auth/v1/user' in url:
            if request.method=='PUT' and flags['fail_update']:
                flags['fail_update']=False;r.fulfill(status=500,json={'message':'fixture update failure'});return
            data=USER
        elif '/auth/v1/logout' in url: data={}
        elif '/auth/v1/token' in url: data=SESSION
        else: raise AssertionError(url)
        r.fulfill(status=200,json=data,headers={'access-control-allow-origin':'*'})
    ctx.route('https://'+PROJECT+'.supabase.co/**',route)
    if recovery:ctx.add_init_script("localStorage.setItem('sb-"+PROJECT+"-auth-token',"+json.dumps(json.dumps(SESSION))+');')
    page=ctx.new_page();page.on('pageerror',lambda err:errors.append(str(err)));page.on('console',lambda msg:errors.append(msg.type+': '+msg.text) if msg.type in ['warning','error'] else None)
    # The destination is tested by URL and intercepted to avoid unrelated database reads.
    page.route('**/pagina.html',lambda r:r.fulfill(status=200,content_type='text/html',body='<h1>Inicio</h1>'))
    page.goto(BASE+'/login.html'+('?type=recovery' if recovery else ''))
    expect(page.locator('#newPassword' if recovery else '#studentCode')).to_be_visible(timeout=15000)
    expect(page.locator('#newPassword' if recovery else '#studentCode')).to_be_enabled(timeout=15000)
    return ctx,page,flags

def register(page):
    page.get_by_role('button',name='Crea tu cuenta',exact=True).click()
    expect(page.locator('#registerScreen')).to_be_visible()

def fill_register(page):
    page.locator('#registerCode').fill('25101823');page.locator('#registerCareer').select_option('ia')
    page.locator('#registerEmail').fill('test@example.invalid');page.locator('#registerPassword').fill('fixturePass12!');page.locator('#registerConfirm').fill('fixturePass12!')


SIZES=[(1920,947),(1536,730),(1366,657),(1280,620),(1024,600),(768,1024),(390,844),(360,640)]
results=[]
CHECK_JS='''() => {
 const screen=document.querySelector('.stage > :not([hidden])');
 const inView=e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,id:e.id,top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
 const elements=[document.querySelector('.brand'),screen.querySelector('h1,h2'),...screen.querySelectorAll('label,input,select,.primary,.secondary,.back-link,.message:not([hidden]),.inline-error:not([hidden])'),document.querySelector('.panel-foot')].filter(Boolean);
 const bad=elements.map(inView).filter(r=>r.top<-.1||r.bottom>innerHeight+.1||r.left<-.1||r.right>innerWidth+.1);
 const stage=document.querySelector('.stage');
 return {shell:inView(document.querySelector('.panel')),height:innerHeight,width:innerWidth,scrollH:document.documentElement.scrollHeight,scrollW:document.documentElement.scrollWidth,y:scrollY,x:scrollX,density:document.body.dataset.fit,headingSize:parseFloat(getComputedStyle(screen.querySelector('h1,h2')).fontSize),logoSize:document.querySelector('.compass').getBoundingClientRect().height,panelHeight:document.querySelector('.panel').getBoundingClientRect().height,stageH:stage.clientHeight,stageScrollH:stage.scrollHeight,stageTop:stage.scrollTop,bad};
}'''

def inspect(page,label):
    page.wait_for_timeout(100)
    before=page.evaluate(CHECK_JS)
    if label=='register' and list(page.viewport_size.values())==[1536,730]:
        assert before['headingSize']>=34 and before['logoSize']>=48, before
    if label=='register' and list(page.viewport_size.values())==[1366,657]:
        assert before['headingSize']>=32, before
    # Actual wheel / keyboard / focus inputs. Space is sent with no button focus.
    page.mouse.move(page.viewport_size['width']-4, page.viewport_size['height']//2);page.mouse.wheel(100,1000)
    page.locator('.stage > :not([hidden]) h1,.stage > :not([hidden]) h2').focus()
    page.keyboard.press('PageDown');page.keyboard.press('Space')
    for _ in range(16):page.keyboard.press('Tab')
    session=page.context.new_cdp_session(page)
    x=page.viewport_size['width']//2;y=page.viewport_size['height']//2
    session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
    session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':max(20,y-180)}]})
    session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});session.detach()
    page.wait_for_timeout(50);after=page.evaluate(CHECK_JS)
    assert page.evaluate("[...document.querySelectorAll('.stage > :not([hidden]) label')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=14)")
    assert page.evaluate("[...document.querySelectorAll('.stage > :not([hidden]) input,.stage > :not([hidden]) select')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=15 && e.getBoundingClientRect().height>=44)")
    assert page.evaluate("[...document.querySelectorAll('.stage > :not([hidden]) button:not([hidden])')].every(e=>e.getBoundingClientRect().height>=44)")
    shell=before['shell']
    ok=(before['scrollH']<=before['height'] and before['scrollW']<=before['width']
        and shell['top']>=-.1 and shell['bottom']<=before['height']+.1
        and shell['left']>=-.1 and shell['right']<=before['width']+.1
        and after['y']==0 and after['x']==0)
    # Normal viewports must show all content with no internal scrolling, too.
    ok=ok and before['stageScrollH']<=before['stageH']+1 and not before['bad'] and after['stageTop']==0
    results.append({'view':label,'size':list(page.viewport_size.values()),'ok':ok,'before':before,'after':after})
    if not ok:print('FAIL',label,page.viewport_size,before,after,flush=True)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('ACCESS_BROWSER','/usr/bin/chromium'),args=['--no-sandbox','--disable-gpu'])
    for size in SIZES:
        ctx,page,flags=context(browser,size=size)
        inspect(page,'login')
        page.locator('#studentCode').fill('123');page.locator('#submit').click();expect(page.locator('#formMessage')).to_be_visible();inspect(page,'login-error')
        register(page);inspect(page,'register')
        if size in [(1920,947),(1536,730),(1366,657),(360,640),(390,844)]:page.screenshot(path=str(OUT/f'crear-cuenta-{size[0]}x{size[1]}.png'))
        fill_register(page);flags['exists']=True
        page.get_by_role('button',name='Crear cuenta y entrar',exact=True).click();expect(page.locator('#formMessage')).to_contain_text('ya tiene una cuenta');inspect(page,'register-error')
        page.locator('#registerScreen [data-view]').click();page.locator('#forgot').click();inspect(page,'forgot')
        page.get_by_role('button',name='Enviarme el enlace',exact=True).click();expect(page.locator('#formMessage')).to_be_visible();inspect(page,'forgot-error')
        page.locator('#recoveryCode').fill('25101823');page.get_by_role('button',name='Enviarme el enlace',exact=True).click();expect(page.locator('#mailScreen')).to_be_visible();inspect(page,'mail')
        page.clock.install();page.clock.run_for(46000);flags['recover_reject']=True
        page.locator('#resendLink').click();expect(page.locator('#formMessage')).to_contain_text('No pudimos reenviar');inspect(page,'mail-error');ctx.close()
        ctx,page,flags=context(browser,recovery=True,size=size);inspect(page,'reset')
        page.locator('#newPassword').fill('fixturePass12!');page.locator('#newConfirm').fill('other-password')
        page.get_by_role('button',name='Guardar y entrar',exact=True).click();expect(page.locator('#formMessage')).to_be_visible();inspect(page,'reset-error');ctx.close()
        print('FINISHED',size,flush=True)
    browser.close()
OUT.joinpath('matrix.json').write_text(json.dumps({'results':results,'console':errors},indent=2,ensure_ascii=False))
print('MATRIX',sum(r['ok'] for r in results),'/',len(results),'CONSOLE',errors,flush=True)
assert all(r['ok'] for r in results)
assert not errors


with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('ACCESS_BROWSER','/usr/bin/chromium'),args=['--no-sandbox','--disable-gpu'])
    for action in ['login','signup-session','reset']:
        ctx,page,flags=context(browser,recovery=action=='reset',size=(1536,730))
        page.evaluate("window.__completeSeen = false; new MutationObserver(() => {const complete=!!document.querySelector('#complete');const status=document.querySelector('#accessStatus');const button=document.querySelector('.stage > :not([hidden]) [type=submit]');if(complete)sessionStorage.setItem('unexpected-complete','true');if(status?.textContent)sessionStorage.setItem('success-announced',String(!!button?.disabled));}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true})")
        if action=='login':
            page.locator('#studentCode').fill('25101823');page.locator('#password').fill('fixturePass12!');page.locator('#submit').click()
        elif action=='signup-session':
            flags['signup_session']=True;register(page);fill_register(page);page.get_by_role('button',name='Crear cuenta y entrar',exact=True).click()
        else:
            page.locator('#newPassword').fill('fixturePass12!');page.locator('#newConfirm').fill('fixturePass12!');page.get_by_role('button',name='Guardar y entrar',exact=True).click()
        page.wait_for_url('**/pagina.html');assert page.evaluate("sessionStorage.getItem('success-announced')==='true' && !sessionStorage.getItem('unexpected-complete')");ctx.close();print('PASS direct',action,flush=True)
    ctx,page,flags=context(browser,size=(1366,657))
    assert page.locator('#startup, #replay, #skipStartup').count()==0
    shell=page.locator('.panel').bounding_box()
    page.locator('#forgot').click();expect(page.locator('#forgotScreen')).to_be_visible()
    assert page.locator('.panel').bounding_box()==shell
    page.locator('#forgotScreen [data-view]').click();expect(page.locator('#loginScreen')).to_be_visible()
    page.locator('#studentCode').fill('25101823');page.locator('#password').fill('fixturePass12!');flags['unconfirmed']=True
    page.locator('#submit').click();expect(page.locator('#formMessage')).to_contain_text('Confirma tu correo')
    page.locator('#resendConfirmation').click();expect(page.locator('#mailScreen')).to_be_visible();ctx.close();print('PASS stable shell and confirmation before real session',flush=True)
    # Real extreme height: only stage scrolls, root remains at zero.
    ctx,page,flags=context(browser,size=(390,480));register(page)
    assert page.evaluate('document.documentElement.scrollHeight===innerHeight && document.body.dataset.extreme==="true"')
    assert page.locator('.stage').evaluate('e=>getComputedStyle(e).overflowY')=='auto'
    page.locator('.stage').hover();page.mouse.wheel(0,800);page.wait_for_timeout(100);assert page.evaluate('scrollY')==0
    assert page.locator('.stage').evaluate('e=>e.scrollTop')>0;ctx.close();print('PASS extreme viewport uses stage only',flush=True)
    # Simulate keyboard visual viewport geometry and resize (not a physical device).
    ctx,page,flags=context(browser,size=(390,844));register(page)
    page.evaluate('Object.defineProperty(window,"visualViewport",{configurable:true,value:{height:390,offsetTop:0}});window.dispatchEvent(new Event("resize"))')
    page.wait_for_timeout(100)
    assert page.evaluate('document.body.dataset.extreme==="true" && scrollY===0')
    assert page.locator('.entry').bounding_box()['height']==390;ctx.close();print('PASS simulated mobile keyboard geometry',flush=True)
    ctx,page,flags=context(browser,size=(1536,730),motion='no-preference')
    register(page);page.wait_for_timeout(1000);geometry=page.evaluate(CHECK_JS)
    assert geometry['scrollH']==730 and geometry['y']==0 and not geometry['bad']
    ctx.close();print('PASS ordinary entrance and exit animations retained',flush=True)
    assert not errors,errors
    browser.close();print('PASS no browser warnings or errors',flush=True)

