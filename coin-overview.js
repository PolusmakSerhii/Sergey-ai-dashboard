(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => (typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value)) ? Number(value) : null;
  const price = value => { const n = number(value); return n !== null && n > 0 ? escape(n.toLocaleString('ru-RU', {maximumSignificantDigits:10})) : '—'; };
  function render({data = {}, ranking = {}, plan = {}, tracked = false, execution = {}} = {}) {
    const technical = data.technical || {}, probability = technical.probability || {};
    const confirmed = technical.confirmedAPlus;
    const rawScore = number(technical.opportunityScore);
    const score = rawScore !== null && rawScore >= 0 && rawScore <= 100 ? rawScore : null;
    const grade = technical.opportunityGrade || '—';
    const confidence = number(probability.confidence?.score);
    const action = technical.recommendation?.action;
    const direction = technical.tradePlan?.direction;
    const recommendationAligned = (direction === 'Long' && action === 'Strong Buy') ||
      (direction === 'Short' && action === 'Strong Sell');
    const rows = [];
    const row = (label, detail, state = 'missing') => rows.push(`<li class="overview-check"><span class="overview-mark" data-state="${state}">${state === 'pass' ? '✓' : state === 'fail' ? '!' : '—'}</span><div><strong>${escape(label)}</strong><span>${escape(detail)}</span></div></li>`);
    if (confirmed !== true) {
      row('Уверенность сигнала', confidence === null ? 'Нет данных свежего анализа' : `${confidence} / 85${confidence < 85 ? ` · не хватает ${+(85-confidence).toFixed(2)} п.п.` : ' · порог выполнен'}`, confidence === null ? 'missing' : confidence >= 85 ? 'pass' : 'fail');
      const ready = technical.tradeReadiness?.ready;
      row('Базовая готовность', ready === true ? 'Подтверждена · сама по себе не означает A+' : ready === false ? 'Условия готовности ещё не выполнены' : 'Нет данных', ready === true ? 'pass' : ready === false ? 'fail' : 'missing');
      const allowed = probability.aiAssessment?.tradeAllowed;
      row('Разрешение торгового сценария', allowed === true ? 'Получено' : allowed === false ? 'Сценарий пока не разрешён' : 'Нет данных', allowed === true ? 'pass' : allowed === false ? 'fail' : 'missing');
      row('Рекомендация', action ? `${action} · для A+ требуется Strong Buy или Strong Sell в направлении сигнала` : 'Нет данных', recommendationAligned ? 'pass' : action ? 'fail' : 'missing');
      const rr = number(technical.tradePlan?.riskReward);
      row('Доходность / риск', rr === null ? 'Отношение не рассчитано' : `${rr} / 2${rr >= 2 ? ' · порог выполнен' : ' · ниже порога'}`, rr === null ? 'missing' : rr >= 2 ? 'pass' : 'fail');
      const live = technical.tradePlan || {};
      const full = [live.entryZone?.from,live.entryZone?.to,live.stopLoss,live.takeProfit1,live.takeProfit2,live.takeProfit3].every(v => number(v) !== null && number(v) > 0);
      row('Вход, стоп и три цели', full ? 'Уровни переданы; их взаимное расположение проверяет общий статус подтверждения' : 'Полного набора уровней нет', full ? 'pass' : 'missing');
    }
    const status = tracked ? 'Сохранённый план сделки' : confirmed === true ? 'Сетап A+ подтверждён' : confirmed === false ? 'Ожидает подтверждения' : 'Статус подтверждения неизвестен';
    const gap = score === null ? 'Оценка live-анализа недоступна' : score < 75 ? `До оценки A — ${+(75-score).toFixed(2)} баллов` : 'Порог оценки A достигнут';
    const timestamp = data.time && Number.isFinite(Date.parse(data.time)) ? new Date(data.time).toLocaleString('ru-RU') : 'время не указано';
    return `<section class="coin-overview" aria-label="Понятный обзор монеты">
      <div class="overview-heading"><h3>Оценка и условия</h3><span class="overview-status">${status}</span></div>
      <div class="overview-score"><strong>${score ?? '—'}<small> / 100</small></strong><span>Оценка ${escape(grade)}</span></div>
      <div class="overview-meter" ${score !== null ? `role="meter" aria-label="Opportunity Score live-анализа" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score}"` : ''}><span style="width:${score ?? 0}%"></span></div>
      <div class="overview-scale"><span>D &lt;55</span><span>C ≥55</span><span>B ≥65</span><span>A ≥75</span><span>A+ ≥85*</span></div>
      <p class="overview-gap">${gap}</p><p class="overview-note">Оценка свежего Live Analysis. *A+ требует подтверждения всех условий; высокий Score сам по себе не разрешает вход.</p>
      <details ${confirmed !== true ? 'open' : ''}><summary>${confirmed === true ? 'Подтверждение свежего анализа' : 'Что известно об условиях A+'}</summary>
      ${confirmed === true ? '<p>Backend подтвердил условия A+. Статус входа указан в блоке Execution.</p>' : `<ul class="overview-checks">${rows.join('')}</ul><p class="overview-note">Это доступные проверки свежего анализа, а не полный список причин. Отсутствующие live-поля не заменяются данными Ranking.</p>`}
      </details>
      <details><summary>Вход, стоп и цели</summary><p class="overview-note">${tracked ? 'Уровни сохранённого плана. Текущий статус: ' + escape(execution.title || 'неизвестен') : confirmed === true ? 'Уровни подтверждённого плана. Статус входа смотрите в Execution.' : 'Предварительные уровни, если доступны. Подтверждения для нового входа нет.'}</p>
      <dl class="overview-levels"><div><dt>Зона входа</dt><dd>${price(plan.entryZone?.from)} – ${price(plan.entryZone?.to)}</dd></div>${[['Стоп',plan.stopLoss],['Цель 1',plan.takeProfit1],['Цель 2',plan.takeProfit2],['Цель 3',plan.takeProfit3]].map(([name,value])=>`<div><dt>${name}</dt><dd>${price(value)}</dd></div>`).join('')}</dl></details>
      <p class="overview-note">Свежий анализ: ${escape(timestamp)}</p>
    </section>`;
  }
  window.SergeyCoinOverview = {render};
})();
