(function (root) {
  'use strict';
  const messages = {
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
  function mount(element, { apiUrl, tradeId, safety }) {
    if (!element) return;
    element.replaceChildren();
    const node = (tag, text, cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
    element.append(node('div', 'Account Risk Manager', 'trade-reasons-title'),
      node('p', 'Read-only gross-risk scenario. Account values are declared by you, not connected to an exchange. No order, reservation or lifecycle change.', 'liquidation-flow-note'));
    const details = [safety?.price, safety?.candles];
    element.append(node('p', details.map((d, i) => `${i ? 'Candles' : 'Price'}: ${d?.source || 'N/A'} · ${d?.instrumentType || 'N/A'} · ${d?.asOf || d?.lastConfirmedAt || 'N/A'} · ${d?.fresh === true ? 'fresh' : 'unavailable/stale'}`).join('\n'), 'liquidation-flow-note'));
    if (!tradeId) { element.append(node('p', 'UNAVAILABLE — a registered frozen trade plan is required.')); return; }
    const form = document.createElement('form'); form.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px';
    const fields = [ ['balance','Account balance · USDT',''], ['riskPercent','Risk per trade %','0.25'],
      ['maxOpenRiskPercent','Max total open risk %','1'], ['maxTrades','Max simultaneous trades','2'],
      ['leverage','Leverage','1'], ['openRiskAmount','Current open risk · USDT',''],
      ['openTrades','Current open trades',''], ['usedMargin','Current used margin · USDT',''] ];
    const inputs = {};
    for (const [name, label, value] of fields) {
      const wrap = node('label', label); const input = document.createElement('input');
      input.type = 'number'; input.step = 'any'; input.min = '0'; input.required = true;
      input.value = value; input.name = name; input.style.cssText = 'width:100%;box-sizing:border-box';
      inputs[name] = input; wrap.append(input); form.append(wrap);
    }
    const attestation = document.createElement('input'); attestation.type = 'checkbox'; attestation.required = true;
    const label = node('label', 'I confirm these are current account values, including all positions and reserved orders.');
    label.prepend(attestation); form.append(label);
    const button = node('button', 'Calculate risk'); button.type = 'submit'; form.append(button);
    const output = node('div', 'UNAVAILABLE — account configuration required.'); output.setAttribute('aria-live','polite');
    let revision = 0;
    form.addEventListener('input', () => { revision++; output.textContent = 'UNAVAILABLE — account inputs changed; recalculate.'; });
    form.addEventListener('submit', async event => {
      event.preventDefault(); const version = ++revision; button.disabled = true; output.textContent = 'Checking risk...';
      try {
        const account = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim() === '' ? null : Number(input.value)]));
        account.confirmedCurrent = attestation.checked; account.asOf = new Date().toISOString();
        const url = new URL(apiUrl); url.search = ''; url.searchParams.set('mode','risk-manager');
        const response = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({tradeId,account}), signal:AbortSignal.timeout(15000)});
        const body = await response.json(); const risk = body.risk;
        if (version !== revision) return;
        if (!response.ok || body.ok !== true || !risk) throw Error('Unavailable');
        output.replaceChildren(node('strong', `${['READY','BLOCKED','UNAVAILABLE'].includes(risk.status) ? risk.status : 'UNAVAILABLE'} · gross-risk scenario only`));
        for (const code of risk.reasonCodes || []) output.append(node('p', reasonText(code)));
        const c = risk.calculation;
        if (c) for (const [name, key] of [['Position notional','positionNotional'],['Required margin','requiredMargin'],
          ['Expected gross loss at SL','expectedGrossLossAtSL'],['Portfolio open risk','portfolioOpenRisk'],['Projected total open risk','projectedOpenRiskAmount']]) {
          output.append(node('p', `${name}: ${Number.isFinite(c[key]) ? c[key].toFixed(2) + ' USDT' : 'N/A'}`));
        }
        const remaining = Date.parse(risk.validUntil) - Date.now();
        if (risk.status === 'READY' && !(remaining > 0)) { output.textContent = 'UNAVAILABLE — risk snapshot expired; recalculate.'; return; }
        if (remaining > 0) setTimeout(() => { if (revision === version) output.textContent = 'UNAVAILABLE — risk snapshot expired; recalculate.'; }, Math.min(remaining, 60000));
        output.append(node('p', 'Quantity / net risk: N/A. Contract metadata, fees, funding and slippage are not verified. This result does not authorize execution.', 'liquidation-flow-note'));
      } catch { output.textContent = 'UNAVAILABLE — risk data could not be verified.'; }
      finally { button.disabled = false; }
    });
    element.append(form,output);
  }
  root.SM1MRisk = { applySafety, reasonText, mount };
})(window);
