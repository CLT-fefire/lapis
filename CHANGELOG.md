# Changelog

**English** · [한국어](CHANGELOG.ko.md)

Version history for Lapis. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
trimmed down for a one-person project. Versioning follows [Semantic Versioning](https://semver.org/) loosely.

> **No binaries are published.** Nothing is attached to GitHub Releases — only tags are pushed.
> Build from source as described in [the README's install section](README.md#installation).

> **⚠️ History rewrite notice (2026-08-18)** — the whole history was rewritten with `git filter-repo`
> when the repository moved to a personal account. **Every commit SHA before v1.10.0 changed.** Tags were
> updated to point at the new SHAs, but old SHA references in external documents and PR pages no longer resolve.

---

## [Unreleased]

### Changed
- **The accent splits into three** ([#264]). One value cannot carry fills, text, and borders at
  once — something always falls under threshold. The old Blurple was chosen for fills and measured
  **3.7:1 as text**, which is where links used it.

  `--accent-solid` fills, `--accent` draws focus rings and borders, `--accent-text` is for letters.
  Same contract as `--danger`/`--danger-text`, with the same guard: `accentText.test.ts` refuses
  `color: var(--accent)` anywhere.

  ⚠️ The twenty-six presets **derive** the other two rather than listing them. A hand-written value
  per theme is a value you can forget on the twenty-seventh, and a forgotten one leaves that theme's
  links the default blue while everything else moves — the screen looks fine and one element is
  wrong. Derivation moves lightness only; hue is the theme's identity and shifting it would make
  twenty-six themes resemble each other.

  ⚠️ A fixed −12% left `teal` at **4.4994:1** — under by six ten-thousandths, the same shape as the
  `--n-700` fix in 2.1.0. The fill now darkens until it has real headroom. All twenty-six are
  measured per theme, on that theme's own tinted surface.
- **New color foundation — Ink & Pyrite** ([#263]). The neutral ramp goes from nine flat greys to
  eleven steps tilted very slightly toward blue, and two steps are added where the shell's three
  layers, cards, and hover states had been sharing one. Dark stays the only theme.

  ⚠️ **Borders are hairline rgba now, not opaque grey.** Contrast between surfaces already
  separates the shell regions, so borders are left to divide cards and inputs *within* a surface.
  Custom CSS that layered its own color over `--border-*` will land differently.

  ⚠️ **Overlay layering is inverted.** Popovers and modals used to be darker than the page (the
  Discord idiom). With a scrim in play a card has to be *lighter* to lift off the background.

  Measured on the new content surface: body text 11.93:1, secondary 8.53, muted 5.74, accent text
  5.72, danger text 6.29.
- **Motion budget widened** ([#263]). `--dur-fast/base/slow` (100/150/200) become `--dur-1..4`
  (90/140/220/320). The old names remain as aliases **for one release**.

  ⚠️ `motion.ts` carries the same numbers for Svelte transitions, which CSS `prefers-reduced-motion`
  cannot reach. Changing one side alone makes the same gesture run at two speeds depending on
  whether CSS or JS draws it.

## [2.4.1] — 2026-08-27

### Fixed
- **Turning on MCP queries could do nothing, silently** ([#261]). Two defects, either of which
  produces "I switched it on and it did not take":

  `setMcp` returned early when the new value equaled the store's — so if the store and the file
  ever disagreed, **the one control that could fix it neither wrote nor said anything**, and the UI
  already showed the desired option as active.

  And nothing checked whether the write landed. `settingsWrite` not throwing was treated as
  success, but a write can **succeed into a different file** (the dev/release split), which is not
  an exception — it is a normal return. That can only be caught by reading back, so `patchSettings`
  now does, and throws when the value is not there. ⚠️ It leaves the store alone in that case:
  updating it would produce exactly the state being diagnosed, where the screen changed and the
  disk did not.
- **The settings screen shows which file MCP actually reads** ([#261]). A dev build writes to the
  `-dev` directory while the MCP gate looks at the release file first, so switching MCP on in a dev
  build cannot reach MCP. That is correct behavior producing an identical symptom to a real bug,
  and the two were indistinguishable. The MCP row now names both paths, in warning color when they
  differ.
- **The property audit counted everything twice** ([#261]). Rust puts every frontmatter key into
  `props`, including the typed `doc_kind` and `topic`, and the audit counted both sides. It
  reported `todo 6 · todos 4` where the truth was `3 · 2`. Which values had split was right and
  only the numbers lied — which is why nobody doubted them.
- **A note's own H1 was read as a mention of another note** ([#261]). Two projects keeping a
  document each on the same concept end up with the same title; one note's H1 then matches the
  other's frontmatter title, and the unlinked-mentions audit called that a mention. A body's first
  H1 is the note's own name — masked now, for the same reason `title:` is.

  That makes three false-positive classes this audit has shed from measurement rather than from
  reasoning about it.

## [2.4.0] — 2026-08-27

### Added
- **The MCP server can ask about vault hygiene** ([#259]). The audits stood at five in the app,
  five in the CLI, and **zero in MCP** — an assistant could search a vault but not ask what was
  broken in it. `lapis_query` takes `audit: "broken" | "orphans" | "unlinked" | "tags" | "props"`.

  It calls **the same pure functions** the app and the CLI call. A separate judgement here would
  mean the state an assistant sees and the state a person sees can disagree, with no way to tell
  which is right.

  ⚠️ There is no `all`. Only `unlinked` reads every note body, so folding it into `all` charges
  that cost to the four cheap ones — and leaving it out while calling the argument `all` is a lie.
- **`lapis export --all --out-dir <dir>`** ([#259]). The whole vault, **mirroring its directory
  structure**. Flattening would put `a/Note.md` and `b/Note.md` in one directory to fight over a
  filename, and the loser disappears without a word.

  `--all` without `--out-dir` is refused: hundreds of documents concatenated onto stdout is not a
  document, and doing that quietly is worse than stopping.
- **The palette reaches all five audits** ([#259]). One command opened the hygiene panel on its
  first tab; getting to "properties" took two more clicks. Each audit has its own entry now.
- **Heading autocomplete in wikilinks** ([#258]). Typing `[[Note#` now offers that note's headings.

  ⚠️ Before this, it did the opposite of nothing — the trigger treated `#` as part of the name, so
  `[[boundary-contracts#` searched for a note by that literal name and **the list went empty**.
  2.2.0 added the syntax and never added a way to type it; you had to remember the heading exactly.

  `[[#Heading]]` completes from the **buffer being edited**, not from disk — the most common moment
  to write an anchor is right after writing the heading, and a note read from disk would not have it
  yet.

  A note that does not resolve falls back to name completion, so `[[C#` still offers `C#.md`. Same
  precedence as resolution itself.
- **Transcluded content says where it came from** ([#258]). A border marks it as somebody else's
  writing; it did not say **whose**. The source is now a line above the excerpt, and it is an
  ordinary wikilink — the existing click path handles it rather than a second one being built.

  Failed embeds get no such line. There is nowhere to go.
- **The editor knows the new syntax** ([#258]). `> [!WARNING]` and `![[Note]]` were plain text
  while editing and colored in the preview, so a typo like `[!WARN]` was only visible after
  switching modes.

  ⚠️ **An unknown callout type is marked differently** — that is the point. Coloring only the
  recognized ones leaves a typo as unhighlighted text, which reads as normal. Unknown types get the
  danger color *and* a wavy underline; color alone gets skipped over.

## [2.3.1] — 2026-08-27

### Fixed
- **`--danger` was still the text color in fifteen places** ([#256]). 2.3.0 measured the problem
  and moved only the callout; the rest were left for a pass with eyes on them. This is that pass.

  Measured against every surface the app puts text on, `--danger` lands between 3.35:1 and 4.37:1 —
  under AA on all four. `--danger-text` lands between 5.54 and 7.22. Borders keep `--danger`: the
  non-text threshold is 3:1 and it clears that.

  ⚠️ The guard reads `app.css` and **resolves the real tokens** rather than restating hex values.
  Writing them out by hand is how the first draft ended up measuring `--surface-content` as the
  wrong ramp step and reporting a pass that was not one.
- **Code blocks had no background** ([#256]). `.rendered pre` sets `--surface-sunken`, and the very
  next rule — `.rendered .hljs { background: transparent }` — beat it on specificity for every
  fence, because they all render as `<pre class="hljs">`. The comment directly above said the
  background belongs to the `pre` rule; the code said otherwise, and only the border was left on
  screen.

  `transparent` is the idiom for cancelling a highlight.js **theme stylesheet**, and this
  repository does not load one. It was guarding against something that is not there.

## [2.3.0] — 2026-08-27

### Added
- **Transclusion** ([#254]). `![[Note]]` expands the whole note where you wrote it;
  `![[Note#Heading]]` expands just that section — heading line included, down to the next heading
  at the same or higher level.

  This is what [#246] was groundwork for: anchors had to resolve before a slice could be addressed.

  ⚠️ **A failure stays in its place.** An embed is part of a sentence's surroundings, so an empty
  gap is hard to notice — nothing says what used to be there. A missing note, a missing heading, a
  cycle, a chain too deep: each leaves a line naming what could not be pulled in.

  ⚠️ **Cycles and depth are both cut, on purpose.** A cycle alone would be caught by the depth
  limit and vice versa, but they say different things. Turning either one off in a canary still
  terminated — the other caught it — while producing the wrong message.

  The app fills placeholders by walking the DOM after render (reading a note is IPC, and
  markdown-it is synchronous); the CLI walks the string. **The rules are shared** — depth, cycle
  detection, and the failure wording all live in one module, because a split there would make the
  same document read differently in the two places.

  ⚠️ An embed on a line of its own is what this assumes. The placeholder is a block element
  emitted from an inline rule, so text sharing its line ends up outside the paragraph.
- **`lapis export <note>`** ([#253]). One self-contained HTML file, from the terminal. The app has
  had this since 2.0; the CLI is where the other headless consumers live, and it did not.

  Same assembler as the app (`previewExportDoc.ts`). What differs is where the material comes from,
  and the difference is documented rather than hidden — the app clones the **live DOM** because
  Mermaid only becomes `<svg>` after mounting, and there is no browser here. So Mermaid stays a
  code fence, and token values are read out of `app.css` plus whichever color theme the settings
  file names, rather than from `getComputedStyle`. Custom CSS does not carry over.

  ⚠️ Images that cannot be inlined are **counted and reported**. Leaving the original path in
  silently would make "self-contained" a lie. Remote images are deliberately left alone: fetching
  and failing loses the picture entirely, while the URL still works online.
- **Settings search** ([#252]). A box in the settings header that searches **across** categories —
  knowing which category holds a setting is exactly what you lack when you go looking. Each result
  names its category, and clicking one takes you there.

  Splitting settings into categories in 2.0.0 took something away: a single scrolling list could be
  searched with the browser's own find. This gives that back.

  ⚠️ The search does not filter the categories in place, because they are not all rendered — an
  inactive category is absent from the DOM, which is why the heavy CodeMirror editor only mounts
  when Advanced is opened. Search swaps in a result list instead.

  ⚠️ That means the list of settings lives in **two** places: the markup and a search index. Adding
  a setting without indexing it makes one that exists but cannot be found — quiet, and easy to read
  as "there is no such setting". A guard reads the markup and checks that every title appears in
  the index under the right category.

  Matching ignores whitespace, so "사용자정의css" finds "사용자 정의 CSS", and descriptions are
  searched too — people do not remember names exactly.
- **Callouts** ([#251]). `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`.

  Measured first: 41 of this vault's files carry 218 hand-rolled callouts written as `⚠️ **…**`.
  The syntax was missing, so bold text and an emoji stood in for it.

  ⚠️ **Only the five GitHub supports.** Obsidian takes a dozen more, but these documents are also
  read on GitHub — the repository is public and the README and changelogs render there. Anything
  outside the intersection shows up in one place and not the other. An unknown type is left as an
  ordinary blockquote on purpose: `[!QUESTION]` stays visible, so whoever wrote it can see why it
  did not take. Swallowing it silently would not tell them.
- **frontmatter hygiene — the fifth audit** ([#250]). Values that have split apart on an axis you
  can filter by. `lapis props audit`, a fifth tab in the vault hygiene panel, and a row in
  `lapis doctor`. The first four audits look at the link graph; this one looks at the axes.

  ⚠️ **It is quiet.** A query does not error — it finds half of what it should. On the real
  vault today: `doc_kind` holds both `todo` and `todos`, and `status` has split into twelve values
  (`반영됨` 18, `완료` 2, `해결됨` 1, plus six free-form variants like `완료 — #232`).

  Three checks, the same shapes the tag audit already looks for on tags: case-only, singular/plural,
  and shared prefix.

  ⚠️ **What it does *not* look at is the point.** Only two fields are excluded by name — `tags`
  (the tag audit has it) and `aliases` (those are names, splitting is normal). Everything else is
  filtered by shape: a field whose values barely repeat is free-form, not an enum; a field whose
  values **resolve to notes** is a cross-reference, not a value.

  That last rule came out of measurement. Before it, half the findings on the real vault were
  `related`: `feeds`, `feeds-excerpt-only`, `feeds-settings-hardening`. Those are three different
  documents — similar names are a normal property of document titles, not a defect. A hand-kept
  list of field names would have needed editing every time a new field appeared; asking the index
  "does this value resolve to a note?" does not.

  Free-form values are not called errors. `status: 완료 — #232` is useful to a person. All the
  audit reports is that several values start the same way.

### Fixed
- **The CLI and the MCP launchers did not run on Windows** ([#249]). `cli/lapis` and
  `mcp/lapis-*` are `#!/bin/sh` scripts. Typing `cli/lapis …` in PowerShell opens a **"choose an
  app to open this file"** dialog — not an error, not a "not supported" message. Pick an editor
  and you are looking at the shell script.

  `cli/README.md` had ruled a Windows shim out: *"one more truth to maintain, and the main
  development environment is macOS"*. That reasoning does not survive contact — Windows is a
  first-class target here (the Rust CI job runs on both), and the fallback advice, "use Git
  Bash", assumes something that is not true by default: a stock PowerShell `Path` has neither
  `sh` nor `bash`.

  Each shell wrapper now has a `.cmd` twin. The maintenance worry is paid for with a guard rather
  than a rule: `scripts/launchers.test.ts` checks that every sh wrapper has a `.cmd` beside it,
  that the two name **the same entry point**, and that both bundle runners keep the two contracts
  they share (the `$lib` alias, the `LAPIS_REPO` handoff). A fifth wrapper added on one side only
  turns it red.

  ⚠️ `*.cmd` is pinned to CRLF in `.gitattributes`. The repo forces LF everywhere else, and
  cmd.exe misbehaves on LF-only batch files in ways that do not announce themselves.
- **A native path would have put the whole path in the exported title** ([#253]). `$lib` assumes
  `/` separators — the `to_ui` contract — and the CLI sits outside that pipeline. Real calls pass a
  cache path, which is already normalized, but a Windows path produced
  `<title>C:\\Users\\…\\note</title>`: the document renders fine and only the tab name is wrong.
  Normalized at the boundary now.
- **The rendered-body stylesheet was imported from a single route** ([#251]). It lived in the main
  page component, so the component preview route rendered Markdown with **no styling at all** —
  the five callouts came out identical, with no error anywhere. Exactly the shape of the custom-CSS
  bug fixed in [#243]; the stylesheet import did not get moved at the same time. It is in the root
  layout now, with a guard.

  Found by reading computed colors out of a real browser. Every test passed while it was broken —
  they check structure, and happy-dom has no layout engine.
- **`--danger` is not readable as text** ([#251]). It measures 3.35:1 against the content
  background, under the 4.5 threshold. The saturated red is right for fills and borders and wrong
  for letters — the same shape as the `--n-700` fix in 2.1.0. `--danger-text` (5.54:1) joins the
  palette and the caution callout uses it.

  ⚠️ Eight existing places still set `color: var(--danger)`. They are being moved separately, with
  eyes on them — changing them all at once would make it impossible to see what shifted.
- **A callout titled with the accent color would have been unreadable in most themes** ([#251]).
  On the default accent it measured 2.37:1 over its own tint, and the twenty-six color themes each
  move `--accent` somewhere new, so the number is a lottery. `note` is neutral instead; the other
  four use status colors, which themes do not touch. Measured: 4.65 to 11.48:1, all above AA.

## [2.2.0] — 2026-08-27

### Added
- **Wikilinks can point at a heading** ([#246]). `[[Note#Heading]]` opens the note and scrolls
  there; `[[#Heading]]` moves within the current document. Markdown links have always dropped the
  anchor before resolving (Rust does it during extraction) — wikilinks never did, so `[[Note#H]]`
  resolved to nothing.

  That failure was quiet in two places at once. The link rendered grey as if the note did not
  exist, it was reported under broken links, and the **backlink edge disappeared** — the target's
  backlink list was simply one row shorter, with nothing to indicate why.

  ⚠️ **The whole target is looked up first, and only a miss is read as an anchor.** A file name may
  contain `#` (`C#.md`), and the other order would send an already-working `[[C#]]` quietly to
  `C.md`. Written this way the fallback cannot change any link that resolves today.

  A heading that is not there does not scroll anywhere. Landing at the top of the right note beats
  landing on the wrong heading, which reads as if it were the right one.
- **Unlinked mentions — the fourth audit** ([#245]). Places that name another note without linking
  to it. `lapis links --unlinked`, a fourth tab in the vault hygiene panel, and a row in
  `lapis doctor`. Broken links ask "pointed at nothing", orphans ask "nobody points here"; this one
  asks **"said it, never pointed"** — the same graph from a third angle.

  It lists and stops there. No convert-to-link button: the audits all behave this way, and a bulk
  action over a list that still contains false positives spreads one mistake across the vault.

  ⚠️ **Keeping false positives out is the whole feature.** The known weakness of the reference
  implementations is noise, and a noisy list is one nobody opens. Eight rules do the filtering, and
  each was measured by switching it off against a real 81-note vault:

  | switched off | mentions reported |
  |---|---|
  | nothing (shipped) | **2** |
  | code exclusion | 63 |
  | sources already connected to the target | 5 |
  | frontmatter exclusion | 5 |
  | ambiguous-name rejection | 3 |

  A two-item list looks like a feature that found nothing. The table is how you know it is a vault
  that is genuinely well linked — loosening any single rule multiplies the list by up to thirty.

  Only this audit reads note bodies; the other three need the index alone. That makes `doctor` read
  them too: 0.73 → 0.79 s on the same vault (+54 ms), and on a large vault this row dominates.

### Fixed
- **`lapis index` committed a cache the same CLI refuses to read** ([#247]). The command drives the
  installed app to write the cache. When that app is a version behind, it writes the older cache
  format — and then prints `커밋했다. 앱을 켜면 이 인덱스를 그대로 읽는다(재색인 없음)`, while
  `lapis doctor` on the same vault rejects it as `version_skew`. **What it just made, it cannot
  read**, and it reported success.

  Found by running the command against a scratch vault while working on something else. The
  existing guard covers an old app that *ignores* the flags; this is an old app that accepts them
  and writes a different version.

  It stops before building shards now. Not a hard failure, because the cache is not worthless —
  the app that wrote it reads it fine; the CLI and the MCP server are the ones locked out. So
  `--allow-version-skew` is there, and taking it changes the last line to say who can read the
  result. A warning during the run is not enough: that scrolls away, and the last line is the one
  people read.
- **Renaming a note dropped the anchor from wikilinks** ([#246]). `[[old#Heading]]` became
  `[[new]]`. Markdown links preserved anchors from the start; the wikilink pattern matched only
  `[[stem]]` and `[[stem|alias]]`. It never mattered while anchors did not resolve — now it would
  be a rename silently breaking a link.
- **Three of the first five hits were notes that already linked to the target** ([#245]). Found by
  running the audit against a real vault before shipping it. All three had the same shape — a link
  written with the filename and the description written with the title:

  ```md
  - [[STATE]] — Lapis progress
  ```

  The linked span is masked, the title sitting next to it is not, so a note that already points at
  the target was reported as not pointing at it. Sources already connected to the target — by body
  link or by a frontmatter relation — are now left out entirely. Note-level, not line-level: this
  audit looks for **missing edges**, and once the edge exists it does not matter which line repeats
  the name.

### Internal
- **The masking pass has a test of its own** ([#245]). Line numbers are counted from offsets into
  the original text, so the mask replaces code and frontmatter with spaces rather than removing
  them. If that length preservation ever breaks, nothing throws — every reported line number just
  quietly shifts and still looks plausible.

## [2.1.0] — 2026-08-27

### Added
- **Twenty-six colour themes** ([#243]). Dark is still the one theme; these sit on top of it,
  fourteen changing only the accent and twelve tinting the background as well. Settings →
  Appearance. Custom CSS still overrides individual tokens on top of whichever is selected.

  They are data, not a second palette in `app.css` — that duplication was removed in 2.0.0 and a
  guard keeps it out. A preset is injected at runtime, between the stylesheet and custom CSS.

  ⚠️ **None of them was colour-matched by eye.** Doing that by hand across twenty-six themes
  guarantees a few unreadable ones, and an unreadable theme is not an error — it is just a bad
  screen, seen only by whoever picked it. Instead a tint preserves the **WCAG relative luminance**
  of every step it touches, by construction: contrast ratios depend on luminance alone, so
  holding it constant holds legibility constant. Measured across themes, body text lands between
  9.29 and 9.41 against a default of 9.36.

  An accent cannot inherit that — its colour is the whole point — so the text placed on it is
  computed instead, black or white by whichever contrasts more. Amber and Ember get black text
  without anyone deciding that.
- **The custom CSS editor opens with a worked example** ([#243]). Every rule in it is commented
  out; uncommenting one and saving changes the app. An example that only describes the hooks
  does not show what can be grabbed.

  It is shown, not stored. Seeding it as the saved default would erase the difference between
  "nothing configured" and "configured to nothing", and then clearing it would either bring it
  back or lose it for good.

### Fixed
- **The text-muted token had no contrast headroom** ([#243]). At `#949ba4` it measured exactly
  4.505:1 against the content background — over the 4.5 threshold by four thousandths. Rounding
  a tinted variant to 8 bits was enough to push it under. It is now `#989fa8` (4.73:1), which is
  not visibly different and leaves room to move. This was a latent fragility in the default theme,
  not only in the new ones.
- **Custom CSS was injected from a single route** ([#243]). The effect lived in the main page
  component, so anything rendered outside it — the component preview route, for one — took the
  stored CSS and theme but never applied them. It runs from the root layout now.

### Internal
- **The CSS token guard no longer objects to component-local properties** ([#243]). A custom
  property set inline on an element and read by that same component's stylesheet has no business
  in `app.css`, but the guard counted it as undefined. Previously such cases went into a
  hand-maintained allowlist; the guard now asks whether the same file defines the property.
  A list that grows every time it is wrong ends up excusing the typos it exists to catch.

## [2.0.0] — 2026-08-27

> **⚠️ Breaking — the light and system themes are gone.** There is one theme now, and it is dark.
> Colour is changed through custom CSS instead. Any theme preference stored from an earlier
> version is ignored.

### Changed
- **The interface follows Discord's visual grammar** ([#235], [#236], [#237]). The neutral ramp
  was a blue-leaning slate; Discord's is a near-desaturated grey, and that accounts for most of
  the difference in impression. The three shell surfaces now sit on Discord's own three:
  rail `#1e1f22`, sidebar `#2b2d31`, content `#313338`.

  The accent had already been Blurple since v1.x, so this is a continuation rather than a turn.

  Corners went up where it counts — `--r-sm`, used in 43 places, moved from 4px to 6px. `--r-lg`
  was raised to 16px and then put back: modals use it, and 16px made them rounder than Discord's
  own. Wanting something to look like Discord is not the same as wanting it rounder.

  Hover and active transitions get a separate easing curve from entrances. The existing curve
  overshoots, which is right for a modal appearing and wrong for a colour change under a moving
  cursor — it reads as a bounce.
- **The global title bar is gone; the note has a header instead** ([#237]). Discord has no global
  bar: the name of what you are looking at sits directly above it. Visit history, the note path
  and the save badge moved into that header, and the word "Lapis" was dropped — an app has no
  reason to display its own name at all times.
- **Settings are split into categories** ([#239]). Appearance, Language, Vault, Advanced, in a
  list on the left with the selected category's contents on the right. Seven sections in a single
  column meant scrolling and re-reading to find anything. The version number now sits at the
  bottom of the category list rather than in the window chrome.

### Added
- **Custom CSS** ([#238], [#239]). The design tokens in `app.css` and fifteen `data-lapis` hooks
  are a documented, stable contract; internal class names explicitly are not. Drawing that line
  narrowly is deliberate — a wide one turns the internal structure into a public API and freezes
  it.

  The editor lives under Advanced: syntax colouring, bracket matching, and real formatting, and
  a failed format doubles as the syntax check. Saving is an explicit action, because saving on
  every keystroke would make the app vanish somewhere in the middle of typing
  `[data-lapis="app"] { display: none` — before the closing brace.

  ⚠️ **Three ways back.** One line of CSS can hide the window and the settings with it.
  `⌘⇧⌥C` (`Ctrl+Shift+Alt+C`) switches custom CSS off — a key handler runs regardless of what
  the styling is doing, so it works on a blank screen. `lapis css --off` edits the settings file
  from a terminal for when the app will not start at all; it disables the CSS without deleting
  it. Failing those, removing the settings file resets everything.

  A preview step is **not** one of those ways: `display: none` looks identical in a preview.
  A safeguard that only works when you already noticed the mistake is not a safeguard.

### Fixed
- **The same colour was defined in three places** ([#235]). `app.css` carried the palette under
  `:root`, again under `[data-theme="light"]`, and a third time inside a
  `prefers-color-scheme` block — with a comment instructing whoever edited one to remember the
  others. Nothing enforced it, and a drift there is invisible to anyone using dark. Removing the
  light and system themes took 135 lines out of the file, and a guard now rejects a second
  palette while still allowing the deliberate compact-density variant.
- **The editor and the preview highlighted search matches differently** ([#236]). Both hardcoded
  their own colours and the two had already drifted — 30% against 35% opacity, a different orange
  for the current match. Moving between editing and reading changed how a match looked. They
  share four tokens now.

### Internal
- **Guards for the contracts this release introduces** ([#235], [#238], [#239]). That a palette
  stays single; that every `data-lapis` in the contract exists in the markup and every one in the
  markup is in the contract; that the panic shortcut is checked before any other key handling;
  that every settings row sits inside a category, since one outside is invisible while still
  compiling and passing tests.

  Two of them were wrong on the first attempt and only a canary showed it. One counted `{#if}`
  depth with a plain counter, which nested conditionals inside a section drove negative — it
  caught nothing. The other read a documentation comment as a real attribute.
- **Formatting loads on demand** ([#239]). Bundled statically, prettier landed in an 852 KB chunk
  the entry point pulled in immediately — every launch paid for it whether or not settings were
  ever opened. Behind a dynamic import it splits into 156 KB and 82 KB, fetched the first time
  Format is pressed. One press is slower; every launch is not.
- **Three open measurement questions were closed without building anything** ([#240]). Whether to
  index `aliases`, whether the `name` field earns its place, and whether the Korean bigram
  tokenizer over-matches. None can be answered from this corpus: it contains no aliases at all,
  its filenames are Latin while its titles are not, and the over-matching was observed on 19,225
  notes where this vault has 71 — a match count cannot exceed the number of notes.

  The limits are recorded in the harness itself, so the next attempt starts by looking at the
  corpus rather than at the tool.

## [1.20.0] — 2026-08-27

> **⚠️ This release reindexes once on first launch.** `CACHE_VERSION` goes 8 → 9 because the
> full-text index gained a field, so existing shards cannot be reused. Unlike the v1.17.0 cache
> migration — which only renamed files — this one rebuilds. Large vaults will spend a moment on it.

### Added
- **A note's title is now its own search field** ([#233]). The full-text index carried only
  `name` and `body`. `name` is the filename, which in these vaults is English kebab-case, so
  `boost: { name: 3 }` did nothing at all for a Korean-language title query. The frontmatter
  `title` had no field of its own — its text sat inside `body`, weighted like any other prose.

  Measured on one vault with the index shape as the only variable (69 notes, 204 cases):

  | fields | overall | title | **title, 2 words** | body | MRR |
  |---|---:|---:|---:|---:|---:|
  | `name`, `body` | 79.9% | 91.2% | **64.7%** | 83.8% | 0.870 |
  | `name`, `title`, `body` | 89.7% | 98.5% | **85.3%** | 85.3% | 0.943 |

  Two earlier attempts at this had failed — swapping the tokenizer moved it 1 point, and the
  four-stage combination ladder moved it not at all.

  ⚠️ **Read that number carefully.** The harness draws its queries from the frontmatter `title`,
  so indexing that field separately is partly teaching to the test. Body queries, which owe
  nothing to the title, went 83.8% → 85.3%. The honest claim is not "search got 10 points
  better" but **"finding a note by a title you half-remember got much better"** — which is the
  situation this harness was built to model.

  No boost is applied to the field. Varying it from 0.01 to 100 changes nothing: clean queries
  all resolve at the `AND` stage, which passes its search options explicitly, so a per-instance
  boost never arrives. The gain comes from BM25 length normalisation — a term in a short title
  field outweighs the same term buried in a long body. A number that does nothing would read as
  a tuned value to whoever comes next.

### Fixed
- **The search-quality harness reported success having measured nothing** ([#232]). Running
  `./mcp/lapis-eval --vault <path>` produced `0 cases`, every quality figure as `NaN%`, and a
  final line reading pass, with exit code 0.

  Three things had to line up. `Number("--vault")` is `NaN`, and `slice(0, NaN)` is an empty
  array — no exception, no warning. `--vault` was never a supported option, yet nothing rejected
  it, so it silently consumed the positional argument that was meant to be the sample size. And
  the verdict at the end only ever checked the latency budget.

  A measuring tool is what other decisions rest on. Change the tokenizer, run this, read "R@1
  unchanged" — and nothing was ever compared. `mcp/benchRun.ts` had the same line, where
  `Math.max(200, NaN)` is also `NaN`.

  Both tools now parse arguments properly, support `--vault` and `--help`, and reject anything
  unrecognised — the discipline `cli/README.md` already described and a sibling tool was not
  following. Zero cases is now an error, not a pass.

### Internal
- **A guard ties the index shape to `CACHE_VERSION`** ([#233]). `CLAUDE.md` warned that
  `fullTextOptions.ts` sits outside that version's protection, but nothing enforced it, and
  forgetting means old shards are read by new query code with no error and quietly wrong results.
  The guard fingerprints what actually determines the stored index — `fields`, `tokenize`,
  `processTerm` — and pins it beside the version. Query-time values (`boost`, `bm25`, `fuzzy`)
  are deliberately excluded: including them would force a full rebuild for every ranking tweak,
  and a guard that noisy gets switched off.
- **A duplicate `FullTextDoc` was removed** ([#233]). `searchIndex.ts` carried a second copy of
  the interface and the app built its documents against that one while the index was configured
  from the other. The two happened to agree, so nothing was wrong — until a field was added to
  one of them. Each file stays internally consistent, so type checking never objects; only the
  search results are wrong. Deleting the copy immediately revealed two more document-producing
  sites, both on the incremental-update path, where only edited notes would have been indexed
  in the other shape.

## [1.19.0] — 2026-08-27

### Fixed
- **A stale index answered confidently, and only one command said so** ([#228]). The CLI reads the
  search index; it never builds one. So when the vault is newer than the index, answers can be out
  of date. `mcp/README.md` documented the contract — report staleness, do not block — but **only
  `lapis search` implemented it.**

  `backlinks`, `list`, `links --broken`, `links --orphans`, `tag audit` and `replace` all stayed
  silent. Running the audits right after adding notes returned no broken links and 1 orphan; after
  a reindex the same vault had 3 orphans. The answer did not change — the first one was wrong, and
  nothing suggested it might be.

  Every read now reports it, in prose and as a `stale` field under `--json`. Reads are still never
  blocked: a live vault goes stale within seconds of being edited, so failing hard would make the
  tool unusable.

  **Writes are treated differently and now stop.** `tag rename --apply` and `replace --apply` walk
  the *indexed note list* while reading contents fresh from disk, so a stale list silently skips
  every note created since the last index — while reporting that 2 notes were updated. Reproduced
  on a throwaway vault: a note added after indexing kept its old text and nothing mentioned it.
  Both commands now refuse on a stale index (exit 2) and point at `lapis index`; `--allow-stale`
  forces it through. A stale read can be repeated; a partial write leaves a vault nobody can audit.
- **Typing the name of a command did not bring that command to the top** ([#228]). In `⌘K`, typing
  `위생` listed body-search results first and the matching command five rows down, even though the
  label of that command starts with the word.

  This was not a scoring problem. Commands were scored with a 1.2× boost, but the palette renders
  fixed groups and the command group was always last, so the boost could never move anything.
  The boost code reads correctly on its own — the file that decides position is a different one.

  A command whose label (or any word in it) starts with what you typed is now promoted above the
  results. Fuzzy-only matches stay where they were: a looser rule would push commands into every
  note lookup, which is worse than the problem. Group order is otherwise unchanged — positions that
  move around defeat muscle memory, and a mis-pick in the palette opens a note or a window.
- **Three keyboard shortcuts in the README did not exist** ([#226]). `⌥B` is actually `⌘⌥B`,
  `⌘←`/`⌘→` are actually `⌘⌃←`/`⌘⌃→`, and `⌘⇧B` (table view) was missing from the table entirely.
  Pressing what was written did nothing, which reads as a broken app rather than a stale document.
  The code was right; the README was not. The Development section now matches CI as well.

### Added
- **`lapis doctor`** ([#228]). Runs every audit at once — broken links, orphans, duplicate tags,
  ambiguous names — plus the index freshness check that otherwise needs a fourth command.

  The exit code carries meaning so it can be used from a hook or CI: `0` clean, `1` problems found,
  `2` could not run. **`doctor` is the only command that gives `1` a meaning beyond error**, so it
  is also the only one that reports an unusable vault as `2` — otherwise a mistyped path would be
  reported as a hygiene finding.

  Staleness is printed first, because how much to trust the numbers below depends on it, but it is
  not counted as a problem: a live vault is almost always slightly stale, and a check that always
  fails gets removed. Like the audits it wraps, `doctor` does not fix anything.

### Internal
- **Guards for the two drift classes above.** One reads the source of every handler and checks that
  a command reading the index reports staleness in **both** its `--json` and human output — the
  first version accepted either, and a canary showed that deleting the human-facing line still
  passed while the JSON field remained. That is the worst shape of all: the script gets the field,
  the person at the terminal sees a stale number with no warning. Another reads the palette
  component and checks its render order matches the declared `GROUP_ORDER`; the absence of that
  check is why score and position had been allowed to disagree.
- **Screens that are awkward to reach by hand can be opened directly** ([#229], [#230]). The
  vault-hygiene modal and the replace panel need real vault state before they show anything.
  `npm run dev` then `/dev/preview` renders them from fixtures, without Tauri, with a surface and
  theme switcher — for checking colour, spacing and alignment, which the DOM tests cannot see.
- **Those screens are now covered by tests** ([#227]). The audit and replace logic were already
  pinned as pure functions, and the CLI shares them, so the data was verified — what was not was
  how the markup draws it. A flipped condition removes a warning with no error at all, and in the
  replace panel those warnings are the last thing seen before an irreversible write. Icon
  containers (`.icns`, `.ico`) are also checked byte-for-byte against the source PNGs.

## [1.18.0] — 2026-08-26

### Fixed
- **A note name shared by two documents resolved to whichever one the walk reached first**
  ([#220]). The resolver was a flat vault-wide map from lowercase name to a single path, and the
  first writer won. Because the walk is alphabetical, a link written in one project silently
  pointed at a same-named note in another. Links were not broken — they went somewhere else.

  Resolution now keeps every candidate and picks the one nearest the linking note; frontmatter
  cross-references go through the same rule, which is where most of the leakage was. Names given
  by a person (`lapis open`, `backlinks`) have no such context, so an ambiguous one is now
  rejected with the candidate paths instead of guessed.

  Measured on a two-project vault: orphan notes went from 8 to 4, and the four that disappeared
  were all false — their inbound links had been captured by same-named notes in the other project.
- **Structural results came back in an unspecified order** ([#219]). Rows from `doc_kind`,
  `topic`, `tag`, and `backlinks_of` carry no score, and their order was whatever order the cache
  happened to store `link_infos` in — vault walk order for a full build, patched order after the
  app's incremental reindex. The same query returned a different order before and after a reindex.

  Order was not the only casualty: results are truncated to `limit` afterwards, so **which rows
  survived changed too**. Structural results are now sorted by vault-relative path, compared by
  UTF-16 code unit rather than `localeCompare` so the order does not depend on the machine's locale.

---

### Added
- **`lapis replace` and replace inside `⌘⇧G`** ([#224]). Vault-wide find and replace. Finding
  worked already; there was no way to act on it. **Dry-run by default** — `--apply` is required —
  and the write goes through the same `$lib/safeWrite` transaction as a tag rename: backup,
  sequential write, rollback on failure.

  ⚠️ Search and replace use **different regex engines**: `⌘⇧G` runs Rust `regex`, replacement runs
  JS `RegExp`, and they can match different text. So the counts shown before applying come from the
  replace engine, never from the search, and in the app a note the search did not surface is never
  written — a miss is recoverable, a wrong write is not. When the two disagree the app says so.

  Warnings come before the file list, not after it: a replacement that matches the pattern again
  (`a` → `aa` doubles on every run), and how many matches sit inside frontmatter where they can
  break the YAML.
- **Time axis — `--since`, `--sort`, `--by`** ([#223]). The vault records when every note was
  modified and nothing could ask about it. `checkStale` was already walking the whole vault on
  every query and throwing those timestamps away; frontmatter `date` was already indexed. Both are
  now query dimensions, on `search`, `backlinks`, and `links --orphans`, and in the MCP tool.

  There are two axes because they answer different questions and one of them lies. `mtime` is what
  you actually touched — but `git pull` and `checkout` rewrite it, and a fresh clone gives every
  file the same value, so after a pull "recently changed" means "whatever the pull touched".
  Frontmatter `date` is unaffected by git but only exists where someone wrote it.

  Notes with no value on the chosen axis are dropped from a `--since` filter and sorted last
  otherwise — and the dropped count is always reported.

  In the app the Command Palette's empty state gained a **Recently changed** group, kept separate
  from *recently opened*: a change made by an editor, by git, or by any other tool never appears in
  reading history.
- **New app icon.** Replaces the Tauri placeholder the project had been shipping with — indigo
  bracket mark with a gold gem, from a supplied vector source. `src-tauri/icons/lapis-light.svg`
  and `lapis-dark.svg` are kept so the set can be regenerated.

  A desktop app icon is a single asset, so the light variant is the one that ships: the dark one is
  nearly black and loses its silhouette against a dark taskbar or dock.
- **`lapis links --orphans` and `lapis tag audit`** ([#221]). Two audits that read what the index
  already holds. Orphans are notes nothing links to — the mirror image of the broken-link audit,
  and, since backlinks are the primary way to navigate, notes that are effectively unreachable.
  The tag audit reports duplicate candidates: the same leaf filed under two parents, tags differing
  only in case, and names that resolve to more than one note.

  Neither one tells you what to do. Orphan rows carry an outgoing-link count so an entry point
  (many outgoing, none incoming) reads differently from a stranded note, and merging is left to
  `tag rename`, which previews, backs up and rolls back.

  In the app the broken-link screen became **Vault hygiene** with three tabs. The Command Palette
  entry changed name accordingly.

---

## [1.17.0] — 2026-08-26

### Added
- **`lapis open <note>`** ([#216]). Opens a note in the running app, or starts the app if it is
  not running. No listening port is involved — the app binary is re-executed and its argv is
  handed to the running instance.

  Which window opens it is decided by the windows, not by Rust: Rust does not know which vault
  each window has, so it stages the request and every window asks whether it is theirs. If no
  window has that vault, a new one is opened for it.
- **`lapis index` — 앱 없이 인덱스를 다시 만든다** ([#215]). Rebuilding the search index used
  to require launching the app. Now the CLI can do it from a terminal, and the app reads the
  result on next launch with no reindexing.

  The work is split across a process boundary the same way the app splits it across IPC: Rust
  walks the vault (it is the only index producer), Node builds the MiniSearch shards (the options
  live in one place), Rust commits them in the order the cache contract requires.

  Against an older app that does not know the flag, the CLI says so instead of hanging — an
  outdated build silently opens a window and never returns, which is how it was found.
- **`lapis tag rename` — CLI layer 3** ([#213]). Renaming or merging a tag across the vault now works
  from a terminal. Child tags follow the parent, the boundary is only at `/`, and renaming onto an
  existing tag is called out as a merge before anything is written.

  **The dry run is the default.** Without `--apply` nothing is written — an irreversible operation
  should not run because an argument was left off. Writes go through the same `$lib/safeWrite`
  transaction the app uses (backup, sequential write, rollback on failure), and `cli/io.ts` re-asserts
  the guarantees the Rust command gives: atomic write, vault confinement resolved through symlinks,
  and the extension whitelist. A CLI that were looser would fork the safety rules it shares.

### Fixed
- **Legacy cache files could be left as orphans** ([#217]). The one-time rename introduced in
  [#214] only ran when the new-key file was missing, so if `lapis index` wrote the cache before the
  app was ever opened, the old file stayed on disk forever — the exact state [#214] set out to
  remove. Observed on a real cache while verifying the CLI.

  The sweep now also runs when the new-key file exists, and in that case removes the superseded
  file instead of renaming over it — renaming would replace a freshly built index with an older
  snapshot. Which side wins is decided from the meta file's mtime, once per key, so a snapshot is
  never split across generations.
- **The same vault could end up with two caches** ([#214]). The cache filename hash was computed from
  whatever path string the caller happened to pass, so `C:\Projects\x` and `C:/Projects/x`, a
  trailing slash, or a path reached through a symlink each produced a different name. The symptom is
  "why is it reindexing everything again", with the previous cache left behind as an orphan. Verified
  on this machine: the app's cache file matched the backslash spelling, and the same vault written
  with forward slashes hashed to a different name. The path is now canonicalised before hashing.

  Existing caches are renamed rather than rebuilt, the same way [#207] handled the previous hash
  change — the migration now tries both older generations.
- **A failed write could look like a success** ([#212]). The backup-then-write-then-rollback
  transaction returned nothing: on a failed backup it just `return`ed, so callers could not tell an
  aborted write from a completed one. The tag-rename dialog closed as if it had worked while nothing
  had been written — the worst way for an irreversible operation to fail, because it makes you believe
  it is done. It now returns an outcome, the dialog stays open with the reason, and the note-rename
  path logs a readable summary.

  The transaction also moved out of the Svelte store into `$lib/safeWrite` with its IO injected. It
  had one consumer, then two (#202 exported it), and a third was coming. Rules for irreversible writes
  must not fork — a fork is how a fix lands on one path and not the other.

---

## [1.16.0] — 2026-08-26

### Added
- **A command-line interface** ([#210]). The same index the MCP server exposes to an agent is now
  reachable from a terminal, without the app running: `search`, `backlinks`, `list`, `links --broken`,
  `status`. Every command takes `--json` and prints the shape `lapis_query` returns, so a script or
  an agent does not have to learn a second format.

  It calls `lapisQuery()` directly rather than reimplementing anything — one ranking, two consumers.
  The command surface (names, options, help text) lives in a single array that `--help`, argument
  validation and a parity test all read, so the help can not drift from what the parser accepts.
  Unknown options exit `2` instead of being ignored: silently dropping `--limt 5` returns a
  default-limit result that looks like the requested one.

  The contract, exit codes, and a layered plan for what is deliberately **not** built yet — headless
  indexing, writes, driving the running app — are in [`cli/README.md`](cli/README.md), in the
  repository rather than in a symlinked notes tree, so they travel with a clone.

### Fixed
- **Every MCP query would have failed after upgrading to v1.15.0** ([#209]). The app moved to cache
  version 8 ([#201]) but the MCP server's expected version stayed at 7, so it would reject a perfectly
  healthy cache with `version_skew` — the tool dies completely while the index is fine.

  The test suite could not catch this **by construction**: `mcp/fixture.ts` writes caches with the
  TypeScript constant and the server reads with the same constant, so the two always agree no matter
  how far either drifts from the app. A guard now reads the Rust source directly and compares, which
  is the only place the two truths meet. Four tests that hardcoded `version: 7` — a literal that
  happened to equal the constant — now use the constant, so they keep testing what they meant to.
- **A frontend wrapper called a Tauri command that no longer exists** ([#208]). `writeSearchCache`
  was the pre-sharding (cache v3) writer; the Rust command was removed in v4 but the TypeScript
  wrapper stayed, so a function that dies with "command not found" sat there looking like API. Command
  names are **strings** — no type checker reaches them, so `tsc`, `svelte-check` and `cargo` all
  passed and the breakage would only surface when someone called it. A test now fails if any
  `invoke("x")` has no matching entry in `generate_handler!`, naming the file. The unused
  `gitHasChanges` wrapper is removed too.

  A second guard checks that `ko.json` and `en.json` carry the same key set. A key present in only one
  locale is not an error either — paraglide falls back to the base locale, so one English sentence
  appears in a Korean screen and nothing complains.
- **Hover and selection styling in the table view did nothing** ([#206]). `TableView.svelte` referred to
  `--surface-hover` (4 places), `--accent-soft` (1) and `--text-tertiary` (6), none of which exist in
  `app.css`. An undefined custom property is **not an error** — the declaration is simply dropped, so
  the build passed, `svelte-check` passed, and row hover, chip selection and de-emphasised text quietly
  did nothing. They now use the tokens that were meant: `--surface-raised`, `--accent-bg-subtle`,
  `--text-muted`. A test now fails if any `var(--x)` in the source is missing from `app.css`, with the
  offending file named in the message.
- **The search cache filename came from an unstable hash** ([#207]). `vault_key` derives the cache
  file's name from the vault path with `DefaultHasher`, whose values std explicitly does not guarantee
  across builds. If that value ever shifted, the app would look for a filename that does not exist —
  a silent full rebuild, with the previous cache left behind as an orphan nothing would ever read or
  clean up. Same root cause as the fingerprint fixed in v1.15.0, in a place where the symptom is
  slowness rather than a wrong answer. It now uses the specified FNV-1a construction from
  `crate::hash`, shared with the fingerprint so there is one written contract instead of two habits.

  Existing caches are **renamed, not rebuilt**: on the first read that misses, the old name is looked
  up and the files are moved. No version bump and no second reindex. If the old name cannot be
  reproduced the result is exactly today's behaviour — a rebuild — so the migration is never worse
  than doing nothing.

---

## [1.15.0] — 2026-08-26

### Added
- **Rename or merge a tag across the vault** ([#202]). Tags form a `/`-separated hierarchy that the
  sidebar renders as a prefix tree, but fixing a single typo meant opening every note that carried it
  by hand. Renaming a note has rewritten its inbound links for a long time; tags had no counterpart.
  Child tags follow the parent — renaming `tech` to `stack` turns `tech/svelte5` into `stack/svelte5`
  — and the boundary is only at `/`, so `technical` is left alone. Renaming onto an existing tag
  merges the two and is called out as such before you commit to it.

  It reuses the note-rename transaction exactly: dry-run preview, backup, sequential write, rollback
  on failure. And like `related:` rewriting, it edits the YAML **line by line rather than parsing and
  re-serializing** — that is the lesson from #184, where a parse failure wiped a note's frontmatter.
  Body `#tag` text is deliberately untouched, because the indexer ignores it for a reason.
- **Whole-vault literal and regex search** (`⌘⇧G`) ([#200]). In-document search (`⌘F`) had regex,
  case and whole-word for years; whole-vault search (`⌘⇧F`) had only BM25 token matching. That gap
  mattered because **BM25 and grep fail in opposite directions** — measured on this vault, grep
  returned nothing for 4 of 4 questions in `_memories` (the notes say "창", the query said "윈도우")
  while BM25 drowned the good hits in that same tree. `mcp/README.md` concluded "use both", but the
  app only had one arm. Matching runs in Rust over the same rayon-parallel walk the bundle read
  already uses. Clicking a result opens in-document search with the same pattern, so you land on the
  match instead of at the top of the note.

  ⚠️ Match offsets come **from Rust**, in UTF-16 code units. Recomputing them in the frontend would be
  wrong twice over: Rust's `regex` has no backreferences or lookaround, so JS `RegExp` can match
  somewhere else, and byte offsets would misplace every highlight on a line containing Korean.
- **A broken-link audit** ([#199]). The preview marks unresolved wikilinks with a class, but only in
  the note you happen to have open — across 19,000 notes that is not something you find by looking.
  It matters because, as the README says, the vault is written by other tools rather than by Lapis:
  renaming inside the app rewrites the links that point at a note, but a file deleted or renamed
  *outside* it breaks them silently, and nothing surfaced that. A new command lists every unresolved
  body link, **grouped by target and ordered by how many notes point at it** — the unit of repair is
  one missing note, not one link, so the top of the list is also the cheapest thing to fix. Computed
  on demand rather than during index build, so startup is untouched.

  ⚠️ Frontmatter cross-refs are deliberately out of scope. `relations.ts` treats "resolves to a note"
  as the definition of a relation, so auditing those fields would flag every ordinary scalar
  (`status: welcome`, `priority: high`) as a broken link. Body links carry their own syntax and have
  no such ambiguity.
- **A relative score (`rel`) that can be compared across queries** ([#198]). Raw BM25 scores could not
  be compared between queries — the same corpus answered `"멀티 윈도우"` with 63 and an English-mixed
  query with 1,494 (another sample: 848 vs 73), because IDF shifts with the query's term composition
  and is shard-local besides. That meant **no absolute cutoff was possible**, which hurt most in the
  `OR` fallback, where the ranker deliberately casts wide and nothing could trim the tail. Every ranked
  hit now carries `rel`, the score relative to that query's top hit (`1.0`). The MCP tool takes
  `min_rel` to drop the tail, and reports `used[].dropped_by_min_rel` so a filtered-out result is never
  silently missing. Ordering is untouched — `rel` is a monotone transform applied after the existing
  sort, so the eval harness's R@1/R@10/MRR are unchanged.

### Fixed
- **Staleness is now decided exactly, not estimated** ([#201]). `mcp/README.md` listed this under
  remaining limitations: the cache fingerprint came from Rust's `DefaultHasher`, whose values std
  explicitly does not guarantee across builds, so the MCP server could not reproduce it and fell back
  to comparing mtimes. That proxy **misses a file that was edited without its mtime moving** — the
  server answers "current" while the index is stale, which is worse than answering "I don't know".
  The hash is now a specified FNV-1a construction that both sides implement from the same written
  contract, pinned by identical test vectors in `vault.rs` and `mcp/fingerprint.test.ts`. Responses
  carry `stale.changed` (the exact verdict) and `stale.fingerprint`.

  The fingerprint input also normalizes paths to `/`, which closes a second issue: the same vault
  produced **different fingerprints on macOS and Windows**, so opening it from both meant a full
  rebuild every time.

  ⚠️ **Cache version 7 → 8.** The first launch after upgrading rebuilds the whole index once
  (about a minute at 19,000 notes). Once only.

---

## [1.14.0] — 2026-08-26

### Added
- **Windows (x64) support** ([#196]). The app builds and runs on Windows 10+ next to macOS, and CI now
  runs the Rust checks and tests on **both**. Three things had to change. **Paths** — Rust handed the
  frontend `\`-separated strings while the frontend splits on `/` in about twenty places, and Windows
  `canonicalize()` returns extended-length paths (`\\?\C:\...`); one boundary helper (`uipath::to_ui`)
  now normalizes both, with the same contract mirrored in the MCP server (`normPath`). **Images** — the
  static asset-protocol scope assumed a macOS layout, so a vault outside the user profile (`D:\notes`)
  rendered no images at all; the opened vault is now registered at runtime instead, which is also
  *narrower* than the static scope. **Shortcuts** — the palette showed `⌘K` on a machine where that key
  does not exist, so labels and the sample notes are rewritten to `Ctrl+K` at display time.

### Fixed
- **The knowledge-query MCP server could never find its cache on Windows** ([#196]). The app-data
  directory was hardcoded to `~/Library/Application Support`, so every query answered `cache_absent`
  no matter how healthy the index was.

---

## [1.13.0] — 2026-08-24

### Changed
- **Changing one note no longer re-reads the whole vault on startup** ([#192]). The cache key was a
  single hash over every file's `(path, mtime, size)`, so one edited note invalidated all of it. On the
  author's vault that meant re-reading **52.6 MB** of note bodies and re-indexing for **~5.3 s** —
  triggered, in practice, by 38 changed files out of 19,364 (0.2%). Because the vault is written by
  other tools rather than by Lapis, most launches took that path: something changed on 19 of the last
  30 days. Startup now compares a per-file stat snapshot against the previous one and, when few files
  moved, repairs only those — the same incremental machinery the file watcher already used. A full
  rebuild still happens when the change set is large, when the shard count would change, or when the
  snapshot is missing or does not match. The snapshot lives in its own file (231 KB gzipped, +1.6% of
  the cache) rather than in the metadata read on every launch, so an unchanged vault costs nothing extra.

### Fixed
- **Search result snippets could show a note's YAML header instead of the matching text** ([#191]).
  Ranking finds Korean text by character bigrams, but the snippet extractor only looked for the query
  typed verbatim. When a word carried a different particle — searching `인덱스로` against a note
  reading `인덱스를` — nothing matched and the fallback printed the first 120 characters, which by
  convention is the frontmatter block. The result was a search hit that could not show why it matched.
  Snippets now try the raw words first and then the same bigrams ranking uses, and never start inside
  frontmatter.
- **Switching vaults could leak the previous vault's notes into search results** ([#191]). Opening a
  vault cleared the link index but left the full-text worker loaded. Shards are only reset for the ones
  the new vault writes, and the shard count follows note count — so going from a large vault (8 shards)
  to a small one (1 shard) left shards 1–7 in memory, and every ready shard answers queries.
- **Five code fence languages rendered without any highlighting** ([#193]). Measured across the whole
  vault: `svelte` (18 fences), `dart` (15), `ruby` (7), `http` (4), and `objective-c` (2). The first
  three had no language registered; the last two were spelling variants no registered alias covered.
  `svelte` maps to the XML grammar, which still colors markup and the contents of `<script>`/`<style>`.

## [1.12.2] — 2026-08-24

### Fixed
- **Tables blew out sideways, while the columns that would have fit folded to one character per line**
  ([#189]). Inline code carried no line-breaking rule, so a long path without spaces
  (`dontalk/…/Foo.swift:1234`, or a brace shorthand like `A/{B,C,D}`) stayed a single unbreakable chunk.
  In a paragraph it pushed the whole pane sideways; in a table it inflated that column's minimum width,
  and the automatic table layout squeezed whatever was left over to the other columns — Korean breaks
  between any two characters, so the squeeze showed up as **one character per line** in a cell 545px tall.
  Inline code now wraps with `overflow-wrap: anywhere`, the one value that also lowers the minimum width
  (`break-word` does not, and would have left the table alone). Code blocks are excluded and still scroll
  horizontally, and exported HTML picks up the same rule. Measured on the author's vault: 321 of 1,301
  notes (24.7%) carry an inline code token longer than 60 characters with no space in it.

## [1.12.1] — 2026-08-21

### Fixed
- **A broken diagram left a "Syntax error in text" graphic stuck on screen** ([#187]). Mermaid draws
  its own error graphic into a temporary `div` it appends to `document.body`, and on a parse failure it
  throws without removing it. So the bomb icon floated at the bottom of the window, survived every note
  switch, and only went away when the app restarted — the note on screen did not even need to contain a
  diagram, because the wreckage came from some earlier note. Mermaid's error rendering is now suppressed
  and the temporary nodes are cleaned up; the failure is reported inline, where the broken block is.

## [1.12.0] — 2026-08-21

### Fixed
- **Editing a property could wipe a note's entire frontmatter** ([#184]). When the YAML failed to parse,
  the app read it as "no properties at all" and rewrote the block with only the key you just edited —
  everything else was gone. It now refuses the write and tells you to fix the YAML in the editor first.
  Measured on the author's vault: 1 note out of 19,213 is in exactly that state today.
- **Dates were rewritten on every property edit** ([#184]). `created: 2026-08-13` came back as
  `2026-08-13T00:00:00.000Z`, because js-yaml's default schema turns timestamps into `Date` objects.
  Reading and writing now both use the CORE schema, so dates stay text. The same bug leaked into the
  UI, where the properties panel showed `Thu Aug 20 2026 09:00:00 GMT+0900`.
- **The blank line between frontmatter and body vanished** on every property edit ([#184]) — the
  separator pattern swallowed the newline. Automatic link updates shared the same splitter and the
  same bug.

### Added
- **The search measurement harness now gates cost, not just quality** ([#182]). `lapis-eval` reports
  p50/p95/max latency next to R@1/R@10/MRR, adds a long-query probe (16 and 32 words — the quality
  cases can never produce one), and exits non-zero when a latency budget is exceeded. A previous
  change passed every quality metric while being four times slower; that was caught by hand.
- **`lapis-bench`** ([#182]) — index build cost: milliseconds per 1,000 notes, growth ratio from n/2 to
  n (to catch superlinear regressions), and **JSON bytes per note**. The size metric is the primary
  gate: it is deterministic, so a 15% margin is enough, while a wall-clock budget loose enough to
  survive a busy machine cannot detect a tokenizer regression at all.
- **42 tests for the frontmatter parser** ([#184]), which had none, and one more for effect dependency
  registration through a helper call ([#185]).

### Changed
- **Preview post-processing effects were rewritten** ([#185]). Five `$effect`s declared their
  dependency by assigning to a variable they never used (`const _html = parsed.html`); the pattern
  breaks silently if a guard moves in front of it. They now call a named `trackPreviewHtml()`, and the
  repeated "null check → `tick()` → null check again → post-process" sequence moved into one helper.
  No behavior change — verified by hand across wikilink colors, mermaid, theme switching, and `⌘F`.

## [1.11.0] — 2026-08-20

### Added
- **CI** — `.github/workflows/ci.yml`. On pull requests and pushes to `main`, it runs `svelte-check`,
  the MCP type check, vitest, and the vite build on Ubuntu, plus `cargo fmt --check`, `cargo clippy`
  (warnings as errors), `cargo check`, and `cargo test` on macOS.
- **`CHANGELOG.md`** — this file. With GitHub Releases unused, it stands in for release notes.
- **A test project for DOM and reactivity** (`*.dom.test.ts`), alongside the existing node one. Preview
  post-processing and Svelte effect timing can now be tested without mounting a component. It carries a
  canary: without `resolve.conditions: ["browser"]` vitest compiles for SSR, `$effect` becomes a no-op,
  and every reactivity test passes vacuously — the canary fails loudly instead.
- **`⌘⇧F` full-text search now offers the structural arm too** — matching tags and `doc_kind`/`topic`
  facets appear below the content hits. This alternative existed only in `⌘K` before.
  It was meant to help short queries, and measurement says it does not: the structural vocabulary is
  English (4 of 4,643 distinct tags contain Hangul, 5 of 299 topics, none of the 23 doc kinds), while
  the queries that score badly are Korean. They cannot meet. What this actually helps is queries
  written in the vocabulary's own language. Short Korean queries remain unsolved, and the answer is
  not here.
- **Window position and size survive a restart.** Every window remembers its own geometry, keyed by
  label, so a second window reopens where the last one was. If the monitor it was on is gone, the
  window falls back to a default position instead of restoring off-screen.

### Changed
- **Full-text combination now degrades in four steps instead of two.** It was AND-then-OR: if a single
  query word was missing from the target, AND returned nothing and the whole query fell back to OR,
  matching **10,346 documents on average** — 53% of the corpus. Typing a half-remembered title is not an
  edge case, and that was the worst path. Two stages now fill the gap: `AND-1` (drop one word, AND the
  rest) and `OR-min` (OR results filtered by matched-term count). Measured on 19,292 notes / 360 cases,
  queries carrying one bogus word went from **10,346 matches to 220 (−98%)** with R@1 **67.2% → 68.9%**.
  Clean queries are byte-for-byte unchanged — the new stages are only reachable when AND finds nothing.
  `AND-1` is capped at 8 words because it is O(n²): uncapped it scored 1.1pt higher but ran 4× slower
  (118ms average against 29ms before, and 860ms on a 32-word query).
- The MCP response field `used[].combine` gained two values, `AND-1` and `OR-min`. See `mcp/README.md`.
- Install instructions moved from a Releases download to building from source. Binary distribution stopped.
- **English is now the primary language for published documents.** `README.md` and `CHANGELOG.md` are the
  English originals; Korean lives in `README.ko.md` and `CHANGELOG.ko.md`. The former `README.en.md`
  became `README.md`.

### Fixed
- `mcp/lapis-eval` silently ignored its sample-size argument — the wrapper did not forward `"$@"`, so
  every run used the default. Two measurements were compared under different case counts before this
  surfaced.
- The release badge in the README was dead — with every release deleted, `github/v/release` had nothing
  to resolve. Replaced with a tag-based `github/v/tag`.

---

## [1.10.0] — 2026-08-19

UI localization and an MCP query toggle. Moving the repository to a personal account brought along
a round of cleanup for public consumption.

### Added
- **UI localization (ko/en)** — built on Paraglide JS 2. English is the source language and Korean is the
  translation. It follows the OS language by default and can be overridden in settings. 309 messages ([#171])
- **MCP query toggle** — turn the `lapis_query` tool on and off from app settings. **Blocked by default**,
  and the gate sits on `tools/call` rather than `tools/list`, so it takes effect without a restart ([#170])
- MIT LICENSE ([#166]), an English README and a language switcher ([#168])

### Fixed
- The properties autocomplete dropdown was clipped instead of escaping the context panel ([#169])
- The MCP wrapper depended on `PATH`, so the server never started under Claude Desktop ([#163])
- Partial settings writes — saving only some fields reset the rest to their defaults. The symptom stayed
  hidden while there was only one field ([#170])

### Docs
- README rewritten, repository URLs updated ([#165]), personal-tool disclaimer added ([#167])
- Corrected the search stack — the README had long claimed "tantivy + lindera", but that stack was removed
  in v1.3.0 ([#161], [#164])
- Added an MCP usage guide ([#162])

---

## [1.9.0] — 2026-08-13

Opened the knowledge vault up to queries from Claude Code, and cleared out several cache faults that had
been failing silently along the way.

### Added
- **`lapis_query` MCP server** — serves full-text and structural queries (backlinks, topic, tag, doc_kind)
  over the index the app builds. It exposes exactly one tool ([#156])
- Start editing where you were reading — the section anchor carries across the read/edit switch ([#154])

### Changed
- Full-text combination switched to AND-first with an OR fallback. Measurement showed the bottleneck was
  the combination strategy, not the tokenizer ([#159])

### Fixed
- Six faults where cache meta and shards drifted apart ([#155])
- Edits did not refresh the on-disk cache — a duplicated gate at the call site ([#158])
- Development and release builds shared an app data directory; they are now separate ([#157])

---

## [1.8.0] — 2026-08-11

Per-window vaults and a single read/edit toggle. The dormant graph code was removed.

### Added
- **A different vault per window** — watcher refcounting plus per-window event routing
- `⌘T` opens a new tab; `⌘P` now replaces the active tab
- Click the topbar path label to copy the absolute path

### Changed
- **Removed the Editor/Preview split in favor of a single read↔edit toggle**
- Editor loads lazily — startup payload 1089 KB → 543 KB
- Shortcut matching extracted to `keymap.ts` (27 tests); the welcome document to `welcomeDoc.ts`
- Removed the dormant graph feature (3,135 lines)

### Fixed
- New windows opened the previous vault — the per-window key is now evaluated lazily

---

## [1.7.0] — 2026-08-06

### Added
- Reading typography pass — adjustable measure, heading hierarchy, paragraph spacing ([#144])
- Debug build markers — window title and a topbar badge ([#146])

### Fixed
- The pane toolbar's ⋯ menu wrapped one character per line (a v1.6.0 regression) ([#145])

---

## [1.6.0] — 2026-08-05

A full UI overhaul. The shell layout borrows from chat apps (Discord): a left icon rail and a right
context panel.

### Added
- Design tokens — three surface layers, larger radii, two density steps ([#130])
- A permanent left icon rail with active-section indication ([#132]), and a new right context panel ([#133])
- Vault header dropdown and a bottom status bar ([#139]), rail tooltips ([#138])
- **Unread markers for notes that changed while you were away** ([#140])
- Enter/exit motion for overlays ([#137]); tab chip and category collapse motion ([#141])

### Changed
- Removed hard borders in favor of the three surface layers ([#131]); new accent color ([#135])
- Fresh installs default to a collapsed Editor; slimmer topbar ([#134])
- Items rendered as chips, rail pill morphing, uppercase categories ([#136])

### Fixed
- Outline entries clipped at the bottom; section badges capped at 9999+ ([#142])

---

## [1.5.0] — 2026-08-03

### Added
- Reveal in Finder — from the file tree, tabs, and both panes ([#127])
- Export the preview as a self-contained HTML file ([#128])
- A ⋯ overflow menu on the pane toolbar ([#126])

---

## [1.4.0] — 2026-06-22

Search quality and responsiveness.

### Added
- **Initial-consonant search in the Quick Switcher** — Korean jamo matching ([#119])
- **A Korean bigram tokenizer for full-text** — recall for compounds and inflections ([#120])
- Force index rebuild in settings — ignore the cache, reset the worker, rebuild everything ([#123])

### Changed
- Debounced palette search with lazily generated snippets ([#121])
- Quick Switcher normalization cache and progressive filtering ([#122])
- Git auto-commit now `add`s only changed paths, avoiding a full working-tree scan ([#118])

---

## [1.3.0] — 2026-06-18

### Removed
- **The entire claude-mem integration** ([#117]). **The tantivy + lindera morphological search engine went
  with it** — search has been a single MiniSearch stack ever since. The README failed to reflect this for
  a long time and was only corrected in v1.10.0.

---

## [1.2.2] — 2026-06-18

### Changed
- Graph feature temporarily disabled pending a 3D redesign ([#114])
- Watcher reindexing moved to the background, so live changes no longer block the sidebar ([#113])

### Fixed
- The mirror sync indicator got stuck on "syncing" forever — a listener re-registration race ([#115])

---

## [1.2.1] — 2026-06-18

### Fixed
- **A UTF-8 character boundary panic in `strip_md_extension`** — an immediate crash after release.
  Replaced with byte-slice comparison ([#110])
- Index build spinner freeze; the watcher missing the search index ([#111], [#112])

### Added
- Incremental indexing and a `.mmd` watcher ([#112])

---

## [1.2.0] — 2026-06-15

Version control the vault with git.

### Added
- A git version-control backend for the vault — shell-out commands ([#104])
- Auto-commit plus a banner for starting version control ([#105])
- Git history viewer — a "History" section in Neighborhood ([#106])
- A settings entry point for git version control, reachable after dismissing the banner ([#107])

### Fixed
- Git commands blocked the IPC thread and froze the UI for 30 seconds — async + `spawn_blocking` ([#108])

---

## [1.1.0] — 2026-06-11

### Added
- On-demand betweenness with a "bridge notes" toggle ([#97]); undirected conversion and a weighting toggle ([#101])
- Disparity filter backbone mode ([#98])
- A global `doc_kind` type filter for the graph ([#100])
- MOC suggestion diagnostics — MOC candidates, bridge notes, orphan notes ([#102])
- Drag-resizable expanded sidebar sections ([#99])

---

## [1.0.0] — 2026-06-08

A document-level knowledge graph and a restructured sidebar.

### Added
- Frontmatter type relation index and the Neighborhood panel ([#92])
- Field lens grouping in the Files tab ([#93])
- Document-level knowledge graph — data model and Local/ego mode ([#94]), Global mode and encoding ([#95])
- Vertical accordion sidebar navigation with an icon rail ([#96])

> The graph feature was disabled in v1.2.2 and its code removed in v1.8.0. It is not in the app today.

---

## [0.12.1] — 2026-06-05

### Fixed
- Tab context-menu actions like "Close other tabs" did nothing ([#90])

---

## [0.12.0] — 2026-06-04

### Added
- Persisted note tabs, restored per vault ([#85])
- Drag to reorder tabs; "close other tabs" from the context menu ([#86])
- Preview font size (zoom) control ([#87])

### Fixed
- Backlink cache now invalidates immediately on in-app rename, delete, and move ([#88])

---

## [0.11.0] — 2026-06-04

A note navigation bundle.

### Added
- **Wikilink autocomplete (`[[`)** — a CodeMirror completion dropdown ([#79])
- Note back/forward navigation ([#80]) and a history dropdown ([#81])
- **Note tabs (multiple open notes)** ([#82])
- A favorites/pins sidebar tab with recent notes ([#83])

---

## [0.10.0] — 2026-06-02

### Added
- Document outline (TOC) panel, synced both ways with the editor and preview ([#73])
- Word/character count and reading time in the topbar ([#72])
- An entry point for adding Properties even when frontmatter is empty ([#77])

### Changed
- Spacing tokenized — exact-match px values replaced with `--sp-*` ([#74])
- A `ModalShell` primitive and normalized z-index tokens ([#75])
- Automatic link updating now identifies code regions via an AST (markdown-it) instead of regex ([#76])
- Icon buttons unified under `.btn--icon` ([#77])

---

## [0.9.1] — 2026-06-01

### Fixed
- Mermaid PNG export — worked around WKWebView canvas tainting (blob → data URL) ([#71])

---

## [0.9.0] — 2026-06-01

### Added
- Syntax highlighting for preview code blocks — highlight.js wired to the `--cm-*` tokens ([#68])

### Changed
- **A full design system overhaul** — tokens plus a three-way theme (light/dark/system) ([#64])
- Normalized sizes and shapes; a button primitive ([#67])

### Fixed
- Mermaid diagram legibility in light mode — theme-adaptive rendering ([#66])

---

## [0.8.0] — 2026-05-29

### Added
- Mermaid diagram PNG export — atomic save from a hover button ([#62])

---

## [0.7.0] — 2026-05-27

### Added
- Collapsible sidebar — `⌘B`, a header button, and a collapsed strip ([#60])

---

## [0.6.0] — 2026-05-21

A performance bundle for large vaults.

### Changed
- Removed search cold init; added an LRU cache and a release profile ([#49])
- Vault cold-start bundle — `read_vault_bundle` on rayon ([#50])
- MiniSearch disk cache ([#51]); gzipped cache and lazy `fullTextIndex` loading ([#52])
- Split cache meta and JSON IPC; moved MiniSearch into a Web Worker ([#53])
- Virtualized the file tree ([#55])
- Sharded progressive loading of the search index — partial search 1.8s in, after the first shard ([#56]),
  with the shard count scaled to vault size ([#57])

### Added
- Copy the current note's absolute path; filter the sidebar tree by search ([#54])

---

## [0.5.1] — 2026-05-19

### Added
- Backup `max_keep` exposed in settings (1–100) ([#47])

### Removed
- The graph view, removed entirely — ADR-001 ([#45])

---

## [0.5.0] — 2026-05-18

### Added
- Dry-run preview for automatic link updating, with `.lapis` snapshot backups ([#42])
- Backup pruning (max 20) and automatic rollback on write failure ([#43])
- In-document search options — regex, case, whole word ([#39])
- vitest adopted, with golden tests for linkRewrite ([#41])

---

## [0.4.0] — 2026-05-14

### Added
- F2 rename and `⌘⌫` delete, Properties add, backlink invalidation ([#34])
- An F2 fallback in the Command Palette plus a note about Mac Magic Keyboards ([#35])
- Support for standalone `.mmd` files ([#36])

---

## [0.3.0] — 2026-05-14

### Added
- Export claude-mem session summaries into the vault; memory FTS search and a related-memory panel
- A `lapis-mem.db` mirror and a live sync engine
- The tantivy + lindera Korean morphological search engine
- The claude-mem integration made optional, off by default ([#30])

> Everything in this section was **removed in v1.3.0**.

---

## [0.2.0] — 2026-05-12

The first tag. Everything from Phase 0 through 5.0 landed here.

### Added
- Tauri 2 + SvelteKit + TypeScript scaffolding; a CodeMirror 6 + markdown-it + frontmatter proof of concept
- Open a vault, file tree, scroll sync
- Wikilinks, a backlinks panel, and safe link navigation
- Quick Switcher (`⌘P`), full-text search (`⌘⇧F`), a tag index, and Files/Tags sidebar tabs
- Editing and saving (`⌘S` + autosave) with **atomic writes**
- Frontmatter four-key schema recognition, hierarchical nested tags, `doc_kind`/`topic` facet filters
- A file watcher — external changes detected automatically, with conflict handling
- Vault operations (create, delete, rename, move) with automatic link updating
- The `⌘K` command palette; expandable backlink chips with context snippets
- Inline frontmatter editing, inline Mermaid code block rendering, relative image paths and a published-asset gallery
- In-document search — `⌘F` in each of the editor and preview

<!-- link references -->

[Unreleased]: https://github.com/eren0315/lapis/compare/v1.16.0...main
[2.4.1]: https://github.com/eren0315/lapis/compare/v2.4.0...v2.4.1
[2.4.0]: https://github.com/eren0315/lapis/compare/v2.3.1...v2.4.0
[2.3.1]: https://github.com/eren0315/lapis/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/eren0315/lapis/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/eren0315/lapis/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/eren0315/lapis/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/eren0315/lapis/compare/v1.20.0...v2.0.0
[1.20.0]: https://github.com/eren0315/lapis/compare/v1.19.0...v1.20.0
[1.19.0]: https://github.com/eren0315/lapis/compare/v1.18.0...v1.19.0
[1.18.0]: https://github.com/eren0315/lapis/compare/v1.17.0...v1.18.0
[1.17.0]: https://github.com/eren0315/lapis/compare/v1.16.0...v1.17.0
[1.16.0]: https://github.com/eren0315/lapis/compare/v1.15.0...v1.16.0
[1.15.0]: https://github.com/eren0315/lapis/compare/v1.14.0...v1.15.0
[1.14.0]: https://github.com/eren0315/lapis/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/eren0315/lapis/compare/v1.12.2...v1.13.0
[1.12.2]: https://github.com/eren0315/lapis/compare/v1.12.1...v1.12.2
[1.12.1]: https://github.com/eren0315/lapis/compare/v1.12.0...v1.12.1
[1.12.0]: https://github.com/eren0315/lapis/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/eren0315/lapis/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/eren0315/lapis/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/eren0315/lapis/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/eren0315/lapis/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/eren0315/lapis/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/eren0315/lapis/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/eren0315/lapis/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/eren0315/lapis/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/eren0315/lapis/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/eren0315/lapis/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/eren0315/lapis/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/eren0315/lapis/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/eren0315/lapis/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/eren0315/lapis/compare/v0.12.1...v1.0.0
[0.12.1]: https://github.com/eren0315/lapis/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/eren0315/lapis/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/eren0315/lapis/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/eren0315/lapis/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/eren0315/lapis/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/eren0315/lapis/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/eren0315/lapis/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/eren0315/lapis/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/eren0315/lapis/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/eren0315/lapis/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/eren0315/lapis/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/eren0315/lapis/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/eren0315/lapis/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/eren0315/lapis/releases/tag/v0.2.0

[#264]: https://github.com/eren0315/lapis/pull/264
[#263]: https://github.com/eren0315/lapis/pull/263
[#261]: https://github.com/eren0315/lapis/pull/261
[#259]: https://github.com/eren0315/lapis/pull/259
[#258]: https://github.com/eren0315/lapis/pull/258
[#256]: https://github.com/eren0315/lapis/pull/256
[#254]: https://github.com/eren0315/lapis/pull/254
[#253]: https://github.com/eren0315/lapis/pull/253
[#252]: https://github.com/eren0315/lapis/pull/252
[#251]: https://github.com/eren0315/lapis/pull/251
[#250]: https://github.com/eren0315/lapis/pull/250
[#249]: https://github.com/eren0315/lapis/pull/249
[#247]: https://github.com/eren0315/lapis/pull/247
[#246]: https://github.com/eren0315/lapis/pull/246
[#245]: https://github.com/eren0315/lapis/pull/245
[#243]: https://github.com/eren0315/lapis/pull/243
[#240]: https://github.com/eren0315/lapis/pull/240
[#239]: https://github.com/eren0315/lapis/pull/239
[#238]: https://github.com/eren0315/lapis/pull/238
[#237]: https://github.com/eren0315/lapis/pull/237
[#236]: https://github.com/eren0315/lapis/pull/236
[#235]: https://github.com/eren0315/lapis/pull/235
[#233]: https://github.com/eren0315/lapis/pull/233
[#232]: https://github.com/eren0315/lapis/pull/232
[#230]: https://github.com/eren0315/lapis/pull/230
[#229]: https://github.com/eren0315/lapis/pull/229
[#228]: https://github.com/eren0315/lapis/pull/228
[#227]: https://github.com/eren0315/lapis/pull/227
[#226]: https://github.com/eren0315/lapis/pull/226
[#224]: https://github.com/eren0315/lapis/pull/224
[#223]: https://github.com/eren0315/lapis/pull/223
[#221]: https://github.com/eren0315/lapis/pull/221
[#220]: https://github.com/eren0315/lapis/pull/220
[#219]: https://github.com/eren0315/lapis/pull/219
[#217]: https://github.com/eren0315/lapis/pull/217
[#216]: https://github.com/eren0315/lapis/pull/216
[#215]: https://github.com/eren0315/lapis/pull/215
[#214]: https://github.com/eren0315/lapis/pull/214
[#213]: https://github.com/eren0315/lapis/pull/213
[#212]: https://github.com/eren0315/lapis/pull/212
[#210]: https://github.com/eren0315/lapis/pull/210
[#209]: https://github.com/eren0315/lapis/pull/209
[#208]: https://github.com/eren0315/lapis/pull/208
[#207]: https://github.com/eren0315/lapis/pull/207
[#206]: https://github.com/eren0315/lapis/pull/206
[#202]: https://github.com/eren0315/lapis/pull/202
[#201]: https://github.com/eren0315/lapis/pull/201
[#200]: https://github.com/eren0315/lapis/pull/200
[#199]: https://github.com/eren0315/lapis/pull/199
[#198]: https://github.com/eren0315/lapis/pull/198
[#196]: https://github.com/eren0315/lapis/pull/196
[#193]: https://github.com/eren0315/lapis/pull/193
[#192]: https://github.com/eren0315/lapis/pull/192
[#191]: https://github.com/eren0315/lapis/pull/191
[#189]: https://github.com/eren0315/lapis/pull/189
[#187]: https://github.com/eren0315/lapis/pull/187
[#185]: https://github.com/eren0315/lapis/pull/185
[#184]: https://github.com/eren0315/lapis/pull/184
[#182]: https://github.com/eren0315/lapis/pull/182
[#171]: https://github.com/eren0315/lapis/pull/171
[#170]: https://github.com/eren0315/lapis/pull/170
[#169]: https://github.com/eren0315/lapis/pull/169
[#168]: https://github.com/eren0315/lapis/pull/168
[#167]: https://github.com/eren0315/lapis/pull/167
[#166]: https://github.com/eren0315/lapis/pull/166
[#165]: https://github.com/eren0315/lapis/pull/165
[#164]: https://github.com/eren0315/lapis/pull/164
[#163]: https://github.com/eren0315/lapis/pull/163
[#162]: https://github.com/eren0315/lapis/pull/162
[#161]: https://github.com/eren0315/lapis/pull/161
[#159]: https://github.com/eren0315/lapis/pull/159
[#158]: https://github.com/eren0315/lapis/pull/158
[#157]: https://github.com/eren0315/lapis/pull/157
[#156]: https://github.com/eren0315/lapis/pull/156
[#155]: https://github.com/eren0315/lapis/pull/155
[#154]: https://github.com/eren0315/lapis/pull/154
[#146]: https://github.com/eren0315/lapis/pull/146
[#145]: https://github.com/eren0315/lapis/pull/145
[#144]: https://github.com/eren0315/lapis/pull/144
[#142]: https://github.com/eren0315/lapis/pull/142
[#141]: https://github.com/eren0315/lapis/pull/141
[#140]: https://github.com/eren0315/lapis/pull/140
[#139]: https://github.com/eren0315/lapis/pull/139
[#138]: https://github.com/eren0315/lapis/pull/138
[#137]: https://github.com/eren0315/lapis/pull/137
[#136]: https://github.com/eren0315/lapis/pull/136
[#135]: https://github.com/eren0315/lapis/pull/135
[#134]: https://github.com/eren0315/lapis/pull/134
[#133]: https://github.com/eren0315/lapis/pull/133
[#132]: https://github.com/eren0315/lapis/pull/132
[#131]: https://github.com/eren0315/lapis/pull/131
[#130]: https://github.com/eren0315/lapis/pull/130
[#128]: https://github.com/eren0315/lapis/pull/128
[#127]: https://github.com/eren0315/lapis/pull/127
[#126]: https://github.com/eren0315/lapis/pull/126
[#123]: https://github.com/eren0315/lapis/pull/123
[#122]: https://github.com/eren0315/lapis/pull/122
[#121]: https://github.com/eren0315/lapis/pull/121
[#120]: https://github.com/eren0315/lapis/pull/120
[#119]: https://github.com/eren0315/lapis/pull/119
[#118]: https://github.com/eren0315/lapis/pull/118
[#117]: https://github.com/eren0315/lapis/pull/117
[#115]: https://github.com/eren0315/lapis/pull/115
[#114]: https://github.com/eren0315/lapis/pull/114
[#113]: https://github.com/eren0315/lapis/pull/113
[#112]: https://github.com/eren0315/lapis/pull/112
[#111]: https://github.com/eren0315/lapis/pull/111
[#110]: https://github.com/eren0315/lapis/pull/110
[#108]: https://github.com/eren0315/lapis/pull/108
[#107]: https://github.com/eren0315/lapis/pull/107
[#106]: https://github.com/eren0315/lapis/pull/106
[#105]: https://github.com/eren0315/lapis/pull/105
[#104]: https://github.com/eren0315/lapis/pull/104
[#102]: https://github.com/eren0315/lapis/pull/102
[#101]: https://github.com/eren0315/lapis/pull/101
[#100]: https://github.com/eren0315/lapis/pull/100
[#99]: https://github.com/eren0315/lapis/pull/99
[#98]: https://github.com/eren0315/lapis/pull/98
[#97]: https://github.com/eren0315/lapis/pull/97
[#96]: https://github.com/eren0315/lapis/pull/96
[#95]: https://github.com/eren0315/lapis/pull/95
[#94]: https://github.com/eren0315/lapis/pull/94
[#93]: https://github.com/eren0315/lapis/pull/93
[#92]: https://github.com/eren0315/lapis/pull/92
[#90]: https://github.com/eren0315/lapis/pull/90
[#88]: https://github.com/eren0315/lapis/pull/88
[#87]: https://github.com/eren0315/lapis/pull/87
[#86]: https://github.com/eren0315/lapis/pull/86
[#85]: https://github.com/eren0315/lapis/pull/85
[#83]: https://github.com/eren0315/lapis/pull/83
[#82]: https://github.com/eren0315/lapis/pull/82
[#81]: https://github.com/eren0315/lapis/pull/81
[#80]: https://github.com/eren0315/lapis/pull/80
[#79]: https://github.com/eren0315/lapis/pull/79
[#77]: https://github.com/eren0315/lapis/pull/77
[#76]: https://github.com/eren0315/lapis/pull/76
[#75]: https://github.com/eren0315/lapis/pull/75
[#74]: https://github.com/eren0315/lapis/pull/74
[#73]: https://github.com/eren0315/lapis/pull/73
[#72]: https://github.com/eren0315/lapis/pull/72
[#71]: https://github.com/eren0315/lapis/pull/71
[#68]: https://github.com/eren0315/lapis/pull/68
[#67]: https://github.com/eren0315/lapis/pull/67
[#66]: https://github.com/eren0315/lapis/pull/66
[#64]: https://github.com/eren0315/lapis/pull/64
[#62]: https://github.com/eren0315/lapis/pull/62
[#60]: https://github.com/eren0315/lapis/pull/60
[#57]: https://github.com/eren0315/lapis/pull/57
[#56]: https://github.com/eren0315/lapis/pull/56
[#55]: https://github.com/eren0315/lapis/pull/55
[#54]: https://github.com/eren0315/lapis/pull/54
[#53]: https://github.com/eren0315/lapis/pull/53
[#52]: https://github.com/eren0315/lapis/pull/52
[#51]: https://github.com/eren0315/lapis/pull/51
[#50]: https://github.com/eren0315/lapis/pull/50
[#49]: https://github.com/eren0315/lapis/pull/49
[#47]: https://github.com/eren0315/lapis/pull/47
[#45]: https://github.com/eren0315/lapis/pull/45
[#43]: https://github.com/eren0315/lapis/pull/43
[#42]: https://github.com/eren0315/lapis/pull/42
[#41]: https://github.com/eren0315/lapis/pull/41
[#39]: https://github.com/eren0315/lapis/pull/39
[#36]: https://github.com/eren0315/lapis/pull/36
[#35]: https://github.com/eren0315/lapis/pull/35
[#34]: https://github.com/eren0315/lapis/pull/34
[#30]: https://github.com/eren0315/lapis/pull/30
