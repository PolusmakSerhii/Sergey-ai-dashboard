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

  chartContainer.innerHTML = `
    <div style="
      display:flex;
      min-height:420px;
      width:100%;
      align-items:center;
      justify-content:center;
      flex-direction:column;
      gap:10px;
    ">
      <strong style="
        color:#67d9ff;
        font-size:18px;
      ">
        ${symbol || "Unknown Symbol"}
      </strong>

      <span style="
        color:#7f91a4;
        font-size:14px;
      ">
        AI Chart module connected successfully
      </span>
    </div>
  `;

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
    symbol
  };
}

window.SergeyAIChart = {
  initialize: initializeAIChart
};
