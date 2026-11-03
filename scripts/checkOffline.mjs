import { preview } from 'vite'
import { spawn } from 'node:child_process'
const server=await preview({preview:{host:'127.0.0.1',port:5183,strictPort:true}})
try{
 const child=spawn(process.execPath,['tests/offline.browser.mjs'],{stdio:'inherit',env:{...process.env,SETUP_BASE_URL:'http://127.0.0.1:5183'}})
 process.exitCode=await new Promise((resolve,reject)=>{child.on('exit',code=>resolve(code??1));child.on('error',reject)})
}finally{await new Promise(resolve=>server.httpServer.close(resolve))}
