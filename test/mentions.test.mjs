// Run: node test/mentions.test.mjs
import assert from "node:assert/strict";
import { mentions, folders } from "../mentions.js";

const text = "Read `docs/PLAN.md:12`, see ~/notes/a.md. Also https://x.com/b.md and (README.md) then docs/PLAN.md again; file:///tmp/z.mdx";
assert.deepEqual(mentions(text), ["/tmp/z.mdx", "docs/PLAN.md", "README.md", "~/notes/a.md"]);
assert.deepEqual(mentions("shot at /tmp/a.PNG, data in out.json:3 and notes.txt."), ["notes.txt", "out.json", "/tmp/a.PNG"]);
assert.deepEqual(mentions("nothing here but main.rs and photo.heic"), []);
assert.deepEqual(folders("cd /Users/me/Code/site/src && ls ~/Code/ops."),
  ["~/Code/ops", "~/Code", "/Users/me/Code/site/src", "/Users/me/Code/site", "/Users/me/Code"]);
const wrapped = "  › [image]/private/tmp/x/scratc\n  hpad/ui-1.png  (172.4KB)\nsee /usr/local\nbin.md";
assert.ok(mentions(wrapped).includes("/private/tmp/x/scratchpad/ui-1.png"));
assert.ok(!mentions("cd /usr/local\nls notes.md").includes("/usr/localls"));
console.log("mentions: ok");
