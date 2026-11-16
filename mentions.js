const tokensOf = (text) => text.split(/[\s`'"()<>\[\]{}|,*]+/).reverse()
  .map((t) => t.replace(/^file:\/\//, "").replace(/(:\d+)+$/, "").replace(/[.:;!?]+$/, ""));

// Previewable file paths (Markdown, text-like data, images) in terminal text, last mentioned first.
export function mentions(text) {
  const seen = new Set(), out = [];
  for (const t of tokensOf(text)) {
    if (t.includes("://")) continue;
    if (!/[\w-]\.(md|markdown|mdx|txt|log|csv|tsv|json|jsonl|ya?ml|toml|xml|ini|conf|png|jpe?g|gif|webp|bmp|svg)$/i.test(t) || seen.has(t)) continue;
    seen.add(t); out.push(t);
    if (out.length >= 60) break;
  }
  return out;
}

// Folders the terminal printed (absolute or ~/ paths, and their parents), last
// mentioned first: an agent that cd's elsewhere prints paths relative to there.
// Parents stop at /a/b/c or ~/a, so /, /Users and the home folder are not searched.
export function folders(text) {
  const out = new Set();
  for (const t of tokensOf(text)) {
    if (!/^(\/|~\/)/.test(t) || t.includes("://")) continue;
    const parts = t.split("/");
    for (let n = parts.length, min = t[0] === "~" ? 2 : 4; n >= min && out.size < 30; n--) out.add(parts.slice(0, n).join("/"));
  }
  return [...out];
}
