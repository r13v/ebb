import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { addNotes, emptyData, ensureDeck, grade } from '../core/model'

const HOME = '/home/u'
const DIR = `${HOME}/.local/share/ebb`

/** A file system in memory, with the `mkdir`, `mv` and `rm` the lock uses. */
const disk = (on: On, seed: Record<string, string> = {}, onSleep?: () => void) => {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const dirs = new Map<string, number>()
  let tick = 1
  for (const [path, text] of Object.entries(seed)) files.set(path, { text, mtimeMs: tick++ })
  const ok = (value: unknown) => ({ value }) as never
  on('fs.exists', (_, e) => ok(files.has(e.path) || dirs.has(e.path)))
  on('fs.stat', (_, e) => {
    const file = files.get(e.path)
    if (file) return ok({ kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false })
    const made = dirs.get(e.path)
    if (made !== undefined) return ok({ kind: 'dir', size: 0, mtimeMs: made, isLink: false })
    throw new Error(`ENOENT ${e.path}`)
  })
  on('fs.read', (_, e) => {
    const file = files.get(e.path)
    if (!file) throw new Error(`ENOENT ${e.path}`)
    return ok(file.text)
  })
  on('fs.write', (_, e) => {
    files.set(e.path, { text: e.text, mtimeMs: tick++ })
    return ok(undefined)
  })
  on('process.run', (_, e) => {
    const [cmd, path = '', to = ''] = e.argv
    if (cmd === '/bin/mv') {
      const file = files.get(path)
      if (file) {
        files.set(to, file)
        files.delete(path)
        return ok({ exitCode: 0, stdout: '', stderr: '' })
      }
      if (!dirs.has(path)) return ok({ exitCode: 1, stdout: '', stderr: 'No such file' })
      dirs.set(to, dirs.get(path)!)
      dirs.delete(path)
      return ok({ exitCode: 0, stdout: '', stderr: '' })
    }
    if (cmd === '/bin/rm') {
      const target = e.argv[2] ?? ''
      dirs.delete(target)
      for (const key of [...files.keys()]) if (key.startsWith(`${target}/`)) files.delete(key)
      return ok({ exitCode: 0, stdout: '', stderr: '' })
    }
    if (cmd === '/bin/mkdir' && path === '-p') return ok({ exitCode: 0, stdout: '', stderr: '' })
    if (cmd === '/bin/mkdir') {
      if (dirs.has(path)) return ok({ exitCode: 1, stdout: '', stderr: 'File exists' })
      dirs.set(path, Date.now())
      return ok({ exitCode: 0, stdout: '', stderr: '' })
    }
    return ok({ exitCode: 0, stdout: '', stderr: '' })
  })
  on('clock.sleep', () => {
    onSleep?.()
    return ok(undefined)
  })
  return { files, dirs, data: () => JSON.parse(files.get(`${DIR}/data.json`)!.text) }
}

/** Stands for what the plugins beneath ebb draw in the band. */
const engineBand = (on: On) =>
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const engine = (on: On) => {
  engineBand(on)
  mock.env(on, { HOME })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'ebb' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.close', () => ({ value: {} }) as never)
}

/** A typed `/ebb <args>` as the prompt hands it. */
const ebb = (args: string) => ({ command: 'ebb', args, origin: { kind: 'human' }, presentation: 'normal' }) as never

/** A small Spanish deck file, as `/ebb install` reads it. */
const deckFile = (
  notes: [string, string][] = [
    ['el corazón', 'heart'],
    ['la mano', 'hand'],
    ['hablar', 'to speak'],
    ['¿Qué tal?', 'How are you?'],
  ],
) =>
  JSON.stringify({
    id: 'es',
    name: 'Spanish',
    learn: 'Spanish',
    native: 'English',
    notes: notes.map(([front, back]) => ({ front, back })),
  })

/** Starts a session with a deck installed from a file. */
const withDeck = async ($: any, fs: ReturnType<typeof disk>) => {
  fs.files.set(`${HOME}/decks/es.json`, { text: deckFile(), mtimeMs: 0 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return $.command.run(ebb('install ~/decks/es.json'))
}

/** The band above the prompt, as the terminal mounts it. */
const BAND = {
  plugin: 'ebb',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

type Node = { type: string; props?: { bold?: boolean }; children?: (Node | string)[] }

const boldText = (node: Node | string): string | undefined => {
  if (typeof node === 'string') return undefined
  if (node.props?.bold) return node.children?.filter(c => typeof c === 'string').join('')

  return node.children?.map(boldText).find(Boolean)
}

/** The band's bold front, or undefined when the band draws none. */
const front = async (ui: any): Promise<string | undefined> => boldText(await ui.drawn())

/** Everything the band draws, as one string. */
const shown = async (ui: any): Promise<string> => JSON.stringify(await ui.drawn())

const PANE = {
  plugin: 'ebb',
  component: 'Pane',
  requestId: 'ebb',
  surface: 'terminal',
  props: {
    title: 'ebb',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('/ebb install adds a deck from a file or a URL, and again only what is new', async ($, on) => {
  engine(on)
  on(
    'http.fetch',
    (_, e) =>
      ({
        value: e.url.endsWith('/es.json')
          ? {
              status: 200,
              ok: true,
              headers: {},
              text: deckFile([
                ['el corazón', 'heart'],
                ['la casa', 'house'],
              ]),
            }
          : { status: 404, ok: false, headers: {}, text: '' },
      }) as never,
  )
  const fs = disk(on)
  expect((await withDeck($, fs)).text).toMatch(/Installed Spanish: 4 new notes/)
  expect(fs.data().decks.es.kinds).toEqual(['recognition', 'production'])
  expect((await $.command.run(ebb('install https://example.com/es.json'))).text).toMatch(/1 new notes/)
  expect((await $.command.run(ebb('install https://example.com/none.json'))).text).toMatch(/HTTP 404/)
  expect((await $.command.run(ebb('install ~/missing.json'))).text).toMatch(/No file/)
  expect((await $.command.run(ebb('decks'))).text).toMatch(/es — Spanish: 5 cards, 0 due, 5 new/)
  expect(fs.dirs.has(`${DIR}/lock`)).toBe(false)
})

test('without a deck the band says how to get one', async ($, on) => {
  engine(on)
  disk(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /\/ebb install/ })).toBeDefined()
  await ui.unmount()
})

test('Forgot grades once on a double press and shows the answer until Next', async ($, on) => {
  engine(on)
  const fs = disk(on)
  await withDeck($, fs)
  const ui = await $.ui.mount(BAND)
  const first = await front(ui)
  const notes = Object.values(fs.data().notes) as { front: string; back: string }[]
  const note = notes.find(n => n.front === first)!
  expect(note).toBeDefined()
  expect(await shown(ui)).not.toContain(note.back)

  await Promise.all([ui.press({ key: 'g1' }), ui.press({ key: 'g1' })])
  const cards = Object.values(fs.data().cards) as { reps: number }[]
  expect(cards.reduce((n, c) => n + c.reps, 0)).toBe(1)
  const log = [...fs.files.entries()].find(([p]) => p.includes('/log/'))!
  expect(JSON.parse(log[1].text).reviews).toHaveLength(1)
  expect(await front(ui)).toBe(first)
  expect(await shown(ui)).toContain(note.back)

  await ui.press({ key: 'next' })
  expect(await front(ui)).not.toBe(first)
  await ui.unmount()
})

test('Got it grades and brings the next card without the answer', async ($, on) => {
  engine(on)
  const fs = disk(on)
  await withDeck($, fs)
  const ui = await $.ui.mount(BAND)
  const first = await front(ui)
  const note = (Object.values(fs.data().notes) as { front: string; back: string }[]).find(n => n.front === first)!
  await ui.press({ key: 'g3' })
  const cards = Object.values(fs.data().cards) as { reps: number }[]
  expect(cards.reduce((n, c) => n + c.reps, 0)).toBe(1)
  expect(await front(ui)).not.toBe(first)
  expect(await shown(ui)).not.toContain(note.back)
  await ui.unmount()
})

test('a graded card never comes straight back, also in a deck of two', async ($, on) => {
  engine(on)
  const fs = disk(on)
  fs.files.set(`${HOME}/decks/es.json`, {
    text: deckFile([
      ['el corazón', 'heart'],
      ['la mano', 'hand'],
    ]),
    mtimeMs: 0,
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(ebb('install ~/decks/es.json'))
  const ui = await $.ui.mount(BAND)
  let last = await front(ui)
  for (let n = 0; n < 6; n++) {
    const isForgot = n % 2 === 0
    await ui.press({ key: isForgot ? 'g1' : 'g3' })
    if (isForgot) await ui.press({ key: 'next' })
    const next = await front(ui)
    expect(next).not.toBe(last)
    last = next
  }
  await ui.unmount()
})

test('the band alternates new cards with due ones', async ($, on) => {
  engine(on)
  const data = emptyData()
  ensureDeck(data, { id: 'es', name: 'Spanish', learn: 'Spanish', native: 'English' })
  const words = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis']
  addNotes(
    data,
    'es',
    words.map(w => ({ front: w, back: w })),
    'test',
    0,
  )
  // The first three were reviewed before and are due now; the other three are new.
  const now = Date.now()
  for (const id of Object.keys(data.cards).slice(0, 3)) {
    grade(data, id, 3, now - 10 * 86_400_000)
    data.cards[id]!.due = now - 1000
  }
  disk(on, { [`${DIR}/data.json`]: JSON.stringify(data) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  const shownWords: string[] = []
  for (let n = 0; n < 4; n++) {
    shownWords.push((await front(ui))!)
    await ui.press({ key: 'g3' })
  }
  await ui.unmount()
  const isNewWord = (w: string) => words.indexOf(w) >= 3
  expect(shownWords.map(isNewWord)).toEqual([true, false, true, false])
})

test('skip shows another card and changes no schedule', async ($, on) => {
  engine(on)
  const fs = disk(on)
  await withDeck($, fs)
  const ui = await $.ui.mount(BAND)
  const first = await front(ui)
  await ui.press({ key: 'skip' })
  expect(await front(ui)).not.toBe(first)
  const cards = Object.values(fs.data().cards) as { reps: number }[]
  expect(cards.reduce((n, c) => n + c.reps, 0)).toBe(0)
  await ui.unmount()
})

test('pause hides the band, and a survey has the band to itself', async ($, on) => {
  engine(on)
  const fs = disk(on)
  await withDeck($, fs)
  const survey = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await shown(survey)).toContain('engine')
  await survey.unmount()
  await $.command.run(ebb('pause 1h'))
  const ui = await $.ui.mount(BAND)
  expect(await shown(ui)).toContain('engine')
  await ui.unmount()
})

test('the band keeps what other plugins draw there and puts the card under it', async ($, on) => {
  engine(on)
  const fs = disk(on)
  await withDeck($, fs)
  const ui = await $.ui.mount(BAND)
  const text = await shown(ui)
  expect(text).toContain('engine')
  expect(await front(ui)).toBeDefined()
  expect(text.indexOf('engine')).toBeLessThan(text.indexOf((await front(ui))!))
  await ui.unmount()
})

test('the footer button hides the band and shows it again, also in the next session', async ($, on) => {
  engine(on)
  on('ui.render', { component: 'SessionMode' }, () => ({ type: 'Text', props: {}, children: [] }) as never)
  const fs = disk(on)
  await withDeck($, fs)
  const footer = await $.ui.mount({ ...BAND, component: 'SessionMode', requestId: 'footer', props: { modes: [] } })
  await footer.press({ key: 'ebb-band' })
  const hidden = await $.ui.mount(BAND)
  expect(await shown(hidden)).toContain('engine')
  await hidden.unmount()

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const again = await $.ui.mount(BAND)
  expect(await shown(again)).toContain('engine')
  await again.unmount()

  await footer.press({ key: 'ebb-band' })
  const back = await $.ui.mount(BAND)
  expect(await front(back)).toBeDefined()
  await back.unmount()
  await footer.unmount()
})

test('a stale lock of a dead session is taken over', async ($, on) => {
  engine(on)
  const fs = disk(on)
  await withDeck($, fs)
  fs.dirs.set(`${DIR}/lock`, Date.now() - 60_000)
  expect((await $.command.run(ebb('pause 1h'))).text).toMatch(/Paused until/)
  expect(fs.data().meta.pausedUntil).toBeGreaterThan(Date.now())
  expect(fs.dirs.has(`${DIR}/lock`)).toBe(false)
})

test('a write waits while another session holds the lock', async ($, on) => {
  engine(on)
  let sleeps = 0
  const fs = disk(on, {}, () => {
    if (++sleeps === 3) fs.dirs.delete(`${DIR}/lock`)
  })
  await withDeck($, fs)
  fs.dirs.set(`${DIR}/lock`, Date.now())
  expect((await $.command.run(ebb('pause 1h'))).text).toMatch(/Paused until/)
  expect(sleeps).toBeGreaterThanOrEqual(3)
})

/** Answers model calls in order. */
const replies = (on: On, ...texts: (string | null)[]) => {
  let call = 0
  on('model.complete', () => {
    const text = texts[call++]
    return (
      text === null || text === undefined
        ? { value: { isAnswered: false, reason: 'api-error', status: 529, error: {}, usage: {} } }
        : { value: { isAnswered: true, text, usage: {} } }
    ) as never
  })
}

const waitForList = async (ui: any) => {
  for (let i = 0; i < 20 && !(await ui.find({ type: 'Button', text: /Add ticked/ })); i++) await ui.advance(10)
}

test('/ebb add flags a bad back-translation and adds only ticked notes', async ($, on) => {
  engine(on)
  replies(
    on,
    '{"notes":[{"front":"el chiringuito","back":"пляжный бар"},{"front":"la caña","back":"бокал пива"}]}',
    '{"fronts":["el chiringuito","la cerveza"]}',
  )
  const fs = disk(on)
  await withDeck($, fs)
  await $.command.run(ebb('add бар'))
  const ui = await $.ui.mount(PANE)
  await waitForList(ui)
  expect((await ui.find({ type: 'Button', text: /caña/ }))?.text).toMatch(/\[ \].*⚠/)
  await ui.press({ key: 'add' })
  await ui.unmount()
  const fronts = (Object.values(fs.data().notes) as { front: string }[]).map(n => n.front)
  expect(fronts).toContain('el chiringuito')
  expect(fronts).not.toContain('la caña')
})

test('/ebb add with a failed back-translation ticks nothing and says so', async ($, on) => {
  engine(on)
  replies(on, '{"notes":[{"front":"el chiringuito","back":"пляжный бар"}]}', null)
  const fs = disk(on)
  await withDeck($, fs)
  await $.command.run(ebb('add бар'))
  const ui = await $.ui.mount(PANE)
  await waitForList(ui)
  expect(await ui.find({ type: 'Text', text: /back-translation failed/ })).toBeDefined()
  expect((await ui.find({ type: 'Button', text: /chiringuito/ }))?.text).toMatch(/\[ \]/)
  await ui.unmount()
})

test('a first /ebb add takes the languages from the request and makes a language deck', async ($, on) => {
  engine(on)
  replies(
    on,
    '{"id":"italian","name":"Italian","learn":"Italian","native":"Russian"}',
    '{"notes":[{"front":"il gatto","back":"кот"}]}',
    '{"fronts":["il gatto"]}',
  )
  const fs = disk(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(ebb('add итальянские животные'))
  const ui = await $.ui.mount(PANE)
  await waitForList(ui)
  await ui.press({ key: 'add' })
  await ui.unmount()
  const deck = fs.data().decks.italian
  expect([deck.learn, deck.native, deck.kinds]).toEqual(['Italian', 'Russian', ['recognition', 'production']])
})

test('when the person’s language is unclear, the pane asks once', async ($, on) => {
  engine(on)
  replies(
    on,
    '{"id":"spanish","name":"Spanish","learn":"Spanish","native":null}',
    '{"notes":[{"front":"el perro","back":"dog"}]}',
    '{"fronts":["el perro"]}',
  )
  const fs = disk(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(ebb('add spanish animals'))
  const ui = await $.ui.mount(PANE)
  for (let i = 0; i < 20 && !(await ui.find({ key: 'native' })); i++) await ui.advance(10)
  await ui.input({ key: 'native', text: 'English', submit: true } as never)
  await waitForList(ui)
  await ui.press({ key: 'add' })
  await ui.unmount()
  expect(fs.data().decks.spanish.native).toBe('English')
})

test('a cancelled first /ebb add leaves no deck behind', async ($, on) => {
  engine(on)
  replies(
    on,
    '{"id":"k8s","name":"Kubernetes","learn":null,"native":null}',
    '{"notes":[{"front":"What restarts a crashed pod?","back":"its controller"}]}',
  )
  const fs = disk(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(ebb('add @k8s pods'))
  const ui = await $.ui.mount(PANE)
  await waitForList(ui)
  await ui.press({ key: 'cancel' })
  await ui.unmount()
  expect(fs.files.has(`${DIR}/data.json`) ? Object.keys(fs.data().decks) : []).toEqual([])
})

test('/ebb add @deck makes a deck of facts that asks one way', async ($, on) => {
  engine(on)
  replies(
    on,
    '{"id":"k8s","name":"Kubernetes","learn":null,"native":null}',
    '{"notes":[{"front":"What restarts a crashed pod?","back":"its controller"}]}',
  )
  const fs = disk(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(ebb('add @k8s pods'))
  const ui = await $.ui.mount(PANE)
  await waitForList(ui)
  await ui.press({ key: 'add' })
  await ui.unmount()
  const data = fs.data()
  expect(data.decks.k8s.kinds).toEqual(['recognition'])
  expect((Object.values(data.notes) as { deck: string }[]).filter(n => n.deck === 'k8s')).toHaveLength(1)
})

test('after /clear the band still shows its card', async ($, on) => {
  engine(on)
  // A /clear starts a new conversation: its state values are unwritten, and no session.start fires.
  let isCleared = false
  on('state.get', (_, e, next) =>
    isCleared && e.plugin === 'ebb' ? ({ value: { value: undefined, version: 0 } } as never) : next(e),
  )
  const fs = disk(on)
  await withDeck($, fs)
  const before = await $.ui.mount(BAND)
  const card = await front(before)
  await before.unmount()

  isCleared = true

  const after = await $.ui.mount(BAND)
  expect(await front(after)).toBe(card)
  await after.unmount()
})

test('after /clear a band the person hid stays hidden', async ($, on) => {
  engine(on)
  let isCleared = false
  on('state.get', (_, e, next) =>
    isCleared && e.plugin === 'ebb' ? ({ value: { value: undefined, version: 0 } } as never) : next(e),
  )
  on('ui.render', { component: 'SessionMode' }, () => ({ type: 'Text', props: {}, children: [] }) as never)
  const fs = disk(on)
  await withDeck($, fs)
  const footer = await $.ui.mount({ ...BAND, component: 'SessionMode', requestId: 'footer', props: { modes: [] } })
  await footer.press({ key: 'ebb-band' })
  await footer.unmount()

  isCleared = true

  const after = await $.ui.mount(BAND)
  expect(await shown(after)).toContain('engine')
  expect(await front(after)).toBeUndefined()
  await after.unmount()
})
