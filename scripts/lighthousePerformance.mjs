import lighthouse from 'lighthouse'
import * as chromeLauncher from 'chrome-launcher'
import { mkdir,writeFile } from 'node:fs/promises'
const base=process.env.PERF_BASE_URL||'http://127.0.0.1:5184',out=process.env.LH_OUTPUT||'/tmp/ia-performance/lighthouse-after',runs=Number(process.env.PERF_RUNS||5)
await mkdir(out,{recursive:true});const rows=[]
const chrome=await chromeLauncher.launch({chromePath:process.env.REVIEW_BROWSER||'/usr/bin/chromium',chromeFlags:['--headless','--no-sandbox','--disable-dev-shm-usage']})
try{
 for(const route of ['login.html','pagina.html'])for(let i=0;i<runs;i++){
  const result=await lighthouse(base+'/'+route,{port:chrome.port,logLevel:'error',onlyCategories:['performance'],formFactor:'mobile',throttlingMethod:'devtools',throttling:{rttMs:150,throughputKbps:1600,requestLatencyMs:150,downloadThroughputKbps:1600,uploadThroughputKbps:750,cpuSlowdownMultiplier:4},screenEmulation:{mobile:true,width:390,height:844,deviceScaleFactor:1,disabled:false}})
  const a=result.lhr.audits;rows.push({route,run:i,lcp:a['largest-contentful-paint'].numericValue,cls:a['cumulative-layout-shift'].numericValue,tbt:a['total-blocking-time'].numericValue,errors:result.lhr.runtimeError||null});await writeFile(out+'/results.json',JSON.stringify(rows,null,2));console.log(rows.at(-1))
 }
}finally{await chrome.kill()}
