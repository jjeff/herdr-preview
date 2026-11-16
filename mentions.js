// Previewable file paths (Markdown, text-like data, images) in terminal text, last mentioned first.
export function mentions(text) {
  const seen = new Set(), out = [];
  const tokens = text.split(/[\s`'"()<>\[\]{}|,*]+/).reverse();
  for (let t of tokens) {
    t = t.replace(/^file:\/\//, "");
    if (t.includes("://")) continue;
    t = t.replace(/(:\d+)+$/, "").replace(/[.:;!?]+$/, "");
    if (!/[\w-]\.(md|markdown|mdx|txt|log|csv|tsv|json|jsonl|ya?ml|toml|xml|ini|conf|png|jpe?g|gif|webp|bmp|svg)$/i.test(t) || seen.has(t)) continue;
    seen.add(t); out.push(t);
    if (out.length >= 60) break;
  }
  return out;
}
