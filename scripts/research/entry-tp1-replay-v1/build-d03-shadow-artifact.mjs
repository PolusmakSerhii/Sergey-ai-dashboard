#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { compareD03Semantics, summarizeD03Comparisons } from './d03-shadow.mjs';

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

function savedD03Input(record) {
  const snapshot = record.researchSnapshot || {};
  const derivatives = snapshot.derivatives || {};
  const market = snapshot.market || {};
  return {
    openInterestChange24h: derivatives.openInterestChange24h ?? null,
    priceChange24h: market.priceChange24h ?? null,
    openInterestSource: derivatives.openInterestSource ?? null,
    priceSource: market.priceSource ?? snapshot.provenance?.priceSource ?? null,
    // Origin/analysis timestamps are not provider observation timestamps and are never substituted.
    observedAt: derivatives.observedAt === market.observedAt ? derivatives.observedAt ?? null : null
  };
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  if (!options.archive || !options.output || !options['generated-at']) {
    throw new Error('Usage: build-d03-shadow-artifact.mjs --archive=FILE --output=FILE --generated-at=ISO [--count=48]');
  }
  const source = JSON.parse(await fs.readFile(path.resolve(options.archive), 'utf8'));
  const count = Number(options.count || 48);
  if (!Number.isInteger(count) || count <= 0) throw new Error('Invalid count');
  const cohort = fixedRecords(source, count);
  const records = cohort.map(record => {
    const input = savedD03Input(record);
    return { tradeId: record.tradeId, inputAvailability: {
      openInterestChange24h: Number.isFinite(input.openInterestChange24h),
      priceChange24h: Number.isFinite(input.priceChange24h),
      providerObservedAt: typeof input.observedAt === 'string' && Number.isFinite(Date.parse(input.observedAt))
    }, comparison: compareD03Semantics(input) };
  });
  const artifact = {
    version: 'core-v2-d03-shadow-artifact-v1',
    contractVersion: 'd03-oi-price-semantics-shadow-v1',
    generatedAt: options['generated-at'],
    sourceCohortIdentifier: source.sourceCohortIdentifier,
    sourceProvenance: { cutoff: new Date(CUTOFF).toISOString(), exitPolicyVersion: POLICY, rulesRevision: RULES,
      fixedCohortCount: count, sourceSnapshotRecords: source.records.length,
      limitation: 'Frozen research snapshots omit D03 OI/price inputs; no historical reconstruction or semantic substitution was performed' },
    summary: summarizeD03Comparisons(records),
    records,
    strategyRecommendation: null
  };
  await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await fs.writeFile(path.resolve(options.output), `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(artifact.summary)}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
