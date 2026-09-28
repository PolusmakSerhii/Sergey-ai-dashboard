// Read-only presentation of saved archive records. No live analysis or polling.
(function () {
  'use strict';
  const endpoint = 'https://sergey-ai-trader-api.vercel.app/api/market?mode=validation-archive';
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const text = value => typeof value === 'string' && value.trim() ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : 'N/A';
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC') : 'N/A';
  const rText = value => number(value) === null ? 'N/A' : `${value > 0 ? '+' : ''}${Number(value.toFixed(2))}R`;
  function result(record) {
    const outcome = object(record.outcome);
    if (!['TP1Hit', 'TP3Hit', 'Stopped'].includes(outcome.status)) return { value: null, label: 'N/A' };
    const value = number(outcome.resultR);
    return { value, label: value === null ? 'N/A' : value > 0 ? 'WIN' : value < 0 ? 'LOSS' : 'BREAK EVEN' };
  }
  function node(tag, value, className) {
    const element = document.createElement(tag);
    if (value !== undefined) element.textContent = text(value);
    if (className) element.className = className;
    return element;
  }
  function fields(title, pairs) {
    const section = node('section', undefined, 'journal-section');
    if (title) section.append(node('h3', title));
    const grid = node('dl', undefined, 'journal-fields');
    for (const [label, value] of pairs) {
      const cell = node('div'); cell.append(node('dt', label), node('dd', value)); grid.append(cell);
    }
    section.append(grid); return section;
  }
  function details(record, dialog) {
    const origin = object(record.origin), plan = object(record.initialPlan), zone = object(plan.entryZone), outcome = object(record.outcome), final = result(record);
    const close = node('button', 'Close', 'journal-button'); close.type = 'button'; close.addEventListener('click', () => dialog.close());
    dialog.replaceChildren(close, node('h2', 'TRADE JOURNAL DETAIL'), node('p', 'Saved analytical trade record. Entry and exit prices may be modelled from confirmed market candles and are not necessarily exchange fills.', 'journal-notice'),
      fields('ORIGINAL A+ SETUP', [['Trade ID', record.tradeId], ['Symbol', origin.symbol], ['Direction', origin.direction], ['Original Grade', origin.grade], ['Original Opportunity Score', origin.opportunityScore], ['Original Confidence', origin.confidence], ['Original Action', origin.action], ['Original detectedAt', date(origin.detectedAt)]]),
      fields('FROZEN TRADE PLAN', [['Entry Zone From', zone.from], ['Entry Zone To', zone.to], ['Planned Entry / midpoint', plan.entryPrice], ['Initial Stop Loss', plan.initialStopLoss ?? plan.stopLoss], ['TP1', plan.takeProfit1], ['TP2', plan.takeProfit2], ['TP3', plan.takeProfit3], ['Original R:R', origin.riskReward]]),
      fields('ACTUAL / MODELLED LIFECYCLE', [['Actual / Modelled Entry', outcome.entryPrice], ['Activated At', date(outcome.activatedAt)], ['Final / Current Stop Loss', outcome.currentStopLoss], ['Final Exit Price', outcome.exitPrice], ['Closed At', final.value === null ? 'N/A' : date(outcome.checkedAt)], ['Lifecycle Status', outcome.status], ['Final Result R', rText(final.value)], ['Result classification', final.label]]));
    const exits = node('section', undefined, 'journal-section'); exits.append(node('h3', 'PARTIAL EXITS'));
    const saved = Array.isArray(outcome.exits) ? outcome.exits.filter(exit => exit && typeof exit === 'object' && !Array.isArray(exit)) : [];
    if (!saved.length) exits.append(node('p', 'No recorded partial exits.'));
    for (const exit of saved) exits.append(fields(null, [['Target', exit.target], ['Price', exit.price], ['Initial fraction', exit.initialFraction], ['Realized R', rText(exit.realizedR)], ['Checked At', date(exit.checkedAt)]]));
    dialog.append(exits); if (!dialog.open) dialog.showModal();
  }
  function createStore(fetcher, notify) {
    const state = { records: new Map(), loading: false, loaded: false, error: false, next: 0, total: null, boundary: null, skipped: 0 };
    return { state, async load() {
      if (state.loading || state.next === null) return;
      const offset = state.next; state.loading = true; state.error = false; notify(state);
      try {
        const response = await fetcher(`${endpoint}&offset=${offset}&limit=100`, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw Error('Archive unavailable');
        const data = await response.json();
        if (data.ok !== true || !Array.isArray(data.records)) throw Error('Invalid archive');
        const next = data.nextOffset;
        if (next != null && (!Number.isInteger(next) || next <= offset || data.records.length === 0)) throw Error('Invalid pagination');
        for (const item of data.records) {
          if (!item || typeof item.tradeId !== 'string' || !item.tradeId.trim() || !item.origin || !item.outcome) { state.skipped++; continue; }
          state.records.set(item.tradeId, item);
        }
        state.total = Number.isInteger(data.totalArchived) && data.totalArchived >= 0 ? data.totalArchived : null;
        state.boundary = data.validationStartAt;
        state.next = next ?? (state.total !== null && offset + data.records.length < state.total && data.records.length ? offset + data.records.length : null);
        state.loaded = true;
      } catch { state.error = true; }
      finally { state.loading = false; notify(state); }
    }};
  }
  function render(root, state, dialog, load) {
    root.replaceChildren(node('p', 'Saved canonical trade records available in the validation archive. Coverage may be incomplete; this is not complete all-time history.', 'journal-notice'),
      node('p', `Archive boundary: ${date(state.boundary)} · Loaded ${state.records.size} archived trades${state.total === null ? '' : ` / ${state.total} reported`}`, 'journal-notice'));
    if (state.skipped) root.append(node('p', `${state.skipped} malformed records skipped.`, 'journal-notice'));
    if (state.error) root.append(node('p', 'Archive unavailable. Loaded records are retained. Please retry.', 'journal-notice'));
    if (state.loading) root.append(node('p', 'Loading archived trades...', 'journal-notice'));
    if (state.loaded && !state.records.size && !state.loading) root.append(node('p', 'No archived trades available.'));
    const list = node('div', undefined, 'journal-list');
    for (const record of state.records.values()) {
      const origin = object(record.origin), outcome = object(record.outcome), final = result(record);
      const card = node('article', undefined, 'journal-card'); card.dataset.tradeId = record.tradeId;
      const open = node('button', text(origin.symbol), 'journal-button'); open.type = 'button'; open.addEventListener('click', () => details(record, dialog));
      card.append(open, fields(null, [['Direction', ['Long', 'Short'].includes(origin.direction) ? origin.direction.toUpperCase() : 'N/A'], ['Original Grade', origin.grade], ['Original Score', origin.opportunityScore], ['Original Confidence', origin.confidence], ['Lifecycle', outcome.status], ['Result R', `${rText(final.value)} · ${final.label}`], ['Opened', date(outcome.activatedAt)], ['Closed', final.value === null ? 'N/A' : date(outcome.checkedAt)]])); list.append(card);
    }
    root.append(list);
    if (state.next !== null && !state.loading) { const more = node('button', state.error ? 'RETRY' : 'LOAD MORE', 'journal-button'); more.type = 'button'; more.addEventListener('click', load); root.append(more); }
  }
  window.Sm1mTradeJournal = { result, details, createStore, render };
  const root = document.querySelector('#trade-journal-content'), dialog = document.querySelector('#trade-journal-dialog');
  if (!root || !dialog) return;
  const store = createStore(window.fetch.bind(window), state => render(root, state, dialog, () => store.load()));
  document.querySelector('.dashboard-tabs')?.addEventListener('click', event => {
    if (event.target.closest('[data-dashboard-tab]')?.dataset.dashboardTab === 'trade-journal' && !store.state.loaded) store.load();
  });
})();
