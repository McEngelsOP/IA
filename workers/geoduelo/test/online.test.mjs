import { test } from 'node:test'
import assert from 'node:assert/strict'
import { questions, answer, view, QUESTION_MS } from '../src/engine.js'
import { runtime, ids, capitals } from './runtime.mjs'
const origin = 'http://127.0.0.1:5173'

test('authority: no solution leaks, no replay, no late or forged scores', () => {
  const state = { id: crypto.randomUUID(), phase: 'question', players: [{name:'A'},{name:'B'}], questions: questions(), round: 0, answers: [null,null], scores: [0,0], deadline: 10000 + QUESTION_MS }
  assert.equal(state.questions.length, 10)
  assert.equal(new Set(state.questions.map(q => q.country)).size, 10)
  for (const q of state.questions) assert.equal(new Set(q.options).size, 4)
  const publicState = view(state, 0, 10000)
  assert.equal(publicState.correct, undefined); assert.equal(publicState.questions, undefined)
  assert.equal(answer(state,0,{round:1,choice:0},10000),false)
  assert.equal(answer(state,0,{round:0,choice:state.questions[0].correct, score:1000000},10000),true)
  assert.equal(state.scores[0],150)
  assert.equal(answer(state,0,{round:0,choice:0},10001),false)
  assert.equal(answer(state,1,{round:0,choice:0},state.deadline),false)
  assert.equal(view(state,1).ownChoice,null)
})

test('real Worker + Durable Objects: public matchmaking, private rooms, identity, reconnect, complete and persist', { timeout: 100000 }, async () => {
  const r = await runtime()
  try {
    const denied = await r.mf.dispatchFetch('https://game.test/session', { method:'POST', headers:{origin:'https://evil.test'}, body:'{}' }); assert.equal(denied.status,403)
    const invalid = await r.mf.dispatchFetch('https://game.test/session', { method:'POST',headers:{origin,authorization:'Bearer fake'},body:'{"action":"search"}' }); assert.equal(invalid.status,401)
    const a = await r.session(0,'search'); assert.equal(a.status,200)
    assert.equal((await r.session(0,'search')).room,a.room)
    const sa = await r.socket(a); assert.equal((await sa.wait(s=>s.phase==='waiting')).code,null)
    const b = await r.session(1,'search'); assert.equal(a.room,b.room)
    const sb = await r.socket(b); await sa.wait(s=>s.phase==='ready'); await sb.wait(s=>s.phase==='ready')
    const forbidden = await r.mf.dispatchFetch(`https://game.test/ws/${a.room}?ticket=${a.ticket}tampered`,{headers:{origin,Upgrade:'websocket'}});assert.equal(forbidden.status,401)
    assert.equal((await r.session(2,'resume',{room:a.room})).status,404)
    sa.send({action:'ready'}); sb.send({action:'ready'})
    for(let round=0;round<10;round++) {
      const state = await sa.wait(s=>s.phase==='question'&&s.round===round)
      await sb.wait(s=>s.phase==='question'&&s.round===round)
      assert.equal(state.correct,undefined);assert.equal(state.answers,undefined)
      const capital = capitals.find(c=>c.country===state.question.country).capital
      const choice = state.question.options.indexOf(capital)
      sa.send({action:'answer',round,choice}); sa.send({action:'answer',round,choice,score:999999})
      sb.send({action:'answer',round,choice:(choice+1)%4})
      const reveal = await sa.wait(s=>s.phase==='reveal'&&s.round===round)
      assert.equal(reveal.correct,choice);assert.equal(reveal.scores[1],0)
      if (round===1) {
        const resumed = await r.session(1,'resume',{room:b.room}); assert.equal(resumed.room,b.room)
        const replacement = await r.socket(resumed); sb.ws = replacement.ws; sb.send = replacement.send; sb.wait = replacement.wait
        assert.equal((await replacement.wait(s=>s.round===round)).seat,1)
      }
    }
    const end = await sa.wait(s=>s.phase==='finished'&&s.saved==='saved')
    assert.equal(end.winner,0);assert.equal(r.results.length,1);assert.ok(r.results[0].score_one<=1500);assert.equal(r.results[0].score_two,0)
    assert.equal(r.results[0].player_one,ids[0])
    const p = await r.session(2,'create'), sp = await r.socket(p)
    const waiting = await sp.wait(s=>s.phase==='waiting'); assert.match(waiting.code,/^[A-F0-9]{8}$/)
    const publicRoom = await r.session(3,'search');assert.notEqual(publicRoom.room,p.room)
    assert.equal((await r.session(4,'join',{code:'XXXXXXXX'})).status,400)
    const friend = await r.session(4,'join',{code:waiting.code});assert.equal(friend.room,p.room)
    assert.equal((await r.session(5,'join',{code:waiting.code})).status,404)
    assert.equal((await r.session(3,'leave')).status,200)
    const sf = await r.socket(friend)
    await sp.wait(s=>s.phase==='ready'); await sf.wait(s=>s.phase==='ready')
    sp.send({action:'ready'}); sf.send({action:'ready'})
    await sf.wait(s=>s.phase==='question')
    r.writes.fail = true
    assert.equal((await r.session(2,'leave')).status,200)
    const retrying = await sf.wait(s=>s.phase==='finished'&&s.saved==='retrying')
    assert.equal(retrying.reason,'abandoned'); assert.equal(retrying.winner,1)
    r.writes.fail = false
    await sf.wait(s=>s.phase==='finished'&&s.saved==='saved')
    assert.equal(r.results.length,2)
    assert.equal((await r.session(4,'resume',{room:p.room})).status,404)
    console.log('PASS: 10 rounds, authoritative scores, reconnect, saved result, public/private isolation')
  } finally { await r.mf.dispose() }
})
