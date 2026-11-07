import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/u'
const DIR = `${HOME}/.claude/ebb`

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

const engine = (on: On) => {
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

/** Stands for the engine's spinner and turn line, which draw what they are handed. */
const drawsWords = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{String((e.props as { word?: string }).word ?? '')}</Text>
  })

/** One whole turn: prompt, spinner, turn line, end. Returns the spinner's word and the turn line. (The kit exports no type for `$`.) */
const turn = async ($: any, n: number) => {
  await $.prompt.submit(typed(`task ${n}`))
  await $.turn.start({ text: `task ${n}`, turnId: `t${n}` })
  const spinner = await $.ui.mount({ ...SPINNER, surface: 'terminal' })
  const word = (await spinner.find({ type: 'Text' }))?.text ?? ''
  await spinner.unmount()
  const row = await $.ui.mount({ plugin: 'ebb', component: 'TurnDuration', requestId: `row-${n}`, surface: 'terminal', props: { word: 'Baked', durationMs: 1000 } })
  const line: string = (await row.find({ type: 'Text' }))?.text ?? ''
  await row.unmount()
  await $.turn.complete({ turnId: `t${n}`, answer: '', durationMs: 1000, isAborted: false, reason: 'answer' } as never)
  return { word, line }
}

/** A prompt as the person typed it. */
const typed = (text: string) => ({ text, origin: { kind: 'human' }, wait: false }) as never

/** A typed `/ebb <args>` as the prompt hands it. */
const ebb = (args: string) => ({ command: 'ebb', args, origin: { kind: 'human' }, presentation: 'normal' }) as never

const SPINNER = { plugin: 'ebb', component: 'Spinner', requestId: 'main', props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' } } as const

/** Starts a session with the bundled Spanish deck added through `/ebb deck`. */
const withDeck = async ($: any) => {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return $.command.run(ebb('deck es-ru'))
}

const PANE = { plugin: 'ebb', component: 'Pane', requestId: 'ebb', surface: 'terminal', props: { title: 'ebb', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const

test('/ebb deck lists the bundled decks and adds one; a later start leaves the file alone', async ($, on) => {
  engine(on)
  const fs = disk(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(ebb('deck'))).text).toMatch(/  es-ru — /)
  expect((await $.command.run(ebb('deck es-ru'))).text).toMatch(/Added .*: \d{4} notes/)
  expect(fs.data().decks['es-ru'].native).toBe('Russian')
  expect((await $.command.run(ebb('deck'))).text).toMatch(/✓ es-ru/)
  expect(fs.dirs.has(`${DIR}/lock`)).toBe(false)
  const written = fs.files.get(`${DIR}/data.json`)!.mtimeMs
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(fs.files.get(`${DIR}/data.json`)!.mtimeMs).toBe(written)
})

test('without a deck the spinner stays as it is and one turn line says how to get one', async ($, on) => {
  engine(on)
  drawsWords(on)
  disk(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const lines: string[] = []
  for (let n = 0; n < 2; n++) {
    const { word, line } = await turn($, n)
    expect(word).toBe('Sauteing')
    lines.push(line)
  }
  expect(lines.filter(l => l.includes('/ebb deck'))).toHaveLength(1)
})

test('a turn puts a card in the spinner and its answer on the turn line', async ($, on) => {
  engine(on)
  drawsWords(on)
  const fs = disk(on)
  await withDeck($)
  await $.prompt.submit(typed('fix the build'))
  await $.turn.start({ text: 'fix the build', turnId: 't1' })
  const spinner = await $.ui.mount({ ...SPINNER, surface: 'terminal' })
  const word = (await spinner.find({ type: 'Text' }))?.text ?? ''
  await spinner.unmount()
  const shown = (Object.values(fs.data().notes) as { front: string; back: string }[]).find(n => word === n.front)
  expect(shown).toBeDefined()

  const line = await $.ui.mount({ plugin: 'ebb', component: 'TurnDuration', requestId: 'row-1', surface: 'terminal', props: { word: 'Baked', durationMs: 3000 } })
  const text = (await line.find({ type: 'Text' }))?.text ?? ''
  expect(text).toContain(`${shown!.front} — ${shown!.back}`)
  expect(text).toContain('Baked for 3s')
  await line.unmount()

  const logs = [...fs.files.keys()].filter(p => p.startsWith(`${DIR}/log/`))
  expect(JSON.parse(fs.files.get(logs[0]!)!.text).exposures).toHaveLength(1)
})

test('a subagent turn changes nothing', async ($, on) => {
  engine(on)
  const fs = disk(on)
  await withDeck($)
  await $.turn.start({ text: 'x', turnId: 't2', agentId: 'a1' })
  expect([...fs.files.keys()].some(p => p.includes('/log/'))).toBe(false)
})

test('two turns in a row never show the same card', async ($, on) => {
  engine(on)
  drawsWords(on)
  const fs = disk(on)
  await withDeck($)
  const words: string[] = []
  for (let n = 0; n < 12; n++) words.push((await turn($, n)).word)
  for (let i = 1; i < words.length; i++) expect(words[i]).not.toBe(words[i - 1])
})

test('a prompt queued during a turn keeps that turn’s card', async ($, on) => {
  engine(on)
  drawsWords(on)
  const fs = disk(on)
  await withDeck($)
  await $.prompt.submit(typed('first'))
  await $.turn.start({ text: 'first', turnId: 'q1' })
  const before = await $.ui.mount({ ...SPINNER, surface: 'terminal' })
  const a = (await before.find({ type: 'Text' }))?.text
  await before.unmount()
  await $.prompt.submit(typed('queued'))
  const after = await $.ui.mount({ ...SPINNER, surface: 'terminal' })
  expect((await after.find({ type: 'Text' }))?.text).toBe(a)
  await after.unmount()
})

test('the study pane reveals, grades once on a double press, and logs the review', async ($, on) => {
  engine(on)
  const fs = disk(on)
  await withDeck($)
  await $.command.run(ebb(''))
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', text: /Show answer/ })).toBeDefined()
  await ui.press({ key: 'reveal' })
  expect(await ui.find({ type: 'Button', text: /Good/ })).toBeDefined()
  await Promise.all([ui.press({ key: 'g3' }), ui.press({ key: 'g3' })])
  await ui.unmount()
  const cards = Object.values(fs.data().cards) as { reps: number }[]
  expect(cards.reduce((n, c) => n + c.reps, 0)).toBe(1)
  const log = [...fs.files.entries()].find(([p]) => p.includes('/log/'))!
  expect(JSON.parse(log[1].text).reviews).toHaveLength(1)
})

test('the card just graded Again does not come straight back', async ($, on) => {
  engine(on)
  disk(on)
  await withDeck($)
  await $.command.run(ebb(''))
  const ui = await $.ui.mount(PANE)
  const first = (await ui.find({ type: 'Text', bold: true } as never))?.text
  await ui.press({ key: 'reveal' })
  await ui.press({ key: 'g1' })
  expect((await ui.find({ type: 'Text', bold: true } as never))?.text).not.toBe(first)
  await ui.unmount()
})

test('a stale lock of a dead session is taken over', async ($, on) => {
  engine(on)
  const fs = disk(on)
  await withDeck($)
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
  await withDeck($)
  fs.dirs.set(`${DIR}/lock`, Date.now())
  expect((await $.command.run(ebb('pause 1h'))).text).toMatch(/Paused until/)
  expect(sleeps).toBeGreaterThanOrEqual(3)
})

/** Answers model calls in order. */
const replies = (on: On, ...texts: (string | null)[]) => {
  let call = 0
  on('model.complete', () => {
    const text = texts[call++]
    return (text === null || text === undefined
      ? { value: { isAnswered: false, reason: 'api-error', status: 529, error: {}, usage: {} } }
      : { value: { isAnswered: true, text, usage: {} } }) as never
  })
}

const waitForList = async (ui: any) => {
  for (let i = 0; i < 20 && !(await ui.find({ type: 'Button', text: /Add ticked/ })); i++) await ui.advance(10)
}

test('/ebb add flags a bad back-translation and adds only ticked notes', async ($, on) => {
  engine(on)
  replies(on, '{"notes":[{"front":"el chiringuito","back":"пляжный бар"},{"front":"la caña","back":"бокал пива"}]}', '{"fronts":["el chiringuito","la cerveza"]}')
  const fs = disk(on)
  await withDeck($)
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
  disk(on)
  await withDeck($)
  await $.command.run(ebb('add бар'))
  const ui = await $.ui.mount(PANE)
  await waitForList(ui)
  expect(await ui.find({ type: 'Text', text: /back-translation failed/ })).toBeDefined()
  expect((await ui.find({ type: 'Button', text: /chiringuito/ }))?.text).toMatch(/\[ \]/)
  await ui.unmount()
})

test('a first /ebb add takes the languages from the request and makes a language deck', async ($, on) => {
  engine(on)
  replies(on, '{"id":"italian","name":"Italian","learn":"Italian","native":"Russian"}', '{"notes":[{"front":"il gatto","back":"кот"}]}', '{"fronts":["il gatto"]}')
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
  replies(on, '{"id":"spanish","name":"Spanish","learn":"Spanish","native":null}', '{"notes":[{"front":"el perro","back":"dog"}]}', '{"fronts":["el perro"]}')
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
  replies(on, '{"id":"k8s","name":"Kubernetes","learn":null,"native":null}', '{"notes":[{"front":"What restarts a crashed pod?","back":"its controller"}]}')
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
  replies(on, '{"id":"k8s","name":"Kubernetes","learn":null,"native":null}', '{"notes":[{"front":"What restarts a crashed pod?","back":"its controller"}]}')
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
