import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.match(html, /<html\b/i, "index.html must contain an html element");
assert.match(html, /<body\b/i, "index.html must contain a body element");
assert.match(html, /Completed Trades/i, "Completed Trades section is missing");
assert.match(html, /AI CHAT ASSISTANT/i, "AI Assistant section is missing");

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());

assert.ok(inlineScripts.length > 0, "index.html must contain an inline script");

for (const [index, source] of inlineScripts.entries()) {
  new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` });
}

console.log(`Frontend validation passed (${inlineScripts.length} inline script checked).`);
