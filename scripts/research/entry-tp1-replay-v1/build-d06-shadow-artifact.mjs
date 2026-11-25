#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { D06_CONTRACT_VERSION, evaluateD06Atr, evaluateD06Geometry, summarizeD06 } from './d06-shadow.mjs';

const CUTOFF = Date.parse('2026-11-01T22:00:00.000Z');
const POLICY = 'tp1-50-reanalyse-v1';
const RULES = 'canonical-trade-archive-v1';
const OKX_ENDPOINT = 'https://www.okx.com/api/v5/market/history-candles';
const DAY_MS = 86_400_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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

async function fetchRows(instId, beforeAt, attempts = 3) {
  const url = new URL(OKX_ENDPOINT);
  url.searchParams.set('instId', instId);
  url.searchParams.set('bar', '1D');
  url.searchParams.set('limit', '20');
  url.searchParams.set('after', String(Date.parse(beforeAt)));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.code === '0' && Array.isArray(payload.data)) return payload.data;
    if (attempt === attempts || ![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`OKX candles failed (${response.status}/${payload?.code ?? 'invalid'})`);
    }
    await sleep(500 * attempt);
  }
}

function parseCandles(rows, beforeAt) {
  return rows.map(row => ({
    timestamp: new Date(Number(row?.[0])).toISOString(),
    open: Number(row?.[1]), high: Number(row?.[2]), low: Number(row?.[3]), close: Number(row?.[4]),
    confirmed: row?.[8] === '1'
  })).filter(candle => Date.parse(candle.timestamp) + DAY_MS <= Date.parse(beforeAt))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-15);
}

function savedCandleInputs(artifact) {
  return new Map((artifact?.records || []).map(record => [record.tradeId, record.candleInput]));
}

function v1Geometry(record) {
  const plan = record.initialPlan || {};
  return {
    plannedEntry: plan.entryPrice,
    entryZoneLow: Math.min(plan.entryZone?.from, plan.entryZone?.to),
    entryZoneHigh: Math.max(plan.entryZone?.from, plan.entryZone?.to),
    stop: plan.initialStopLoss,
    tp1: plan.takeProfit1,
    tp2: plan.takeProfit2,
    tp3: plan.takeProfit3
  };
}

function validGeometry(geometry) {
  return Object.values(geometry).every(value => finite(value) && value > 0);
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  if (!options.archive || !options['d04-artifact'] || !options.output || !options['generated-at'] || !options['candles-retrieved-at']) {
    throw new Error('Usage: build-d06-shadow-artifact.mjs --archive=FILE --d04-artifact=FILE --output=FILE --generated-at=ISO --candles-retrieved-at=ISO (--fetch-okx=true|--candle-artifact=FILE) [--count=48]');
  }
  if (![options['generated-at'], options['candles-retrieved-at']].every(value => Number.isFinite(Date.parse(value)))) {
    throw new Error('Invalid timestamp option');
  }
  const source = JSON.parse(await fs.readFile(path.resolve(options.archive), 'utf8'));
  const d04Artifact = JSON.parse(await fs.readFile(path.resolve(options['d04-artifact']), 'utf8'));
  const count = Number(options.count || 48);
  if (!Number.isInteger(count) || count <= 0) throw new Error('Invalid count');
  const cohort = fixedRecords(source, count);
  const ticks = new Map((d04Artifact?.tickMetadata?.records || []).map(item => [item.symbol, item]));
  const priorInputs = options['candle-artifact']
    ? savedCandleInputs(JSON.parse(await fs.readFile(path.resolve(options['candle-artifact']), 'utf8'))) : new Map();
  if (!options['candle-artifact'] && options['fetch-okx'] !== 'true') throw new Error('Use --fetch-okx=true or --candle-artifact=FILE');

  const records = [];
  for (let index = 0; index < cohort.length; index += 1) {
    const record = cohort[index];
    const symbol = record.origin.symbol;
    const analysisAt = record.researchSnapshot?.analysisAt;
    const savedLatest = record.researchSnapshot?.provenance?.dailyLastConfirmedAt;
    const tickContract = ticks.get(symbol) ?? null;
    let candleInput = priorInputs.get(record.tradeId) ?? null;
    if (!candleInput && tickContract && Number.isFinite(Date.parse(analysisAt))) {
      try {
        const candles = parseCandles(await fetchRows(tickContract.instId, analysisAt), analysisAt);
        const newestOpen = candles.at(-1)?.timestamp ?? null;
        const newestClose = newestOpen ? new Date(Date.parse(newestOpen) + DAY_MS).toISOString() : null;
        candleInput = {
          candles,
          provenance: {
            source: 'OKX public history-candles', endpoint: OKX_ENDPOINT, instId: tickContract.instId, bar: '1D',
            retrievedAt: new Date(options['candles-retrieved-at']).toISOString(), analysisAt,
            savedDailyLastConfirmedAt: savedLatest ?? null, fetchedNewestConfirmedOpenAt: newestOpen,
            fetchedNewestConfirmedCloseAt: newestClose,
            timestampCompatible: Boolean(newestClose && savedLatest && Date.parse(newestClose) === Date.parse(savedLatest))
          }
        };
      } catch (error) {
        candleInput = { candles: [], provenance: { source: 'OKX public history-candles', endpoint: OKX_ENDPOINT,
          instId: tickContract.instId, bar: '1D', retrievedAt: new Date(options['candles-retrieved-at']).toISOString(),
          analysisAt, savedDailyLastConfirmedAt: savedLatest ?? null, fetchedNewestConfirmedOpenAt: null,
          fetchedNewestConfirmedCloseAt: null,
          timestampCompatible: false, acquisitionError: error.message } };
      }
      await sleep(90);
    }
    const currentGeometry = v1Geometry(record);
    const baseAvailable = Boolean(tickContract) && finite(record.researchSnapshot?.originPrice) && validGeometry(currentGeometry);
    const candlesCompatible = candleInput?.provenance?.timestampCompatible === true;
    const atr = candlesCompatible ? evaluateD06Atr({ candles: candleInput.candles, evaluatedAt: analysisAt,
      price: record.researchSnapshot.originPrice }) : null;
    const fullyEvaluable = baseAvailable && atr?.status === 'AVAILABLE';
    const evaluability = fullyEvaluable ? 'FULLY_EVALUABLE'
      : baseAvailable || candlesCompatible ? 'PARTIALLY_EVALUABLE' : 'NOT_EVALUABLE';
    const geometry = fullyEvaluable ? evaluateD06Geometry({ direction: record.origin.direction, symbol,
      instrumentType: record.researchSnapshot?.instrument?.instrumentType, referencePrice: record.researchSnapshot.originPrice,
      atrV2: atr.atrV2TrueRange, tickContract, v1Geometry: currentGeometry }) : null;
    records.push({
      tradeId: record.tradeId, symbol, direction: record.origin.direction, evaluability,
      savedResearchAtr14: record.researchSnapshot?.indicators?.atr14 ?? null,
      v1ShadowMatchesSavedAtr14: atr?.status === 'AVAILABLE' && finite(record.researchSnapshot?.indicators?.atr14)
        ? atr.atrV1 === record.researchSnapshot.indicators.atr14 : null,
      tickContract,
      candleInput,
      atr,
      geometry
    });
    if (!options['candle-artifact']) process.stderr.write(`d06-candles ${index + 1}/${cohort.length} ${symbol} compatible=${candlesCompatible}\n`);
  }
  const summary = summarizeD06(records);
  const artifact = {
    version: 'core-v2-d06-shadow-artifact-v1',
    contractVersion: D06_CONTRACT_VERSION,
    generatedAt: new Date(options['generated-at']).toISOString(),
    sourceCohortIdentifier: source.sourceCohortIdentifier,
    sourceProvenance: {
      protocol: 'post-cutoff-confirmatory-v1', cutoff: new Date(CUTOFF).toISOString(), strategyVersion: POLICY,
      rulesRevision: RULES, fixedCohortCount: count, sourceSnapshotRecords: source.records.length
    },
    candleProvenance: {
      source: 'OKX public history-candles', endpoint: OKX_ENDPOINT, bar: '1D', requiredCandles: 15,
      retrievedAt: new Date(options['candles-retrieved-at']).toISOString(),
      compatibilityRule: 'newest fetched candle close (open timestamp + 24h) must equal saved dailyLastConfirmedAt and be <= analysisAt',
      limitation: 'Candles were retrieved separately after trade birth; exact timestamp compatibility is verified, but this is not a claim that the raw candles were persisted in the original snapshot'
    },
    d04Provenance: {
      artifactVersion: d04Artifact.version, contractVersion: d04Artifact.contractVersion,
      instrumentRecordObservedAt: d04Artifact.tickMetadata?.instrumentRecordObservedAt,
      temporalScope: d04Artifact.tickMetadata?.temporalScope
    },
    summary,
    records,
    strategyRecommendation: null
  };
  await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await fs.writeFile(path.resolve(options.output), `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
