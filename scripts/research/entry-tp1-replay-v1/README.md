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

## D01 lifecycle-aligned economics

`d01.mjs` adds research-only pre-entry geometry using the frozen planned entry reference. It reports the modeled activation entry separately and never substitutes it into planned geometry. The 50% TP1 leg, fixed cost-in-R, direction-aware zone range, and parametric post-TP1 scenario vector are observability fields only. Archived remainder and final modeled net R are explicitly post-outcome observations. No probability, expected-value field, eligibility gate, score component, or strategy recommendation is created.

`build-d01-artifact.mjs` enriches the already proven parity artifact with the frozen archive records and writes a new artifact in exclusive mode. The earlier artifact is never overwritten.

## D03 OI/price semantic shadow

`d03-shadow.mjs` defines a typed, research-only contract that keeps `openInterestChange24h` and same-analysis ticker `priceChange24h` separate. Missing/non-finite metrics or unproven provenance return `UNAVAILABLE`; values are never substituted, reused, coerced to zero, or inferred. Zero OI, zero price, and both-flat cases are explicit.

`evaluateV1SemanticShadow` models the proven v1 substitution only for comparison. Nothing under this research directory is imported by production scoring, eligibility, plan creation, candidate freezing, or registration. `build-d03-shadow-artifact.mjs` refuses to reconstruct fields omitted by historical snapshots and records those rows as `NOT_PROVEN`.

## D05 mandatory birth-safety shadow

`d05-shadow.mjs` defines a research-only, fail-closed birth-safety contract for exact instrument identity, fresh positive ticker data, at least 200 confirmed contiguous 1D candles with valid OHLC, and explicit required/optional source availability. The existing 60-second ticker limit and 24-hour-plus-5-minute latest-candle limit are frozen in the contract. Required sources block when unavailable; an absent optional source is recorded as unavailable but is never substituted and does not block by itself.

The contract only returns `READY` or `BLOCKED` for complete live-shaped inputs. Historical evaluation is separate: if any mandatory condition cannot be proved from the saved snapshot, the record is `NOT_EVALUABLE`, never inferred safe or counted as blocked. The fixed archive omits `instId`, an authoritative instrument record, and raw daily OHLC history, so `build-d05-shadow-artifact.mjs` preserves those limitations explicitly. D05 is not imported by production plan creation, opportunity/A+ scoring, candidate freezing, registration, probability, confidence, readiness, or score paths.

## D04 tick-size and price-precision shadow

`d04-shadow.mjs` preserves raw analytical values and uses BigInt decimal tick units only when executable geometry is required. Tick size is accepted only from an exact, timestamped `OKX public instruments` contract; it is never inferred from price magnitude, displayed decimals, or existing `toFixed` output. Entry-zone boundaries quantize inward, stops and targets follow the frozen direction-aware rules, and invalid or collapsed geometry is reported without repair.

`build-d04-shadow-artifact.mjs` compares saved v1 geometry with D04 shadow geometry, recomputes D01 metrics where valid, and includes deterministic fixtures that expose `toFixed(2)` zero-collapse and level merging. Its metadata timestamp describes when the authoritative instrument record was observed; it does not claim the current tick was historically unchanged at trade birth. D04 remains disconnected from every production analysis, scoring, eligibility, plan, scanner, candidate, registration, and lifecycle path.

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
