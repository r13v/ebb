// The files, the clock and the network of the shared session (`core/ebb.ts`) on Node, as pi runs it.

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Host } from '../core/ebb'

type Files = Omit<Host, 'complete' | 'showBand'>

const isOk = (work: Promise<unknown>) =>
  work.then(
    () => true,
    () => false,
  )

export const fileHost = (home: string, dir: string): Files => ({
  home,
  dir,
  exists: path => isOk(stat(path)),
  read: path => readFile(path, 'utf8'),
  write: async (path, text) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  },
  mtimeMs: async path => (await stat(path)).mtimeMs,
  mkdir: path => isOk(mkdir(path)),
  mkdirp: async path => void (await mkdir(path, { recursive: true })),
  rename: (from, to) => isOk(rename(from, to)),
  remove: path => rm(path, { recursive: true, force: true }),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  fetch: async url => {
    const r = await fetch(url)
    return { ok: r.ok, status: r.status, text: await r.text() }
  },
})
