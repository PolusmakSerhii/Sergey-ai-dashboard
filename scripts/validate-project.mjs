import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.equal((html.match(/\$\{data\.totalAvailableSymbols \?\? 0\} MARKETS/g) || []).length, 2, "Market count must use the English MARKETS label");
assert.match(html, /src="assets\/sm1m-logo-transparent-v5\.png"/, "Lossless transparent SM1M logo asset is missing");
assert.doesNotMatch(html, /sm1m-logo-desktop\.svg/, "Desktop logo must not depend on an externally masked SVG");
assert.match(html, /src="assets\/bitcoin-star-transparent\.png"/, "Bitcoin star asset is missing");
assert.match(html, /\.header-star\s*\{[\s\S]*?width:\s*119px;[\s\S]*?height:\s*119px;/, "Bitcoin star must be 10% smaller");
assert.doesNotMatch(html, /header-logo-infinity/, "Legacy infinity logo overlay must be removed");
assert.match(html, /\.header-logo-wrap\s*\{[\s\S]*?top:\s*calc\(50% \+ 5mm\);[\s\S]*?width:\s*min\(297px, 100%\)/, "Desktop header logo must sit 5mm below center");
assert.match(html, /\.header-logo\s*\{[\s\S]*?filter:\s*none;/, "Header logo must remain crisp without CSS blur");
assert.match(html, /\.header\s*\{[\s\S]*?overflow:\s*hidden;/, "Header must clip logo artwork to the panel bounds");
assert.match(html, /\.header-logo\s*\{[\s\S]*?mix-blend-mode:\s*normal;/, "Transparent logo must render without blend modes");
assert.match(html, /<html\b/i, "index.html must contain an html element");
assert.match(html, /<body\b/i, "index.html must contain a body element");
assert.match(html, /Completed Trades/i, "Completed Trades section is missing");
assert.match(html, /AI CHAT ASSISTANT/i, "AI Assistant section is missing");
assert.match(
  html,
  /Recommendation Confidence/,
  "Recommendation Confidence column is missing"
);
assert.match(html, /class="mobile-scanner-list"/, "Compact mobile scanner list is missing");
assert.match(html, /mobile-scanner-signal">Signal /, "Mobile scanner must show Signal confidence");
assert.match(html, /mobile-scanner-recommendation">Rec\. /, "Mobile scanner must show recommendation confidence");
assert.match(
  html,
  /\.mobile-scanner-row\s*\{[\s\S]*?grid-template-columns:\s*28px minmax\(0, 1\.55fr\) minmax\(0, 0\.58fr\) minmax\(0, 0\.5fr\) minmax\(0, 1\.15fr\)/,
  "Mobile scanner rows must use aligned vertical columns"
);
assert.match(
  html,
  /@media \(max-width: 560px\)[\s\S]*?#scanner-table \.market-scanner-table\s*\{[\s\S]*?display:\s*none;[\s\S]*?#scanner-table \.mobile-scanner-list\s*\{[\s\S]*?display:\s*block;/,
  "Mobile scanner must replace the desktop table only on small screens"
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
assert.match(html, />\s*AI Chat Assistant\s*<\/p>/, "AI Chat heading must not include Preview");
assert.doesNotMatch(html, /AI Chat Assistant · Preview/i, "AI Chat Preview label must be removed");
assert.ok(
  html.indexOf('id="ai-assistant"') > html.indexOf('id="scanner-pagination"') &&
  html.indexOf('id="ai-assistant"') < html.indexOf('class="card ai-market-core"'),
  "AI Chat must appear immediately after the coin table"
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
assert.match(html, /id="market-trend-visual"/, "Header market trend visual is missing");
assert.match(html, /Bullish:\s*\{[\s\S]*?market-bull-transparent\.png/, "Bullish trend must show the bull asset");
assert.match(html, /Bearish:\s*\{[\s\S]*?market-bear-transparent\.png/, "Bearish trend must show the bear asset");
assert.match(html, /trendVisual\.hidden = !trendAsset/, "Neutral trend must hide the trend visual");
assert.match(html, /class="card ai-market-core"/, "AI Market Core wrapper is missing");
assert.match(html, /id="ai-market-core-title">AI Market Core<\/p>/, "AI Market Core heading is missing");
assert.match(html, /\.ai-market-core \.grid > \.card\s*\{[\s\S]*?padding:\s*12px 14px/, "AI Market Core cards must use compact sizing");
assert.match(
  html,
  /\.ai-market-core \.grid > \.card > \.card-label,[\s\S]*?\.statistics-history-card > summary \.statistics-metric-label\s*\{[\s\S]*?color:\s*#4fe3b1/i,
  "Selected card headings must match the Buy color"
);
assert.match(html, /id="statistics" style="margin-top: 6px;"/, "Statistics section spacing must be 6px");
assert.match(html, /\.statistics-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/, "Statistics metrics must use three columns");
assert.match(html, /\.statistics-metric\s*\{[\s\S]*?padding:\s*12px 14px/, "Statistics metrics must match AI Market Core sizing");
assert.match(html, /\.ai-market-core \.grid > \.card \.card-value\s*\{[\s\S]*?font-size:\s*13px/, "AI Market Core values must match the section heading size");
assert.match(html, /\.ai-market-core \.market-overview-card \.card-value\s*\{[\s\S]*?font-size:\s*13px/, "AI Market overview values must match the section heading size");
assert.match(html, /\.statistics-grid \.statistics-metric-value\s*\{[\s\S]*?font-size:\s*13px/, "Statistics values must match the section heading size");
assert.match(html, /\.statistics-chart-header \.statistics-metric-label\s*\{[\s\S]*?color:\s*#4fe3b1/i, "Statistics chart headings must match Active Trades color");
assert.match(html, /<details class="statistics-history-card statistics-collapsible" id="advanced-analytics">/, "Advanced Analytics collapsible section is missing");
assert.doesNotMatch(html, /<details class="statistics-history-card statistics-collapsible" id="advanced-analytics"\s+open/, "Advanced Analytics must be collapsed by default");
assert.ok(html.indexOf('id="advanced-analytics"') < html.indexOf('id="statistics-active-count"'), "Advanced Analytics must remain above the trade history sections");
assert.match(html, /\.ai-chat-preview\s*\{[\s\S]*?margin-top:\s*6px/, "AI Chat section spacing must be 6px");
assert.match(html, /const NEWS_URL\s*=/, "News Background endpoint is missing");
assert.match(html, /Не влияет на торговый Score/, "News Background safety label is missing");
assert.match(html, />Market News<\/p>/, "News heading must be Market News");
assert.match(html, /BullishNews:\s*"🟢 Bullish News"/, "Bullish news mode is missing");
assert.match(html, /StopTrading:\s*"⚠️ Stop Trading"/, "Stop trading news mode is missing");
assert.match(html, /\.card-label\.news-background-heading\s*\{[\s\S]*?color:\s*#00e676/i, "News heading must use neon green");
assert.match(
  html,
  /#market-scanner > \.card-label,[\s\S]*?#ai-assistant \.ai-chat-header > \.card-label\s*\{[\s\S]*?color:\s*#00e676/i,
  "Primary dashboard section headings must use the Market News neon green"
);
assert.ok(
  html.indexOf('id="news-background"') < html.indexOf('class="dashboard-market-shell"') &&
  html.indexOf('id="news-background"') < html.indexOf('class="dashboard-tabs"'),
  "News Background must appear above the market tabs"
);
assert.match(
  html,
  /\.card\.news-background\s*\{[\s\S]*?min-height:\s*0/,
  "Collapsed News Background must use compact height"
);
assert.match(
  html,
  /@media \(max-width: 560px\)[\s\S]*?\.news-background-summary\s*\{[\s\S]*?align-items:\s*baseline !important;[\s\S]*?flex-direction:\s*row/,
  "Mobile Market News summary must match the compact trade sections"
);
assert.match(
  html,
  /@media \(max-width: 560px\)[\s\S]*?\.news-background-status\s*\{[\s\S]*?margin-left:\s*auto;[\s\S]*?background:\s*transparent/,
  "Mobile Market News status must remain compact and right aligned"
);
assert.match(
  html,
  /@media \(max-width: 560px\)[\s\S]*?\.header-brand\s*\{[\s\S]*?position:\s*relative;[\s\S]*?height:\s*142px;[\s\S]*?\.header-logo-wrap\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*50%;[\s\S]*?left:\s*50%;[\s\S]*?\.header-star\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?right:\s*4px;/,
  "Mobile header must center the logo and place the Bitcoin artwork at the upper right"
);
assert.match(
  html,
  /@media \(max-width: 560px\)[\s\S]*?\.header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?\.header-status-group\s*\{[\s\S]*?justify-self:\s*stretch;/,
  "Mobile header rows must align across the full panel width"
);
assert.match(
  html,
  /<span>Opened<strong>\$\{openedTime\}<\/strong><\/span>/,
  "Completed Trades must show the opening time"
);
assert.match(
  html,
  /\.trade-plan-grid > \*\s*\{[\s\S]*?min-height:\s*84px;[\s\S]*?height:\s*84px;[\s\S]*?padding:\s*11px;/,
  "Trade Plan cards must be 30% smaller and uniformly sized"
);

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());

assert.ok(inlineScripts.length > 0, "index.html must contain an inline script");

for (const [index, source] of inlineScripts.entries()) {
  new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` });
}

console.log(`Frontend validation passed (${inlineScripts.length} inline script checked).`);
