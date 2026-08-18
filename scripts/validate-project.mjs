import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.match(html, /<html\b/i, "index.html must contain an html element");
assert.match(html, /<body\b/i, "index.html must contain a body element");
assert.match(html, /Completed Trades/i, "Completed Trades section is missing");
assert.match(html, /AI CHAT ASSISTANT/i, "AI Assistant section is missing");
assert.match(
  html,
  /Recommendation Confidence/,
  "Recommendation Confidence column is missing"
);
assert.match(
  html,
  /Showing \$\{filteredResults\.length\} on this page · \$\{totalResults\} markets total/,
  "Scanner total count is missing"
);
assert.match(
  html,
  /scannerResultTotal\s*=\s*actionFilteredResults\.length/,
  "Global ranking refresh must retain the scanner total"
);
assert.match(
  html,
  /Следующая цель: 100 сделок/,
  "Completed Trades must show the next statistics milestone"
);
assert.match(
  html,
  /\.statistics-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
  "Statistics must use four columns on wide screens"
);
assert.match(
  html,
  /\.market-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  "Market overview must use three columns on wide screens"
);
assert.equal(
  [...html.matchAll(/id="best-setup-symbol"/g)].length,
  1,
  "Global Best Setup must appear exactly once"
);
assert.match(
  html,
  /<details class="card ai-chat-preview statistics-collapsible">/,
  "AI Chat must be collapsible and closed by default"
);
assert.doesNotMatch(
  html,
  /<details class="card ai-chat-preview statistics-collapsible" open>/,
  "AI Chat must not be open by default"
);

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());

assert.ok(inlineScripts.length > 0, "index.html must contain an inline script");

for (const [index, source] of inlineScripts.entries()) {
  new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` });
}

console.log(`Frontend validation passed (${inlineScripts.length} inline script checked).`);
