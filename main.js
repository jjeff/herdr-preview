// Preview: a side panel (beside Files and Changes) that lists the files the
// focused terminal has mentioned (Markdown, text-like data, images), newest
// first, and shows one formatted. Works on any machine Herdr is connected to: the terminal's
// output comes from `hc read` and the file from that machine through
// herdr-core, so nothing needs to be mounted. Local files can be edited;
// other machines' files are read-only (writeTextFile has no `on`).
// doc.js and blocks.js are copies of markdown-panel's (from herdr-kanso).
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, focused, terminals, hc, exec, watchFolder, theme, appHome, props, openOverlay, closeOverlay } from "herdr";
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { createHash } from "crypto";
import { Buffer } from "buffer";
import { MarkdownDoc, tildePath } from "./doc.js";
import { mentions, folders } from "./mentions.js";

const ICONS = "mods/preview/icons";
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
// image() only loads from the app's own folder, so a picture is copied here first.
const CACHE = "cache/preview";

// An image file, shown with the same interface main.js uses for MarkdownDoc.
// Read again on the same timer/watch; a new copy is written only when the bytes change.
class ImageDoc {
  constructor(path, on) { this.path = path; this.on = on; this.editing = false; this.src = null; this.error = null; }
  load(cx) {
    cx.spawn(async (cx) => {
      try {
        // Another machine's file: its checksum first, and the bytes (as base64) only when that changed.
        // ponytail: a changed huge image still comes over whole; fine for screenshots.
        let bytes;
        if (this.on) {
          const r = await exec("sh", ["-c", 'c=$(cksum < "$1") || exit 1; echo "$c"; [ "$c" = "$2" ] || base64 < "$1"', "sh", this.path, this.sum ?? ""], { on: this.on });
          if (r.code !== 0) throw new Error(r.stderr.trim() || "not found");
          const nl = r.stdout.indexOf("\n");
          if (r.stdout.slice(0, nl) === this.sum && this.src) { this.error = null; return; }
          this.sum = r.stdout.slice(0, nl);
          bytes = Buffer.from(r.stdout.slice(nl + 1), "base64");
        } else bytes = await readFile(this.path);
        if (!bytes.length) throw new Error("empty or unreadable");
        const name = `${CACHE}/${createHash("sha1").update(bytes).digest("hex")}.${IMAGE.exec(this.path)[1].toLowerCase()}`;
        if (name !== this.src) {
          await mkdir(`${appHome()}/${CACHE}`, { recursive: true });
          await writeFile(`${appHome()}/${name}`, bytes);
          this.release(); this.src = name;
        }
        this.error = null;
      } catch (e) { this.error = `Cannot read this image: ${e?.message ?? e}`; }
      cx.notify();
    });
  }
  flush() { return Promise.resolve(true); }
  release() { if (this.src) unlink(`${appHome()}/${this.src}`).catch(() => {}); }
  controls() { return []; }
  key() {}
  body(t, id) {
    if (this.error) return div().p(16).text_color(t.dim).child(this.error);
    if (!this.src) return div().p(16).text_color(t.dim).child("Reading…");
    return div().id(`${id}-scroll`).flex_1().min_h(0).overflow_y_scrollbar().p(12)
      .child(div().id(`${id}-img`).cursor_pointer().tooltip("Show larger")
        .on_click(() => openOverlay({ mod: "preview", props: { image: this.src, name: nameOf(this.path) }, kind: "dialog", width: 0.92, height: 0.92 }))
        .child(image(this.src).max_w_full()));
  }
}
// hc read falls back to the bare screen when a full-screen program (Claude
// Code) has less history than asked for, so step down until it stitches.
// Each read is a trip through herdr-core (and the network, for another
// machine), so start at the depth that worked last time for this terminal.
const DEPTHS = [2000, 1000, 500, 200, 100, 50];
const depthOf = new Map();
async function readTerminal(address) {
  let last = "";
  for (let i = depthOf.get(address) ?? 0; i < DEPTHS.length; i++) {
    const r = await hc(["read", address, "--json", "--lines", String(DEPTHS[i])]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "hc read failed");
    const d = JSON.parse(r.stdout);
    if (d.complete) { depthOf.set(address, i); return d.text; }
    last ||= d.text;
  }
  return last;
}
const REMOTE_READ_MS = 3000;
const FOLLOW_MS = 1500;
const SETTLE_MS = 2500;
const FOLDER_MAX = 40;
const folderOf = (path) => path.replace(/\/[^/]*$/, "") || "/";
const nameOf = (path) => path.split("/").pop();

// Runs on the terminal's machine, in one trip. First: the mentioned paths that
// exist there, made absolute (relative to the terminal's folder, ~ to that
// machine's home), in the same order. Then a SPLIT line, then the folder's own
// Markdown: what git tracks, else a shallow look (no node_modules or hidden folders).
const SPLIT = "::preview-folder::";
const RESOLVE = `cd "$1" 2>/dev/null && inside=1; dirs=$2; shift 2
nl='
'
for p; do
  case $p in "~/"*) p="$HOME/\${p#??}";; esac
  # A relative path: the terminal's folder first, then the folders it printed.
  case $p in /*) ;; *) f=$p; IFS=$nl; for d in $dirs; do
    case $d in "~/"*) d="$HOME/\${d#??}";; esac
    [ -f "$f" ] && break; f="$d/$p"
  done; unset IFS; p=$f;; esac
  [ -f "$p" ] || continue
  d=$(cd "$(dirname "$p")" && pwd -P) && printf '%s/%s\\n' "$d" "$(basename "$p")"
done
echo "${SPLIT}"
[ -n "$inside" ] || exit 0
here=$(pwd -P)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git ls-files -- '*.md' '*.markdown' '*.mdx'
else
  find . -maxdepth 3 \\( -name node_modules -o -path '*/.*' \\) -prune -o -type f \\( -iname '*.md' -o -iname '*.markdown' -o -iname '*.mdx' \\) -print | sed 's#^\\./##'
fi | head -2000 | sed "s#^#$here/#"`;

// The folder's Markdown, nearest first, without what the terminal mentioned.
const nearest = (paths, skip) => paths.filter((p) => !skip.has(p))
  .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)).slice(0, FOLDER_MAX);

// The terminal the panel follows, and its machine (null: this one). Same rule
// as the Files panel; a remote pane's terminal gets its machine/ prefix.
function target() {
  const f = focused();
  if (!f?.terminal) return null;
  const space = spaces().find((s) => s.active);
  const on = f.pane === null ? (f.terminal.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const address = on && !f.terminal.includes("/") ? `${on}/${f.terminal}` : f.terminal;
  return { address, on, cwd: f.cwd || space?.folder || "" };
}

export default class Preview extends View {
  init(_props, cx) {
    // Opened as an overlay to show one image large: nothing else to set up.
    if ((this.lightbox = props()?.image ? props() : null)) return;
    this.at = null; this.files = null; this.folder = []; this.doc = null; this.error = null; this.scans = 0;
    this.handle = cx.focus_handle();
    // Herdr doesn't redraw a mod when an agent's status changes, so look on a
    // timer too. Only in-memory reads here; the terminal is read on a change.
    this.ticker = cx.timer.every(FOLLOW_MS, (cx) => this.follow(cx));
  }

  // Follow the focused terminal (clicking into this panel keeps the last one),
  // and read it again when its agent starts or finishes a turn.
  follow(cx) {
    const now = target();
    if (now && now.address !== this.at?.address) {
      this.at = now; this.beat = this.heartbeat();
      if (!this.doc) this.scan(cx);
      else cx.notify();
    } else if (this.at) {
      const beat = this.heartbeat();
      if (beat !== this.beat) {
        this.beat = beat;
        if (this.doc) return;
        this.scan(cx, true);
        // The agent can report the change before it draws its last words.
        cx.timer.after(SETTLE_MS, (cx) => { if (!this.doc) this.scan(cx, true); });
      }
    }
  }

  // Changes when the terminal's agent changes status or starts a turn.
  // ponytail: plain shells report no status, so they only refresh on ↻.
  heartbeat() {
    const a = this.at.address, short = a.split("/").pop();
    const t = terminals().find((t) => t.address === a || (t.address === short && !this.at.on));
    return t ? `${t.status}:${t.turn}` : null;
  }

  // Reads the terminal again and lists what it mentioned.
  // keep: leave the current list up while it's read again (same terminal).
  scan(cx, keep = false) {
    const at = this.at, n = ++this.scans;
    this.busy = (this.busy ?? 0) + 1; cx.notify();
    if (!keep) { this.files = null; this.folder = []; this.error = null; }
    cx.spawn(async (cx) => {
      try {
        // Remember what each terminal mentioned, so paths that scroll away stay listed.
        const seen = (this.seen ??= new Map()).get(at.address) ?? { found: [], dirs: [] };
        const text = await readTerminal(at.address);
        const found = [...new Set([...mentions(text), ...seen.found])].slice(0, 60);
        const dirs = [...new Set([...folders(text), ...seen.dirs])].slice(0, 30);
        this.seen.set(at.address, { found, dirs });
        let files = found, folder = [];
        // ponytail: sh-only; a Windows machine shows the paths unchecked and no folder list.
        const ok = await exec("sh", ["-c", RESOLVE, "sh", at.cwd, dirs.join("\n"), ...found], { on: at.on }).catch(() => null);
        if (ok?.code === 0) {
          const [mentioned, inFolder = ""] = ok.stdout.split(SPLIT + "\n");
          files = [...new Set(mentioned.split("\n").filter(Boolean))];
          folder = nearest(inFolder.split("\n").filter(Boolean), new Set(files));
        }
        if (n === this.scans) { this.files = files; this.folder = folder; this.error = null; }
      } catch (e) { if (n === this.scans) { this.files = []; this.error = String(e?.message ?? e); } }
      this.busy--;
      cx.notify();
    });
  }

  open(path, cx) {
    const before = this.doc, on = this.at?.on ?? null;
    cx.spawn(async (cx) => {
      if (before && !(await before.flush())) { cx.notify(); return; }
      before?.release();
      this.doc = IMAGE.test(path) ? new ImageDoc(path, on) : new MarkdownDoc(path, on, (to) => this.open(to, cx), ICONS);
      this.doc.load(cx);
      if (on) this.poll(path, cx); else this.watch(path, cx); // watchFolder is local only
      cx.notify();
    });
  }

  watch(path, cx) {
    cx.spawn(async (cx) => {
      try { while (this.doc?.path === path) { await watchFolder(folderOf(path)); if (this.doc?.path === path) this.doc.load(cx); } } catch {}
    });
  }

  // Another machine's file, read again every few seconds while it's shown.
  poll(path, cx) {
    cx.timer.after(REMOTE_READ_MS, (cx) => {
      if (this.doc?.path !== path) return;
      if (!this.doc.editing) this.doc.load(cx);
      this.poll(path, cx);
    });
  }

  back(cx) {
    const doc = this.doc;
    if (!doc) return;
    cx.spawn(async (cx) => {
      if (!(await doc.flush())) { cx.notify(); return; }
      doc.release(); this.doc = null;
      cx.notify();
      this.scan(cx, true);
    });
  }

  // The image filling a dialog; a click anywhere (or Esc, or outside) closes it.
  lightboxView() {
    const t = theme(), { image: src, name, overlay } = this.lightbox;
    return v_flex().id("mda-lightbox").size_full().bg(t.background).text_color(t.foreground).cursor_pointer()
      .on_click(() => closeOverlay(overlay))
      .child(h_flex().h(36).flex_none().px(12).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.dim).child(name ?? ""))
        .child(div().id("mda-lightbox-close").p(4).rounded(6).text_color(t.muted).tooltip("Close (Esc)")
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).child(svg(`${ICONS}/close.svg`).size(14))))
      .child(div().flex_1().min_h(0).p(12).child(image(src).size_full()));
  }

  render(cx) {
    if (this.lightbox) return this.lightboxView();
    this.follow(cx);
    const t = theme(), doc = this.doc;
    const button = (id, icon, tip, action, spin = false) => div().id(id).p(4).rounded(6).cursor_pointer().text_color(spin ? t.foreground : t.muted).tooltip(tip)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => action(cx))
      .child(svg(`${ICONS}/${icon}.svg`).size(14).when(spin, (el) => el.spin(900)));
    // Spins while the terminal is being read: on ↻, and on the panel's own
    // looks (focus change, the agent starting or finishing a turn).
    const looking = !doc && this.busy > 0;
    const where = this.at ? (this.at.on ? `${this.at.on} · ${this.at.address}` : this.at.address) : "";
    return v_flex().id("preview").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => doc?.key(e, cx))
      .child(h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .when(Boolean(doc), (el) => el.child(button("mda-back", "chevron-left", "Back to file list", (cx) => this.back(cx))))
        .child(v_flex().flex_1().min_w(0).pl(doc ? 0 : 4)
          .child(div().truncate().font_semibold().child(doc ? nameOf(doc.path) : "Preview"))
          .child(div().truncate().text_size(11).text_color(t.dim).child(doc ? tildePath(folderOf(doc.path), doc.on) : where)))
        .children(doc ? doc.controls(t, "mda") : [])
        .when(!doc || !doc.editing, (el) => el.child(button("mda-refresh", "refresh", doc ? "Read again" : looking ? "Looking…" : "Look again",
          (cx) => doc ? doc.load(cx) : this.at && this.scan(cx), looking))))
      .child(doc ? doc.body(t, "mda-doc") : this.listView(t));
  }

  listView(t) {
    const note = (text) => div().p(16).text_size(12.5).text_color(t.dim).child(text);
    if (!this.at) return note("Focus a terminal to see the files it mentioned.");
    if (this.files === null) return note("Looking for files…");
    if (this.error) return note(`Cannot read this terminal: ${this.error}`);
    // Click a heading to fold its list. "In this folder" starts folded.
    // ponytail: remembered for this run only; localStorage needs the storage capability.
    const shut = (this.shut ??= new Set(["folder"]));
    const heading = (key, text, n) => div().id(`mda-h-${key}`).px(10).pt(10).pb(4).text_size(11).font_semibold().text_color(t.dim)
      .cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { shut.has(key) ? shut.delete(key) : shut.add(key); cx.notify(); })
      .child(`${shut.has(key) ? "▸" : "▾"} ${text}${shut.has(key) && n ? ` (${n})` : ""}`);
    const row = (key) => (f, i) => v_flex().id(`mda-${key}-${i}`).px(10).py(5).rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.open(f, cx))
      .child(div().truncate().child(nameOf(f)))
      .child(div().truncate().text_size(11.5).text_color(t.dim).child(tildePath(folderOf(f), null)));
    return v_flex().id("mda-files").flex_1().min_h(0).overflow_y_scrollbar().p(6)
      .child(heading("t", "Mentioned", this.files.length))
      .when(!shut.has("t") && !this.files.length, (el) => el.child(div().px(10).py(4).text_size(12.5).text_color(t.dim).child("No files mentioned yet.")))
      .children(shut.has("t") ? [] : this.files.map(row("t")))
      .when(this.folder.length > 0, (el) => el.child(heading("folder", "In this folder", this.folder.length))
        .children(shut.has("folder") ? [] : this.folder.map(row("f"))));
  }
}
