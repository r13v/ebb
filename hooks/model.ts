// The data of ebb and the pure operations on it. No `$` here: register.tsx
// reads and writes the files, this module decides.

import { newSchedule, type Rating, type Schedule, scheduler } from './fsrs'

export const DAY = 86_400_000

export type Kind = 'recognition' | 'production'

export type Deck = {
  id: string
  name: string
  newPerDay: number
  /** Kinds this deck makes; a language deck makes both. */
  kinds: Kind[]
  /** Stability in days of the recognition card that unlocks production. */
  productionUnlockDays: number
  /** Spinner showings of a card before it gives way to the next one. */
  passiveShows?: number
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
  /** newByDeck: how many new cards each deck introduced on `day` (a local date). */
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
type Exposure = { ts: number; card: string }
export type MonthLog = { reviews: ReviewLog[]; exposures: Exposure[] }

/** What a card asks and answers, by its kind. */
export type Face = { card: Card; note: Note; ask: string; answer: string; hint?: string }

const SPINNER_MAX = 40
const ACTIVE_NEW = 5
export const PASSIVE_SHOWS = 3

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

/** The next card of a study session: due cards, then new ones within the daily limit, then learning cards due soon. */
export const nextStudyCard = (data: Data, now: number, skip?: string): Card | undefined => {
  const cards = Object.values(data.cards).filter(c => c.id !== skip && data.notes[c.note])
  const due = cards.filter(c => !isNew(c) && c.due <= now).sort((a, b) => a.due - b.due)
  if (due[0]) return due[0]
  const fresh = cards
    .filter(c => isNew(c) && newLeftToday(data, data.decks[data.notes[c.note]!.deck]!, now) > 0)
    .sort(byOrder(data))
  if (fresh[0]) return fresh[0]
  return cards.filter(c => isLearning(c) && c.due <= now + 20 * 60_000).sort((a, b) => a.due - b.due)[0]
}

/** How many times each card was shown in the spinner since its last review, by `passiveKey`. */
export type Passive = Record<string, number>

/** A review starts the count again: the key carries the time of the last review. */
export const passiveKey = (card: Card) => `${card.id}@${card.lastReview ?? 0}`

/**
 * The card the spinner shows this turn, or none; never the one shown last turn.
 * Cards in learning or due within a day come first, then the next new cards in deck
 * order. A card gives way after `passiveShows` showings since its last review, so the
 * spinner moves through the deck on its own while the schedule waits for real reviews.
 * When every candidate has had its showings, any card the user has met is shown.
 */
export const pickSpinnerCard = (
  data: Data,
  passive: Passive,
  now: number,
  last: string | undefined,
  random: () => number,
): Face | undefined => {
  if ((data.meta.pausedUntil ?? 0) > now) return undefined
  const faces = Object.values(data.cards)
    .filter(c => c.id !== last)
    .map(c => face(data, c))
    .filter((f): f is Face => !!f && f.ask.length <= SPINNER_MAX)
  const fresh = (f: Face) =>
    (passive[passiveKey(f.card)] ?? 0) < (data.decks[f.note.deck]?.passiveShows ?? PASSIVE_SHOWS)
  const choose = (pool: Face[]) => pool[Math.floor(random() * pool.length)]
  const soon = faces
    .filter(f => !isNew(f.card) && fresh(f) && (isLearning(f.card) || f.card.due <= now + DAY))
    .sort((a, b) => a.card.due - b.card.due)
    .slice(0, ACTIVE_NEW)
  if (soon.length) return choose(soon)
  const upcoming = faces
    .filter(f => isNew(f.card) && fresh(f))
    .sort((a, b) => byOrder(data)(a.card, b.card))
    .slice(0, ACTIVE_NEW)
  if (upcoming.length) return choose(upcoming)
  return choose(faces.filter(f => !isNew(f.card) || !fresh(f)))
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
  if (before.state === 0) {
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
