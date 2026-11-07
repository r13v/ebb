// Deck files: a deck as one JSON file that `/ebb install` reads from a path or a URL.

import type { Deck, NoteInput } from './model'

/**
 * `{ id, name, description?, learn?, native?, guidance?, notes: [{ front, back, hint?, tags? }] }`.
 * `learn` and `native` make a language deck: the language learned and the language of the answers.
 */
export type DeckFile = { deck: Partial<Deck> & { id: string; name: string }; notes: NoteInput[] }

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** The deck in a deck file, or why it is not one. */
export const parseDeckFile = (source: string): DeckFile | { error: string } => {
  let v: Record<string, unknown>
  try {
    v = JSON.parse(source) as Record<string, unknown>
  } catch {
    return { error: 'the file is not JSON' }
  }
  const id = text(v.id)?.toLowerCase()
  const name = text(v.name)
  if (!id || !/^[a-z0-9-]+$/.test(id))
    return { error: 'the deck needs an "id" of lowercase letters, digits and hyphens' }
  if (!name) return { error: 'the deck needs a "name"' }
  if (!Array.isArray(v.notes)) return { error: 'the deck needs a "notes" list' }
  const notes: NoteInput[] = []
  for (const n of v.notes as Record<string, unknown>[]) {
    const front = text(n?.front)
    const back = text(n?.back)
    if (!front || !back) continue
    const tags = Array.isArray(n.tags) ? n.tags.filter((t): t is string => typeof t === 'string') : []
    notes.push({ front, back, hint: text(n.hint), tags })
  }
  if (!notes.length) return { error: 'the deck has no notes with "front" and "back"' }
  const learn = text(v.learn)
  const native = text(v.native)
  return {
    deck: {
      id,
      name,
      learn,
      native,
      guidance: text(v.guidance),
      kinds: learn && native ? ['recognition', 'production'] : ['recognition'],
    },
    notes,
  }
}
