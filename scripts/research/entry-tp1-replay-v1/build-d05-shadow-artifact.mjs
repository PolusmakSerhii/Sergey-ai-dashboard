#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { D05_CONTRACT_VERSION, summarizeHistoricalD05 } from './d05-shadow.mjs';

const CUTOFF = Date.parse('2026-11-01T22:00:00.000Z');
const POLICY = 'tp1-50-reanalyse-v1';
const RULES = 'canonical-trade-archive-v1';

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

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  if (!options.archive || !options.output || !options['generated-at']) {
    throw new Error('Usage: build-d05-shadow-artifact.mjs --archive=FILE --output=FILE --generated-at=ISO [--count=48]');
  }
  if (!Number.isFinite(Date.parse(options['generated-at']))) throw new Error('Invalid generated-at');
  const source = JSON.parse(await fs.readFile(path.resolve(options.archive), 'utf8'));
  const count = Number(options.count || 48);
  if (!Number.isInteger(count) || count <= 0) throw new Error('Invalid count');
  const cohort = fixedRecords(source, count);
  const analysis = summarizeHistoricalD05(cohort);
  const { records, ...summary } = analysis;
  const artifact = {
    version: 'core-v2-d05-shadow-artifact-v1',
    contractVersion: D05_CONTRACT_VERSION,
    generatedAt: new Date(options['generated-at']).toISOString(),
    sourceCohortIdentifier: source.sourceCohortIdentifier,
    sourceProvenance: {
      protocol: 'post-cutoff-confirmatory-v1',
      cutoff: new Date(CUTOFF).toISOString(),
      strategyVersion: POLICY,
      rulesRevision: RULES,
      fixedCohortCount: count,
      sourceSnapshotRecords: source.records.length,
      limitation: 'Frozen snapshots omit instId, an authoritative instrument record, and raw 1D OHLC history; missing evidence remains NOT_EVALUABLE and is never inferred from trade birth'
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
