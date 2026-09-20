(() => {
  'use strict';
  const endpoint = 'https://sergey-ai-trader-api.vercel.app/api/market?mode=entry-setups';
  const notice = 'Analytical layer. Does not change trade execution.';
  const text = value => value === null || value === undefined ? 'N/A' : String(value);
  function node(tag, value, className = '') {
    const element = document.createElement(tag);
    element.className = className;
    if (value !== undefined) element.textContent = text(value);
    return element;
  }
  function details(setup, dialog) {
    dialog.replaceChildren();
    const close = node('button', 'Close'); close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    dialog.append(close, node('h2', `${setup.symbol} · ENTRY SETUP ANALYSIS`), node('p', notice),
      node('p', `Lifecycle: ${text(setup.lifecycleStatus)}`));
    const section = (title, values) => {
      const box = node('section'); box.append(node('h3', title));
      const list = node('dl');
      for (const [label, value] of values) list.append(node('dt', label), node('dd', value));
      box.append(list); dialog.append(box);
    };
    const p = setup.originalPlan || {}, o = setup.origin || {}, c = setup.current || {}, a = setup.entryAnalysis || {};
    section('ORIGINAL A+ PLAN', [['Original Grade', o.originalGrade], ['Original Score', o.originalScore],
      ['Original Confidence', o.originalConfidence], ['Direction', setup.direction], ['Detected At', o.detectedAt],
      ['Entry Zone', `${text(p.entryFrom)} – ${text(p.entryTo)}`], ['Planned midpoint', p.plannedEntry],
      ['Initial SL', p.initialSL], ['TP1', p.TP1], ['TP2', p.TP2], ['TP3', p.TP3], ['Original R:R', p.originalRR]]);
    section('CURRENT ENTRY ANALYSIS', [['Saved Ranking as of', c.asOf], ['Current Price', c.price],
      ['Current Grade', c.currentGrade], ['Current Score', c.currentScore], ['Current Confidence', c.currentConfidence],
      ['Pullback / frozen risk distance (not ATR)', a.pullbackR], ['Theoretical R:R to frozen TP2', a.currentRR],
      ['Structure', 'N/A'], ['Entry Status', 'Analysis pending'], ['Entry Quality', 'N/A'], ['Projection updated', a.updatedAt]]);
    dialog.showModal();
  }
  function render(root, setups, dialog) {
    root.replaceChildren(node('p', notice));
    if (!setups.length) { root.append(node('p', 'No verified open A+ setups.')); return; }
    const table = node('table'), head = node('tr');
    for (const label of ['SYMBOL', 'ORIGIN', 'CURRENT', 'ENTRY SETUP', 'ENTRY QUALITY']) head.append(node('th', label));
    const thead = node('thead'); thead.append(head); table.append(thead);
    const body = node('tbody');
    for (const setup of setups) {
      const row = node('tr'), symbol = node('td'), button = node('button', setup.symbol);
      button.type = 'button'; button.addEventListener('click', () => details(setup, dialog));
      symbol.append(button, node('small', `Lifecycle: ${text(setup.lifecycleStatus)}`));
      const current = node('td', setup.current?.currentGrade);
      current.append(node('small', `Ranking: ${text(setup.current?.asOf)}`));
      row.append(symbol, node('td', 'Verified A+'), current, node('td', 'Analysis pending'), node('td', 'N/A'));
      body.append(row);
    }
    table.append(body); root.append(table);
  }
  function createLoader(fetcher, show, fail) {
    let sequence = 0, latest = -Infinity;
    return {
      cancel() { sequence++; },
      async load() {
        const request = ++sequence;
        try {
          const response = await fetcher(endpoint, { cache: 'no-store' });
          if (!response.ok) throw new Error('Unavailable');
          const data = await response.json();
          if (!data.ok || !Array.isArray(data.setups) || !Number.isFinite(Date.parse(data.generatedAt))) throw new Error('Invalid response');
          if (request !== sequence || Date.parse(data.generatedAt) < latest) return;
          latest = Date.parse(data.generatedAt);
          show(data.setups.filter(s => s?.origin?.confirmedAPlus === true && typeof s.tradeId === 'string'));
        } catch { if (request === sequence) fail(); }
      }
    };
  }
  window.Sm1mEntrySetups = { createLoader, render, details };
  const root = document.querySelector('#entry-setups-content');
  const dialog = document.querySelector('#entry-setups-dialog');
  if (!root || !dialog || root.dataset.enabled !== 'true') return;
  const loader = createLoader(window.fetch.bind(window), setups => render(root, setups, dialog),
    () => root.replaceChildren(node('p', 'Entry Setup data unavailable.')));
  document.querySelector('.dashboard-tabs')?.addEventListener('click', event => {
    const tab = event.target.closest('[data-dashboard-tab]');
    if (!tab) return;
    if (tab.dataset.dashboardTab === 'entry-setups') {
      root.replaceChildren(node('p', 'Loading Entry Setups...'));
      loader.load();
    }
    else loader.cancel();
  });
})();
