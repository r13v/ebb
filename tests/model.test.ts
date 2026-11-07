import { expect, test } from 'claude-code/testing'

import { flagMismatches, parseNotes } from '../hooks/generate'
import { parseDeckFile } from '../hooks/decks'
import { DAY, PASSIVE_SHOWS, addNotes, emptyData, ensureDeck, grade, newLeftToday, nextStudyCard, parseDuration, passiveKey, pickSpinnerCard, upgrade, type Data, type Passive } from '../hooks/model'

const seeded = (): Data => {
  const data = emptyData()
  ensureDeck(data, { id: 'es', name: 'Castellano' })
  addNotes(data, 'es', [
    { front: 'el corazón', back: 'сердце' },
    { front: 'la mano', back: 'рука' },
    { front: 'hablar', back: 'говорить' },
    { front: 'Más vale pájaro en mano que ciento volando', back: 'лучше синица в руках' },
  ], 'test', 0)
  return data
}

test('re-adding the same fronts adds nothing', async () => {
  const data = seeded()
  expect(addNotes(data, 'es', [{ front: 'El corazón ', back: 'сердце' }], 'again', 1)).toBe(0)
  expect(Object.keys(data.notes)).toHaveLength(4)
  expect(Object.keys(data.cards)).toHaveLength(4)
})

test('the spinner skips long fronts and the card shown last turn', async () => {
  const data = seeded()
  const first = pickSpinnerCard(data, {}, 0, undefined, () => 0)!
  expect(first.ask.length).toBeLessThanOrEqual(40)
  for (let i = 0; i < 20; i++) {
    const next = pickSpinnerCard(data, {}, 0, first.card.id, () => i / 20)!
    expect(next.card.id).not.toBe(first.card.id)
    expect(next.ask).not.toMatch(/pájaro/)
  }
})

test('the spinner prefers cards in learning over new ones', async () => {
  const data = seeded()
  const hablar = Object.values(data.cards).find(c => data.notes[c.note]!.front === 'hablar')!
  grade(data, hablar.id, 3, 1000)
  expect(pickSpinnerCard(data, {}, 2000, undefined, () => 0.5)!.ask).toBe('hablar')
})

test('pause hides the spinner card', async () => {
  const data = seeded()
  data.meta.pausedUntil = 10_000
  expect(pickSpinnerCard(data, {}, 5000, undefined, Math.random)).toBeUndefined()
  expect(pickSpinnerCard(data, {}, 20_000, undefined, Math.random)).toBeDefined()
})

test('a study session serves due cards, then new ones up to the daily limit', async () => {
  const data = seeded()
  data.decks.es!.newPerDay = 2
  const now = Date.UTC(2026, 10, 7, 10)
  const a = nextStudyCard(data, now)!
  grade(data, a.id, 4, now)
  const b = nextStudyCard(data, now)!
  grade(data, b.id, 4, now)
  expect(nextStudyCard(data, now)).toBeUndefined()
  expect(nextStudyCard(data, now + 30 * DAY)).toBeDefined()
})

test('a stable recognition card unlocks its production card', async () => {
  const data = seeded()
  const id = Object.keys(data.cards)[0]!
  data.cards[id] = { ...data.cards[id]!, state: 2, stability: 30, difficulty: 3, lastReview: 0, due: 40 * DAY }
  const graded = grade(data, id, 3, 40 * DAY)
  expect(graded.unlocked?.kind).toBe('production')
  expect(data.cards[`${data.cards[id]!.note}:p`]).toBeDefined()
})

test('a deck without production never unlocks it', async () => {
  const data = emptyData()
  ensureDeck(data, { id: 'k8s', name: 'Kubernetes', kinds: ['recognition'] })
  addNotes(data, 'k8s', [{ front: 'What restarts a crashed pod?', back: 'its controller (ReplicaSet)' }], 'test', 0)
  const id = Object.keys(data.cards)[0]!
  data.cards[id] = { ...data.cards[id]!, state: 2, stability: 60, difficulty: 3, lastReview: 0, due: 60 * DAY }
  expect(grade(data, id, 3, 60 * DAY).unlocked).toBeUndefined()
})

test('a deck file parses into a deck and its notes, or says what is wrong', async () => {
  const file = parseDeckFile(JSON.stringify({ id: 'es', name: 'Spanish', learn: 'Spanish', native: 'English', notes: [{ front: 'el agua', back: 'water', hint: 'el, not la' }, { front: '', back: 'x' }] }))
  if ('error' in file) throw new Error(file.error)
  expect(file.deck.kinds).toEqual(['recognition', 'production'])
  expect(file.notes).toEqual([{ front: 'el agua', back: 'water', hint: 'el, not la', tags: [] }])
  const facts = parseDeckFile(JSON.stringify({ id: 'k8s', name: 'Kubernetes', notes: [{ front: 'q', back: 'a' }] }))
  expect('error' in facts ? facts.error : facts.deck.kinds).toEqual(['recognition'])
  expect(parseDeckFile('not json')).toEqual({ error: 'the file is not JSON' })
  expect(parseDeckFile(JSON.stringify({ id: 'Bad Id', name: 'x', notes: [] }))).toMatchObject({ error: expect.stringMatching(/id/) })
})

test('model replies: bad JSON is an error, a wrong back-translation is flagged', async () => {
  expect('error' in parseNotes('sorry, no')).toBe(true)
  const parsed = parseNotes('```json\n{"notes":[{"front":"el mapa","back":"карта"},{"front":"la mano","back":"нога"}]}\n```')
  if ('error' in parsed) throw new Error(parsed.error)
  const flagged = flagMismatches(parsed.notes, '{"fronts":["el mapa","la pierna"]}')
  expect(flagged[0]!.isChecked).toBe(true)
  expect(flagged[1]!.isChecked).toBe(false)
  expect(flagged[1]!.flag).toMatch(/pierna/)
})

test('durations parse', async () => {
  expect(parseDuration('1h')).toBe(3_600_000)
  expect(parseDuration('30m')).toBe(1_800_000)
  expect(parseDuration('soon')).toBeUndefined()
})

test('an import merges a word that two lists share', async () => {
  const data = seeded()
  addNotes(data, 'es', [{ front: 'mejor', back: 'лучший', tags: ['adjective'] }], 'import', 0, true)
  addNotes(data, 'es', [{ front: 'mejor', back: 'лучше', tags: ['adverb'] }], 'import', 0, true)
  addNotes(data, 'es', [{ front: 'mejor', back: 'лучше', tags: ['adverb'] }], 'import', 0, true)
  const mejor = Object.values(data.notes).find(n => n.front === 'mejor')!
  expect(mejor.back).toBe('лучший; лучше')
  expect(mejor.tags).toEqual(['adjective', 'adverb'])
})

test('data from the first build keeps today’s count of new cards', async () => {
  const data = seeded()
  const now = Date.UTC(2026, 10, 7, 10)
  ;(data.meta as Record<string, unknown>).newDay = new Date(now).toDateString()
  ;(data.meta as Record<string, unknown>).newToday = 3
  upgrade(data)
  expect(newLeftToday(data, data.decks.es!, now)).toBe(7)
  expect('newToday' in data.meta).toBe(false)
})

test('the spinner moves on through new cards without any review', async () => {
  const data = emptyData()
  ensureDeck(data, { id: 'es', name: 'Castellano' })
  addNotes(data, 'es', Array.from({ length: 20 }, (_, i) => ({ front: `palabra ${i}`, back: `слово ${i}` })), 'test', 0)
  const passive: Passive = {}
  const shown = new Set<string>()
  let last: string | undefined
  for (let turn = 0; turn < 60; turn++) {
    const f = pickSpinnerCard(data, passive, 0, last, Math.random)!
    passive[passiveKey(f.card)] = (passive[passiveKey(f.card)] ?? 0) + 1
    // Until the deck runs out of fresh cards, no card goes past its showings.
    if (turn < 50) expect(passive[passiveKey(f.card)]).toBeLessThanOrEqual(PASSIVE_SHOWS)
    shown.add(f.ask)
    last = f.card.id
  }
  expect(shown.size).toBe(20)
})

test('an overdue card gives way after its showings, and a review counts again', async () => {
  const data = seeded()
  const id = Object.keys(data.cards)[0]!
  data.cards[id] = { ...data.cards[id]!, state: 2, stability: 5, difficulty: 5, lastReview: 0, due: DAY }
  const passive: Passive = { [passiveKey(data.cards[id]!)]: PASSIVE_SHOWS }
  for (let i = 0; i < 10; i++) expect(pickSpinnerCard(data, passive, 2 * DAY, undefined, Math.random)!.card.id).not.toBe(id)
  grade(data, id, 3, 2 * DAY)
  data.cards[id]!.due = 2 * DAY
  expect(pickSpinnerCard(data, passive, 2 * DAY, undefined, () => 0)!.card.id).toBe(id)
})
