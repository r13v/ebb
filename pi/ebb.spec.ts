// The extension runs in a real pi session from the SDK: pi's own runner loads it, dispatches its
// command, events and shortcuts, and its model calls go to pi's faux provider. Only the terminal is
// a stand-in, typed by pi's `ExtensionUIContext`, as pi's own test suite does it.

import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FauxProviderRegistration, fauxAssistantMessage, registerFauxProvider } from '@earendil-works/pi-ai/compat'
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionUIContext,
  initTheme,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type Theme,
} from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences } from '@earendil-works/pi-tui'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createSession, type Host } from '../core/ebb'
import { fileHost } from './host'

const DECK = JSON.stringify({
  id: 'es',
  name: 'Spanish',
  learn: 'Spanish',
  native: 'English',
  notes: [
    { front: 'el corazón', back: 'heart' },
    { front: 'la mano', back: 'hand' },
  ],
})

let dir: string
let faux: FauxProviderRegistration

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ebb-'))
  await writeFile(join(dir, 'es.json'), DECK)
  vi.stubEnv('XDG_DATA_HOME', dir)
  vi.resetModules()
  faux = registerFauxProvider()
})

afterEach(() => {
  faux.unregister()
  vi.unstubAllEnvs()
})

/** What the extension drew: the band above the editor and the notices. */
type Screen = { band?: string[]; notes: string[] }

/** A terminal that draws nothing; every member pi's UI context has, so a change of that contract fails the type check. */
const uiStub = (theme: Theme): ExtensionUIContext => ({
  select: async () => undefined,
  confirm: async () => false,
  input: async () => undefined,
  notify: () => undefined,
  onTerminalInput: () => () => undefined,
  setStatus: () => undefined,
  setWorkingMessage: () => undefined,
  setWorkingVisible: () => undefined,
  setWorkingIndicator: () => undefined,
  setHiddenThinkingLabel: () => undefined,
  setWidget: () => undefined,
  setFooter: () => undefined,
  setHeader: () => undefined,
  setTitle: () => undefined,
  custom: async () => undefined as never,
  pasteToEditor: () => undefined,
  setEditorText: () => undefined,
  getEditorText: () => '',
  editor: async () => undefined,
  addAutocompleteProvider: () => undefined,
  setEditorComponent: () => undefined,
  getEditorComponent: () => undefined,
  theme,
  getAllThemes: () => [],
  getTheme: () => undefined,
  setTheme: () => ({ success: false, error: 'no themes in tests' }),
  getToolsExpanded: () => false,
  setToolsExpanded: () => undefined,
})

/** The terminal: draws the band, keeps the notices, and drives the list of `/ebb add` with `keys`. */
const terminal = (screen: Screen, theme: Theme, keys: string[]): Partial<ExtensionUIContext> => ({
  setWidget: ((_key: string, lines: string[] | undefined) => {
    screen.band = lines?.map(stripTerminalSequences)
  }) as ExtensionUIContext['setWidget'],
  notify: text => void screen.notes.push(text),
  custom: async factory => {
    let result: unknown
    let isDone = false
    const tui = { requestRender: () => undefined }
    const component = await factory(tui as never, theme, undefined as never, value => {
      result = value
      isDone = true
    })
    for (let i = 0; i < 50 && !component.render(80).some(line => line.includes('add ticked')); i++)
      await new Promise(resolve => setTimeout(resolve, 10))
    for (const key of keys) if (!isDone) component.handleInput?.(key)
    return result as never
  },
})

/** A pi session with the extension of this checkout, loaded as pi loads it. */
const startPi = async (keys: string[] = []) => {
  const screen: Screen = { notes: [] }
  const { default: ebb } = await import('./index')
  const settingsManager = SettingsManager.inMemory()
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    noExtensions: true,
    extensionFactories: [ebb],
  })
  await resourceLoader.reload()
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null })
  // The faux models as a provider with a key, as an extension's `pi.registerProvider` adds one.
  const model = faux.getModel()
  modelRuntime.registerProvider(model.provider, {
    baseUrl: model.baseUrl,
    apiKey: 'faux',
    api: faux.api,
    models: faux.models.map(m => ({
      id: m.id,
      name: m.name,
      api: m.api,
      reasoning: m.reasoning,
      input: m.input,
      cost: m.cost,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    })),
  })
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    model,
    modelRuntime,
    settingsManager,
    sessionManager: SessionManager.inMemory(dir),
    resourceLoader,
    noTools: 'all',
  })
  // pi's own theme, as its runner hands it to an extension; interactive mode loads it at start.
  initTheme('dark')
  const { theme } = session.extensionRunner.createContext().ui
  await session.bindExtensions({ uiContext: { ...uiStub(theme), ...terminal(screen, theme, keys) }, mode: 'tui' })

  return { session, screen, press: (key: string) => press(session, key) }
}

/**
 * A shortcut as pi's interactive mode runs it. The SDK does not export pi's built-in keybindings, so
 * a clash with one is not checked here; `pi.registerShortcut` reports it at load.
 */
const press = async (session: AgentSession, key: string) => {
  const runner = session.extensionRunner
  const shortcut = runner.getShortcuts({}).get(key as never)
  if (!shortcut) throw new Error(`no shortcut ${key}`)
  await shortcut.handler(runner.createContext())
}

const readData = async () => JSON.parse(await readFile(join(dir, 'ebb', 'data.json'), 'utf8'))

const reps = async () =>
  Object.values((await readData()).cards as Record<string, { reps: number }>).reduce((n, c) => n + c.reps, 0)

test('a shortcut grades the card in the band, and the schedule and the log are saved', async () => {
  const pi = await startPi()
  await pi.session.prompt(`/ebb install ${join(dir, 'es.json')}`)
  const first = pi.screen.band?.[0]
  expect(first).toMatch(/alt\+r Forgot {2}alt\+g Got it {2}alt\+s Skip/)

  await pi.press('alt+r')
  expect(pi.screen.band?.[0]).toMatch(/— (heart|hand).*alt\+r Next/)
  await pi.press('alt+g') // Got it does nothing while the answer is open
  await pi.press('alt+r')
  expect(pi.screen.band?.[0]).not.toBe(first)

  expect(await reps()).toBe(1)
  const [month] = await readdir(join(dir, 'ebb', 'log'))
  expect(await readdir(join(dir, 'ebb', 'log', month!))).toHaveLength(1)
})

test('the band stays hidden in the next session and takes no grade', async () => {
  const pi = await startPi()
  await pi.session.prompt(`/ebb install ${join(dir, 'es.json')}`)
  await pi.press('alt+h')
  expect(pi.screen.band).toBeUndefined()

  vi.resetModules()
  const next = await startPi()
  expect(next.screen.band).toBeUndefined()
  await next.press('alt+g')
  expect(await reps()).toBe(0)
})

test('/ebb add writes notes with the session model and adds the ticked ones', async () => {
  const pi = await startPi(['2', 'a'])
  await pi.session.prompt(`/ebb install ${join(dir, 'es.json')}`)
  faux.setResponses([
    fauxAssistantMessage('{"notes":[{"front":"el perro","back":"dog"},{"front":"el gato","back":"cat"}]}'),
    fauxAssistantMessage('{"fronts":["el perro","el gato"]}'),
  ])

  await pi.session.prompt('/ebb add animals')

  const fronts = Object.values((await readData()).notes as Record<string, { front: string }>).map(n => n.front)
  expect(fronts).toContain('el perro')
  expect(fronts).not.toContain('el gato')
  expect(pi.screen.notes.at(-1)).toMatch(/notes added: 1/)
})

test('a card that came due takes the band at the end of a turn', async () => {
  const pi = await startPi()
  await pi.session.prompt(`/ebb install ${join(dir, 'es.json')}`)
  const data = await readData()
  const ids = Object.keys(data.cards)
  for (const id of ids) data.cards[id].state = 2
  data.cards[ids[1]!].due = Date.now() - 1000
  data.cards[ids[0]!].due = Date.now() + 86_400_000
  await writeFile(join(dir, 'ebb', 'data.json'), JSON.stringify(data))
  faux.setResponses([fauxAssistantMessage('ok')])

  await pi.session.prompt('hola')

  expect(pi.screen.band?.[0]).toMatch(/^la mano/)
})

test('two sessions that write at once keep both changes', async () => {
  const host = (): Host => ({
    ...fileHost(dir, join(dir, 'ebb')),
    complete: async () => ({ error: 'none' }),
    showBand: async () => undefined,
  })
  const other = DECK.replace('"es"', '"it"').replace('Spanish', 'Italian')
  await writeFile(join(dir, 'it.json'), other)
  const run = (file: string) => createSession().runCommand(host(), `install ${join(dir, file)}`, async () => '')

  await Promise.all([run('es.json'), run('it.json')])

  const data = await readData()
  expect(Object.keys(data.decks).sort()).toEqual(['es', 'it'])
  expect(await readdir(join(dir, 'ebb'))).not.toContain('lock')
})
