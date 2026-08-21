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
  /<details class="card ai-chat-preview statistics-collapsible"(?:\s+id="[^"]+")?>/,
  "AI Chat must be collapsible and closed by default"
);
assert.doesNotMatch(
  html,
  /<details class="card ai-chat-preview statistics-collapsible"[^>]*\sopen(?:\s|>)/,
  "AI Chat must not be open by default"
);
assert.match(
  html,
  /\.ai-chat-preview:not\(\[open\]\)\s*\{[\s\S]*?min-height:\s*0/,
  "Collapsed AI Chat must use compact height"
);
assert.doesNotMatch(
  html,
  /terminal-sidebar/,
  "Dashboard must not render a left sidebar"
);
assert.match(
  html,
  /width:\s*min\(1240px,\s*calc\(100% - 28px\)\)/,
  "Dashboard must retain its compact desktop width"
);
for (const tab of ["global-ranking", "top-coins", "watchlist"]) {
  assert.match(
    html,
    new RegExp(`data-dashboard-tab="${tab}"`),
    `Dashboard tab ${tab} is missing`
  );
  assert.match(
    html,
    new RegExp(`data-dashboard-panel="${tab}"`),
    `Dashboard panel ${tab} is missing`
  );
}
assert.match(html, /id="news-background"/, "News Background section is missing");
assert.match(html, /const NEWS_URL\s*=/, "News Background endpoint is missing");
assert.match(html, /Не влияет на торговый Score/, "News Background safety label is missing");
assert.match(html, /Market News & Upcoming Events · Informational/, "News heading must be in English");
assert.match(html, /Bullish News \(Новости на рост\)/, "Bullish news mode is missing");
assert.match(html, /Stop Trading \(Непонятная ситуация \/ Стоп торги\)/, "Stop trading news mode is missing");
assert.ok(
  html.indexOf('id="news-background"') > html.indexOf('id="scanner-pagination"') &&
  html.indexOf('id="news-background"') < html.indexOf('<section class="grid">'),
  "News Background must appear immediately after the coin table shell"
);
assert.match(
  html,
  /\.card\.news-background\s*\{[\s\S]*?min-height:\s*0/,
  "Collapsed News Background must use compact height"
);
assert.match(
  html,
  /<span>Opened<strong>\$\{openedTime\}<\/strong><\/span>/,
  "Completed Trades must show the opening time"
);

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());

assert.ok(inlineScripts.length > 0, "index.html must contain an inline script");

for (const [index, source] of inlineScripts.entries()) {
  new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` });
}

console.log(`Frontend validation passed (${inlineScripts.length} inline script checked).`);
