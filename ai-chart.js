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

function createChartLegend(chart, series) {
  const element = document.createElement("div");
  element.className = "chart-averages";
  const cells = series.map((_, i) => {
    const cell = document.createElement("span");
    cell.append("EMA" + [20, 50, 200][i] + " ");
    const value = document.createElement("strong");
    cell.append(value);
    element.append(cell);
    return value;
  });
  let latest = [];
  function render(values) {
    cells.forEach((cell, i) => { cell.textContent = values[i] == null ? "—" : formatChartValue(values[i]); });
  }
  render(latest);
  chart.subscribeCrosshairMove(param => render(param.time != null && param.seriesData
    ? series.map(line => param.seriesData.get(line)?.value) : latest));
  return { element, setValues(values) { latest = values; render(latest); } };
}

function createTimeframeToolbar(options = {}) {
  const {
  chartContainer,
  activeTimeframe = "1H",
  onTimeframeChange,
  getLoadedTimeframe
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

  toolbar.className = "chart-intervals";
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

    button.setAttribute("aria-pressed", String(isActive));
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
      getLoadedTimeframe?.() || currentTimeframe;

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

      if (result?.ok === false && result?.ignored !== true) {
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

  updateActiveButton(activeTimeframe);
return {
  element: toolbar,
  buttons,

  get activeTimeframe() {
    return currentTimeframe;
  },

  setActiveTimeframe:
    updateActiveButton
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
  volumeSeries,
  timeframe = "1H",
  limit = 300,
  getDisplayWidth = () => Infinity,
  isCurrentRequest = () => true
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

  // No chart mutation (including price formats) may precede this check.
  // The remaining update is synchronous, so a newer request cannot interleave.
  if (!isCurrentRequest()) {
    return { ok: false, ignored: true };
  }

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

    const v = candle.volume;
    if ((typeof v === "number" || (typeof v === "string" && v.trim() !== "")) &&
        Number.isFinite(Number(v)) && Number(v) >= 0) normalizedCandle.volume = Number(v);

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
  candlestickSeries.setData(candles);
  volumeSeries.setData(candles.filter(c => c.volume !== undefined).map(c => ({
    time: c.time, value: c.volume, color: c.close >= c.open ? "#319889" : "#ba596e"
  })));
  const ema20Data = calculateEMAData(candles, 20);
  const ema50Data = calculateEMAData(candles, 50);
  const ema200Data = calculateEMAData(candles, 200);
  ema20Series?.setData(ema20Data);
  ema50Series?.setData(ema50Data);
  ema200Series?.setData(ema200Data);

  if (getDisplayWidth() > 0 && getDisplayWidth() <= 480) {
    // Presentation only: retain the full series for scrolling and EMA calculations.
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, candles.length - 40), to: candles.length + 2
    });
  } else {
    chart.timeScale().fitContent();
  }

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
  emaValues: [ema20Data, ema50Data, ema200Data].map(rows => rows.at(-1)?.value),
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

let currentChart = null;
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

currentChart?.dispose();
  chartContainer.innerHTML = "";
  const plot = document.createElement("div");
  plot.className = "chart-plot";
  chartContainer.append(plot);
  const header = document.createElement("header");
  header.className = "chart-heading";
  const title = document.createElement("strong");
  title.textContent = symbol;
  const loading = document.createElement("small");
  loading.setAttribute("role", "status");
  const full = document.createElement("button");
  full.type = "button";
  full.textContent = "⛶";
  full.setAttribute("aria-label", "Полный экран");
  full.hidden = !chartContainer.requestFullscreen;
  full.onclick = async () => {
    try {
      if (document.fullscreenElement === chartContainer) await document.exitFullscreen();
      else await chartContainer.requestFullscreen();
    } catch { loading.textContent = "Полный экран недоступен"; }
  };
  header.append(title, loading, full);

  chartContainer.style.position =
  "relative";
  
const chart =
  window.LightweightCharts.createChart(
    plot,
    {
      width:
        chartContainer.clientWidth,

      height: plot.clientHeight,

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
  
const volumeSeries = chart.addSeries(window.LightweightCharts.HistogramSeries,
  { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false, title: "Volume" }, 1);
chart.panes()[0].setStretchFactor(4);
chart.panes()[1].setStretchFactor(1);
const chartLegend = createChartLegend(chart, [ema20Series, ema50Series, ema200Series]);
  let activeTimeframe = "1H";

const candleError = document.createElement("div");
candleError.setAttribute("role", "alert");
candleError.className = "chart-error";
candleError.hidden = true;
const candleErrorText = document.createElement("div");
const retryCandlesButton = document.createElement("button");
retryCandlesButton.type = "button";
retryCandlesButton.textContent = "Повторить";
retryCandlesButton.style.cssText = `
  margin-top:10px; padding:8px 14px; border:1px solid #67d9ff;
  border-radius:7px; background:#142638; color:#67d9ff; cursor:pointer;
`;
candleError.appendChild(candleErrorText);
candleError.appendChild(retryCandlesButton);
chartContainer.appendChild(candleError);
let failedTimeframe = "1H";
retryCandlesButton.addEventListener("click", () => reloadTimeframe(failedTimeframe));

let latestRequestId = 0;
let pendingTimeframeSwitch = null;

async function reloadTimeframe(
  nextTimeframe,
  debounceMs = 0
) {
  const requestId =
    ++latestRequestId;

  if (pendingTimeframeSwitch) {
    clearTimeout(pendingTimeframeSwitch.timer);
    pendingTimeframeSwitch.resolve();
    pendingTimeframeSwitch = null;
  }

  loading.textContent = "Загрузка " + nextTimeframe + "…";
  candleError.hidden = true;
  retryCandlesButton.disabled = true;
  if (debounceMs > 0) {
    await new Promise(resolve => {
      pendingTimeframeSwitch = {
        resolve,
        timer: setTimeout(() => {
          pendingTimeframeSwitch = null;
          resolve();
        }, debounceMs)
      };
    });
    if (requestId !== latestRequestId) {
      return { ok: false, ignored: true };
    }
  }
  let result;
  try {
    result = await loadCandlestickData({
      chart,
      candlestickSeries,
      ema20Series,
      ema50Series,
      ema200Series, volumeSeries,
      symbol,
      timeframe: nextTimeframe,
      limit: 300,
      getDisplayWidth: () => chartContainer.clientWidth,
      isCurrentRequest: () => requestId === latestRequestId
    });
  } catch (error) {
    result = { ok: false, error: error?.message || "Не удалось загрузить свечи" };
  }

  if (
    requestId !==
    latestRequestId
  ) {
    return {
      ok: false,
      ignored: true
    };
  }

  retryCandlesButton.disabled = false;
  if (result?.ok === true) {
    timeframeToolbar?.setActiveTimeframe(nextTimeframe);
    activeTimeframe =
      nextTimeframe;

    title.textContent = symbol + " · " + nextTimeframe;
    chartLegend.setValues(result.emaValues);
    loading.textContent = "";
  } else {
    loading.textContent = "";
    failedTimeframe = nextTimeframe;
    candleErrorText.textContent = `Не удалось загрузить свечи ${symbol} · ${nextTimeframe}: ${result?.error || "Неизвестная ошибка"}`;
    candleError.hidden = false;
  }

  return result;
}
  
const timeframeToolbar =
  createTimeframeToolbar({
    chartContainer,
    activeTimeframe: "1H",

    onTimeframeChange: nextTimeframe => reloadTimeframe(nextTimeframe, 250),
    getLoadedTimeframe: () => activeTimeframe
  });
  
chartContainer.prepend(header, chartLegend.element, timeframeToolbar.element);
let disposed = false;
function resize() {
  if (!disposed && plot.clientWidth && plot.clientHeight)
    chart.resize(plot.clientWidth, plot.clientHeight);
}
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(plot);
function onFullscreen() {
  requestAnimationFrame(() => { if (!disposed) { resize(); chart.timeScale().fitContent(); } });
}
document.addEventListener("fullscreenchange", onFullscreen);
const instance = {
  ok: true, candlesPromise: reloadTimeframe("1H"),
  dispose() {
    if (disposed) return;
    disposed = true;
    latestRequestId++;
    if (pendingTimeframeSwitch) {
      clearTimeout(pendingTimeframeSwitch.timer);
      pendingTimeframeSwitch.resolve();
      pendingTimeframeSwitch = null;
    }
    resizeObserver.disconnect();
    document.removeEventListener("fullscreenchange", onFullscreen);
    chart.remove();
    if (currentChart === instance) currentChart = null;
  }
};
currentChart = instance;
return instance;
}

window.SergeyAIChart = {
  initialize: initializeAIChart,
  dispose: () => currentChart?.dispose()
};
