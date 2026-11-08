// The session of ebb that both hosts share: the data file under the lock, the review log, the card
// in the band, the commands and the drafting of new notes. A host (`hooks/register.tsx` for Claude
// Code, `pi/index.ts` for pi) gives it a `Host` and draws what it decides.

import { parseDeckFile } from './decks'
import type { Rating } from './fsrs'
import {
  backTranslationPrompt,
  deckPrompt,
  flagMismatches,
  generationPrompt,
  parseDeckReply,
  parseNotes,
} from './generate'
import {
  activeDeck,
  addNotes,
  counts,
  type Data,
  type Deck,
  emptyData,
  ensureDeck,
  type Face,
  face,
  grade,
  type MonthLog,
  monthKey,
  nextCard,
  parseDuration,
  upgrade,
} from './model'

/** A note the model proposed in `/ebb add`, before the user approves it. */
export type Candidate = {
  front: string
  back: string
  hint?: string
  tags?: string[]
  flag?: string
  isDuplicate?: boolean
  isChecked: boolean
}

/** A deck `/ebb add` makes when the person adds its first notes; `native` is asked when the request does not show it. */
export type NewDeck = { id: string; name: string; learn?: string; native?: string }

/** What the list of `/ebb add` shows. */
export type View = {
  deck: string
  topic: string
  candidates: Candidate[]
  status?: string
  newDeck?: NewDeck
}

/** The card the band above the prompt shows. */
export type Band = { cardId: string | null; isRevealed: boolean; shownAt: number }

/** What the band draws: a card, a hint to get cards, an error, or nothing (paused or no card). */
export type BandView =
  | { kind: 'card'; face: Face; isRevealed: boolean }
  | { kind: 'no-deck' }
  | { kind: 'error'; error: string }
  | { kind: 'none' }

/** What a host gives the shared session: its files, processes, network, clock, model and band. */
export type Host = {
  /** The data directory: `dataDir` of the host's environment. */
  dir: string
  /** The home directory, for a `~/` path the person types. */
  home: string
  exists(path: string): Promise<boolean>
  read(path: string): Promise<string>
  /** Writes a file and makes its directories. */
  write(path: string, text: string): Promise<void>
  mtimeMs(path: string): Promise<number>
  /** Makes one directory; false when it is there already. It is atomic, so it takes the lock. */
  mkdir(path: string): Promise<boolean>
  mkdirp(path: string): Promise<void>
  /** Renames a file or a directory; false when that failed. */
  rename(from: string, to: string): Promise<boolean>
  remove(path: string): Promise<void>
  sleep(ms: number): Promise<void>
  fetch(url: string): Promise<{ ok: boolean; status: number; text: string }>
  complete(request: {
    system: string
    prompt: string
    maxTokens: number
    timeoutMs: number
  }): Promise<{ text: string } | { error: string }>
  /** Draws the band again; called on every change of the card in it. */
  showBand(band: Band): Promise<void>
}

/** Where both hosts keep the data: `$XDG_DATA_HOME/ebb`, by default `~/.local/share/ebb`. */
export const dataDir = (home: string, xdgDataHome?: string) => `${xdgDataHome || `${home}/.local/share`}/ebb`

const HELP = `/ebb decks — your decks
/ebb use @deck — the deck whose cards show above the prompt
/ebb install <file or URL> — add a deck file
/ebb add [@deck] <topic or word list> — write new notes with the model, in the active deck or in @deck; a new @deck is made on first use
/ebb pause [1h|30m|2d|off] — no card above the prompt for a while
/ebb stats — notes, due cards and new cards of the active deck`

const LOCK_STALE_MS = 10_000
const RECENT_PROMPTS = 3

/** The deck a new deck becomes: a language deck asks both ways, a deck of facts one way. */
const deckFrom = (d: NewDeck): Partial<Deck> & { id: string; name: string } =>
  d.learn ? { ...d, kinds: ['recognition', 'production'] } : { id: d.id, name: d.name, kinds: ['recognition'] }

/** One session of a host: its caches, its own log file, the card in its band and the cards it skipped. */
export const createSession = () => {
  // This session's own log file, which no other session writes.
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const dataPath = (host: Host) => `${host.dir}/data.json`

  let cache: { data: Data; mtimeMs: number } | undefined

  /** The data as on disk, read again only when another session changed the file. */
  const load = async (host: Host): Promise<Data> => {
    const path = dataPath(host)
    if (!(await host.exists(path))) {
      cache = { data: emptyData(), mtimeMs: 0 }
      return cache.data
    }
    const mtimeMs = await host.mtimeMs(path)
    if (cache && cache.mtimeMs === mtimeMs) return cache.data
    const data = upgrade(JSON.parse(await host.read(path)) as Data)
    cache = { data, mtimeMs }
    return data
  }

  /**
   * Runs `work` under the lock of the data directory, so two sessions never lose each other's writes.
   * `mkdir` takes the lock atomically and an owner file inside names who holds it.
   * A lock older than 10 s is taken as left by a dead session: it is renamed away first,
   * so only one waiter removes it.
   */
  const withLock = async <T>(host: Host, work: () => Promise<T>): Promise<T> => {
    const lock = `${host.dir}/lock`
    const token = `${sessionId}-${Math.random().toString(36).slice(2, 8)}`
    await host.mkdirp(host.dir)
    for (let waited = 0; ; waited += 100) {
      if (await host.mkdir(lock)) break
      const heldSince = await host.mtimeMs(lock).catch(() => undefined)
      if (heldSince !== undefined && Date.now() - heldSince > LOCK_STALE_MS) {
        const aside = `${lock}.stale-${token}`
        if (await host.rename(lock, aside)) await host.remove(aside)
        continue
      }
      if (waited > LOCK_STALE_MS + 2_000) throw new Error('данные заняты другой сессией, попробуйте ещё раз')
      await host.sleep(100)
    }
    await host.write(`${lock}/owner`, token)
    try {
      return await work()
    } finally {
      const owner = await host.read(`${lock}/owner`).catch(() => undefined)
      if (owner === token) await host.remove(lock)
    }
  }

  /** Replaces a file by an atomic rename, so a reader never sees half of it. */
  const replaceFile = async (host: Host, path: string, text: string) => {
    await host.write(`${path}.tmp`, text)
    if (!(await host.rename(`${path}.tmp`, path))) throw new Error(`не удалось сохранить ${path}`)
  }

  /** Changes `data.json` under the lock, on a copy read again inside it. The only writer of the file. */
  const mutate = <T>(host: Host, change: (data: Data) => T): Promise<T> =>
    withLock(host, async () => {
      try {
        cache = undefined
        const data = await load(host)
        const result = change(data)
        const path = dataPath(host)
        await replaceFile(host, path, JSON.stringify(data))
        cache = { data, mtimeMs: await host.mtimeMs(path) }
        return result
      } catch (error) {
        cache = undefined
        throw error
      }
    })

  let log: { key: string; value: MonthLog } | undefined
  let logWrite: Promise<void> = Promise.resolve()

  /** Appends a review to this session's own log for the month. */
  const appendLog = async (host: Host, review: MonthLog['reviews'][number]) => {
    const path = `${host.dir}/log/${monthKey(review.ts)}/${sessionId}.json`
    if (log?.key !== path) log = { key: path, value: { reviews: [] } }
    log.value.reviews.push(review)
    const text = JSON.stringify(log.value)
    // Writes go one after another, so an older snapshot never lands after a newer one.
    logWrite = logWrite.catch(() => undefined).then(() => host.write(path, text))
    await logWrite
  }

  // ---------- the band ----------

  let band: Band = { cardId: null, isRevealed: false, shownAt: 0 }

  const setBand = async (host: Host, next: Band) => {
    band = next
    await host.showBand(band)
  }

  // Cards skipped in this session; they come back when nothing else is left.
  const skipped = new Set<string>()

  // New and due cards take turns (`nextCard`). `chosenWith` is the turn of the card in the band,
  // `wasNew` whether that card was new: the next pick takes the other turn.
  let chosenWith = false
  let wasNew = false

  /**
   * Puts the next card in the band, with its answer hidden. `previous`, the card just graded or
   * skipped, never comes straight back while another card is left. `isRepick` chooses again for
   * the same turn, so a card that came due can take the band's place without moving the turns.
   */
  const showNextCard = async (host: Host, previous?: string, isRepick = false): Promise<string | undefined> => {
    try {
      const data = await load(host)
      const now = Date.now()
      const avoid = previous ? [previous] : []
      const isNewTurn = isRepick ? chosenWith : !wasNew
      let card = nextCard(data, now, new Set([...skipped, ...avoid]), isNewTurn)
      if (!card) {
        skipped.clear()
        card = nextCard(data, now, new Set(avoid), isNewTurn) ?? nextCard(data, now)
      }
      chosenWith = isNewTurn
      wasNew = card?.state === 0
      await setBand(host, { cardId: card?.id ?? null, isRevealed: false, shownAt: now })
      return undefined
    } catch (error) {
      await setBand(host, { cardId: null, isRevealed: false, shownAt: 0 })
      return String(error)
    }
  }

  const skip = async (host: Host) => {
    if (band.cardId) skipped.add(band.cardId)
    await showNextCard(host, band.cardId ?? undefined)
  }

  /** After Forgot showed the answer: the next card. */
  const next = (host: Host) => showNextCard(host, band.cardId ?? undefined)

  let isGrading = false

  /** Grades the card in the band; a forgotten card shows its answer until `next`. Throws when the grade was not saved. */
  const gradeCard = async (host: Host, rating: Rating) => {
    const graded = band
    if (isGrading || !graded.cardId || graded.isRevealed) return
    isGrading = true // a second press while this one saves is ignored
    const cardId = graded.cardId
    try {
      const result = await mutate(host, data =>
        grade(data, cardId, rating, Date.now(), Math.random, Date.now() - graded.shownAt),
      )
      await appendLog(host, result.log)
      skipped.delete(cardId)
      if (rating === 1) await setBand(host, { ...band, isRevealed: true })
      else await showNextCard(host, cardId)
    } finally {
      isGrading = false
    }
  }

  /** At the end of a turn a card may have come due; an open answer stays as it is. */
  const endTurn = async (host: Host) => {
    if (!band.isRevealed) await showNextCard(host, undefined, true)
  }

  /** What the band draws now. A reader on every render: it never throws. */
  const bandView = async (host: Host): Promise<BandView> => {
    let data: Data
    try {
      data = await load(host)
    } catch (error) {
      return { kind: 'error', error: String(error) }
    }
    if (!Object.keys(data.decks).length) return { kind: 'no-deck' }

    const card = band.cardId ? data.cards[band.cardId] : undefined
    const f = card && face(data, card)
    if ((data.meta.pausedUntil ?? 0) > Date.now() || !f) return { kind: 'none' }

    return { kind: 'card', face: f, isRevealed: band.isRevealed }
  }

  // ---------- commands ----------

  /**
   * `/ebb install <path or URL>`: adds a deck file. Installing it again adds the notes that are
   * new and the meanings that are new; cards keep their schedule.
   */
  const installDeck = async (host: Host, where: string): Promise<string> => {
    if (!where) return 'Name a deck file or URL: /ebb install ~/decks/spanish.json'
    let source: string
    if (/^https?:\/\//.test(where)) {
      const r = await host.fetch(where)
      if (!r.ok) return `Could not download the deck: HTTP ${r.status}`
      source = r.text
    } else {
      const path = where.startsWith('~/') ? `${host.home}${where.slice(1)}` : where
      if (!(await host.exists(path))) return `No file ${path}`
      source = await host.read(path)
    }
    const file = parseDeckFile(source)
    if ('error' in file) return `Not a deck: ${file.error}`
    const { added, isActive } = await mutate(host, d => {
      ensureDeck(d, file.deck)
      const added = addNotes(d, file.deck.id, file.notes, `install: ${where}`, Date.now(), true)
      return { added, isActive: activeDeck(d)?.id === file.deck.id }
    })
    await showNextCard(host)
    return isActive
      ? `Installed ${file.deck.name}: ${added} new notes. Its cards show above the prompt.`
      : `Installed ${file.deck.name}: ${added} new notes. Switch to it: /ebb use @${file.deck.id}`
  }

  const listDecks = async (host: Host): Promise<string> => {
    const data = await load(host)
    const now = Date.now()
    const active = activeDeck(data)?.id
    const rows = Object.values(data.decks).map(d => {
      const cards = Object.values(data.cards).filter(c => data.notes[c.note]?.deck === d.id)
      const due = cards.filter(c => c.state !== 0 && c.due <= now).length
      const fresh = cards.filter(c => c.state === 0).length
      return `${d.id === active ? '▶' : ' '} ${d.id} — ${d.name}: ${cards.length} cards, ${due} due, ${fresh} new`
    })
    return [
      ...(rows.length ? rows : ['No deck yet.']),
      '',
      ...(rows.length > 1 ? ['▶ shows above the prompt. Switch: /ebb use @<deck>.'] : []),
      'Make one: /ebb add <topic>. Install one: /ebb install <file or URL>.',
    ].join('\n')
  }

  /** `/ebb use @deck`: makes the deck active and shows its card; without a known deck, the list. */
  const useDeck = async (host: Host, tail: string): Promise<string> => {
    const id = tail.replace(/^@/, '')
    if (!id || !Object.hasOwn((await load(host)).decks, id))
      return `${id ? `No deck ${id}.\n\n` : ''}${await listDecks(host)}`
    const deck = await mutate(host, data => {
      data.meta.activeDeck = id
      return data.decks[id]!
    })
    await showNextCard(host)
    return `${deck.name} shows above the prompt.`
  }

  const stats = async (host: Host) => {
    const data = await load(host)
    const deck = activeDeck(data)
    if (!deck) return 'No deck yet.'
    const c = counts(data, deck.id, Date.now())
    const notes = Object.values(data.notes).filter(n => n.deck === deck.id).length
    const paused = (data.meta.pausedUntil ?? 0) > Date.now() ? ' · paused' : ''

    return `${deck.name} · notes: ${notes} · due: ${c.due} · new: ${c.new}${paused}`
  }

  const pause = async (host: Host, tail: string) => {
    if (tail === 'off') {
      await mutate(host, data => void delete data.meta.pausedUntil)
      await host.showBand(band)
      return 'Cards are back above the prompt.'
    }
    const ms = tail ? parseDuration(tail) : 3_600_000
    if (!ms) return 'Use /ebb pause 1h, 30m, 2d or off'

    const until = Date.now() + ms
    await mutate(host, data => {
      data.meta.pausedUntil = until
    })
    await host.showBand(band)

    return `Paused until ${new Date(until).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`
  }

  /** `/ebb <args>`: the text to show. `add` belongs to the host, which draws its list. */
  const runCommand = async (host: Host, args: string, add: (tail: string) => Promise<string>): Promise<string> => {
    const [sub = '', ...rest] = args.trim().split(/\s+/)
    const tail = rest.join(' ')
    switch (sub) {
      case 'decks':
        return listDecks(host)
      case 'install':
        return installDeck(host, tail)
      case 'use':
        return useDeck(host, tail)
      case 'add':
        return tail ? add(tail) : 'Name a topic: /ebb add ordering at a bar'
      case 'pause':
        return pause(host, tail)
      case 'stats':
        return stats(host)
      default:
        return `${await stats(host)}\n\n${HELP}`
    }
  }

  // ---------- adding notes ----------

  // The person's last prompts: `/ebb add` reads their own language from them.
  const recentPrompts: string[] = []

  const notePrompt = (text: string) => {
    if (text.trimStart().startsWith('/')) return
    recentPrompts.push(text.slice(0, 300))
    if (recentPrompts.length > RECENT_PROMPTS) recentPrompts.shift()
  }

  /**
   * The start of `/ebb add [@deck] <topic>`: the view to show and the deck, when it exists. Text
   * when the request cannot go on. A new deck is saved only with its first notes (`commitAdd`).
   */
  const planAdd = async (
    host: Host,
    args: string,
  ): Promise<{ view: View; deck?: Deck; named?: string } | { text: string }> => {
    const match = /^@([\w-]+)\s+(.+)$/u.exec(args)
    const named = match?.[1]
    const topic = match ? match[2]! : args
    const data = await load(host)
    let deck = activeDeck(data)
    if (named) deck = Object.hasOwn(data.decks, named) ? data.decks[named] : undefined
    const view: View = { deck: deck?.id ?? named ?? '', topic, candidates: [], status: 'Reading the request…' }

    return { view, deck, named }
  }

  /** A new deck from the request and the person's recent prompts; `native` stays empty when unclear. */
  const askDeck = async (host: Host, args: string, named?: string): Promise<NewDeck> => {
    const r = await host.complete({ ...deckPrompt(args, recentPrompts), maxTokens: 300, timeoutMs: 60_000 })
    const reply = 'text' in r ? parseDeckReply(r.text) : undefined

    return {
      id: named ?? reply?.id ?? 'notes',
      name: reply?.name ?? named ?? 'Notes',
      learn: reply?.learn ?? undefined,
      native: reply?.native ?? undefined,
    }
  }

  /**
   * Up to 9 new notes on the topic. In a language deck a second call translates them back; a note
   * that does not match is flagged and unticked. Notes the deck has are marked and unticked.
   */
  const draftNotes = async (
    host: Host,
    deck: Deck | NewDeck,
    topic: string,
    onStatus: (status: string) => Promise<unknown>,
  ): Promise<Pick<View, 'candidates' | 'status'>> => {
    const data = await load(host)
    await onStatus('Writing notes…')
    const existing = Object.values(data.notes)
      .filter(n => n.deck === deck.id)
      .map(n => n.front)
    const asDeck = { ...deckFrom(deck), ...deck } as Deck
    const made = await host.complete({
      ...generationPrompt(asDeck, topic, existing),
      maxTokens: 3000,
      timeoutMs: 120_000,
    })
    if ('error' in made) return { candidates: [], status: `The model did not answer: ${made.error}` }
    const parsed = parseNotes(made.text)
    if ('error' in parsed) return { candidates: [], status: parsed.error }

    const notes = parsed.notes.slice(0, 9)
    const known = new Set(existing.map(f => f.toLowerCase()))
    let candidates: Candidate[] = notes.map(n => ({ ...n, isChecked: true }))
    let status: string | undefined
    if (deck.learn) {
      await onStatus('Checking by back-translation…')
      const checked = await host.complete({
        ...backTranslationPrompt(asDeck, notes),
        maxTokens: 1500,
        timeoutMs: 60_000,
      })
      const flagged = 'text' in checked ? flagMismatches(notes, checked.text) : undefined
      // Without a back-translation nothing is checked: every note starts unticked, and the status says why.
      candidates = flagged ?? notes.map(n => ({ ...n, isChecked: false }))
      if (!flagged) status = 'The back-translation failed: check the notes yourself and tick the good ones'
    }
    candidates = candidates.map(c =>
      known.has(c.front.toLowerCase()) ? { ...c, isDuplicate: true, isChecked: false } : c,
    )

    return { candidates, status }
  }

  /** Adds the ticked notes, and the new deck with them; the band then takes a card. Returns how many were added. */
  const commitAdd = async (host: Host, view: View) => {
    const chosen = view.candidates.filter(c => c.isChecked && !c.isDuplicate)
    const added = await mutate(host, data => {
      if (view.newDeck) ensureDeck(data, deckFrom(view.newDeck))
      return addNotes(data, view.deck, chosen, `ebb add: ${view.topic}`, Date.now())
    })
    await showNextCard(host)

    return added
  }

  return {
    showNextCard,
    skip,
    next,
    gradeCard,
    endTurn,
    bandView,
    runCommand,
    notePrompt,
    planAdd,
    askDeck,
    draftNotes,
    commitAdd,
  }
}

/** Ticks or unticks the candidate at `index`; a note the deck has stays unticked. */
export const toggleCandidate = (view: View, index: number): View => ({
  ...view,
  candidates: view.candidates.map((c, j) => (j === index && !c.isDuplicate ? { ...c, isChecked: !c.isChecked } : c)),
})

/** The mark of a candidate in the list of `/ebb add`. */
const checkbox = (c: Candidate) => {
  if (c.isDuplicate) return '[have]'

  return c.isChecked ? '[x]' : '[ ]'
}

/** How many notes `commitAdd` would add. */
export const tickedCount = (view: View) => view.candidates.filter(c => c.isChecked && !c.isDuplicate).length

/** A candidate as one line of the list. */
export const candidateLine = (c: Candidate) =>
  `${checkbox(c)} ${c.front} — ${c.back}${c.hint ? ` (${c.hint})` : ''}${c.flag ? ` ⚠ ${c.flag}` : ''}`
