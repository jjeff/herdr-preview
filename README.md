# herdr-preview

A side panel for the [Herdr](https://github.com/herdrdev/herdr-app) app that
lists the files the focused terminal has mentioned — Markdown, text-like data
files and images — and shows them formatted — on **any machine Herdr is connected to**, with nothing mounted.

Coding agents print paths that are local to the machine they run on. When that 
machine is a remote one, those paths mean nothing to your desktop. This panel
reads the terminal's output and the files themselves through herdr-core's
existing connection, so a path Claude printed on a remote Mac opens right
where you are.

## What it does

- Reads the focused terminal's screen and history (`hc read`), finds every
  previewable path in it — Markdown (`.md`, `.markdown`, `.mdx`), text-like
  files (`.txt`, `.log`, `.csv`, `.tsv`, `.json`, `.jsonl`, `.yaml`, `.yml`,
  `.toml`, `.xml`, `.ini`, `.conf`) and images (`.png`, `.jpg`, `.gif`,
  `.webp`, `.bmp`, `.svg`) — absolute, `~/…`, relative to the
  terminal's folder, `file://` links and `path.md:42` references — and lists
  them **newest first**.
- Keeps only the paths that exist on the terminal's machine.
- Lists the terminal folder's own Markdown below the mentioned files ("In this folder"):
  what git tracks, else a search three levels deep that skips hidden folders
  and `node_modules`.
- Click a list heading to fold it. "In this folder" starts folded, with its
  count shown.
- Shows a file formatted: Markdown rendered, text-like files as one
  highlighted block, images full width. Local Markdown can be edited in place
  (double-click a block), other local text files with Edit; saves never
  overwrite a change an agent made meanwhile.
- Refreshes when the terminal's agent starts or finishes a turn, and on ↻.
  An open file reloads as it changes (local) or every 3 seconds (other
  machines).
- Follows the focused terminal; clicking into the panel keeps the last one.

## Install

```sh
git clone https://github.com/jjeff/herdr-preview ~/.config/herdr-app/mods/preview
herdr-app check ~/.config/herdr-app/mods/preview
```

Clone it into the mods folder itself. Herdr does not load a mod's icons
through a symlink that points outside `~/.config/herdr-app`.

The panel goes in your layout's side-panel stack, next to Files and Changes.
Herdr's shipped layouts are read-only, so clone one first
(`herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`), then add
this child to the `panel-body` stack in `layouts/my-layout.json`:

```json
{ "id": "markdown", "type": "block", "content": { "mod": "preview" } }
```

Add a button for it to your tab-bar mod beside the Files and Changes ones. In
a clone of the shipped `tabs` mod, that is one more panel button:

```js
.child(panelButton("markdown", "Preview", "mods/preview/icons/markdown.svg"))
```

and `"markdown"` in the list of enabled panels. Or open it from a key in
`keys.json`, using the `layout.select` (`{"stack":"panel-body","child":"markdown"}`)
and `layout.show` (`{"id":"panel"}`) commands.

## Limits

- **Other machines' files are read-only.** Herdr's `writeTextFile` only writes
  on this machine.
- For full-screen programs such as Claude Code, `hc read` returns only the
  screen when asked for more history than the terminal has, so the panel
  steps down from 2000 lines until a read is complete. Paths a terminal has
  mentioned stay listed until the app restarts.
- A relative path or bare filename is looked up in the terminal's folder,
  then in the folders the terminal printed (an agent that `cd`s elsewhere, or
  started in one repo and works in another). One that is in none of them is
  dropped; there is no search of subfolders.
- Plain shells report no agent status, so they refresh only on ↻.
- Images are copied into `~/.config/herdr-app/cache/preview` to be shown
  (Herdr loads images only from its own folder). Another machine's image
  is checked every 3 seconds while open and copied over (as base64) only
  when its checksum changed.
- Text-like files longer than 2000 lines show only their last 2000 lines
  and are not editable.
- The "In this folder" list is Markdown only.
- Path checks use `sh`; on a Windows machine the paths are listed unchecked
  and there is no "In this folder" list.

## Test

```sh
node test/mentions.test.mjs
herdr-app check .
```

## License

Apache-2.0. The Markdown renderer (`doc.js`, `blocks.js`) comes from
[Kanso](https://github.com/jlopezlira/herdr-kanso)'s markdown-panel; see
[NOTICE](NOTICE).
