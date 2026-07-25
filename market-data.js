const MARKET_API_URL =
  "https://sergey-ai-trader-api.vercel.app/api/market";

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase();
}

function normalizeTimeframe(timeframe) {
  const allowedTimeframes =
    new Set([
      "1m",
      "5m",
      "15m",
      "1H",
      "4H",
      "1D"
    ]);

  return allowedTimeframes.has(timeframe)
    ? timeframe
    : "1H";
}

async function getCandles(options = {}) {
  const symbol =
    normalizeSymbol(options.symbol);

  const timeframe =
    normalizeTimeframe(
      options.timeframe
    );

  const requestedLimit =
    Number.parseInt(
      String(options.limit || "300"),
      10
    );

  const limit =
    Number.isFinite(requestedLimit)
      ? Math.max(
          50,
          Math.min(1000, requestedLimit)
        )
      : 300;

  if (!symbol) {
    return {
      ok: false,
      symbol: null,
      timeframe,
      candles: [],
      error: "Symbol is required"
    };
  }

  const url =
    new URL(MARKET_API_URL);

  url.searchParams.set(
    "mode",
    "chart"
  );

  url.searchParams.set(
    "symbol",
    symbol
  );

  url.searchParams.set(
    "timeframe",
    timeframe
  );

  url.searchParams.set(
    "limit",
    String(limit)
  );

  try {
    const response =
      await fetch(url);

    const payload =
      await response
        .json()
        .catch(() => null);

    if (
      !response.ok ||
      payload?.ok !== true
    ) {
      return {
        ok: false,
        symbol,
        timeframe,
        candles: [],
        error:
          payload?.error ||
          `Chart request failed: ${response.status}`
      };
    }

    return {
      ok: true,
      symbol,
      timeframe,
      candles:
        Array.isArray(payload.candles)
          ? payload.candles
          : [],
      count:
        Number(payload.count) || 0,
      source:
        payload.source || "Backend API",
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      symbol,
      timeframe,
      candles: [],
      error: error.message
    };
  }
}

window.SergeyMarketData = {
  getCandles
};
