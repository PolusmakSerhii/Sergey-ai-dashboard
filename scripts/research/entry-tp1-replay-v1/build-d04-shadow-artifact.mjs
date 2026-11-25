#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { buildAnalyticalRoundingFixtures, D04_CONTRACT_VERSION, evaluateD04Shadow,
  OKX_TICK_SOURCE, summarizeD04 } from './d04-shadow.mjs';

const CUTOFF = Date.parse('2026-11-01T22:00:00.000Z');
const POLICY = 'tp1-50-reanalyse-v1';
const RULES = 'canonical-trade-archive-v1';
const OKX_ENDPOINT = 'https://www.okx.com/api/v5/public/instruments?instType=SWAP';
const finite = value => typeof value === 'number' && Number.isFinite(value);

function argumentsFrom(argv) {
  return Object.fromEntries(argv.map(arg => arg.startsWith('--') ? arg.slice(2).split(/=(.*)/s, 2) : [])
    .filter(pair => pair.length === 2));
}

function fixedRecords(source, count) {
  if (source.rulesRevision !== RULES || source.strategyVersion !== POLICY || !Array.isArray(source.records)) {
    throw new Error('Invalid archive source');
  }
  const records = source.records.filter(record =>
    record?.rulesRevision === RULES && Date.parse(record?.origin?.detectedAt) >= CUTOFF &&
    Date.parse(record?.origin?.detectedAt) === Date.parse(record?.initialPlan?.createdAt) &&
    record?.initialPlan?.exitStrategy?.version === POLICY && ['Stopped', 'Closed'].includes(record?.outcome?.status) &&
    Number.isFinite(Date.parse(record?.outcome?.checkedAt)) && Number.isFinite(record?.outcome?.resultR));
  records.sort((a, b) => Date.parse(a.outcome.checkedAt) - Date.parse(b.outcome.checkedAt) || a.tradeId.localeCompare(b.tradeId));
  if (records.length < count) throw new Error(`Fixed cohort unavailable: ${records.length}/${count}`);
  return records.slice(0, count);
}

async function rawMetadata(options) {
  if (options.metadata) {
    const saved = JSON.parse(await fs.readFile(path.resolve(options.metadata), 'utf8'));
    if (!Array.isArray(saved?.tickMetadata?.records)) throw new Error('Metadata artifact has no tickMetadata.records');
    return saved.tickMetadata.records;
  }
  if (options['fetch-okx'] !== 'true') throw new Error('Use --fetch-okx=true or --metadata=ARTIFACT');
  const response = await fetch(OKX_ENDPOINT, { signal: AbortSignal.timeout(15_000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.code !== '0' || !Array.isArray(payload.data)) {
    throw new Error(`OKX instruments request failed (${response.status}/${payload?.code ?? 'invalid'})`);
  }
  return payload.data;
}

function normalizeMetadata(items, symbols, observedAt) {
  const wanted = new Set(symbols);
  const records = [];
  for (const item of items) {
    if (item?.tickSource === OKX_TICK_SOURCE) {
      const baseCcy = item?.identityEvidence?.contractValueCurrency;
      const quoteCcy = item?.identityEvidence?.settleCurrency;
      const exactFamily = `${baseCcy}-${quoteCcy}`;
      if (wanted.has(item.symbol) && item.symbol === `${baseCcy}${quoteCcy}` && item.instId === `${exactFamily}-SWAP` &&
        item.instrumentType === 'SWAP' && item.identityEvidence.instrumentFamily === exactFamily &&
        item.identityEvidence.underlying === exactFamily && item.identityEvidence.state === 'live' &&
        typeof item.tickSize === 'string' && Number.isFinite(Date.parse(item.instrumentRecordObservedAt))) records.push(item);
      continue;
    }
    const baseCcy = item?.ctValCcy;
    const quoteCcy = item?.settleCcy;
    const symbol = `${baseCcy || ''}${quoteCcy || ''}`;
    const exactInstId = `${baseCcy}-${quoteCcy}-SWAP`;
    const exactFamily = `${baseCcy}-${quoteCcy}`;
    if (!wanted.has(symbol) || item?.instType !== 'SWAP' || quoteCcy !== 'USDT' || item?.instId !== exactInstId ||
      item?.instFamily !== exactFamily || item?.uly !== exactFamily ||
      item?.state !== 'live' || typeof item?.tickSz !== 'string') continue;
    records.push({
      symbol, instId: item.instId, instrumentType: item.instType, tickSize: item.tickSz,
      tickSource: OKX_TICK_SOURCE, instrumentRecordObservedAt: observedAt,
      identityEvidence: { contractValueCurrency: baseCcy, settleCurrency: quoteCcy,
        instrumentFamily: item.instFamily, underlying: item.uly, state: item.state }
    });
  }
  records.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return records;
}

function geometryFrom(record) {
  const plan = record.initialPlan || {};
  return {
    symbol: record.origin?.symbol ?? null,
    instrumentType: record.researchSnapshot?.instrument?.instrumentType ?? null,
    plannedEntry: plan.entryPrice,
    entryZoneLow: Math.min(plan.entryZone?.from, plan.entryZone?.to),
    entryZoneHigh: Math.max(plan.entryZone?.from, plan.entryZone?.to),
    stop: plan.initialStopLoss,
    tp1: plan.takeProfit1,
    tp2: plan.takeProfit2 ?? null,
    tp3: plan.takeProfit3 ?? null
  };
}

function geometryAvailable(geometry) {
  return typeof geometry.symbol === 'string' && geometry.instrumentType === 'SWAP' && ['plannedEntry', 'entryZoneLow', 'entryZoneHigh', 'stop', 'tp1']
    .every(key => finite(geometry[key]) && geometry[key] > 0);
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  if (!options.archive || !options.output || !options['generated-at'] || !options['metadata-observed-at']) {
    throw new Error('Usage: build-d04-shadow-artifact.mjs --archive=FILE --output=FILE --generated-at=ISO --metadata-observed-at=ISO (--fetch-okx=true|--metadata=ARTIFACT) [--count=48]');
  }
  if (![options['generated-at'], options['metadata-observed-at']].every(value => Number.isFinite(Date.parse(value)))) {
    throw new Error('Invalid timestamp option');
  }
  const source = JSON.parse(await fs.readFile(path.resolve(options.archive), 'utf8'));
  const count = Number(options.count || 48);
  if (!Number.isInteger(count) || count <= 0) throw new Error('Invalid count');
  const cohort = fixedRecords(source, count);
  const symbols = [...new Set(cohort.map(record => record.origin.symbol))].sort();
  const observedAt = new Date(options['metadata-observed-at']).toISOString();
  const tickMetadata = normalizeMetadata(await rawMetadata(options), symbols, observedAt);
  const bySymbol = new Map(tickMetadata.map(item => [item.symbol, item]));
  const records = cohort.map(record => {
    const geometry = geometryFrom(record);
    const tickContract = bySymbol.get(geometry.symbol) ?? null;
    const hasGeometry = geometryAvailable(geometry);
    const hasTick = Boolean(tickContract);
    const evaluability = hasGeometry && hasTick ? 'FULLY_EVALUABLE'
      : hasGeometry || hasTick ? 'PARTIALLY_EVALUABLE' : 'NOT_EVALUABLE';
    return {
      tradeId: record.tradeId,
      symbol: geometry.symbol,
      direction: record.origin.direction,
      evaluability,
      tickMetadataAvailable: hasTick,
      tickContract,
      shadow: evaluability === 'FULLY_EVALUABLE'
        ? evaluateD04Shadow({ direction: record.origin.direction, geometry, tickContract }) : null
    };
  });
  const fixtures = buildAnalyticalRoundingFixtures();
  const summary = summarizeD04(records, fixtures);
  const artifact = {
    version: 'core-v2-d04-shadow-artifact-v1',
    contractVersion: D04_CONTRACT_VERSION,
    generatedAt: new Date(options['generated-at']).toISOString(),
    sourceCohortIdentifier: source.sourceCohortIdentifier,
    sourceProvenance: {
      protocol: 'post-cutoff-confirmatory-v1', cutoff: new Date(CUTOFF).toISOString(), strategyVersion: POLICY,
      rulesRevision: RULES, fixedCohortCount: count, sourceSnapshotRecords: source.records.length
    },
    tickMetadata: {
      source: OKX_TICK_SOURCE,
      endpoint: OKX_ENDPOINT,
      instrumentRecordObservedAt: observedAt,
      temporalScope: 'Authoritative metadata observed at artifact time; this shadow does not assert that tick size was historically unchanged at trade birth',
      requestedSymbols: symbols.length,
      exactIdentityMatches: tickMetadata.length,
      records: tickMetadata
    },
    summary,
    analyticalRoundingFixtures: fixtures,
    records,
    strategyRecommendation: null
  };
  await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await fs.writeFile(path.resolve(options.output), `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
