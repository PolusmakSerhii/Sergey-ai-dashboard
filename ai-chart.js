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
  chart,
  resizeObserver
};
}

window.SergeyAIChart = {
  initialize: initializeAIChart
};
