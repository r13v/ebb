import { expect, test } from 'claude-code/testing'
import { parseDeckFile } from '../hooks/decks'
import { flagMismatches, parseNotes } from '../hooks/generate'
import {
  addNotes,
  DAY,
  type Data,
  emptyData,
  ensureDeck,
  grade,
  newLeftToday,
  nextCard,
  parseDuration,
  upgrade,
} from '../hooks/model'

const seeded = (): Data => {
  const data = emptyData()
  ensureDeck(data, { id: 'es', name: 'Castellano' })
  addNotes(
    data,
    'es',
    [
      { front: 'el corazón', back: 'сердце' },
      { front: 'la mano', back: 'рука' },
      { front: 'hablar', back: 'говорить' },
      { front: 'Más vale pájaro en mano que ciento volando', back: 'лучше синица в руках' },
    ],
    'test',
    0,
  )
  return data
}

test('re-adding the same fronts adds nothing', async () => {
  const data = seeded()
  expect(addNotes(data, 'es', [{ front: 'El corazón ', back: 'сердце' }], 'again', 1)).toBe(0)
  expect(Object.keys(data.notes)).toHaveLength(4)
  expect(Object.keys(data.cards)).toHaveLength(4)
})

test('the band takes due cards, then new ones up to the daily limit, then runs ahead', async () => {
  const data = seeded()
  data.decks.es!.newPerDay = 2
  const now = Date.UTC(2026, 10, 7, 10)
  const order = (id: string) => data.notes[data.cards[id]!.note]!.order
  const a = nextCard(data, now)!
  grade(data, a.id, 4, now)
  const b = nextCard(data, now)!
  grade(data, b.id, 4, now)
  expect([order(a.id), order(b.id)]).toEqual([0, 1])
  // Past the daily limit the band still shows the next new card in deck order.
  const ahead = nextCard(data, now)!
  expect(order(ahead.id)).toBe(2)

  const later = now + 30 * DAY
  expect(nextCard(data, later)!.state).not.toBe(0)
})

test('with no new card left, the band shows the card that comes due soonest', async () => {
  const data = seeded()
  const now = Date.UTC(2026, 10, 7, 10)
  for (const id of Object.keys(data.cards)) grade(data, id, 4, now)
  const soonest = Object.values(data.cards).sort((x, y) => x.due - y.due)[0]!
  expect(nextCard(data, now)!.id).toBe(soonest.id)
})

test('new production cards take none of the daily limit and wait for today’s new words', async () => {
  const data = seeded()
  data.decks.es!.newPerDay = 2
  const now = Date.UTC(2026, 10, 7, 10)
  const [first, second] = Object.values(data.cards)
  // A production card of the first note, unlocked earlier, is new.
  const productionId = `${first!.note}:p`
  data.cards[productionId] = { ...first!, id: productionId, kind: 'production' }
  expect(nextCard(data, now)!.id).toBe(first!.id)
  grade(data, first!.id, 4, now)
  expect(nextCard(data, now)!.id).toBe(second!.id)
  grade(data, second!.id, 4, now)
  expect(nextCard(data, now)!.id).toBe(productionId)
  grade(data, productionId, 4, now)
  expect(newLeftToday(data, data.decks.es!, now)).toBe(0)
  data.decks.es!.newPerDay = 3
  expect(newLeftToday(data, data.decks.es!, now)).toBe(1)
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
  const file = parseDeckFile(
    JSON.stringify({
      id: 'es',
      name: 'Spanish',
      learn: 'Spanish',
      native: 'English',
      notes: [
        { front: 'el agua', back: 'water', hint: 'el, not la' },
        { front: '', back: 'x' },
      ],
    }),
  )
  if ('error' in file) throw new Error(file.error)
  expect(file.deck.kinds).toEqual(['recognition', 'production'])
  expect(file.notes).toEqual([{ front: 'el agua', back: 'water', hint: 'el, not la', tags: [] }])
  const facts = parseDeckFile(JSON.stringify({ id: 'k8s', name: 'Kubernetes', notes: [{ front: 'q', back: 'a' }] }))
  expect('error' in facts ? facts.error : facts.deck.kinds).toEqual(['recognition'])
  expect(parseDeckFile('not json')).toEqual({ error: 'the file is not JSON' })
  expect(parseDeckFile(JSON.stringify({ id: 'Bad Id', name: 'x', notes: [] }))).toMatchObject({
    error: expect.stringMatching(/id/),
  })
})

test('model replies: bad JSON is an error, a wrong back-translation is flagged', async () => {
  expect('error' in parseNotes('sorry, no')).toBe(true)
  const parsed = parseNotes(
    '```json\n{"notes":[{"front":"el mapa","back":"карта"},{"front":"la mano","back":"нога"}]}\n```',
  )
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
  expect(newLeftToday(data, data.decks.es!, now)).toBe(17)
  expect('newToday' in data.meta).toBe(false)
})

test('skipped cards wait until no other card is left', async () => {
  const data = seeded()
  const first = nextCard(data, 0)!
  const second = nextCard(data, 0, new Set([first.id]))!
  expect(second.id).not.toBe(first.id)
  const all = new Set(Object.keys(data.cards))
  expect(nextCard(data, 0, all)).toBeUndefined()
})

test('a deck on the old default of 10 new cards a day gets 20', async () => {
  const data = seeded()
  data.decks.es!.newPerDay = 10
  upgrade(data)
  expect(data.decks.es!.newPerDay).toBe(20)
})

test('a learning card waits for its step while other cards are left', async () => {
  const data = seeded()
  const now = Date.UTC(2026, 10, 7, 10)
  const first = nextCard(data, now)!
  grade(data, first.id, 3, now)
  expect(nextCard(data, now + 60_000)!.id).not.toBe(first.id)
  expect(nextCard(data, now + 11 * 60_000)!.id).toBe(first.id)
})

test('new and due cards take turns while both are left', async () => {
  const data = seeded()
  const now = Date.UTC(2026, 10, 7, 10)
  const [first, second] = Object.values(data.cards)
  grade(data, first!.id, 3, now - DAY)
  data.cards[first!.id]!.due = now
  // The due card goes first on a due turn, a new card in deck order on a new turn.
  expect(nextCard(data, now, new Set(), false)!.id).toBe(first!.id)
  expect(nextCard(data, now, new Set(), true)!.id).toBe(second!.id)
})
