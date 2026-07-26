function formatChartValue(value) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return "—";
  }

  if (Math.abs(number) >= 1000) {
    return number.toFixed(2);
  }

  if (Math.abs(number) >= 1) {
    return number.toFixed(4);
  }

  if (Math.abs(number) >= 0.01) {
    return number.toFixed(6);
  }

  return number.toPrecision(6);
}

function getDynamicPriceFormat(
  candles = []
) {
  const validPrices =
    candles
      .map(candle =>
        Number(candle?.close)
      )
      .filter(price =>
        Number.isFinite(price) &&
        price > 0
      );

  if (validPrices.length === 0) {
    return {
      type: "price",
      precision: 2,
      minMove: 0.01
    };
  }

  const latestPrice =
    validPrices[
      validPrices.length - 1
    ];

  let precision = 2;

  if (latestPrice < 1) {
    precision = 4;
  }

  if (latestPrice < 0.1) {
    precision = 5;
  }

  if (latestPrice < 0.01) {
    precision = 6;
  }

  if (latestPrice < 0.001) {
    precision = 7;
  }

  if (latestPrice < 0.0001) {
    precision = 8;
  }

  const minMove =
    1 / Math.pow(
      10,
      precision
    );

  return {
    type: "price",
    precision,
    minMove
  };
}

function calculateEMAData(
  candles,
  period
) {
  if (
    !Array.isArray(candles) ||
    candles.length < period
  ) {
    return [];
  }

  const multiplier =
    2 / (period + 1);

  const initialAverage =
    candles
      .slice(0, period)
      .reduce(
        (sum, candle) =>
          sum + candle.close,
        0
      ) / period;

  const emaData = [];

  let previousEMA =
    initialAverage;

  emaData.push({
    time:
      candles[period - 1].time,

    value:
      previousEMA
  });

  for (
    let index = period;
    index < candles.length;
    index++
  ) {
    const candle =
      candles[index];

    previousEMA =
      candle.close * multiplier +
      previousEMA *
        (1 - multiplier);

    emaData.push({
      time: candle.time,
      value:
        Number(
          previousEMA.toFixed(8)
        )
    });
  }

  return emaData;
}

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

function createEMALayer(
  chart,
  options = {}
) {
  const {
    period,
    color,
    lineWidth = 2
  } = options;

  if (
    !chart ||
    !window.LightweightCharts?.LineSeries ||
    !Number.isInteger(period) ||
    period <= 0
  ) {
    return null;
  }

  return chart.addSeries(
    window.LightweightCharts.LineSeries,
    {
      color:
        color || "#f4b942",

      lineWidth,

      title:
        `EMA ${period}`,

      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true
    }
  );
}

function createChartLegend(options = {}) {
  const {
    chartContainer,
    chart,
    candlestickSeries,
    ema20Series,
    symbol,
    timeframe
  } = options;

  if (
    !chartContainer ||
    !chart ||
    !candlestickSeries
  ) {
    return null;
  }
   let currentTimeframe =
     timeframe || "1H";
  
  const legend =
    document.createElement("div");

  legend.style.cssText = `
    position:absolute;
    top:14px;
    left:16px;
    z-index:20;
    display:flex;
    flex-wrap:wrap;
    gap:8px 14px;
    padding:9px 12px;
    border:1px solid rgba(143,161,181,0.18);
    border-radius:9px;
    background:rgba(8,17,28,0.86);
    color:#a7b5c5;
    font-size:12px;
    font-weight:700;
    pointer-events:none;
    backdrop-filter:blur(8px);
  `;

  function renderLegend(
    candle = null,
    ema20 = null
  ) {
    legend.innerHTML = `
      <span style="color:#67d9ff;">
       ${symbol || "—"} · ${currentTimeframe}
      </span>

      <span>
        O:
        <strong style="color:#f5f7fa;">
          ${formatChartValue(candle?.open)}
        </strong>
      </span>

      <span>
        H:
        <strong style="color:#4ee3b2;">
          ${formatChartValue(candle?.high)}
        </strong>
      </span>

      <span>
        L:
        <strong style="color:#ff7474;">
          ${formatChartValue(candle?.low)}
        </strong>
      </span>

      <span>
        C:
        <strong style="color:#f5f7fa;">
          ${formatChartValue(candle?.close)}
        </strong>
      </span>

      <span>
        EMA20:
        <strong style="color:#f4b942;">
          ${formatChartValue(ema20?.value)}
        </strong>
      </span>
    `;
  }

  renderLegend();

  chartContainer.appendChild(
    legend
  );

  const crosshairHandler =
    param => {
      if (
        !param?.time ||
        !param.seriesData
      ) {
        renderLegend();
        return;
      }

      const candle =
        param.seriesData.get(
          candlestickSeries
        );

      const ema20 =
        ema20Series
          ? param.seriesData.get(
              ema20Series
            )
          : null;

      renderLegend(
        candle,
        ema20
      );
    };

  chart.subscribeCrosshairMove(
    crosshairHandler
  );

  return {
  element: legend,
  crosshairHandler,

  setTimeframe(nextTimeframe) {
    currentTimeframe =
      nextTimeframe || "1H";

    renderLegend();
  }
};
  
function createTimeframeToolbar(options = {}) {
  const {
  chartContainer,
  activeTimeframe = "1H",
  onTimeframeChange
} = options;
  
  if (!chartContainer) {
    return null;
  }

  const timeframes = [
    "1m",
    "5m",
    "15m",
    "1H",
    "4H",
    "1D"
  ];

  let currentTimeframe =
  activeTimeframe;
  
  const toolbar =
    document.createElement("div");

  toolbar.style.cssText = `
    position:absolute;
    top:76px;
    right:16px;
    z-index:21;
    display:flex;
    align-items:center;
    gap:6px;
    padding:6px;
    border:1px solid rgba(143,161,181,0.18);
    border-radius:9px;
    background:rgba(8,17,28,0.86);
    backdrop-filter:blur(8px);
  `;

  const buttons = new Map();

  function updateActiveButton(
  nextTimeframe
) {
  currentTimeframe =
    nextTimeframe;

  for (
    const [
      timeframe,
      button
    ] of buttons
  ) {
    const isActive =
      timeframe ===
      currentTimeframe;

    button.style.borderColor =
      isActive
        ? "rgba(103,217,255,0.75)"
        : "transparent";

    button.style.background =
      isActive
        ? "rgba(103,217,255,0.16)"
        : "transparent";

    button.style.color =
      isActive
        ? "#67d9ff"
        : "#8fa1b5";
  }
}
  
  for (const timeframe of timeframes) {
    const button =
      document.createElement("button");

    button.type = "button";
    button.textContent = timeframe;
    button.dataset.timeframe =
      timeframe;

    const isActive =
      timeframe === activeTimeframe;

    button.style.cssText = `
      min-width:38px;
      height:30px;
      padding:0 9px;
      border:1px solid ${
        isActive
          ? "rgba(103,217,255,0.75)"
          : "transparent"
      };
      border-radius:7px;
      background:${
        isActive
          ? "rgba(103,217,255,0.16)"
          : "transparent"
      };
      color:${
        isActive
          ? "#67d9ff"
          : "#8fa1b5"
      };
      font-size:12px;
      font-weight:800;
      cursor:pointer;
    `;

    button.title =
      `${timeframe} timeframe`;
    
    button.addEventListener(
     "click",
    async () => {
     if (
      timeframe ===
      currentTimeframe
    ) {
      return;
    }

    const previousTimeframe =
      currentTimeframe;

    updateActiveButton(
      timeframe
    );

    button.disabled = true;
    button.style.opacity = "0.65";

    try {
      const result =
        await onTimeframeChange?.(
          timeframe
        );

      if (result?.ok === false) {
        updateActiveButton(
          previousTimeframe
        );
      }
    } catch (error) {
      console.error(
        "Timeframe change failed:",
        error
      );

      updateActiveButton(
        previousTimeframe
      );
    } finally {
      button.disabled = false;
      button.style.opacity = "1";
    }
  }
);    
    
    toolbar.appendChild(button);

    buttons.set(
      timeframe,
      button
    );
  }

  chartContainer.appendChild(
    toolbar
  );
return {
  element: toolbar,
  buttons,

  get activeTimeframe() {
    return currentTimeframe;
  },

  setActiveTimeframe:
    updateActiveButton
};
  
  function createChartControlsRow(
  options = {}
) {
  const {
    chartContainer,
    chartLegend,
    timeframeToolbar
  } = options;

  if (!chartContainer) {
    return null;
  }

  const controlsRow =
    document.createElement("div");

  controlsRow.style.cssText = `
    position:absolute;
    top:14px;
    left:16px;
    right:16px;
    z-index:30;

   display:flex;
   align-items:flex-start;
   justify-content:space-between;
   flex-wrap:nowrap; 
   
   gap:10px 16px;

    pointer-events:none;
  `;

  if (chartLegend?.element) {
    const legendElement =
      chartLegend.element;

    legendElement.style.position =
      "static";

    legendElement.style.top =
      "auto";

    legendElement.style.left =
      "auto";

    legendElement.style.maxWidth =
      "100%";

   legendElement.style.flex =
  "1 1 auto";

legendElement.style.minWidth =
  "0";

legendElement.style.overflow =
  "hidden";

    controlsRow.appendChild(
      legendElement
    );
  }

  if (timeframeToolbar?.element) {
    const toolbarElement =
      timeframeToolbar.element;

    toolbarElement.style.position =
      "static";

    toolbarElement.style.top =
      "auto";

    toolbarElement.style.right =
      "auto";

    toolbarElement.style.flex =
      "0 0 auto";
    toolbarElement.style.maxWidth =
      "520px";
    
    toolbarElement.style.marginLeft =
      "auto";

    toolbarElement.style.pointerEvents =
      "auto";

    controlsRow.appendChild(
      toolbarElement
    );
  }

  chartContainer.appendChild(
    controlsRow
  );

  return {
    element: controlsRow
  };
}

async function loadCandlestickData(
  options = {}
) {
  
const {
  chart,
  candlestickSeries,
  ema20Series,
  ema50Series,
  ema200Series,
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

  const priceFormat =
  getDynamicPriceFormat(
    candles
  );

candlestickSeries.applyOptions({
  priceFormat
});

if (ema20Series) {
  ema20Series.applyOptions({
    priceFormat
  });
}

if (ema50Series) {
  ema50Series.applyOptions({
    priceFormat
  });
}
  if (ema200Series) {
  ema200Series.applyOptions({
    priceFormat
  });
}
  candlestickSeries.setData(
    candles
  );
  
   const ema20Data =
  calculateEMAData(
    candles,
    20
  );

if (
  ema20Series &&
  ema20Data.length > 0
) {
  ema20Series.setData(
    ema20Data
  );
}
   const ema50Data =
  calculateEMAData(
    candles,
    50
  );

if (
  ema50Series &&
  ema50Data.length > 0
) {
  ema50Series.setData(
    ema50Data
  );
}
  const ema200Data =
  calculateEMAData(
    candles,
    200
  );

if (
  ema200Series &&
  ema200Data.length > 0
) {
  ema200Series.setData(
    ema200Data
  );
}
  
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
  candles,
  priceFormat,
  
indicators: {
  ema20:
    ema20Data.length,

  ema50:
    ema50Data.length,

  ema200:
    ema200Data.length
}
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

  chartContainer.style.position =
  "relative";
  
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

 const ema20Series =
  createEMALayer(
    chart,
    {
      period: 20,
      color: "#f4b942",
      lineWidth: 2
    }
  );
const ema50Series =
  createEMALayer(
    chart,
    {
      period: 50,
      color: "#4da3ff",
      lineWidth: 2
    }
  );  
  const ema200Series =
  createEMALayer(
    chart,
    {
      period: 200,
      color: "#b875ff",
      lineWidth: 2
    }
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
if (!ema20Series) {
  console.warn(
    "EMA20 layer is unavailable"
  );
}
if (!ema50Series) {
  console.warn(
    "EMA50 layer is unavailable"
  );
}
if (!ema200Series) {
  console.warn(
    "EMA200 layer is unavailable"
  );
}
  
const chartLegend =
  createChartLegend({
    chartContainer,
    chart,
    candlestickSeries,
    ema20Series,
    symbol,
    timeframe: "1H"
  });

  let activeTimeframe = "1H";

let latestRequestId = 0;

async function reloadTimeframe(
  nextTimeframe
) {
  const requestId =
    ++latestRequestId;

  const result =
    await loadCandlestickData({
      chart,
      candlestickSeries,
      ema20Series,
      ema50Series,
      ema200Series,
      symbol,
      timeframe: nextTimeframe,
      limit: 300
    });

  if (
    requestId !==
    latestRequestId
  ) {
    return {
      ok: false,
      ignored: true
    };
  }

  if (result?.ok === true) {
    activeTimeframe =
      nextTimeframe;

    chartLegend?.setTimeframe(
      nextTimeframe
    );
  }

  return result;
}
  
const timeframeToolbar =
  createTimeframeToolbar({
    chartContainer,
    activeTimeframe: "1H",

    onTimeframeChange:
      reloadTimeframe
  });
  
const chartControlsRow =
  createChartControlsRow({
    chartContainer,
    chartLegend,
    timeframeToolbar
  });
  
const candlesPromise =
  reloadTimeframe(
    "1H"
  );
  
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

get timeframe() {
  return activeTimeframe;
},
  
chart,
candlestickSeries,
ema20Series,
ema50Series,
ema200Series,
chartLegend,
timeframeToolbar,
chartControlsRow,
candlesPromise,
resizeObserver
};  
}

window.SergeyAIChart = {
  initialize: initializeAIChart
};
