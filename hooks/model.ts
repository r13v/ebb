// The data of ebb and the pure operations on it. No `$` here: register.tsx
// reads and writes the files, this module decides.

import { newSchedule, type Rating, type Schedule, scheduler } from './fsrs'

export const DAY = 86_400_000

type Kind = 'recognition' | 'production'

export type Deck = {
  id: string
  name: string
  newPerDay: number
  /** Kinds this deck makes; a language deck makes both. */
  kinds: Kind[]
  /** Stability in days of the recognition card that unlocks production. */
  productionUnlockDays: number
  /** The language the deck teaches, and the language of its answers; absent for a deck of facts. */
  learn?: string
  native?: string
  /** Extra instructions for `/ebb add` notes in this deck. */
  guidance?: string
}

type Note = {
  id: string
  deck: string
  front: string
  back: string
  hint?: string
  tags: string[]
  order: number
  source: string
  createdAt: number
}

export type Card = Schedule & { id: string; note: string; kind: Kind; reps: number; lapses: number }

export type Data = {
  version: 1
  decks: Record<string, Deck>
  notes: Record<string, Note>
  cards: Record<string, Card>
  /** newByDeck: how many new recognition cards each deck introduced on `day` (a local date). */
  meta: { pausedUntil?: number; newByDeck?: Record<string, { day: string; count: number }> }
}

type ReviewLog = {
  ts: number
  card: string
  rating: Rating
  state: number
  stability: number | null
  difficulty: number | null
  scheduledMs: number
  durationMs?: number
}
export type MonthLog = { reviews: ReviewLog[] }

/** What a card asks and answers, by its kind. */
export type Face = { card: Card; note: Note; ask: string; answer: string; hint?: string }

export const emptyData = (): Data => ({ version: 1, decks: {}, notes: {}, cards: {}, meta: {} })

/** Data written by the first build kept one daily counter for all decks; it was the Spanish deck's. */
export const upgrade = (data: Data): Data => {
  const old = data.meta as Data['meta'] & { newDay?: string; newToday?: number }
  if (old.newDay !== undefined) {
    data.meta.newByDeck ??= { es: { day: old.newDay, count: old.newToday ?? 0 } }
    delete old.newDay
    delete old.newToday
  }
  return data
}

/** FNV-1a, hex: a stable id for a note from its deck and front. */
const noteId = (deck: string, front: string) => {
  let h = 0x811c9dc5
  for (const ch of `${deck}\u0000${front.trim().toLowerCase()}`) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export const face = (data: Data, card: Card): Face | undefined => {
  const note = data.notes[card.note]
  if (!note) return undefined
  return card.kind === 'recognition'
    ? { card, note, ask: note.front, answer: note.back, hint: note.hint }
    : { card, note, ask: note.back, answer: note.front, hint: note.hint }
}

export const ensureDeck = (data: Data, deck: Partial<Deck> & { id: string; name: string }) => {
  data.decks[deck.id] ??= {
    newPerDay: 10,
    kinds: ['recognition', 'production'],
    productionUnlockDays: 21,
    ...deck,
  }
  return data.decks[deck.id]!
}

export type NoteInput = { front: string; back: string; hint?: string; tags?: string[] }

/**
 * Adds notes not yet in the deck, each with its recognition card. Returns how many were new.
 * With `merge`, a note whose front exists already adds its meanings, hint and tags to that note
 * (one word in two word lists, such as `mejor` the adjective and the adverb).
 */
export const addNotes = (
  data: Data,
  deckId: string,
  notes: NoteInput[],
  source: string,
  now: number,
  merge = false,
) => {
  const deck = data.decks[deckId]
  if (!deck) throw new Error(`no deck ${deckId}`)
  let order = Object.values(data.notes).filter(n => n.deck === deckId).length
  let added = 0
  for (const input of notes) {
    const front = input.front.trim()
    const back = input.back.trim()
    if (!front || !back) continue
    const key = front.toLowerCase()
    let id = noteId(deckId, front)
    // A different front with the same 32-bit hash gets a suffix instead of being dropped.
    for (let n = 1; data.notes[id] && data.notes[id]!.front.toLowerCase() !== key; n++)
      id = `${noteId(deckId, front)}-${n}`
    const existing = data.notes[id]
    if (existing) {
      if (merge) {
        const backs = existing.back.split('; ')
        for (const part of back.split('; ')) if (!backs.includes(part)) backs.push(part)
        existing.back = backs.join('; ')
        existing.hint ??= input.hint?.trim() || undefined
        existing.tags = [...new Set([...existing.tags, ...(input.tags ?? [])])]
      }
      continue
    }
    data.notes[id] = {
      id,
      deck: deckId,
      front,
      back,
      hint: input.hint?.trim() || undefined,
      tags: input.tags ?? [],
      order: order++,
      source,
      createdAt: now,
    }
    const first: Kind = deck.kinds.includes('recognition') ? 'recognition' : deck.kinds[0]!
    data.cards[`${id}:${first[0]}`] = {
      ...newSchedule(now),
      id: `${id}:${first[0]}`,
      note: id,
      kind: first,
      reps: 0,
      lapses: 0,
    }
    added++
  }
  return added
}

const isNew = (c: Card) => c.state === 0
const isLearning = (c: Card) => c.state === 1 || c.state === 3

// A learning card this close to its due time is shown before the cards ahead of schedule.
const LEARN_AHEAD_MS = 20 * 60_000

const localDay = (now: number) => new Date(now).toDateString()

export const newLeftToday = (data: Data, deck: Deck, now: number) => {
  const today = data.meta.newByDeck?.[deck.id]
  return today?.day === localDay(now) ? Math.max(0, deck.newPerDay - today.count) : deck.newPerDay
}

export const counts = (data: Data, now: number) => {
  let due = 0
  let fresh = 0
  for (const c of Object.values(data.cards)) {
    if (isNew(c)) fresh++
    else if (c.due <= now) due++
  }
  return { due, new: fresh }
}

const byOrder = (data: Data) => (a: Card, b: Card) =>
  (data.notes[a.note]?.order ?? 0) - (data.notes[b.note]?.order ?? 0)

/**
 * The next card for the band, or none only when every card is skipped.
 * By schedule first: due cards, new recognition cards within the daily limit, new production
 * cards, learning cards due soon. Then ahead of schedule, so the band never runs dry: new cards
 * past the limit, in deck order, then the card that comes due soonest.
 * A production card is of a word the person knows already, so it takes none of the daily limit:
 * otherwise a mature deck would fill the limit with them and stop new words.
 */
export const nextCard = (data: Data, now: number, skip: ReadonlySet<string> = new Set()): Card | undefined => {
  const cards = Object.values(data.cards).filter(c => !skip.has(c.id) && data.notes[c.note])
  const due = cards.filter(c => !isNew(c) && c.due <= now).sort((a, b) => a.due - b.due)
  if (due[0]) return due[0]

  const fresh = cards.filter(isNew).sort(byOrder(data))
  const freshToday = fresh.find(
    c => c.kind === 'recognition' && newLeftToday(data, data.decks[data.notes[c.note]!.deck]!, now) > 0,
  )
  if (freshToday) return freshToday

  const production = fresh.find(c => c.kind === 'production')
  if (production) return production

  const learningSoon = cards.filter(c => isLearning(c) && c.due <= now + LEARN_AHEAD_MS).sort((a, b) => a.due - b.due)
  if (learningSoon[0]) return learningSoon[0]

  const soonest = cards.filter(c => !isNew(c)).sort((a, b) => a.due - b.due)

  return fresh[0] ?? soonest[0]
}

export type Graded = { card: Card; log: ReviewLog; unlocked?: Card }

/** Grades a card: the new schedule, its log row, and a production card if this unlocked one. */
export const grade = (
  data: Data,
  cardId: string,
  rating: Rating,
  now: number,
  random?: () => number,
  durationMs?: number,
): Graded => {
  const before = data.cards[cardId]
  if (!before) throw new Error(`no card ${cardId}`)
  const note = data.notes[before.note]!
  const deck = data.decks[note.deck]!
  const next = scheduler({ random }).review(before, rating, now)
  const card: Card = {
    ...before,
    ...next,
    reps: before.reps + 1,
    lapses: before.lapses + (rating === 1 && before.state === 2 ? 1 : 0),
  }
  data.cards[cardId] = card
  if (before.state === 0 && before.kind === 'recognition') {
    const day = localDay(now)
    data.meta.newByDeck ??= {}
    const byDeck = data.meta.newByDeck
    const today = byDeck[deck.id]
    byDeck[deck.id] = { day, count: today?.day === day ? today.count + 1 : 1 }
  }
  const log: ReviewLog = {
    ts: now,
    card: cardId,
    rating,
    state: before.state,
    stability: before.stability,
    difficulty: before.difficulty,
    scheduledMs: card.due - now,
    durationMs,
  }
  let unlocked: Card | undefined
  const prodId = `${note.id}:p`
  if (
    card.kind === 'recognition' &&
    deck.kinds.includes('production') &&
    !data.cards[prodId] &&
    (card.stability ?? 0) >= deck.productionUnlockDays
  ) {
    unlocked = { ...newSchedule(now), id: prodId, note: note.id, kind: 'production', reps: 0, lapses: 0 }
    data.cards[prodId] = unlocked
  }
  return { card, log, unlocked }
}

/** `1h`, `30m`, `2d` → ms; undefined when it does not parse. */
export const parseDuration = (text: string): number | undefined => {
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|d)$/i.exec(text.trim())
  if (!m) return undefined
  const unit = { m: 60_000, min: 60_000, h: 3_600_000, d: DAY }[m[2]!.toLowerCase() as 'm' | 'min' | 'h' | 'd']
  return Number(m[1]) * unit
}

export const monthKey = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
