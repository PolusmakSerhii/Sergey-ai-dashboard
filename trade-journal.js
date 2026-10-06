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
  const defaultFilters = () => ({ search: '', direction: 'ALL', result: 'ALL', score: 'ALL', cohort: 'ALL' });
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
  function cohortButtons(options, selected, change) {
    const bar = node('div', undefined, 'cohort-controls');
    bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Cohort / Период');
    for (const [value, label] of options) {
      const button = node('button', label, 'journal-button'); button.type = 'button';
      button.dataset.cohort = value;
      button.setAttribute('aria-pressed', String(value === selected));
      button.addEventListener('click', () => {
        change(value);
        for (const item of bar.children) item.setAttribute('aria-pressed', String(item.dataset.cohort === value));
      });
      bar.append(button);
    }
    return bar;
  }
  function bilingual(english, russian) {
    const label = node('span', english);
    label.append(node('small', russian, 'cohort-ru')); return label;
  }
  function unknownNotice(state) {
    const count = state.liveCohorts?.summaries?.UNKNOWN?.total;
    return Number.isInteger(count) && count > 0 ? bilingual(
      `Records without an unambiguous origin date: ${count}. They remain available in ALL and are excluded from PRE-LIVE/LIVE.`,
      `Записей без однозначной даты происхождения: ${count}. Они доступны в ALL и исключены из PRE-LIVE/LIVE.`) : null;
  }
  function renderPerformance(root, state) {
    const selected = root.performanceCohort || 'PRE-LIVE';
    root.performanceCohort = selected;
    const header = node('div', undefined, 'performance-header');
    const heading = node('h3'); heading.append(bilingual('PERFORMANCE STATISTICS', 'Статистика результатов'));
    header.append(heading, cohortButtons([['PRE-LIVE', 'PRE-LIVE'], ['LIVE', 'LIVE · FROM 12 OCT 2026']], selected,
      value => { root.performanceCohort = value; renderPerformance(root, state); }));
    const notice = node('div', undefined, 'performance-notice');
    notice.append(bilingual('Canonical/modelled SM1M trades · not confirmed exchange P&L',
      'Канонические/модельные сделки SM1M · не подтверждённый биржевой P&L'),
      bilingual('Based on available archive records · history completeness is not guaranteed',
      'По доступным записям архива · полнота истории не гарантируется'));
    root.replaceChildren(header, notice);
    const data = state.liveCohorts, summary = data?.summaries?.[selected];
    const counts = ['total', 'completed', 'active', 'wins', 'losses', 'breakEvens'];
    if (state.error || data?.startAt !== LIVE_START_UTC || data?.basis !== 'canonical-modelled' ||
        !summary || !counts.every(key => Number.isInteger(summary[key]) && summary[key] >= 0)) {
      root.append(bilingual(state.loading ? 'Loading performance...' : 'Performance unavailable.',
        state.loading ? 'Загрузка результатов…' : 'Статистика результатов недоступна.')); return;
    }
    if (selected === 'LIVE' && summary.total === 0) root.append(bilingual(
      'LIVE starts 12 Oct 2026, 00:00 Europe/Kyiv.', 'LIVE начинается 12 октября 2026, 00:00 по Киеву.'));
    const metric = (grid, english, russian, value, kind) => {
      const cell = node('div'), title = node('dt'); title.append(bilingual(english, russian));
      const formatted = number(value) === null ? 'N/A' : kind === 'magnitude' ? `${Number(Math.abs(value).toFixed(2))}R` :
        kind === 'R' ? rText(value) : kind === '%' ? `${value.toFixed(1)}%` : kind === 'ratio' ? value.toFixed(2) : String(value);
      cell.append(title, node('dd', formatted)); grid.append(cell);
    };
    const kpis = node('dl', undefined, 'performance-kpis');
    for (const [key, en, ru, kind] of [
      ['completed','Completed','Завершено'], ['winRate','Win Rate','Доля прибыльных','%'],
      ['netR','Net R','Итоговый R','R'], ['profitFactor','Profit Factor','Фактор прибыли','ratio'],
      ['maxDrawdownR','Max Drawdown','Максимальная просадка, R','magnitude'], ['active','Active','Активные']
    ]) metric(kpis, en, ru, summary[key], kind);
    const details = node('section', undefined, 'performance-details'), detailsTitle = node('h4');
    detailsTitle.append(bilingual('DETAILED STATISTICS', 'Детальная статистика'));
    const secondary = node('dl', undefined, 'performance-secondary');
    for (const [key, en, ru, kind] of [
      ['wins','Wins','Прибыльные'], ['losses','Losses','Убыточные'], ['breakEvens','Break-even','Безубыточные'],
      ['averageR','Average R','Средний R','R'], ['expectancy','Expectancy','Матожидание, R на сделку','R'],
      ['currentLossStreak','Current Loss Streak','Текущая серия убытков'], ['maxLossStreak','Max Loss Streak','Максимальная серия убытков']
    ]) metric(secondary, en, ru, summary[key], kind);
    details.append(detailsTitle, secondary);
    const directions = node('div', undefined, 'performance-directions');
    for (const direction of ['Long', 'Short']) {
      const side = summary.directions?.[direction], block = node('section', undefined, `performance-direction is-${direction.toLowerCase()}`);
      const title = node('h4'); title.append(bilingual(`${direction.toUpperCase()} TRADES`, direction === 'Long' ? 'Длинные сделки' : 'Короткие сделки'));
      const grid = node('dl', undefined, 'performance-secondary');
      const countValid = Number.isInteger(side?.count) && side.count >= 0;
      const winsValid = countValid && Number.isInteger(side?.wins) && side.wins >= 0 && side.wins <= side.count;
      metric(grid, 'Completed', 'Завершено', countValid ? side.count : null);
      metric(grid, 'Wins', 'Прибыльные', winsValid ? side.wins : null);
      const directLosses = winsValid && Number.isInteger(side?.losses) && side.losses >= 0 && side.losses <= side.count - side.wins;
      const sideBE = Number.isInteger(side?.breakEvens) && side.breakEvens >= 0 ? side.breakEvens :
        summary.breakEvens === 0 ? 0 : null;
      const losses = directLosses ? side.losses : winsValid && sideBE !== null && sideBE <= side.count - side.wins
        ? side.count - side.wins - sideBE : null;
      metric(grid, 'Losses', 'Убыточные', losses);
      metric(grid, 'Win Rate', 'Доля прибыльных', winsValid && side.count > 0 ? 100 * side.wins / side.count : null, '%');
      metric(grid, 'Net R', 'Итоговый R', side?.netR, 'R');
      metric(grid, 'Average R', 'Средний R', countValid && side.count > 0 && number(side?.netR) !== null ? side.netR / side.count : null, 'R');
      block.append(title, grid); directions.append(block);
    }
    root.append(kpis, details, directions);
    const warning = unknownNotice(state); if (warning) root.append(warning);
  }
  function controls(filters, update) {
    const bar = node('div', undefined, 'journal-controls');
    const searchLabel = node('label', 'Search Symbol'), search = node('input');
    search.type = 'search'; search.value = filters.search; search.placeholder = 'Symbol';
    search.addEventListener('input', () => { filters.search = search.value; update(); }); searchLabel.append(search); bar.append(searchLabel);
    const inputs = { search };
    const cohorts = cohortButtons([['ALL','ALL'], ['PRE-LIVE','PRE-LIVE'], ['LIVE','LIVE']], filters.cohort, value => { filters.cohort = value; update(); });
    for (const [key, label, options] of [['direction', 'Direction', ['ALL', 'Long', 'Short']], ['result', 'Result', ['ALL', 'WIN', 'LOSS', 'BREAK EVEN']], ['score', 'Score', ['ALL', '85–89', '90–94', '95+']]]) {
      const wrapper = node('label', label), select = node('select');
      for (const value of options) { const option = node('option', value.toUpperCase()); option.value = value; select.append(option); }
      select.value = filters[key]; select.addEventListener('change', () => { filters[key] = select.value; update(); });
      inputs[key] = select; wrapper.append(select); bar.append(wrapper);
    }
    const reset = node('button', 'Reset', 'journal-button'); reset.type = 'button';
    reset.addEventListener('click', () => { Object.assign(filters, defaultFilters()); for (const key of Object.keys(inputs)) inputs[key].value = filters[key]; for (const button of cohorts.children) button.setAttribute('aria-pressed', String(button.dataset.cohort === 'ALL')); update(); });
    bar.append(reset); const wrapper = node('div'); wrapper.append(cohorts, bar); return wrapper;
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
    const state = { filters: defaultFilters(), records: new Map(), loading: false, loaded: false, error: false, next: 0, total: null, boundary: null, liveCohorts: null, skipped: 0 };
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
        state.liveCohorts = data.liveCohorts || null;
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
    const active = state.filters.search.trim() || ['direction', 'result', 'score', 'cohort'].some(key => state.filters[key] !== 'ALL');
    view.replaceChildren(node('p', `Граница архива: ${date(state.boundary)} · Загружено сделок: ${state.records.size}${state.total === null ? '' : ` из ${state.total}`} · После фильтрации: ${selected.length} из ${state.records.size} загруженных сделок. Аналитика рассчитана только по загруженным сделкам и не является статистикой за всё время.`, 'journal-notice'),
      fields(active ? 'FILTERED COHORT' : 'LOADED ARCHIVE COHORT', [['COMPLETED', summary.completed], ['WIN RATE', summary.winRate === null ? 'N/A' : `${summary.winRate.toFixed(1)}%`], ['NET R', rText(summary.netR)], ['AVERAGE R', rText(summary.averageR)], ['WINS', summary.wins], ['LOSSES', summary.losses], ['BREAK EVEN', summary.breakEven]]));
    const warning = unknownNotice(state); if (warning) view.append(warning);
    if (state.skipped) view.append(node('p', `${state.skipped} malformed records skipped.`, 'journal-notice'));
    if (state.error) view.append(node('p', 'Archive unavailable. Loaded records are retained. Please retry.', 'journal-notice'));
    if (state.loading) view.append(node('p', 'Loading archived trades...', 'journal-notice'));
    if (state.loaded && !state.records.size && !state.loading) view.append(node('p', 'No archived trades available.'));
    const otherFilters = state.filters.search.trim() || ['direction', 'result', 'score'].some(key => state.filters[key] !== 'ALL');
    if (state.loaded && !state.loading && !state.error && !selected.length && state.filters.cohort === 'LIVE' && !otherFilters) {
      view.append(bilingual('In loaded records there are no LIVE trades.', 'В загруженных записях нет LIVE-сделок.'));
      if (state.next !== null) view.append(bilingual('Archive loading is incomplete. Use LOAD MORE.', 'Архив загружен не полностью. Используйте LOAD MORE.'));
    } else if (state.records.size && !selected.length) view.append(node('p', 'No matching loaded records.'));
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
  window.Sm1mTradeJournal = { renderPerformance, classifyLiveCohort, filterCohort, result, details, createStore, render, defaultFilters, filterRecords, summarize };
  const root = document.querySelector('#trade-journal-content'), dialog = document.querySelector('#trade-journal-dialog');
  if (!root || !dialog) return;
  const performance = document.querySelector('#statistics-trade-analytics');
  const store = createStore(window.fetch.bind(window), state => {
    render(root, state, dialog, () => store.load());
    if (performance) renderPerformance(performance, state);
  });
  // This script is loaded only after the existing owner-session gate succeeds.
  if (performance) store.load();
  document.querySelector('.dashboard-tabs')?.addEventListener('click', event => {
    if (event.target.closest('[data-dashboard-tab]')?.dataset.dashboardTab === 'trade-journal' && !store.state.loaded) store.load();
  });
})();
