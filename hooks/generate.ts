// Prompts and parsers for model calls: generating notes, checking them, answering a question.
// Pure: register.tsx makes the calls.

import type { Candidate } from '../types'
import type { Deck, NoteInput } from './model'

const LANGUAGE_DECK = `The deck teaches Castilian Spanish (Spain, not Latin America) to a Russian speaker.
- front: the Spanish word or phrase. Nouns carry their article (el/la/los/las). Adjectives show both genders as "bueno/a" when they change.
- back: a short Russian translation; for several meanings, separate them with "; ".
- hint: optional, one short Russian note on a trap: gender exceptions, ser/estar, a false friend, irregular forms. Omit when there is none.
- Use Spain's usage: ordenador, coche, móvil, zumo, patata, vale, vosotros.`

export const generationPrompt = (deck: Deck, topic: string, existing: string[]) => ({
  system: `You write spaced-repetition notes. ${deck.id === 'es' ? LANGUAGE_DECK : `Deck: ${deck.name}. front: a short question or cue; back: the short answer.`}
One fact per note. Prefer frequent, useful items. Reply with JSON only, no prose and no code fence:
{"notes":[{"front":"...","back":"...","hint":"...","tags":["..."]}]}`,
  prompt: `Topic or list: ${topic}
Write up to 9 notes. Skip these, the deck has them: ${existing.slice(0, 300).join(', ') || 'none'}`,
})

/** The notes of a model reply, or why there are none. */
export const parseNotes = (text: string): { notes: NoteInput[] } | { error: string } => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return { error: 'в ответе модели нет JSON' }
  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { error: 'модель вернула битый JSON' }
  }
  const list = (value as { notes?: unknown }).notes
  if (!Array.isArray(list)) return { error: 'в JSON нет списка notes' }
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
  return notes.length ? { notes } : { error: 'модель не вернула ни одной записи' }
}

/** Back-translation: the model sees only the backs and writes the fronts. */
export const backTranslationPrompt = (deck: Deck, notes: NoteInput[]) => ({
  system: `Translate each item back into the deck's target language (${deck.id === 'es' ? 'Castilian Spanish; nouns with their article' : deck.name}). Reply with JSON only: {"fronts":["..."]}, same order and length.`,
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
    return isClose ? { ...note, isChecked: true } : { ...note, isChecked: false, flag: `обратный перевод: ${back}` }
  })
}

export const questionPrompt = (deck: Deck, ask: string, answer: string, hint: string | undefined, question: string) => ({
  system: `You are a concise tutor inside a flashcard app. ${deck.id === 'es' ? 'The learner is a Russian speaker learning Castilian Spanish (Spain).' : `Deck: ${deck.name}.`} Answer in Russian, in at most 6 short lines, plain text without markdown.`,
  prompt: `Card: ${ask} — ${answer}${hint ? ` (${hint})` : ''}\nQuestion: ${question}`,
})
