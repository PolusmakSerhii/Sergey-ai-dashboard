#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { buildReplayArtifact, RESULT } from './replay.mjs';
import { observedRemainderFromOutcome } from './d01.mjs';

const MINUTE_MS = 60_000;
const CUTOFF = '2026-11-01T22:00:00.000Z';
const POLICY = 'tp1-50-reanalyse-v1';
const RULES = 'canonical-trade-archive-v1';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function args(argv) {
  return Object.fromEntries(argv.map(arg => arg.startsWith('--') ? arg.slice(2).split(/=(.*)/s, 2) : []).filter(pair => pair.length === 2));
}

function archivedReachability(record) {
  if (record.outcome.exits?.some(exit => exit?.target === 'TP1')) return RESULT.TP1;
  if (record.outcome.exitCheck?.rule === 'same-candle-sl-first' || record.outcome.priceCheck?.bothLevelsTouched === true) return RESULT.SL;
  return record.outcome.status === 'Stopped' ? RESULT.SL : null;
}

function firstResolutionAt(record) {
  return record.outcome.exits?.find(exit => exit?.target === 'TP1' && iso(exit.checkedAt))?.checkedAt || record.outcome.checkedAt;
}

function diagnostics(record) {
  const snapshot = record.researchSnapshot || {};
  return {
    originPrice: snapshot.originPrice ?? null,
    opportunityScore: record.origin.opportunityScore ?? snapshot.decision?.opportunityScore ?? null,
    opportunityGrade: record.origin.grade ?? snapshot.decision?.opportunityGrade ?? null,
    volatilityLabel: snapshot.environment?.components?.volatility?.status ?? null,
    atr: snapshot.indicators?.atr14 ?? null,
    atrPercent: snapshot.environment?.components?.volatility?.atrPercent ?? null,
    analysisAt: snapshot.analysisAt ?? null,
    priceTimestamp: snapshot.provenance?.priceTimestamp ?? null,
    trendLabel: snapshot.environment?.trend ?? null,
    regimeLabel: snapshot.environment?.regime ?? null,
    structure: snapshot.structure ?? null,
    freshness: {
      telemetryStatus: snapshot.telemetryStatus ?? null,
      capturedAt: snapshot.capturedAt ?? null,
      dailySource: snapshot.provenance?.dailySource ?? null,
      dailyBar: snapshot.provenance?.dailyBar ?? null,
      dailyConfirmedOnly: snapshot.provenance?.confirmedOnly ?? null,
      dailyLastConfirmedAt: snapshot.provenance?.dailyLastConfirmedAt ?? null,
      confirmedCount: snapshot.provenance?.confirmedCount ?? null,
      priceSource: snapshot.provenance?.priceSource ?? null,
      priceTimestamp: snapshot.provenance?.priceTimestamp ?? null
    }
  };
}

async function fetchPage(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.code === '0' && Array.isArray(payload.data)) return payload.data;
    if (attempt === attempts || ![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`OKX request failed (${response.status}/${payload?.code ?? 'invalid'})`);
    }
    await sleep(500 * attempt);
  }
}

async function fetchCandles(symbol, fromAt, toAt) {
  const from = Date.parse(fromAt);
  const to = Date.parse(toAt);
  const instrument = `${symbol.replace(/USDT$/, '')}-USDT-SWAP`;
  const byTime = new Map();
  let after = to;
  let requests = 0;
  while (after > from) {
    const url = new URL('https://www.okx.com/api/v5/market/history-candles');
    url.searchParams.set('instId', instrument);
    url.searchParams.set('bar', '1m');
    url.searchParams.set('limit', String(Math.min(100, Math.ceil((after - from) / MINUTE_MS))));
    url.searchParams.set('after', String(after));
    url.searchParams.set('before', String(from - 1));
    const data = await fetchPage(url);
    requests += 1;
    let oldest = after;
    for (const row of data) {
      const timestamp = Number(row?.[0]);
      if (Number.isFinite(timestamp)) oldest = Math.min(oldest, timestamp);
      if (timestamp >= from && timestamp < to) byTime.set(timestamp, {
        timestamp, open: Number(row?.[1]), high: Number(row?.[2]), low: Number(row?.[3]),
        close: Number(row?.[4]), confirmed: row?.[8] === '1'
      });
    }
    if (!data.length || oldest >= after) break;
    after = oldest;
    if (requests % 10 === 0) await sleep(1100);
    else await sleep(80);
  }
  return { candles: [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp), requests };
}

function fixedCohort(source, count) {
  if (source.rulesRevision !== RULES || source.strategyVersion !== POLICY || !Array.isArray(source.records)) throw new Error('Invalid source cohort contract');
  const eligible = source.records.filter(record =>
    record?.rulesRevision === RULES && Date.parse(record?.origin?.detectedAt) >= Date.parse(CUTOFF) &&
    Date.parse(record?.origin?.detectedAt) === Date.parse(record?.initialPlan?.createdAt) &&
    record?.initialPlan?.exitStrategy?.version === POLICY &&
    ['Stopped', 'Closed'].includes(record?.outcome?.status) && iso(record?.outcome?.checkedAt) &&
    Number.isFinite(record?.outcome?.resultR) && archivedReachability(record));
  eligible.sort((a, b) => Date.parse(a.outcome.checkedAt) - Date.parse(b.outcome.checkedAt) || a.tradeId.localeCompare(b.tradeId));
  if (eligible.length < count) throw new Error(`Fixed cohort unavailable: ${eligible.length}/${count}`);
  return { records: eligible.slice(0, count), excludedPostFreeze: eligible.length - count,
    frozenThroughCompletedAt: eligible[count - 1].outcome.checkedAt };
}

function availability(records) {
  const checks = {
    tradeIdentity: r => Boolean(r.tradeId && r.origin?.symbol && r.origin?.direction),
    frozenGeometry: r => [r.initialPlan?.entryPrice, r.initialPlan?.entryZone?.from, r.initialPlan?.entryZone?.to, r.initialPlan?.initialStopLoss, r.initialPlan?.takeProfit1].every(Number.isFinite),
    activationAndEntry: r => iso(r.outcome?.activatedAt) && Number.isFinite(r.outcome?.entryPrice),
    opportunityScoreAndGrade: r => Number.isFinite(r.origin?.opportunityScore) && Boolean(r.origin?.grade),
    atrAndAtrPercent: r => Number.isFinite(r.researchSnapshot?.indicators?.atr14) && Number.isFinite(r.researchSnapshot?.environment?.components?.volatility?.atrPercent),
    provenanceTimestamps: r => iso(r.researchSnapshot?.analysisAt) && iso(r.researchSnapshot?.provenance?.priceTimestamp),
    trendAndStructure: r => Boolean(r.researchSnapshot?.environment?.trend && r.researchSnapshot?.structure),
    instrumentPrecisionOrTick: r => Number.isFinite(r.researchSnapshot?.instrument?.tickSize) || Number.isInteger(r.researchSnapshot?.instrument?.pricePrecision),
    explicitRegimeLabel: r => Boolean(r.researchSnapshot?.environment?.regime),
    savedStrategyVersion: r => Boolean(r.initialPlan?.strategyVersion || r.researchSnapshot?.strategyVersion)
  };
  const counts = Object.fromEntries(Object.entries(checks).map(([key, check]) => [key, records.filter(check).length]));
  return {
    fieldsAvailableForAll: Object.keys(counts).filter(key => counts[key] === records.length),
    fieldsPartial: Object.entries(counts).filter(([, count]) => count > 0 && count < records.length).map(([field, count]) => ({ field, count })),
    missingFields: Object.keys(counts).filter(key => counts[key] === 0),
    counts
  };
}

async function main() {
  const options = args(process.argv.slice(2));
  if (!options.input || !options.output) throw new Error('Usage: build-fixed-cohort.mjs --input=FILE --output=FILE [--count=48] [--generated-at=ISO]');
  const source = JSON.parse(await fs.readFile(path.resolve(options.input), 'utf8'));
  const count = Number(options.count || 48);
  if (!Number.isInteger(count) || count <= 0) throw new Error('Invalid count');
  const cohort = fixedCohort(source, count);
  const inputs = [];
  let totalRequests = 0;
  for (let index = 0; index < cohort.records.length; index += 1) {
    const record = cohort.records[index];
    const endAt = firstResolutionAt(record);
    const fetched = await fetchCandles(record.origin.symbol, record.initialPlan.plannedAt, endAt);
    totalRequests += fetched.requests;
    inputs.push({
      tradeId: record.tradeId, symbol: record.origin.symbol, direction: record.origin.direction,
      originAt: record.origin.detectedAt, plannedAt: record.initialPlan.plannedAt,
      expiresAt: record.initialPlan.expiresAt, plannedEntry: record.initialPlan.entryPrice,
      entryZone: record.initialPlan.entryZone, initialStopLoss: record.initialPlan.initialStopLoss,
      takeProfit1: record.initialPlan.takeProfit1,
      strategyVersion: record.initialPlan.strategyVersion ?? record.researchSnapshot?.strategyVersion ?? null,
      exitPolicyVersion: record.initialPlan.exitStrategy.version,
      activationAt: record.outcome.activatedAt, archivedResult: archivedReachability(record), replayEndAt: endAt,
      headlineRiskReward: record.origin.riskReward,
      observedRemainderR: observedRemainderFromOutcome(record.outcome),
      observedFinalGrossR: record.outcome.resultR,
      instrument: record.researchSnapshot?.instrument ?? null, diagnostics: diagnostics(record), candles: fetched.candles
    });
    process.stderr.write(`replay-input ${index + 1}/${cohort.records.length} candles=${fetched.candles.length} requests=${fetched.requests}\n`);
  }
  const artifact = buildReplayArtifact(inputs, {
    sourceCohortIdentifier: source.sourceCohortIdentifier,
    generatedAt: options['generated-at'],
    availability: availability(cohort.records),
    sourceProvenance: {
      protocol: 'post-cutoff-confirmatory-v1', cutoff: CUTOFF, strategyVersion: null,
      exitPolicyVersion: POLICY, rules: RULES,
      sourceSnapshotCompletedRecords: source.records.length,
      fixedCohortCount: count, excludedPostFreeze: cohort.excludedPostFreeze,
      frozenThroughCompletedAt: cohort.frozenThroughCompletedAt,
      candleSource: 'OKX public history-candles 1m confirmed', candleRequests: totalRequests
    }
  });
  await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await fs.writeFile(path.resolve(options.output), `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(artifact.aggregate)}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
