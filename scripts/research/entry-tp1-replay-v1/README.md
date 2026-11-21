# Entry → TP1 replay v1

Offline, read-only research harness for deterministic Core v1 entry/SL/TP1 replay. It does not import or mutate production scanner, eligibility, lifecycle, Redis, API, environment, or notification code.

## Contract

The executable schema is exported as `REPLAY_INPUT_SCHEMA` from `replay.mjs`. Required inputs are frozen plan identity and geometry, the saved exit-policy version, replay boundaries, and a contiguous confirmed 1-minute OHLC series. Optional inputs contain an explicitly saved strategy identifier, archived activation/result data, instrument precision, and saved diagnostic evidence. The fixed archive has no separate saved strategy identifier, so that field remains `null`; it is never inferred from the exit-policy version.

Candles are copied and sorted by timestamp. Exact duplicate timestamps and malformed/unconfirmed candles fail closed. An out-of-order but otherwise complete array is accepted after deterministic sorting and reported with `inputWasOutOfOrder: true`. A missing minute in the required interval returns `UNRESOLVED/CANDLE_GAP`.

Activation uses the frozen v1 rule: the first complete candle touching the frozen entry zone activates at `clamp(candle.open, zoneLow, zoneHigh)`. Exact level boundaries count as touches. A candle touching both initial SL and TP1 returns `AMBIGUOUS_SAME_CANDLE`; the harness never invents intrabar ordering.

## Output labels

- `TP1_BEFORE_SL`
- `SL_BEFORE_TP1`
- `AMBIGUOUS_SAME_CANDLE`
- `UNRESOLVED`
- `INVALID_INPUT`

Cost diagnostics use `0.0015 * entryPrice / abs(entryPrice - initialStopLoss)`. Midpoint, best-zone, and worst-zone values are diagnostics only and never gates.

## CLI

```sh
node scripts/research/entry-tp1-replay-v1/replay.mjs \
  --input=/absolute/path/replay-input.json \
  --output=/absolute/path/new-artifact.json \
  --generated-at=2026-11-21T00:00:00.000Z
```

Output creation uses exclusive mode and refuses to overwrite an existing artifact. The machine-readable artifact contains no strategy recommendation.

`build-fixed-cohort.mjs` is the separate read-only acquisition adapter used for the frozen confirmatory cohort. It accepts an authenticated archive export, selects the explicitly requested fixed count in completion order, obtains public confirmed OKX 1m candles, and creates a new artifact with source provenance. It never reads cookies, bearer tokens, headers, or secrets.

## Evidence availability

The archive adapter should map every available saved field without fabricating missing values. Geometry, direction, score, activation timing, and archived outcomes are expected for the fixed cohort. Instrument tick metadata, regime labels, and some freshness/structure summaries may be partial and remain `null` when absent.
