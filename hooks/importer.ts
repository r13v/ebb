// Parses the word lists of ~/.claude/spanish into notes. Pure: the caller reads the files.

import type { NoteInput } from './model'

export const SPANISH_FILES = [
  ['gerunds.txt', 'gerund'],
  ['verbs.txt', 'verb'],
  ['nouns.txt', 'noun'],
  ['adjectives.txt', 'adjective'],
  ['adverbs.txt', 'adverb'],
] as const

/** `word|translation` lines; `#` lines and blanks are skipped. */
export const parseWordList = (text: string, tag: string): NoteInput[] =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('|'))
    .map(line => {
      const [front, ...rest] = line.split('|')
      return { front: front!.trim(), back: rest.join('|').trim(), tags: [tag] }
    })

/**
 * tips.json: `💬 es — ru` phrases and `🧠 es — букв. «…» → meaning` idioms.
 * An idiom's literal reading becomes its hint.
 */
export const parseTips = (tips: unknown): NoteInput[] => {
  if (!Array.isArray(tips)) return []
  const notes: NoteInput[] = []
  for (const tip of tips) {
    if (typeof tip !== 'string') continue
    const phrase = /^💬\s*(.+?)\s+—\s+(.+)$/u.exec(tip)
    if (phrase) {
      notes.push({ front: phrase[1]!, back: phrase[2]!, tags: ['phrase'] })
      continue
    }
    const idiom = /^🧠\s*(.+?)\s+—\s+(.+?)\s+→\s+(.+)$/u.exec(tip)
    if (idiom) notes.push({ front: idiom[1]!, back: idiom[3]!, hint: idiom[2]!, tags: ['idiom'] })
  }
  return notes
}

/** Round-robin over the lists, so new cards mix parts of speech instead of 500 verbs in a row. */
export const interleave = <T,>(lists: T[][]): T[] => {
  const out: T[] = []
  const longest = Math.max(0, ...lists.map(l => l.length))
  for (let i = 0; i < longest; i++) for (const list of lists) if (i < list.length) out.push(list[i]!)
  return out
}
