function createCandlestickLayer(chart) {
  if (
    !chart ||
    !window.LightweightCharts?.CandlestickSeries
  ) {
    return null;
  }

  return chart.addSeries(
    window.LightweightCharts.CandlestickSeries,
    {
      upColor: "#4ee3b2",
      downColor: "#ff7474",

      borderUpColor: "#4ee3b2",
      borderDownColor: "#ff7474",

      wickUpColor: "#4ee3b2",
      wickDownColor: "#ff7474",

      priceLineVisible: true,
      lastValueVisible: true
    }
  );
}
async function loadCandlestickData(
  options = {}
) {
  const {
    chart,
    candlestickSeries,
    symbol,
    timeframe = "1H",
    limit = 300
  } = options;

  if (
    !chart ||
    !candlestickSeries
  ) {
    return {
      ok: false,
      error:
        "Chart or candlestick series is unavailable"
    };
  }

  if (
    !window.SergeyMarketData?.getCandles
  ) {
    return {
      ok: false,
      error:
        "Market Data module is unavailable"
    };
  }

  const response =
    await window.SergeyMarketData.getCandles({
      symbol,
      timeframe,
      limit
    });

  if (
    response.ok !== true ||
    !Array.isArray(response.candles)
  ) {
    console.error(
      "AI Chart candles failed:",
      response
    );

    return {
      ok: false,
      error:
        response.error ||
        "Could not load candle data"
    };
  }

  const candlesByTime =
    new Map();

  for (const candle of response.candles) {
    const normalizedCandle = {
      time: Number(candle.time),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close)
    };

    const valid =
      Number.isFinite(
        normalizedCandle.time
      ) &&
      Number.isFinite(
        normalizedCandle.open
      ) &&
      Number.isFinite(
        normalizedCandle.high
      ) &&
      Number.isFinite(
        normalizedCandle.low
      ) &&
      Number.isFinite(
        normalizedCandle.close
      );

    if (!valid) continue;

    candlesByTime.set(
      normalizedCandle.time,
      normalizedCandle
    );
  }

  const candles =
    Array
      .from(candlesByTime.values())
      .sort(
        (a, b) =>
          a.time - b.time
      );

  if (candles.length === 0) {
    return {
      ok: false,
      error:
        "Backend returned no valid candles"
    };
  }

  candlestickSeries.setData(
    candles
  );

  chart
    .timeScale()
    .fitContent();

  console.log(
    "AI Chart candles loaded:",
    {
      symbol,
      timeframe,
      count: candles.length,
      source: response.source
    }
  );

  return {
    ok: true,
    symbol,
    timeframe,
    count: candles.length,
    candles
  };
}

function initializeAIChart(options = {}) {
  const {
    containerId,
    symbol
  } = options;

  const chartContainer =
    document.getElementById(containerId);

  if (!chartContainer) {
    console.error(
      `AI Chart container not found: ${containerId}`
    );

    return {
      ok: false,
      error:
        `Chart container not found: ${containerId}`
    };
  }

 if (!window.LightweightCharts) {
  chartContainer.innerHTML = `
    <div style="
      display:flex;
      min-height:420px;
      align-items:center;
      justify-content:center;
      color:#ff7474;
    ">
      Chart library failed to load
    </div>
  `;

  return {
    ok: false,
    error: "Lightweight Charts is unavailable"
  };
}

chartContainer.innerHTML = "";

const chart =
  window.LightweightCharts.createChart(
    chartContainer,
    {
      width:
        chartContainer.clientWidth,

      height: 420,

      layout: {
        background: {
          color: "#08111c"
        },

        textColor: "#8fa1b5"
      },

      grid: {
        vertLines: {
          color: "rgba(143, 161, 181, 0.08)"
        },

        horzLines: {
          color: "rgba(143, 161, 181, 0.08)"
        }
      },

      rightPriceScale: {
        borderColor:
          "rgba(143, 161, 181, 0.20)"
      },

      timeScale: {
        borderColor:
          "rgba(143, 161, 181, 0.20)",

        timeVisible: true
      },

      crosshair: {
        mode: 1
      }
    }
  );
const candlestickSeries =
  createCandlestickLayer(
    chart
  );

if (!candlestickSeries) {
  chartContainer.innerHTML = `
    <div style="
      display:flex;
      min-height:420px;
      align-items:center;
      justify-content:center;
      color:#ff7474;
    ">
      Candlestick layer failed to initialize
    </div>
  `;

  return {
    ok: false,
    error:
      "Candlestick layer is unavailable"
  };
}

const candlesPromise =
  loadCandlestickData({
    chart,
    candlestickSeries,
    symbol,
    timeframe: "1H",
    limit: 300
  });

candlesPromise.then(
  result => {
    console.log(
      "AI Chart candle result:",
      result
    );
  }
);
  
const resizeObserver =
  new ResizeObserver(() => {
    chart.applyOptions({
      width:
        chartContainer.clientWidth
    });
  });

resizeObserver.observe(
  chartContainer
);
  
  console.log(
    "AI Chart initialized:",
    {
      containerId,
      symbol
    }
  );

 return {
  ok: true,
  containerId,
  symbol,

  timeframe: "1H",

  chart,
  candlestickSeries,
  candlesPromise,
  resizeObserver
};
}

window.SergeyAIChart = {
  initialize: initializeAIChart
};
