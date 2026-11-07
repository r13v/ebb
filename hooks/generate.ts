// Prompts and parsers for model calls: generating notes, checking them, answering a question.
// Pure: register.tsx makes the calls.

import type { Candidate } from '../types'
import type { Deck, NoteInput } from './model'

const describeDeck = (deck: Deck) =>
  deck.learn && deck.native
    ? `The deck teaches ${deck.learn} to a ${deck.native} speaker.
- front: the ${deck.learn} word or phrase.
- back: a short ${deck.native} translation.
- hint: optional, one short note in ${deck.native} on a trap. Omit it when there is none.${deck.guidance ? `\n${deck.guidance}` : ''}`
    : `Deck: ${deck.name}. front: a short question or cue; back: the short answer.${deck.guidance ? `\n${deck.guidance}` : ''}`

export const generationPrompt = (deck: Deck, topic: string, existing: string[]) => ({
  system: `You write spaced-repetition notes. ${describeDeck(deck)}
One fact per note. Prefer frequent, useful items. Reply with JSON only, no prose and no code fence:
{"notes":[{"front":"...","back":"...","hint":"...","tags":["..."]}]}`,
  prompt: `Topic or list: ${topic}
Write up to 9 notes. Skip these, the deck has them: ${existing.slice(0, 300).join(', ') || 'none'}`,
})

/** The notes of a model reply, or why there are none. */
export const parseNotes = (text: string): { notes: NoteInput[] } | { error: string } => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return { error: 'the reply has no JSON' }
  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { error: 'the reply has broken JSON' }
  }
  const list = (value as { notes?: unknown }).notes
  if (!Array.isArray(list)) return { error: 'the JSON has no notes list' }
  const notes: NoteInput[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const { front, back, hint, tags } = item as Record<string, unknown>
    if (typeof front !== 'string' || typeof back !== 'string' || !front.trim() || !back.trim()) continue
    notes.push({
      front: front.trim(),
      back: back.trim(),
      hint: typeof hint === 'string' && hint.trim() ? hint.trim() : undefined,
      tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [],
    })
  }
  return notes.length ? { notes } : { error: 'the reply has no notes' }
}

/** Back-translation of a language deck: the model sees only the backs and writes the fronts. */
export const backTranslationPrompt = (deck: Deck, notes: NoteInput[]) => ({
  system: `Translate each item into ${deck.learn}.${deck.guidance ? ` ${deck.guidance}` : ''} Reply with JSON only: {"fronts":["..."]}, same order and length.`,
  prompt: JSON.stringify(notes.map(n => n.back)),
})

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;:()"«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Flags the notes whose back-translation does not land on the front. A missing reply flags nothing. */
export const flagMismatches = (notes: NoteInput[], reply: string): Candidate[] => {
  let fronts: unknown[] = []
  try {
    const start = reply.indexOf('{')
    const parsed = JSON.parse(reply.slice(start, reply.lastIndexOf('}') + 1)) as { fronts?: unknown }
    if (Array.isArray(parsed.fronts)) fronts = parsed.fronts
  } catch {
    // no check is possible; the user still sees every note
  }
  return notes.map((note, i) => {
    const back = fronts[i]
    if (typeof back !== 'string') return { ...note, isChecked: true }
    const a = normalize(note.front)
    const b = normalize(back)
    const words = new Set(a.split(/[ /]/))
    const isClose = a === b || a.includes(b) || b.includes(a) || b.split(/[ /]/).some(w => w.length > 3 && words.has(w))
    return isClose ? { ...note, isChecked: true } : { ...note, isChecked: false, flag: `back-translation: ${back}` }
  })
}

export const questionPrompt = (deck: Deck, ask: string, answer: string, hint: string | undefined, question: string) => ({
  system: `You are a concise tutor inside a flashcard app. ${deck.learn && deck.native ? `The learner is a ${deck.native} speaker learning ${deck.learn}. Answer in ${deck.native}.` : `Deck: ${deck.name}. Answer in the language of the question.`} Use at most 6 short lines, plain text without markdown.`,
  prompt: `Card: ${ask} — ${answer}${hint ? ` (${hint})` : ''}\nQuestion: ${question}`,
})

/** What a new deck needs, read from the request and the person's recent messages. */
export type DeckReply = { id: string; name: string; learn: string | null; native: string | null }

export const deckPrompt = (request: string, recent: string[]) => ({
  system: `A person asks a flashcard app for notes. Decide the deck they need. Reply with JSON only:
{"id":"short-lowercase-slug","name":"Short deck name","learn":"the language the person learns, or null when the notes are not about a language","native":"the language of the answers, or null"}
The language of the answers is the language the person writes in, in the request or in their recent messages. When the request is about a language but you cannot tell the person's own language, "native" is null.`,
  prompt: `Request: ${request}\nRecent messages: ${JSON.stringify(recent.slice(-3))}`,
})

export const parseDeckReply = (text: string): DeckReply | undefined => {
  try {
    const v = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>
    const id = typeof v.id === 'string' ? v.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') : ''
    if (!id) return undefined
    const text_ = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)
    return { id, name: text_(v.name) ?? id, learn: text_(v.learn), native: text_(v.native) }
  } catch {
    return undefined
  }
}
