"""Reproducible cold/warm production measurements with isolated synthetic auth."""
from playwright.sync_api import sync_playwright
import os,json,time,base64,statistics
from pathlib import Path
BASE=os.environ.get('PERF_BASE_URL','http://127.0.0.1:5183'); OUT=Path(os.environ.get('PERF_OUTPUT','/tmp/ia-performance/baseline.json')); RUNS=int(os.environ.get('PERF_RUNS','5')); DEVICE=os.environ.get('PERF_DEVICE','mobile')
USER={'id':'11111111-1111-4111-8111-111111111111','email':'fixture@example.invalid','aud':'authenticated','role':'authenticated','app_metadata':{'provider':'email'},'user_metadata':{'carrera':'ia'},'created_at':'2026-01-01T00:00:00Z'}
enc=lambda x:base64.urlsafe_b64encode(json.dumps(x).encode()).rstrip(b'=').decode()
token=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':USER['id'],'exp':int(time.time())+3600,'role':'authenticated'})+'.fixture'
SESSION={'access_token':token,'refresh_token':'fixture','expires_at':int(time.time())+3600,'expires_in':3600,'token_type':'bearer','user':USER}
def fixture_data(url):
 path=url.split('?')[0]
 if path.endswith('/user'): return USER
 if path.endswith('/profiles'):return {'carrera':'ia','created_at':USER['created_at']}
 if path.endswith('/progress'):return {'done':[],'plan':[]}
 if path.endswith('/student_setup'):return {'draft':{},'preferences':{},'completed_at':USER['created_at']}
 return []
OBSERVER="""window.perf={lcp:0,cls:0,long:[],shifts:[]};for(const type of ['largest-contentful-paint','layout-shift','longtask'])new PerformanceObserver(list=>{for(const e of list.getEntries()){if(type==='largest-contentful-paint')perf.lcp=e.startTime;if(type==='layout-shift'&&!e.hadRecentInput){perf.cls+=e.value;perf.shifts.push({value:e.value,nodes:e.sources.map(s=>({node:s.node?.outerHTML?.slice(0,140),before:s.previousRect.toJSON(),after:s.currentRect.toJSON()}))})}if(type==='longtask')perf.long.push({start:e.startTime,duration:e.duration})}}).observe({type,buffered:true});"""
rows=[]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for route in ['login.html','pagina.html']:
  for run in range(RUNS):
   ctx=b.new_context(viewport={'width':1536 if DEVICE=='desktop' else 390,'height':730 if DEVICE=='desktop' else 844},device_scale_factor=1,reduced_motion='no-preference' if DEVICE=='desktop' else 'reduce')
   ctx.add_init_script(OBSERVER)
   ctx.add_init_script("localStorage.setItem('sb-setup-fixture-auth-token',"+json.dumps(json.dumps(SESSION))+ ");localStorage.setItem('sb-setup-fixture-auth-token:web-activity:v1:"+USER['id']+"',JSON.stringify({at:Date.now()}));" if route=='pagina.html' else '')
   page=ctx.new_page();cdp=ctx.new_cdp_session(page);cdp.on('Fetch.requestPaused',lambda e:cdp.send('Fetch.fulfillRequest',{'requestId':e['requestId'],'responseCode':200,'responseHeaders':[{'name':'Content-Type','value':'application/json'},{'name':'access-control-allow-origin','value':'*'},{'name':'access-control-allow-headers','value':'*'}],'body':base64.b64encode(json.dumps(fixture_data(e['request']['url'])).encode()).decode()}));cdp.send('Fetch.enable',{'patterns':[{'urlPattern':'https://setup-fixture.supabase.co/*'}]});cdp.send('Network.enable');cdp.send('Network.setCacheDisabled',{'cacheDisabled':False});cdp.send('Network.emulateNetworkConditions',{'offline':False,'latency':20 if DEVICE=='desktop' else 150,'downloadThroughput':2500000 if DEVICE=='desktop' else 200000,'uploadThroughput':1250000 if DEVICE=='desktop' else 93750});cdp.send('Emulation.setCPUThrottlingRate',{'rate':1 if DEVICE=='desktop' else 4})
   for cache in ['cold','warm']:
    # Re-navigate the same URL so init scripts never run on an opaque origin.
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(BASE+'/'+route,wait_until='networkidle');page.wait_for_timeout(400)
    row=page.evaluate("""()=>({...perf,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime||0,resources:performance.getEntriesByType('resource').map(r=>({url:r.name,bytes:r.encodedBodySize,transfer:r.transferSize,type:r.initiatorType})),html:performance.getEntriesByType('navigation')[0].encodedBodySize})""")
    row.update(route=route,run=run,cache=cache,errors=errors);rows.append(row)
   ctx.close()
 b.close()
OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(rows,indent=2))
for route in ['login.html','pagina.html']:
 for cache in ['cold','warm']:
  sample=[r for r in rows if r['route']==route and r['cache']==cache]
  print(route,cache,{'lcp_ms':round(statistics.median(r['lcp'] for r in sample)), 'cls':round(statistics.median(r['cls'] for r in sample),4),'long_task_blocking_ms':round(statistics.median(sum(max(0,t['duration']-50) for t in r['long']) for r in sample)),'critical_bytes':round(statistics.median(r['html']+sum(v['bytes'] for v in r['resources'] if '127.0.0.1' in v['url'] and not v['url'].endswith('.mp4')) for r in sample))})
summary=[]
for route in ['login.html','pagina.html']:
 for cache in ['cold','warm']:
  sample=[r for r in rows if r['route']==route and r['cache']==cache]
  med=lambda f:statistics.median(f(r) for r in sample)
  item={'route':route,'cache':cache,'device':DEVICE,'runs':RUNS,'lcp_ms':med(lambda r:r['lcp']),'cls':med(lambda r:r['cls']),'js_gzip_bytes':med(lambda r:sum(v['bytes'] for v in r['resources'] if '127.0.0.1' in v['url'] and v['url'].endswith('.js'))),'critical_bytes':med(lambda r:r['html']+sum(v['bytes'] for v in r['resources'] if '127.0.0.1' in v['url'] and not v['url'].endswith('.mp4'))),'wire_bytes':med(lambda r:sum(v['transfer'] for v in r['resources'] if '127.0.0.1' in v['url']))}
  summary.append(item)
  if os.environ.get('PERF_ASSERT')=='1':
   assert 0<item['lcp_ms']<=2500,item
   assert item['cls']<=.1,item
   assert item['js_gzip_bytes']<=250000,item
   assert item['critical_bytes']<=500000,item
assert not any(r['errors'] for r in rows),[r['errors'] for r in rows if r['errors']]
OUT.with_name(OUT.stem+'-summary.json').write_text(json.dumps(summary,indent=2))
