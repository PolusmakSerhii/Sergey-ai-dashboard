#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { calculateLifecycleAlignedEconomics, observedRemainderFromOutcome, summarizeD01 } from './d01.mjs';

const CUTOFF = Date.parse('2026-11-01T22:00:00.000Z');
const POLICY = 'tp1-50-reanalyse-v1';
const RULES = 'canonical-trade-archive-v1';

function argumentsFrom(argv) {
  return Object.fromEntries(argv.map(arg => arg.startsWith('--') ? arg.slice(2).split(/=(.*)/s, 2) : []).filter(pair => pair.length === 2));
}

function fixedRecords(source, count) {
  if (source.rulesRevision !== RULES || !Array.isArray(source.records)) throw new Error('Invalid archive source');
  const records = source.records.filter(record =>
    record?.rulesRevision === RULES && Date.parse(record?.origin?.detectedAt) >= CUTOFF &&
    Date.parse(record?.origin?.detectedAt) === Date.parse(record?.initialPlan?.createdAt) &&
    record?.initialPlan?.exitStrategy?.version === POLICY && ['Stopped', 'Closed'].includes(record?.outcome?.status) &&
    Number.isFinite(Date.parse(record?.outcome?.checkedAt)) && Number.isFinite(record?.outcome?.resultR));
  records.sort((a, b) => Date.parse(a.outcome.checkedAt) - Date.parse(b.outcome.checkedAt) || a.tradeId.localeCompare(b.tradeId));
  if (records.length < count) throw new Error(`Fixed cohort unavailable: ${records.length}/${count}`);
  return records.slice(0, count);
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  if (!options.replay || !options.archive || !options.output || !options['generated-at']) {
    throw new Error('Usage: build-d01-artifact.mjs --replay=FILE --archive=FILE --output=FILE --generated-at=ISO');
  }
  const replay = JSON.parse(await fs.readFile(path.resolve(options.replay), 'utf8'));
  const source = JSON.parse(await fs.readFile(path.resolve(options.archive), 'utf8'));
  if (replay.aggregate?.tradesReplayed !== 48 || replay.aggregate?.parityMatch !== 48 || replay.aggregate?.parityMismatch !== 0 ||
      !Array.isArray(replay.trades) || replay.trades.length !== 48 || replay.strategyRecommendation !== null) {
    throw new Error('Prior replay parity contract failed');
  }
  const records = fixedRecords(source, replay.trades.length);
  const byId = new Map(records.map(record => [record.tradeId, record]));
  const trades = replay.trades.map(trade => {
    const record = byId.get(trade.tradeId);
    if (!record) throw new Error(`Cohort identity mismatch: ${trade.tradeId}`);
    const plan = record.initialPlan;
    const outcome = record.outcome;
    const lifecycleAlignedEconomics = calculateLifecycleAlignedEconomics({
      direction: record.origin.direction,
      plannedEntryReference: plan.entryPrice,
      activationEntryReference: outcome.entryPrice,
      initialStopLoss: plan.initialStopLoss,
      takeProfit1: plan.takeProfit1,
      entryZone: plan.entryZone,
      currentHeadlineRR: record.origin.riskReward,
      observedRemainderR: observedRemainderFromOutcome(outcome),
      observedFinalGrossR: outcome.resultR
    });
    if (!lifecycleAlignedEconomics.valid) throw new Error(`Invalid D01 geometry: ${trade.tradeId}`);
    return { ...trade, lifecycleAlignedEconomics };
  });
  const artifact = {
    ...replay,
    version: 'entry-tp1-replay-v1+d01-v1',
    generatedAt: options['generated-at'],
    derivedFromArtifact: path.basename(options.replay),
    d01Contract: {
      plannedEntryReference: 'initialPlan.entryPrice',
      activationEntryReference: 'outcome.entryPrice; reported separately',
      initialRisk: 'abs(plannedEntryReference - initialStopLoss)',
      tp1Allocation: 0.5,
      modeledCost: '0.0015 * entryReference / abs(entryReference - initialStopLoss)',
      zonePolicy: 'direction-aware endpoint extrema plus midpoint',
      scenarioPolicy: 'TP1-then-BE numeric; reanalysis CLOSE parametric until a close price is supplied',
      observedPolicy: 'archived remainder and final R are post-outcome observations only'
    },
    d01Comparison: summarizeD01(trades),
    trades,
    strategyRecommendation: null
  };
  await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await fs.writeFile(path.resolve(options.output), `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ aggregate: artifact.aggregate, d01Comparison: artifact.d01Comparison })}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
