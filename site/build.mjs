// Builds the GitHub Pages site into _site/: one page that lists every deck in decks/
// with a button that copies its install command. Run: node site/build.mjs

import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const out = join(root, '_site')
mkdirSync(join(out, 'decks'), { recursive: true })

const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const decks = readdirSync(join(root, 'decks'))
  .filter(f => f.endsWith('.json'))
  .sort()
  .map(file => {
    copyFileSync(join(root, 'decks', file), join(out, 'decks', file))
    const d = JSON.parse(readFileSync(join(root, 'decks', file), 'utf8'))
    return { file, ...d }
  })

// Cards for the band demo: short fronts from every deck.
const demo = decks.flatMap(d =>
  d.notes
    .filter(n => n.front.length <= 22)
    .slice(0, 40)
    .map(n => [n.front, n.back.split(';')[0].trim(), n.hint ?? '']),
)

const deckCard = d => `
      <article class="deck">
        <header>
          <h3>${esc(d.name)}</h3>
          ${d.learn ? `<p class="langs"><span>${esc(d.learn)}</span><span class="arrow">→</span><span>${esc(d.native)}</span></p>` : ''}
        </header>
        ${d.description ? `<p class="desc">${esc(d.description)}</p>` : ''}
        <ul class="sample">
          ${d.notes
            .slice(0, 6)
            .map(n => `<li><b>${esc(n.front)}</b><span>${esc(n.back.split(';')[0])}</span></li>`)
            .join('')}
        </ul>
        <footer>
          <span class="count">${d.notes.length.toLocaleString('en')} notes</span>
          <button class="copy" data-copy-deck="${esc(d.file)}">Copy install command</button>
        </footer>
        <code class="cmd" data-cmd-deck="${esc(d.file)}">/ebb install …/decks/${esc(d.file)}</code>
      </article>`

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ebb — learn while Claude thinks</title>
<meta name="description" content="ebb is a Claude Code plugin for spaced repetition: one card above the prompt, revealed and graded while Claude works.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #fbf6f2; --surface: #ffffff; --ink: #1d1714; --muted: #6f625b; --line: #eadfd8;
  --accent: #d9432f; --accent-ink: #ffffff; --accent-soft: #fbe3dd;
  --term: #1b1513; --term-ink: #f3e9e3; --term-dim: #8f807a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #140f0d; --surface: #1d1714; --ink: #f4ebe6; --muted: #a8988f; --line: #2f2621;
    --accent: #ff6a52; --accent-ink: #1a0c08; --accent-soft: #3a1c16;
    --term: #0d0908; --term-ink: #f3e9e3; --term-dim: #7d6e68;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 Inter, system-ui, sans-serif; }
a { color: var(--accent); }
code, pre, .mono { font-family: "JetBrains Mono", ui-monospace, monospace; }
.wrap { max-width: 1040px; margin: 0 auto; padding: 0 16px; }

/* top */
.top { display: flex; align-items: center; justify-content: space-between; padding: 22px 0; }
.logo { display: flex; align-items: center; gap: 10px; font: 700 26px/1 Fraunces, serif; letter-spacing: -0.02em; color: var(--ink); text-decoration: none; }
.logo svg { width: 34px; height: 34px; }
.top nav a { color: var(--muted); text-decoration: none; margin-left: 22px; font-weight: 500; }
.top nav a:hover { color: var(--ink); }

/* hero */
.hero { display: grid; grid-template-columns: 1.05fr 1fr; gap: 48px; align-items: center; padding: 48px 0 72px; }
.hero > *, .make > *, .decks > *, .steps > * { min-width: 0; }
h1 { font: 700 clamp(40px, 6vw, 68px)/1.02 Fraunces, serif; letter-spacing: -0.03em; margin: 0 0 20px; }
h1 em { font-style: normal; color: var(--accent); }
.lead { font-size: 19px; color: var(--muted); margin: 0 0 28px; max-width: 34em; }
.install { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 6px; }
.install .row { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; }
.install .row + .row { border-top: 1px solid var(--line); }
.install code { flex: 1; min-width: 0; font-size: 14px; overflow-x: auto; white-space: nowrap; }
.install code::before { content: "$ "; color: var(--muted); }
button.copy { flex: none; border: 0; border-radius: 9px; background: var(--accent); color: var(--accent-ink); font: 600 13px Inter, sans-serif; padding: 9px 14px; cursor: pointer; transition: transform .15s ease, filter .15s ease; }
button.copy:hover { filter: brightness(1.08); }
button.copy:active { transform: scale(.97); }
button.copy.done { background: var(--ink); color: var(--bg); }
.small { font-size: 14px; color: var(--muted); margin-top: 12px; }

/* terminal */
.term { background: var(--term); color: var(--term-ink); border-radius: 16px; padding: 18px 20px 22px; font: 14px/1.7 "JetBrains Mono", monospace; box-shadow: 0 30px 60px -30px rgba(80, 20, 10, .45); min-height: 280px; }
.term .dots { display: flex; gap: 7px; margin-bottom: 16px; }
.term .dots i { width: 11px; height: 11px; border-radius: 50%; background: #3a2f2b; }
.term .dots i:first-child { background: var(--accent); }
.term .you { color: var(--term-dim); }
.term .you b { color: var(--term-ink); font-weight: 400; }
.term .tool { margin: 10px 0 0; color: var(--term-dim); }
.term .tool b { color: var(--term-ink); font-weight: 400; }
.term .reply { margin: 10px 0 12px; }
.term .spin { color: var(--accent); }
.term .word { color: var(--term-ink); font-weight: 500; }
.term .meta { color: var(--term-dim); }
.term .band { margin-top: 14px; color: var(--term-dim); }
.term .band b { color: var(--term-ink); font-weight: 500; }
.term .band .btn { color: var(--term-ink); margin-left: 10px; }
.term .band .sep { margin-left: 10px; }
.term .band .btn i { color: var(--accent); font-style: normal; }
.term .grades { display: none; }
.term .band.on .grades { display: block; }
.term .band.on .ask { display: none; }
.term .prompt { margin-top: 6px; padding-top: 6px; border-top: 1px solid #3a2f2b; color: var(--term-dim); display: flex; justify-content: space-between; }
.term .hint { color: var(--term-dim); }

/* sections */
section { padding: 56px 0; border-top: 1px solid var(--line); }
h2 { font: 700 34px/1.1 Fraunces, serif; letter-spacing: -0.02em; margin: 0 0 10px; }
.sub { color: var(--muted); margin: 0 0 32px; max-width: 40em; }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.step { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 22px; }
.step .n { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-weight: 600; margin-bottom: 12px; }
.step h3 { margin: 0 0 6px; font-size: 18px; }
.step p { margin: 0; color: var(--muted); font-size: 15px; }
.step code { font-size: 13px; color: var(--ink); }

.decks { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 18px; }
.deck { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 22px; display: flex; flex-direction: column; gap: 14px; }
.deck h3 { margin: 0; font: 600 20px/1.25 Fraunces, serif; }
.langs { margin: 6px 0 0; display: flex; gap: 8px; align-items: center; font-size: 13px; }
.langs span:not(.arrow) { background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: 2px 10px; font-weight: 500; }
.langs .arrow { color: var(--muted); }
.desc { margin: 0; color: var(--muted); font-size: 15px; }
.sample { list-style: none; margin: 0; padding: 0; border-top: 1px dashed var(--line); }
.sample li { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px dashed var(--line); font-size: 14px; }
.sample b { font-weight: 600; }
.sample span { color: var(--muted); text-align: right; }
.deck footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: auto; }
.count { color: var(--muted); font-size: 14px; }
.cmd { display: block; font-size: 12px; color: var(--muted); overflow-x: auto; white-space: nowrap; }

.make { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
pre { margin: 0; background: var(--term); color: var(--term-ink); border-radius: 14px; padding: 18px 20px; font-size: 13.5px; line-height: 1.65; overflow-x: auto; }
pre .c { color: var(--term-dim); }
pre .k { color: var(--accent); }

.foot { padding: 36px 0 56px; color: var(--muted); font-size: 14px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

@media (max-width: 820px) {
  .hero, .make { grid-template-columns: 1fr; }
  .steps { grid-template-columns: 1fr; }
  .top nav a:not(:last-child) { display: none; }
  .hero { padding-top: 20px; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <a class="logo" href="#">
      <svg viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="17" fill="var(--accent)"/><path d="M6 19c3.5-4 7.5-4 11 0s7.5 4 11 0" stroke="var(--accent-ink)" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M6 13c3.5-4 7.5-4 11 0s7.5 4 11 0" stroke="var(--accent-ink)" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".55"/></svg>
      ebb
    </a>
    <nav><a href="#decks">Decks</a><a href="#make">Make a deck</a><a href="https://github.com/r13v/ebb">GitHub</a></nav>
  </div>

  <div class="hero">
    <div>
      <h1>Learn while <em>Claude</em> thinks.</h1>
      <p class="lead">ebb is a Claude Code plugin for spaced repetition. One card waits above the prompt. Grade it while Claude works; skip it when you are busy, or hide the band with the <code>🌊 ebb</code> button under the prompt. Nothing ever interrupts you.</p>
      <div class="install">
        <div class="row"><code>claude plugin marketplace add r13v/ebb</code><button class="copy" data-copy="claude plugin marketplace add r13v/ebb">Copy</button></div>
        <div class="row"><code>claude plugin install ebb@ebb</code><button class="copy" data-copy="claude plugin install ebb@ebb">Copy</button></div>
      </div>
      <p class="small">Then restart Claude Code and pick a deck below, or make your own.</p>
    </div>
    <div class="term" aria-label="Claude Code with ebb">
      <div class="dots"><i></i><i></i><i></i></div>
      <div class="you">❯ <b>fix the flaky login test</b></div>
      <div class="tool">⏺ <b>Read</b> tests/login.spec.ts</div>
      <div class="tool">⏺ <b>Bash</b> npm test -- login</div>
      <div class="reply"><span class="spin" id="spin">✻</span> <span class="word">Noodling</span><span class="meta">… (12s · ↓ 1.4k tokens)</span></div>
      <div class="band" id="band">
        <div class="ask"><b id="front">el corazón</b><span class="sep">│</span><span class="btn"><i>f</i>: Forgot</span><span class="btn"><i>g</i>: Got it</span><span class="btn"><i>s</i>: Skip</span></div>
        <div class="grades"><b id="pair">el corazón — heart</b><span class="hint" id="hint"></span><span class="sep">│</span><span class="btn"><i>f</i>: Next</span></div>
      </div>
      <div class="prompt">❯<span class="foot">🌊 ebb</span></div>
    </div>
  </div>

  <section>
    <h2>One line, no pop-ups</h2>
    <p class="sub">ebb uses the waits you already have. It schedules cards with FSRS-6, the algorithm in Anki.</p>
    <div class="steps">
      <div class="step"><span class="n">1</span><h3>A card</h3><p>Above the prompt, ebb shows the next card: a due one first, then a new one. You keep typing as usual.</p></div>
      <div class="step"><span class="n">2</span><h3>Grade</h3><p>Got it (<code>g</code>) or Forgot (<code>f</code>): click, or press <code>ctrl+x tab</code> and the key. Skip puts the card aside for now.</p></div>
      <div class="step"><span class="n">3</span><h3>Next</h3><p>Got it brings the next card at once. Forgot shows the answer with the note's hint, such as the gender of a word; Next (<code>f</code>) brings the next card.</p></div>
    </div>
  </section>

  <section id="decks">
    <h2>Decks</h2>
    <p class="sub">Copy the command and run it in Claude Code. Install the same deck again later to get its new notes; your progress stays.</p>
    <div class="decks">${decks.map(deckCard).join('')}
    </div>
  </section>

  <section id="make">
    <h2>Make a deck</h2>
    <p class="sub">Ask Claude in your own language. It reads the language you learn from the request and answers in the language you write in. You tick the notes to keep.</p>
    <div class="make">
<pre><span class="c"># a language deck</span>
<span class="k">/ebb add</span> Spanish words for ordering at a bar
<span class="k">/ebb add</span> испанские слова для бара

<span class="c"># anything else: question → answer</span>
<span class="k">/ebb add</span> @k8s how pods restart

<span class="c"># your decks</span>
<span class="k">/ebb decks</span></pre>
<pre><span class="c">// or write a deck file and /ebb install it</span>
{
  "id": "es-en",
  "name": "Spanish for English speakers",
  "learn": "Spanish",
  "native": "English",
  "notes": [
    {"front": "el agua", "back": "water",
     "hint": "el, although agua is feminine"}
  ]
}</pre>
    </div>
  </section>

  <div class="foot"><span>ebb · MIT · made for Claude Code</span><a href="https://github.com/r13v/ebb">github.com/r13v/ebb</a></div>
</div>
<script>
const demo = ${JSON.stringify(demo)};
const base = new URL('decks/', location.href).href;
document.querySelectorAll('[data-cmd-deck]').forEach(el => { el.textContent = '/ebb install ' + base + el.dataset.cmdDeck; });
document.querySelectorAll('button.copy').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = btn.dataset.copy ?? '/ebb install ' + base + btn.dataset.copyDeck;
    try { await navigator.clipboard.writeText(text); } catch { prompt('Copy:', text); return; }
    const label = btn.textContent;
    btn.textContent = 'Copied'; btn.classList.add('done');
    setTimeout(() => { btn.textContent = label; btn.classList.remove('done'); }, 1400);
  });
});
// The band demo: a card above the prompt with its grades, then its answer after Forgot.
const glyphs = ['✻', '✢', '✳', '✶'];
let g = 0, i = 0;
const hintEl = document.getElementById('hint'), band = document.getElementById('band'), front = document.getElementById('front'), pair = document.getElementById('pair'), spin = document.getElementById('spin');
setInterval(() => { spin.textContent = glyphs[g++ % glyphs.length]; }, 160);
const cycle = () => {
  if (!demo.length) return;
  const [f, back, hint] = demo[i++ % demo.length];
  band.classList.remove('on');
  front.textContent = f;
  setTimeout(() => { pair.textContent = f + ' — ' + back; hintEl.textContent = hint ? ' (' + hint + ')' : ''; band.classList.add('on'); }, 2200);
};
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { cycle(); setInterval(cycle, 4200); }
</script>
</body>
</html>
`

writeFileSync(join(out, 'index.html'), html)
console.log(`site: ${decks.length} deck(s) → ${out}`)
