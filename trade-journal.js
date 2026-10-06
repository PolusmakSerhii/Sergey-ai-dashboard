// Read-only presentation of saved archive records. No live analysis or polling.
(function () {
  'use strict';
const LIVE_START_UTC = "2026-10-11T21:00:00.000Z";
function classifyLiveCohort(record) {
  const instant = value => typeof value === "string" &&
    /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  const origin = instant(record?.origin?.detectedAt);
  if (!Number.isFinite(origin)) return { cohort: "UNKNOWN", reason: "INVALID_OR_MISSING_ORIGIN" };
  const frozen = record?.initialPlan?.createdAt;
  if (frozen !== undefined && frozen !== null &&
      (!Number.isFinite(instant(frozen)) || instant(frozen) !== origin))
    return { cohort: "UNKNOWN", reason: "FROZEN_ORIGIN_CONFLICT" };
  return { cohort: origin >= Date.parse(LIVE_START_UTC) ? "LIVE" : "PRE-LIVE", reason: null };
}

  const endpoint = 'https://sergey-ai-trader-api.vercel.app/api/market?mode=validation-archive';
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const text = value => typeof value === 'string' && value.trim() ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : 'N/A';
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC') : 'N/A';
  const rText = value => number(value) === null ? 'N/A' : `${value > 0 ? '+' : ''}${Number(value.toFixed(2))}R`;
  function result(record) {
    const outcome = object(record.outcome);
    if (!['TP1Hit', 'TP3Hit', 'Stopped', 'Closed'].includes(outcome.status) ||
        typeof outcome.checkedAt !== 'string' || !Number.isFinite(Date.parse(outcome.checkedAt))) return { value: null, label: 'N/A' };
    const value = number(outcome.resultR);
    return { value, label: value === null ? 'N/A' : value > 0 ? 'WIN' : value < 0 ? 'LOSS' : 'BREAK EVEN' };
  }
  const defaultFilters = () => ({ search: '', direction: 'ALL', result: 'ALL', score: 'ALL' });
  function filterCohort(records, cohort = 'ALL') {
    return records.filter(record => cohort === 'ALL' || classifyLiveCohort(record).cohort === cohort &&
      ['PRE-LIVE', 'LIVE'].includes(cohort));
  }
  function filterRecords(records, filters) {
    return filterCohort([...records.values()], filters.cohort || 'ALL').filter(record => {
      const origin = object(record.origin), score = number(origin.opportunityScore);
      return (!filters.search.trim() || (typeof origin.symbol === 'string' && origin.symbol.toUpperCase().includes(filters.search.trim().toUpperCase()))) &&
        (filters.direction === 'ALL' || origin.direction === filters.direction) &&
        (filters.result === 'ALL' || result(record).label === filters.result) &&
        (filters.score === 'ALL' || score !== null && (filters.score === '85–89' ? score >= 85 && score < 90 : filters.score === '90–94' ? score >= 90 && score < 95 : score >= 95));
    });
  }
  function summarize(records) {
    const summary = { completed: 0, wins: 0, losses: 0, breakEven: 0, netR: 0, winRate: null, averageR: null };
    for (const record of new Map(records.map(record => [record.tradeId, record])).values()) {
      const final = result(record);
      if (final.value === null) continue;
      summary.completed++; summary.netR += final.value;
      if (final.value > 0) summary.wins++; else if (final.value < 0) summary.losses++; else summary.breakEven++;
    }
    if (summary.completed) { summary.winRate = summary.wins / summary.completed * 100; summary.averageR = summary.netR / summary.completed; }
    return summary;
  }
  function controls(filters, update) {
    const bar = node('div', undefined, 'journal-controls');
    const searchLabel = node('label', 'Search Symbol'), search = node('input');
    search.type = 'search'; search.value = filters.search; search.placeholder = 'Symbol';
    search.addEventListener('input', () => { filters.search = search.value; update(); }); searchLabel.append(search); bar.append(searchLabel);
    const inputs = { search };
    for (const [key, label, options] of [['direction', 'Direction', ['ALL', 'Long', 'Short']], ['result', 'Result', ['ALL', 'WIN', 'LOSS', 'BREAK EVEN']], ['score', 'Score', ['ALL', '85–89', '90–94', '95+']]]) {
      const wrapper = node('label', label), select = node('select');
      for (const value of options) { const option = node('option', value.toUpperCase()); option.value = value; select.append(option); }
      select.value = filters[key]; select.addEventListener('change', () => { filters[key] = select.value; update(); });
      inputs[key] = select; wrapper.append(select); bar.append(wrapper);
    }
    const reset = node('button', 'Reset', 'journal-button'); reset.type = 'button';
    reset.addEventListener('click', () => { Object.assign(filters, defaultFilters()); for (const key of Object.keys(inputs)) inputs[key].value = filters[key]; update(); });
    bar.append(reset); return bar;
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
    const state = { filters: defaultFilters(), records: new Map(), loading: false, loaded: false, error: false, next: 0, total: null, boundary: null, skipped: 0 };
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
    state.filters ||= defaultFilters();
    if (!root.journalView) {
      root.journalView = node('div');
      root.replaceChildren(node('p', 'Сохранённые записи сделок из архива валидации. Архив может содержать не всю историю сделок.', 'journal-notice'),
        controls(state.filters, () => render(root, state, dialog, load)), root.journalView);
    }
    const view = root.journalView, selected = filterRecords(state.records, state.filters), summary = summarize(selected);
    const active = state.filters.search.trim() || ['direction', 'result', 'score'].some(key => state.filters[key] !== 'ALL');
    view.replaceChildren(node('p', `Граница архива: ${date(state.boundary)} · Загружено сделок: ${state.records.size}${state.total === null ? '' : ` из ${state.total}`} · После фильтрации: ${selected.length} из ${state.records.size} загруженных сделок. Аналитика рассчитана только по загруженным сделкам и не является статистикой за всё время.`, 'journal-notice'),
      fields(active ? 'FILTERED COHORT' : 'LOADED ARCHIVE COHORT', [['COMPLETED', summary.completed], ['WIN RATE', summary.winRate === null ? 'N/A' : `${summary.winRate.toFixed(1)}%`], ['NET R', rText(summary.netR)], ['AVERAGE R', rText(summary.averageR)], ['WINS', summary.wins], ['LOSSES', summary.losses], ['BREAK EVEN', summary.breakEven]]));
    if (state.skipped) view.append(node('p', `${state.skipped} malformed records skipped.`, 'journal-notice'));
    if (state.error) view.append(node('p', 'Archive unavailable. Loaded records are retained. Please retry.', 'journal-notice'));
    if (state.loading) view.append(node('p', 'Loading archived trades...', 'journal-notice'));
    if (state.loaded && !state.records.size && !state.loading) view.append(node('p', 'No archived trades available.'));
    if (state.records.size && !selected.length) view.append(node('p', 'No matching loaded records.'));
    const list = node('div', undefined, 'journal-list');
    for (const record of selected) {
      const origin = object(record.origin), outcome = object(record.outcome), final = result(record);
      const card = node('article', undefined, 'journal-card'); card.dataset.tradeId = record.tradeId;
      const open = node('button', text(origin.symbol), 'journal-button'); open.type = 'button'; open.addEventListener('click', () => details(record, dialog));
      card.append(open, fields(null, [['Direction', ['Long', 'Short'].includes(origin.direction) ? origin.direction.toUpperCase() : 'N/A'], ['Original Grade', origin.grade], ['Original Score', origin.opportunityScore], ['Original Confidence', origin.confidence], ['Lifecycle', outcome.status], ['Result R', `${rText(final.value)} · ${final.label}`], ['Opened', date(outcome.activatedAt)], ['Closed', final.value === null ? 'N/A' : date(outcome.checkedAt)]])); list.append(card);
    }
    view.append(list);
    if (state.next !== null && !state.loading) { const more = node('button', state.error ? 'RETRY' : 'LOAD MORE', 'journal-button'); more.type = 'button'; more.addEventListener('click', load); view.append(more); }
  }
  window.Sm1mTradeJournal = { classifyLiveCohort, filterCohort, result, details, createStore, render, defaultFilters, filterRecords, summarize };
  const root = document.querySelector('#trade-journal-content'), dialog = document.querySelector('#trade-journal-dialog');
  if (!root || !dialog) return;
  const store = createStore(window.fetch.bind(window), state => render(root, state, dialog, () => store.load()));
  document.querySelector('.dashboard-tabs')?.addEventListener('click', event => {
    if (event.target.closest('[data-dashboard-tab]')?.dataset.dashboardTab === 'trade-journal' && !store.state.loaded) store.load();
  });
})();
