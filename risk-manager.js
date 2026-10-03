(function (root) {
  'use strict';
  const messages = {
    INVALID_FROZEN_PLAN: 'Frozen Entry Zone / midpoint / initial Stop Loss or targets are invalid. No live-plan fallback.',
    INVALID_BALANCE: 'Enter a positive account balance.', INVALID_RISK_CONFIGURATION: 'Enter valid risk limits and leverage.',
    MISSING_PORTFOLIO_STATE: 'Explicit current account exposure is required.', STALE_ACCOUNT_STATE: 'Account snapshot is stale.',
    INVALID_ENTRY: 'Invalid frozen entry.', INVALID_STOP: 'Invalid frozen Stop Loss.',
    RISK_LIMIT_EXCEEDED: 'Total open risk limit exceeded.', MAX_TRADES_REACHED: 'Maximum simultaneous trades reached.',
    INSUFFICIENT_MARGIN: 'Insufficient declared available margin.', STALE_PRICE: 'Execution price is stale.',
    STALE_CANDLES: 'Critical candles are stale.', INSTRUMENT_MISMATCH: 'Price/candles use incompatible instruments.',
    MISSING_OR_INVALID_PRICE: 'Execution price or its timestamp is unavailable.',
    MISSING_OR_INVALID_CANDLES: 'Closed candles are missing, invalid or contain gaps.',
    EXISTING_ACTIVE_TRADE: 'Existing Active trade follows its frozen lifecycle; no additional entry.',
    EXPIRED_PLAN: 'Frozen plan expired.', OUTSIDE_ENTRY_ZONE: 'Current price is outside the frozen entry zone.',
    FROZEN_PLAN_UNAVAILABLE: 'A registered frozen plan is required.', RISK_DATA_UNAVAILABLE: 'Risk data unavailable.',
    PROVIDER_UNAVAILABLE: 'Provider response unavailable.', MISSING_HISTORY: 'Required history is missing.',
    PERIOD_MISMATCH: 'Closed periods do not align.', STALE_DATA: 'Provider history is stale.',
    INVALID_DATA: 'Provider values are invalid.', MISSING_INSTRUMENT_METADATA: 'Contract quantity requires instrument metadata.'
  };
  function reasonText(code) { return messages[code] || 'Data unavailable or incomplete.'; }
  function applySafety(execution, safety) {
    if (!['READY TO ENTER', 'WAIT FOR ENTRY'].includes(execution.title)) return execution;
    return { title: safety?.status === 'READY' ? 'RISK CHECK REQUIRED' : 'DATA SAFETY BLOCKED', color: '#f4b942',
      message: safety?.status === 'READY'
        ? 'Canonical setup quality passed. Check account risk separately; this is not an order authorization.'
        : 'Canonical setup quality is separate from execution safety. Critical data is unavailable, stale or incompatible.' };
  }
  function mount(element, { apiUrl, tradeId, safety, trackedSignal }) {
    if (!element) return;
    element.replaceChildren();
    const node = (tag, text, cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
    const bilingual = (en, ru, cls = '') => {
      const block = node('div', '', `risk-manager-label ${cls}`);
      block.append(node('span', en), node('small', ru, 'risk-manager-ru'));
      return block;
    };
    const status = (target, en, ru) => target.replaceChildren(bilingual(en, ru, 'risk-manager-status'));
    element.append(bilingual('ACCOUNT RISK MANAGER', 'Управление риском', 'risk-manager-heading'),
      node('p', 'Расчёт по введённым вами данным, без подключения к биржевому счёту. Не размещает ордера и не меняет сделку.', 'risk-manager-note'));
    const dataStatus = node('div', '', 'risk-manager-data');
    dataStatus.append(bilingual('DATA STATUS', 'Данные'));
    const provenance = document.createElement('details'); provenance.className = 'risk-manager-details';
    const summary = document.createElement('summary'); summary.append(bilingual('DATA DETAILS', 'Источники и время')); provenance.append(summary);
    [safety?.price, safety?.candles].forEach((d, i) => {
      const label = i ? 'CANDLES' : 'PRICE';
      dataStatus.append(bilingual(`${label} · ${d?.fresh === true ? 'Fresh' : 'Unavailable / stale'}`,
        `${i ? 'Свечи' : 'Цена'} · ${d?.fresh === true ? 'Актуальные' : 'Недоступны / устарели'}`, d?.fresh === true ? '' : 'risk-manager-warning'));
      provenance.append(node('p', `${label}: ${d?.source || 'N/A'} · ${d?.instrumentType || 'N/A'} · ${d?.asOf || d?.lastConfirmedAt || 'N/A'}`, 'risk-manager-note'));
    });
    dataStatus.append(node('p', 'Актуальность данных не является разрешением на вход.', 'risk-manager-note'));
    if (safety?.status !== 'READY') dataStatus.append(bilingual('DATA SAFETY BLOCKED', 'Проверка данных не пройдена', 'risk-manager-warning'));
    else dataStatus.append(bilingual('RISK CHECK REQUIRED', 'Требуется проверка риска'));
    for (const code of safety?.reasonCodes || []) dataStatus.append(node('p', reasonText(code), 'risk-manager-warning'));
    element.append(dataStatus, provenance);
    if (!tradeId) { element.append(bilingual('UNAVAILABLE — a registered frozen trade plan is required.', 'Расчёт недоступен — требуется зарегистрированный зафиксированный план.')); return; }
    const referencePanel = node('div', '', 'risk-manager-metrics');
    const referenceValue = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? String(value) : 'N/A';
    const metric = (en, ru, value) => {
      const box = node('div', '', 'risk-manager-metric');
      box.append(bilingual(en, ru), node('strong', value, 'risk-manager-value')); return box;
    };
    const showReference = (reference, active = false) => {
      referencePanel.replaceChildren(metric('PLANNED ENTRY', 'Плановый вход · Frozen A+ plan', referenceValue(reference?.plannedEntry)));
      if (active) referencePanel.append(metric('ACTUAL ENTRY', 'Вход по модели', referenceValue(reference?.actualEntry)));
      referencePanel.append(metric('INITIAL STOP LOSS', 'Начальный стоп · Frozen A+ plan', referenceValue(reference?.initialStopLoss)));
      if (active) referencePanel.append(metric('CURRENT STOP LOSS', 'Текущий стоп', referenceValue(reference?.currentStopLoss)));
    };
    const positionStatus = node('div', '', 'risk-manager-position-status');
    element.append(positionStatus, referencePanel);
    const activePresentation = () => {
      status(positionStatus, 'ACTIVE POSITION', 'Активная позиция');
      element.append(node('p', 'Сделка активирована по модели. Здесь показаны сохранённые параметры позиции для контроля. Новый размер позиции не рассчитывается; разрешение на новый вход не выдаётся.', 'risk-manager-note'));
    };
    const tracked = trackedSignal?.tradeId === tradeId ? trackedSignal : null;
    const state = tracked?.outcome?.status;
    if (state === 'Active') {
      showReference({ plannedEntry: tracked.initialPlan?.entryPrice, initialStopLoss: tracked.initialPlan?.initialStopLoss,
        actualEntry: tracked.outcome.entryPrice, currentStopLoss: tracked.outcome.currentStopLoss }, true);
      activePresentation();
      return;
    }
    if (state && !['WaitingEntry', 'Pending'].includes(state)) {
      element.append(bilingual('CLOSED / EXPIRED — historical trade; new position sizing unavailable.', 'Сделка завершена / план истёк. Новый расчёт позиции недоступен.'));
      return;
    }
    showReference(tracked ? {plannedEntry: tracked.initialPlan?.entryPrice, initialStopLoss: tracked.initialPlan?.initialStopLoss} : null);
    referencePanel.append(node('p', 'Плановый расчёт использует проверенные сервером midpoint и начальный SL зафиксированного плана, а не текущую цену.', 'risk-manager-note'));
    const form = document.createElement('form'); form.className = 'risk-manager-form';
    const fields = [ ['balance','Account balance · USDT',''], ['riskPercent','Risk per trade %','0.25'],
      ['maxOpenRiskPercent','Max total open risk %','1'], ['maxTrades','Max simultaneous trades','2'],
      ['leverage','Leverage','1'], ['openRiskAmount','Current open risk · USDT',''],
      ['openTrades','Current open trades',''], ['usedMargin','Current used margin · USDT',''] ];
    const inputRu = ['Баланс счёта · USDT','Риск на сделку, %','Лимит общего открытого риска, %','Максимум одновременных сделок','Кредитное плечо','Текущий открытый риск · USDT','Открытых сделок','Занятая маржа · USDT'];
    const inputs = {};
    for (const [name, label, value] of fields) {
      const wrap = node('label', '', 'risk-manager-field'); wrap.append(bilingual(label, inputRu[fields.findIndex(field => field[0] === name)])); const input = document.createElement('input');
      input.type = 'number'; input.step = 'any'; input.min = '0'; input.required = true;
      input.value = value; input.name = name; input.style.cssText = 'width:100%;box-sizing:border-box';
      inputs[name] = input; wrap.append(input); form.append(wrap);
    }
    const attestation = document.createElement('input'); attestation.type = 'checkbox'; attestation.required = true;
    const label = node('label', 'I confirm these are current account values, including all positions and reserved orders.');
    label.append(node('small', 'Подтверждаю актуальность данных счёта, включая все позиции и зарезервированные ордера.', 'risk-manager-ru'));
    label.prepend(attestation); form.append(label);
    const button = node('button', 'Calculate risk'); button.append(node('small', 'Рассчитать риск', 'risk-manager-ru')); button.type = 'submit'; form.append(button);
    const output = node('div', '', 'risk-manager-output'); status(output, 'UNAVAILABLE — account configuration required.', 'Расчёт недоступен — заполните параметры счёта.'); output.setAttribute('aria-live','polite');
    let revision = 0;
    form.addEventListener('input', () => { revision++; status(output, 'UNAVAILABLE — account inputs changed; recalculate.', 'Данные изменены — пересчитайте риск'); });
    form.addEventListener('submit', async event => {
      event.preventDefault(); const version = ++revision; button.disabled = true; status(output, 'Checking risk...', 'Проверяем риск…');
      try {
        const account = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim() === '' ? null : Number(input.value)]));
        account.confirmedCurrent = attestation.checked; account.asOf = new Date().toISOString();
        const url = new URL(apiUrl); url.search = ''; url.searchParams.set('mode','risk-manager');
        const response = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({tradeId,account}), signal:AbortSignal.timeout(15000)});
        const body = await response.json(); const risk = body.risk;
        if (version !== revision) return;
        if (!response.ok || body.ok !== true || !risk) throw Error('Unavailable');
        if (risk.reference) showReference(risk.reference, risk.mode === 'existing-position');
        if (risk.mode === 'existing-position') {
          form.remove();
          output.replaceChildren(); activePresentation();
          return;
        }
        status(output, `${['READY','BLOCKED','UNAVAILABLE'].includes(risk.status) ? risk.status : 'UNAVAILABLE'} · gross-risk scenario only`, `${({READY:'Проверка риска пройдена',BLOCKED:'Расчёт заблокирован'})[risk.status] || 'Расчёт недоступен'} · Только сценарий риска до издержек`);
        for (const code of risk.reasonCodes || []) output.append(node('p', reasonText(code)));
        const c = risk.calculation;
        if (c) for (const [name, key] of [['Position notional','positionNotional'],['Required margin','requiredMargin'],
          ['Expected gross loss at SL','expectedGrossLossAtSL'],['Portfolio open risk','portfolioOpenRisk'],['Projected total open risk','projectedOpenRiskAmount']]) {
          output.append(metric(name, ({positionNotional:'Номинальный объём позиции',requiredMargin:'Требуемая маржа',expectedGrossLossAtSL:'Расчётный убыток по SL до издержек',portfolioOpenRisk:'Текущий риск портфеля',projectedOpenRiskAmount:'Общий риск с новой позицией'})[key], Number.isFinite(c[key]) ? c[key].toFixed(2) + ' USDT' : 'N/A'));
        }
        const remaining = Date.parse(risk.validUntil) - Date.now();
        if (risk.status === 'READY' && !(remaining > 0)) { status(output, 'UNAVAILABLE — risk snapshot expired; recalculate.', 'Расчёт устарел — пересчитайте риск'); return; }
        if (remaining > 0) setTimeout(() => { if (revision === version) status(output, 'UNAVAILABLE — risk snapshot expired; recalculate.', 'Расчёт устарел — пересчитайте риск'); }, Math.min(remaining, 60000));
        const potential = risk.targetPotential;
        const targets = [potential?.tp1, potential?.tp2, potential?.tp3];
        const positive = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
        if (risk.status === 'READY' && risk.mode === 'planned-entry' && potential?.mode === 'planned' &&
            potential.currency === 'USDT' && potential.basis === 'linear-gross-before-costs' &&
            targets.every(t => t && positive(t.fraction) && t.fraction <= 1 && positive(t.rMultiple) && positive(t.contribution)) &&
            Math.abs(targets.reduce((sum, t) => sum + t.fraction, 0) - 1) < 1e-12 &&
            positive(potential.weightedAmount) && positive(potential.weightedR)) {
          output.append(bilingual('PLANNED TARGET POTENTIAL', 'Плановый потенциал целей'),
            bilingual('Gross · before fees/funding/slippage', 'До комиссий, funding и проскальзывания'));
          targets.forEach((target, i) => output.append(bilingual(
            `TP${i + 1} · ${Number((target.fraction * 100).toFixed(2))}% contribution: +${target.contribution.toFixed(2)} USDT`, 'Вклад частичного закрытия')));
          output.append(bilingual(`Weighted TP Potential: +${potential.weightedAmount.toFixed(2)} USDT · +${potential.weightedR.toFixed(2)}R`, 'Суммарный взвешенный потенциал'),
            node('p', 'Frozen A+ plan · заданный Risk Amount. Условный gross-результат при достижении всех целей.', 'liquidation-flow-note'));
        }
        output.append(bilingual('Quantity / net risk: N/A. Contract metadata, fees, funding and slippage are not verified. This result does not authorize execution.', 'Количество / риск после издержек: недоступны. Параметры контрактов и издержки не проверены. Результат не разрешает исполнение.'));
      } catch { status(output, 'UNAVAILABLE — risk data could not be verified.', 'Не удалось проверить данные риска'); }
      finally { button.disabled = false; }
    });
    element.append(form,output);
  }
  root.SM1MRisk = { applySafety, reasonText, mount };
})(window);
