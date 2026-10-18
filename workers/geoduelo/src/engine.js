import capitals from './capitals.json' with { type: 'json' }
export const ROUNDS = 10
export const QUESTION_MS = 25000
export const REVEAL_MS = 3500
export function shuffle(items) {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    // Rejection sampling keeps the shuffle unbiased.
    const ceiling = Math.floor(4294967296 / (i + 1)) * (i + 1)
    let n
    do { n = crypto.getRandomValues(new Uint32Array(1))[0] } while (n >= ceiling)
    const j = n % (i + 1); [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
export function questions() {
  return shuffle(capitals).slice(0, ROUNDS).map(c => {
    const options = shuffle([c.capital, ...shuffle(capitals.filter(d => d.capital !== c.capital)).slice(0, 3).map(d => d.capital)])
    return { country: c.country, options, correct: options.indexOf(c.capital) }
  })
}
export function answer(state, seat, message, now) {
  if (state.phase !== 'question' || now >= state.deadline || message.round !== state.round || state.answers[seat] !== null
    || !Number.isInteger(message.choice) || message.choice < 0 || message.choice > 3) return false
  const correct = message.choice === state.questions[state.round].correct
  const points = correct ? 100 + Math.floor(50 * Math.max(0, Math.min(QUESTION_MS, state.deadline - now)) / QUESTION_MS) : 0
  state.answers[seat] = { choice: message.choice, points }
  state.scores[seat] += points
  return true
}
export function view(state, seat, now = Date.now()) {
  const q = state.questions?.[state.round]
  return { room: state.id, code: state.code, phase: state.phase, seat, players: state.players.map(p => ({ name: p.name, ready: !!p.ready })),
    scores: state.scores, round: state.round, rounds: ROUNDS, deadline: state.deadline, serverTime: now,
    answered: state.answers.map(a => a !== null), ownChoice: state.answers[seat]?.choice ?? null,
    question: q && { country: q.country, options: q.options },
    ...(state.phase === 'reveal' || state.phase === 'finished' ? { correct: q?.correct, answers: state.answers } : {}),
    reason: state.reason, saved: state.saved, winner: state.winner }
}
