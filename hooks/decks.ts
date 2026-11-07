// Bundled decks: the decks that come with ebb, in `decks/`.

import type { NoteInput } from './model'

export type BundledDeck = {
  id: string
  name: string
  description: string
  /** The language the deck teaches, and the language of its answers; absent for a deck of facts. */
  learn?: string
  native?: string
  /** Extra instructions for `/ebb add` notes in this deck. */
  guidance?: string
  /** Lists of `front|back` or `front|back|hint` lines, each with the tag its notes get. */
  lists: { tag: string; text: string }[]
}

/** `front|back` or `front|back|hint` lines; `#` lines and blanks are skipped. */
export const parseList = (text: string, tag: string): NoteInput[] =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('|'))
    .map(line => {
      const [front = '', back = '', hint] = line.split('|').map(part => part.trim())
      return hint ? { front, back, hint, tags: [tag] } : { front, back, tags: [tag] }
    })

/** Round-robin over the lists, so new cards mix kinds instead of 500 verbs in a row. */
export const interleave = <T,>(lists: T[][]): T[] => {
  const out: T[] = []
  const longest = Math.max(0, ...lists.map(l => l.length))
  for (let i = 0; i < longest; i++) for (const list of lists) if (i < list.length) out.push(list[i]!)
  return out
}

/** The deck's notes in the order new cards come. */
export const notesOf = (deck: BundledDeck) => interleave(deck.lists.map(l => parseList(l.text, l.tag)))
