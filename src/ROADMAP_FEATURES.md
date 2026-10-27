# Roadmap Studio: feature specification

This document lists **every feature of the Roadmap tab** in Study Hub. Use it as the starting spec for a separate project: a public, roadmap.sh-style site where an owner publishes roadmaps from a dashboard, and anyone can follow one and track personal progress **without signing in**.

Legend used in this file:

- **Built**: exists today in the Roadmap tab (`Roadmap.jsx`).
- **Change**: exists today but must work differently in the public product.
- **New**: does not exist yet; needed for the public product.
- **Drop**: specific to Study Hub, leave it out of the new project.

Sections 1 to 8 describe what is built. Sections 9 to 12 describe how it must change for the public product.

---

## 1. Roadmaps (several of them)

| Feature | Behaviour | Status |
|---|---|---|
| Roadmap switcher | A row of pill tabs, one per roadmap. Each tab shows the title and the overall progress percentage. The active one is highlighted. The row scrolls sideways on small screens. | Built |
| Create | "+ New roadmap" opens a dialog with a name and a starting point: an empty roadmap, or a copy of the current one. | Built |
| Rename | The big title field above the map edits the open roadmap's name. | Built |
| Duplicate | Menu item: copies the open roadmap (new ids everywhere) as "Name (copy)". | Built |
| Reorder | Menu items "Move left" and "Move right" change the tab order. | Built |
| Delete | Menu item with a two-click confirmation. Not allowed when only one roadmap is left. Anything that linked to the deleted roadmap becomes a normal item again. | Built |
| Remember the open roadmap | The last open roadmap stays open after a reload. | Built |
| Follow a link and come back | Opening a linked roadmap pushes the current one on a "trail". A "← Back to X" button pops it. Clicking a tab clears the trail. | Built |

## 2. Roadmap structure

A roadmap is an ordered list of **topics**. Each topic can have **subtopics** and one **gate**. There are exactly two levels: topic and subtopic (no sub-subtopics).

| Element | Look and behaviour |
|---|---|
| Topic | A numbered square (230 px wide) in a vertical snake: odd topics sit on the left, even topics on the right. Shows number and title, timeframe, a 4-line description, the priority label and a progress bar. |
| Subtopic | A smaller square (170 px wide) placed beside its topic on the side facing the centre, connected to the topic by an elbow line. Shows title and priority label. Each topic has a dashed "+ Subtopic" button under its subtopics. |
| Gate | A diamond under a topic with a name and a pass criterion ("Build a feature in 3 h, with tests"). Click the diamond to mark it passed. A "key gate" has an accent outline. |
| Add, edit, delete | Topics and subtopics can be added, edited, duplicated, deleted and moved up or down. A new item opens its panel and puts the cursor in the title. |
| Empty state | "No topics yet. Add your first topic to start the path." |

## 3. What every topic and subtopic holds (the side panel)

Clicking a square opens a panel from the right (full width on a phone). `Esc`, the Close button or a click outside closes it. A subtopic's panel has a "← Parent" button.

| Field | Details |
|---|---|
| Title | Text. |
| Short description | One line, shown on topic squares. |
| Timeframe | Free text such as "Weeks 1–5". |
| Linked roadmap | Choose another roadmap this item points to (see section 5). |
| Status | Not started, In progress, Done. Disabled when the item is linked, because the status then follows the linked roadmap. |
| Priority | Mandatory, Recommended, Nice to have, Optional. |
| Study notes | Read mode and edit mode. A small Markdown subset: `#` to `###` headings, `-` or `*` lists, `**bold**`, `` `code` ``. Text is HTML-escaped before rendering. |
| Checklist | Steps with a checkbox and text. Add, edit, delete. Drives the progress bar. |
| Subtopics (topics only) | A list with done checkbox, title, priority and an Open button. |
| Resources | Type (Docs, Video, Article, Course, Book), title and URL, with an Open link for `http(s)` URLs. |
| Projects | Name, description, done checkbox. |
| Gate (topics only) | Toggle "this topic ends with a gate", then name, criteria, "passed" and "key gate". |
| Actions | Move up, move down, duplicate, delete (two-click confirmation). |

## 4. Priority levels and colours

| Level | Default colour | Border | Meaning |
|---|---|---|---|
| Mandatory | violet `#7c6cff` | solid 2 px | Must learn |
| Recommended | blue `#3b9dff` | solid 1.5 px | Should learn |
| Nice to have | amber `#f5a524` | dashed | Learn if time allows |
| Optional | teal `#2fbfa8` | dotted | Extra |

- Each square has a 14% tint of its priority colour, a border in the full colour and a small label.
- Colour is never the only clue: the border style differs too, for colour-blind readers.
- Status overrides the border and tint: **In progress** gets an amber border, **Done** gets a green tint and border.
- The four colours are user settings (a "Colours" dialog with live preview and a reset button).
- Legend chips under the title double as filters: click one to highlight only that priority and dim the rest.

## 5. Linking roadmaps

An item (topic or subtopic) can point at another roadmap. Example: the "JavaScript" subtopic inside a full-stack roadmap points at the "JavaScript" roadmap.

**Rules**

1. A linked item shows a "↗ Roadmap name" badge, the other roadmap's progress bar and a small ↗ button that opens that roadmap.
2. Its checkbox is disabled. Its status is computed:
   - **Done** when every topic and every subtopic of the linked roadmap is done (and the roadmap has at least one item).
   - **In progress** when at least one is done.
   - **Not started** otherwise.
3. Links chain: A can point to B and B to C. The status is computed recursively.
4. **Loops are impossible.** The picker disables any roadmap that already reaches the current one ("would loop back here"), and the computation also stops if it meets a roadmap it is already inside (protection against bad imported data).
5. When a roadmap becomes 100% finished, a toast says so and lists the roadmaps where it now counts as done, with a celebration sound.
6. Deleting a roadmap clears every link that pointed to it.

```text
effectiveStatus(item, chain = [])
    if item has no link, or the target is missing, or the target is in chain
        return item.status
    p = progress(target roadmap, chain + [target])
    return p.total > 0 and p.done == p.total ? "done" : p.done > 0 ? "doing" : "todo"

progress(roadmap)          counts topics and subtopics, using effectiveStatus
reaches(from, target)      depth-first search through links, with a visited set
```

## 6. Progress, motivation and navigation

| Feature | Details |
|---|---|
| Item progress | Topic bar = share of (checklist steps + subtopics) that are done. A topic with neither counts 100% when its own status is Done. A linked topic shows the linked roadmap's progress. |
| Roadmap progress | A bar plus text: `37% · 7/19 items · mandatory 3/9`. Items are topics and subtopics. The mandatory counter is separate. |
| Tab percentages | Every tab shows its roadmap's percentage. |
| Continue | Scrolls to the first unfinished **mandatory** item, otherwise the first unfinished item, and shows a toast. |
| Search | Matches title, description, notes and checklist text. Non-matching squares are dimmed, not hidden. |
| Hide subtopics | A toggle for an overview of just the topics. |
| Confetti | A burst from the checkbox when something is marked done. |
| Sounds | Check, uncheck, finish a topic, pass a gate, add, delete, move, roadmap complete. Synthesised in the browser with the Web Audio API, so there are no audio files. They can be turned off globally. |
| Accessibility | Every control has a label, toggles use `aria-pressed`, the panel is a dialog, the focus ring is visible, animations respect `prefers-reduced-motion`. |

## 7. The map drawing (how the snake and the lines work)

**Layout**

- A column of rows with a 70 px gap. Odd rows are `left`, even rows `right` (`flex-direction: row-reverse`), each with 2% padding from its edge.
- A row holds the topic cell (topic square + optional gate) and the subtopic column, with a 56 px gap.
- Below 700 px wide the rows become a single column: the topic first, subtopics wrapped underneath, right-aligned for right rows, and the subtopic connectors are hidden.

**Connector lines** are SVG paths drawn in a layout effect from the real DOM rectangles:

```text
for each topic i, between topic i and topic i+1:
    x1 = centre x of cell i           y0 = bottom of cell i (bottom of the whole row on mobile)
    y1 = bottom of the whole row      x2 = centre x of topic i+1       y2 = top of topic i+1
    d  = max(30, (y2 - y1) * 0.6)
    path = M x1 y0  V y1  C x1 (y1+d), x2 (y2-d), x2 y2
```

- Each connector is two stacked paths: a dashed grey base and a green "fill" path with `pathLength=1`, `stroke-dasharray=1` and a `stroke-dashoffset` that animates from 1 to 0 over 0.8 s with a soft glow.
- The fill is switched on when `effectiveStatus(topic) == done` **and** (the topic has no gate **or** its gate is passed).
- Subtopic connectors are elbow lines (`M xs ys H xmid V ye H xe`) from the side of the topic to the side of each subtopic, solid green when that subtopic is done, dashed grey otherwise.
- The paths are created once and reused, so changing status animates the fill instead of redrawing it.
- Redraw triggers: after every render, on window resize, when the rows' size changes (`ResizeObserver`) and when web fonts finish loading.

## 8. Data model (JSON)

This is the current shape. Everything is plain JSON.

```ts
type Priority = 'must' | 'rec' | 'nice' | 'opt'
type Status = 'todo' | 'doing' | 'done'

interface Store {                       // everything the user owns today
    order: string[]                     // roadmap ids, in tab order
    active: string                      // open roadmap id
    maps: Record<string, Roadmap>
}

interface Roadmap {
    id: string
    title: string
    topics: Item[]
}

interface Item {                        // topic, or subtopic (subs is empty)
    id: string
    title: string
    desc: string
    when: string                        // timeframe
    status: Status                      // ignored when ref points at an existing roadmap
    priority: Priority
    notes: string                       // Markdown subset
    ref: string | null                  // id of another roadmap
    steps: { id: string; t: string; done: boolean }[]
    subs: Item[]                        // only on topics
    res: { id: string; type: 'Docs' | 'Video' | 'Article' | 'Course' | 'Book'; t: string; url: string }[]
    proj: { id: string; t: string; desc: string; done: boolean }[]
    gate: { name: string; desc: string; highlight: boolean; done: boolean } | null   // only on topics
}
```

Defaults and safety rules in the importer: unknown priority becomes `rec`, unknown status becomes `todo`, missing ids are generated, a non-string `ref` becomes `null`, and the gate only exists on topics.

## 9. Backup and import (built, and the model for the public product)

| Feature | Details |
|---|---|
| Export | A dialog with the JSON in a text area. Scope: all roadmaps, or only the open one. Buttons: Copy, Download (`roadmaps.json` or `<title>.json`). |
| Import | Paste or edit JSON, then Import. A set (`maps` and `order`) **replaces** everything. A single roadmap (`topics`) is **added** as a new tab. Invalid input shows a clear message and changes nothing. |
| Reset | "Reset to the examples" with a two-click confirmation. |
| Migration | An older single-roadmap save is wrapped into the new multi-roadmap shape the first time it is opened. |

---

## 10. The public product: what must change

**The idea**

- An **owner dashboard** (login required, for authors only) creates and edits roadmaps.
- Roadmaps are stored **online and public**: anyone with a link can open one.
- **Readers have no accounts.** Their progress is saved in their own browser and can be exported and imported.

### 10.1 Separate content from progress (the most important change)

Today the content and the progress live in the same object (`status`, `steps[].done`, `gate.done` sit next to the title). That cannot work for a shared roadmap. Split them:

```ts
// Online, public, edited by the owner. Contains no personal state.
interface PublishedRoadmap {
    slug: string                // stable, used in the URL
    rev: number                 // increases on every publish
    title: string
    topics: ItemContent[]       // Item without status, done flags, or gate.done
}

// Stays in the reader's browser.
interface Progress {
    slug: string
    rev: number                 // the roadmap revision this was last saved against
    updatedAt: number
    items: Record<string, {     // keyed by the stable item id
        status?: Status
        steps?: Record<string, true>      // checked step ids
        projects?: Record<string, true>
        gate?: true
        notes?: string                    // the reader's personal notes
    }>
}
```

- Item, step, project and gate ids must be **stable forever**. The dashboard must never regenerate ids when editing, or readers lose their progress.
- Progress is keyed by id, so adding, moving and renaming items does not break it. Progress for removed items is kept silently (it may come back) and ignored in the totals.
- Linked roadmaps (section 5) compute from the reader's local `Progress` for the target roadmap. The page must load the target roadmap's content by slug. If the reader never opened it, it counts as 0%.

### 10.2 Where the reader's progress lives

| Option | Use it for |
|---|---|
| **IndexedDB** (recommended) | Main store: database `roadmap-progress`, object store `progress` keyed by `slug`. Larger, structured, and works from a web worker. |
| `localStorage` | Fallback when IndexedDB is unavailable (some private modes). Keys `rm.progress.<slug>`. |
| `navigator.storage.persist()` | Ask once so the browser is less likely to evict the data. |

- Writes are debounced (about 300 ms) and also flushed on `visibilitychange` and `pagehide`.
- Progress for a different roadmap never interferes: it is one record per slug.

### 10.3 Export and import for readers (their backup)

- **Export** all progress as one file: `{ "app": "roadmap-studio", "version": 1, "exportedAt": "...", "progress": { "<slug>": Progress } }`. Also offer "export this roadmap's progress".
- **Import** with a preview ("3 roadmaps, 87 items checked") and two modes: **merge** (per item, the most recently updated wins) and **replace**. Reject files that do not match the schema and never execute or render anything from them.
- Show a gentle reminder ("last backup 30 days ago") because clearing browser data deletes progress.
- Optional transfer between devices without an account: a share code or QR that encodes compressed progress in the URL hash (never sent to the server).

### 10.4 Updating a roadmap that people are already following

- Keep the `rev` in each reader's progress. On a newer `rev`, show a small banner: "This roadmap was updated" with a changelog (topics added, removed, renamed).
- New mandatory topics appear as not started. Removed items disappear from totals.
- The owner can mark a publish as "breaking" (ids changed) so the banner offers a best-effort match by title.

### 10.5 Backend (owner side only)

- Public **read-only** API: list roadmaps, get one by slug. Cacheable at the edge with `ETag` and a long `Cache-Control`. No cookies and no tracking, so no consent banner is needed.
- **Write** access only for authenticated owners (a normal login, kept separate from readers). Validate every roadmap against the schema on write, enforce a size limit and sanitise all text.
- Static pre-rendering for each roadmap page (good for SEO, link previews and fast first paint), with the interactive map hydrating over it.
- A free tier is enough to start: static hosting plus a small database or object storage with public read rules.

## 11. Ideas to be better than roadmap.sh (all New)

- Progress without any account, on every page (this spec), plus export and import.
- **Cross-roadmap links** with automatic completion (section 5).
- **Gates**: checkpoints between topics that unlock the next line.
- **Per-item priority colours** that the reader can change.
- Time: an estimate per topic and a total ("about 120 h left") computed from the reader's progress.
- Resource filters by type (video, book, free only) and a "my notes" field per item.
- **Offline-first PWA**: roadmaps open without a connection after the first visit.
- Deep links to any topic (`/frontend#topic=abc123`), and an embeddable widget for blogs.
- A read-only "show my progress" image or link a reader can share (generated locally from their progress).
- Print and PDF view of a roadmap with checked items.
- Right-to-left and full translation support (Arabic, for example), plus keyboard-only operation.
- A changelog per roadmap and a public "suggest a change" link (optional, moderated).

## 12. Things to drop or redo from Study Hub

| Study Hub feature | In the new project |
|---|---|
| "→ Today" buttons that add a step, resource or project to the weekly todo board | **Drop** (no dashboard of the reader's own). |
| Cloud sync of the owner's whole store through Firebase | **Drop** for readers. The owner dashboard uses the real backend instead. |
| Streaks, XP and badges | Optional **New**: compute them from local progress only. |
| Roadmap content and progress in one object | **Change**: split as in 10.1. |
| Random ids created when the example data loads | **Change**: stable ids chosen by the owner's dashboard. |

## 13. Known limits of the current Roadmap tab (fix in the new project)

- Only two levels (topic, subtopic). Sub-subtopics are not supported.
- Gates exist only on topics.
- Topics can be moved up and down but not dragged.
- Notes support a small Markdown subset only (no links, images or tables).
- The vertical layout has fixed square sizes; very large roadmaps (hundreds of items) would need virtualised rendering.
- Priorities are four fixed levels; per-item custom colours and custom tags do not exist.
- No version history for a roadmap, and no multi-author editing.

---

## 14. Tree layout, threads, side topics, connections and the zoomable canvas (Study Hub)

This replaces the left/right snake described in sections 2 and 7. Progress rules (sections 5 and 6) are unchanged: every topic, side topic and subtopic counts as one item.

| Feature | Behaviour |
|---|---|
| Centred tree | The first topic of a thread sits in the middle; the next topics stack straight below it (30 px gap). |
| Threads | Parallel paths side by side, each with a header card (name, progress, hover actions: + Topic, move left/right, delete). Create them with **+ Thread** or choose 1 to 4 when creating a roadmap. |
| Side topics | **+ Side topic** (or hover a topic and press ＋→, or the drawer button) starts a path to the right of a topic, for example Node.js beside TypeScript. A side path can have its own topics below it and its own side topics. |
| Subtopics | Fan out to the left of their topic, 5 per column; the 6th starts a new column further left. |
| Connections | **Connect** (or 🔗 on a topic, or the drawer list) links any topic to any other, across threads. Drawn as a dashed arrow, green once the source is done. Click a line to remove it. |
| Zoom and move | Wheel zooms (button "Wheel: zoom / move" switches it; Ctrl + wheel and pinch always zoom). Drag the background, or hold **Space** and drag anywhere, or use the middle mouse button, to move. Keys when the canvas has focus: arrows move, + and - zoom, 0 fits, 1 is 100 %. Fit, 100 % and Full screen buttons. Range 15 % to 250 %. |
| Sounds | New category "Roadmap map": zoom steps, zoom limit, fit, pick, connect, unlink, side topic, thread. |

Data (all optional on old roadmaps; `ensureStructure()` in `roadmapLayout.js` repairs them):

```ts
interface Roadmap { /* ...existing */ threads: { id: string; title: string }[]
                    lanes:   { id: string; thread: string; from: string | null }[]   // from = topic the side path grows out of
                    conns:   { id: string; from: string; to: string }[] }
interface Item    { /* ...existing */ lane: string }                                    // top-level topics only
```

- Topics stay in the flat `topics` array, so progress in Dashboard, Study Group and Notes is computed exactly as before.
- Old roadmaps load as one thread ("Main path") with one path and no connections, and are saved in the new shape on first open.
- Copying or importing a roadmap gives every object a new id and rewrites the references between them.
- Deleting a topic moves its side paths to the nearest topic of its own path and removes its connections.
- Layout uses fixed box sizes (topic 230x132, subtopic 180x50), so positions are computed, not measured.
