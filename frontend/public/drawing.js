// =========================================================================
// drawing.js — Canvas drawing/annotation tools and regime overlays
// =========================================================================

// Drawing mode state
let drawingMode = false;
let currentDrawingTool = null;  // 'box', 'lineDown', 'lineUp', 'hline', 'point'
let drawingCanvas = null;
let drawingCtx = null;
let isDrawing = false;
let drawStart = { x: 0, y: 0 };
let drawings = {
  peak: null,       // { type: 'point', x, y } - Prior peak marker
  markdown: null,   // { type: 'lineDown', x1, y1, x2, y2 }
  base: null,       // { type: 'box', x1, y1, x2, y2 }
  markup: null,     // { type: 'lineUp', x1, y1, x2, y2 }
  pullback: null,   // { type: 'lineDown', x1, y1, x2, y2 }
  breakout: null    // { type: 'hline', y, x1, x2 }
};
const drawingColors = {
  peak: '#ef4444',      // Red
  markdown: '#f97316',  // Orange
  base: '#22c55e',      // Green
  markup: '#3b82f6',    // Blue
  pullback: '#eab308',  // Yellow
  breakout: '#a855f7'   // Purple
};

// Continuous update loop for drawings to handle all zoom/pan
let drawingUpdateId = null;
let lastPriceAtY100 = null;
let lastTimeAtX100 = null;
let frameCount = 0;

function startDrawingUpdateLoop() {
  if (drawingUpdateId) {
    cancelAnimationFrame(drawingUpdateId);
  }

  function update() {
    frameCount++;
    if (frameCount % 3 === 0 && patternSeries && patternChart) {
      try {
        const priceAtY100 = patternSeries.coordinateToPrice(100);
        const timeAtX100 = patternChart.timeScale().coordinateToTime(100);
        const priceStr = priceAtY100 ? priceAtY100.toFixed(2) : null;
        const timeStr = timeAtX100 || null;
        if (priceStr !== lastPriceAtY100 || timeStr !== lastTimeAtX100) {
          lastPriceAtY100 = priceStr;
          lastTimeAtX100 = timeStr;
          redrawAllDrawings();
        }
      } catch (e) {}
    }
    drawingUpdateId = requestAnimationFrame(update);
  }
  update();
}

function stopDrawingUpdateLoop() {
  if (drawingUpdateId) {
    cancelAnimationFrame(drawingUpdateId);
    drawingUpdateId = null;
  }
}

// Initialize drawing canvas overlay
function initDrawingCanvas() {
  const container = document.getElementById('chart-container');
  drawingCanvas = document.getElementById('drawing-canvas');
  drawingCanvas.width = container.clientWidth;
  drawingCanvas.height = container.clientHeight;
  drawingCtx = drawingCanvas.getContext('2d');

  window.addEventListener('resize', () => {
    if (drawingCanvas && container) {
      drawingCanvas.width = container.clientWidth;
      drawingCanvas.height = container.clientHeight;
      redrawAllDrawings();
    }
  });
}

function resizeDrawingCanvas() {
  const container = document.getElementById('chart-container');
  if (!drawingCanvas || !container) return;
  drawingCanvas.width = container.clientWidth;
  drawingCanvas.height = container.clientHeight;
  redrawAllDrawings();
}

// Enter drawing mode with a specific tool
function enterDrawingMode(tool, label) {
  drawingMode = true;
  currentDrawingTool = { tool, label };
  drawingCanvas.style.pointerEvents = 'auto';
  drawingCanvas.style.cursor = 'crosshair';

  drawingCanvas.onmousedown = startDrawing;
  drawingCanvas.onmousemove = continueDrawing;
  drawingCanvas.onmouseup = finishDrawing;
  drawingCanvas.onmouseleave = finishDrawing;

  updateDrawingToolButtons();
}

function exitDrawingMode() {
  drawingMode = false;
  currentDrawingTool = null;
  isDrawing = false;
  drawingCanvas.style.pointerEvents = 'none';
  drawingCanvas.style.cursor = 'default';
  drawingCanvas.onmousedown = null;
  drawingCanvas.onmousemove = null;
  drawingCanvas.onmouseup = null;
  drawingCanvas.onmouseleave = null;
  updateDrawingToolButtons();
}

function startDrawing(e) {
  if (!drawingMode) return;
  isDrawing = true;
  const rect = drawingCanvas.getBoundingClientRect();
  drawStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function continueDrawing(e) {
  if (!isDrawing || !drawingMode) return;
  const rect = drawingCanvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;
  redrawAllDrawings();
  drawPreview(drawStart.x, drawStart.y, currentX, currentY);
}

function finishDrawing(e) {
  if (!isDrawing || !drawingMode) return;
  isDrawing = false;

  const rect = drawingCanvas.getBoundingClientRect();
  const endX = e.clientX - rect.left;
  const endY = e.clientY - rect.top;

  const startCoords = pixelToChartCoords(drawStart.x, drawStart.y);
  const endCoords = pixelToChartCoords(endX, endY);

  if (!startCoords || !endCoords) {
    console.error('Could not convert coordinates');
    exitDrawingMode();
    return;
  }

  const { tool, label } = currentDrawingTool;

  if (tool === 'point') {
    drawings[label] = { type: 'point', time: endCoords.time, price: endCoords.price };
  } else if (tool === 'hline') {
    drawings[label] = { type: 'hline', price: endCoords.price };
  } else {
    drawings[label] = {
      type: tool,
      time1: startCoords.time, price1: startCoords.price,
      time2: endCoords.time, price2: endCoords.price
    };
  }

  redrawAllDrawings();
  updateDrawingStatus(label, 'Set');
  exitDrawingMode();
}

function drawPreview(x1, y1, x2, y2) {
  if (!currentDrawingTool) return;
  const { tool, label } = currentDrawingTool;
  const color = drawingColors[label] || '#ffffff';

  drawingCtx.save();
  drawingCtx.strokeStyle = color;
  drawingCtx.fillStyle = color + '40';
  drawingCtx.lineWidth = 2;
  drawingCtx.setLineDash([5, 5]);

  if (tool === 'point') {
    drawingCtx.setLineDash([]);
    drawingCtx.beginPath();
    drawingCtx.arc(x2, y2, 8, 0, Math.PI * 2);
    drawingCtx.stroke();
    drawingCtx.fillStyle = color;
    drawingCtx.beginPath();
    drawingCtx.arc(x2, y2, 4, 0, Math.PI * 2);
    drawingCtx.fill();
  } else if (tool === 'box') {
    const width = x2 - x1;
    const height = y2 - y1;
    drawingCtx.fillRect(x1, y1, width, height);
    drawingCtx.strokeRect(x1, y1, width, height);
  } else if (tool === 'lineDown' || tool === 'lineUp') {
    drawingCtx.beginPath();
    drawingCtx.moveTo(x1, y1);
    drawingCtx.lineTo(x2, y2);
    drawingCtx.stroke();
    drawArrowHead(drawingCtx, x1, y1, x2, y2, color);
  } else if (tool === 'hline') {
    drawingCtx.beginPath();
    drawingCtx.moveTo(0, y2);
    drawingCtx.lineTo(drawingCanvas.width, y2);
    drawingCtx.stroke();
  }

  drawingCtx.restore();
}

function redrawAllDrawings() {
  if (!drawingCtx) return;
  drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  drawRegimeWindowsOverlay();

  for (const [label, drawing] of Object.entries(drawings)) {
    if (!drawing) continue;
    const color = drawingColors[label];

    drawingCtx.save();
    drawingCtx.strokeStyle = color;
    drawingCtx.fillStyle = color + '40';
    drawingCtx.lineWidth = 2;

    if (drawing.type === 'point') {
      const pixel = chartToPixelCoords(drawing.time, drawing.price);
      if (!pixel) { drawingCtx.restore(); continue; }
      drawingCtx.strokeStyle = color;
      drawingCtx.fillStyle = color;
      drawingCtx.beginPath();
      drawingCtx.arc(pixel.x, pixel.y, 10, 0, Math.PI * 2);
      drawingCtx.stroke();
      drawingCtx.beginPath();
      drawingCtx.arc(pixel.x, pixel.y, 5, 0, Math.PI * 2);
      drawingCtx.fill();
      drawingCtx.font = 'bold 12px sans-serif';
      drawingCtx.fillText(label.toUpperCase(), pixel.x - 15, pixel.y - 15);
    } else if (drawing.type === 'box') {
      const p1 = chartToPixelCoords(drawing.time1, drawing.price1);
      const p2 = chartToPixelCoords(drawing.time2, drawing.price2);
      if (!p1 || !p2) { drawingCtx.restore(); continue; }
      const xMin = Math.min(p1.x, p2.x);
      const yMin = Math.min(p1.y, p2.y);
      const width = Math.abs(p2.x - p1.x);
      const height = Math.abs(p2.y - p1.y);
      drawingCtx.fillRect(xMin, yMin, width, height);
      drawingCtx.strokeRect(xMin, yMin, width, height);
      drawingCtx.font = 'bold 14px sans-serif';
      drawingCtx.fillStyle = color;
      drawingCtx.fillText(label.toUpperCase(), xMin + 5, yMin + 18);
    } else if (drawing.type === 'lineDown' || drawing.type === 'lineUp') {
      const p1 = chartToPixelCoords(drawing.time1, drawing.price1);
      const p2 = chartToPixelCoords(drawing.time2, drawing.price2);
      if (!p1 || !p2) { drawingCtx.restore(); continue; }
      drawingCtx.beginPath();
      drawingCtx.moveTo(p1.x, p1.y);
      drawingCtx.lineTo(p2.x, p2.y);
      drawingCtx.stroke();
      drawArrowHead(drawingCtx, p1.x, p1.y, p2.x, p2.y, color);
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      drawingCtx.font = 'bold 12px sans-serif';
      drawingCtx.fillStyle = color;
      drawingCtx.fillText(label.toUpperCase(), midX + 5, midY);
    } else if (drawing.type === 'hline') {
      const y = patternSeries ? patternSeries.priceToCoordinate(drawing.price) : null;
      if (y === null) { drawingCtx.restore(); continue; }
      drawingCtx.beginPath();
      drawingCtx.moveTo(0, y);
      drawingCtx.lineTo(drawingCanvas.width, y);
      drawingCtx.stroke();
      drawingCtx.font = 'bold 12px sans-serif';
      drawingCtx.fillStyle = color;
      drawingCtx.fillText(label.toUpperCase(), 10, y - 5);
    }

    drawingCtx.restore();
  }
}

function drawRegimeWindowsOverlay() {
  if (!drawingCtx || !patternChart || !currentDisplayData) return;
  if (currentDisplayData.pattern_type !== 'regime') return;

  const source = currentDisplayData.swing_data || {};
  const windows = Array.isArray(source.regime_windows) ? source.regime_windows : [];
  if (!windows.length) return;

  const fills = {
    expansion: 'rgba(34, 197, 94, 0.14)',
    accumulation: 'rgba(59, 130, 246, 0.12)',
    distribution: 'rgba(239, 68, 68, 0.12)',
  };
  const strokes = {
    expansion: 'rgba(34, 197, 94, 0.6)',
    accumulation: 'rgba(59, 130, 246, 0.55)',
    distribution: 'rgba(239, 68, 68, 0.55)',
  };

  drawingCtx.save();
  drawingCtx.font = '10px monospace';
  drawingCtx.textBaseline = 'top';

  for (const win of windows) {
    const regime = String(win?.regime || '').toLowerCase();
    const startDate = String(win?.start_date || '').trim();
    const endDate = String(win?.end_date || '').trim();
    if (!startDate || !endDate) continue;

    let x1 = patternChart.timeScale().timeToCoordinate(startDate);
    let x2 = patternChart.timeScale().timeToCoordinate(endDate);
    if (x1 == null && x2 == null) continue;
    if (x1 == null) x1 = 0;
    if (x2 == null) x2 = drawingCanvas.width;
    if (x2 < x1) { const t = x1; x1 = x2; x2 = t; }

    const width = Math.max(1, x2 - x1);
    const fill = fills[regime] || 'rgba(148, 163, 184, 0.10)';
    const stroke = strokes[regime] || 'rgba(148, 163, 184, 0.45)';

    drawingCtx.fillStyle = fill;
    drawingCtx.fillRect(x1, 0, width, drawingCanvas.height);
    drawingCtx.strokeStyle = stroke;
    drawingCtx.lineWidth = 1;
    drawingCtx.strokeRect(x1 + 0.5, 0.5, Math.max(0, width - 1), Math.max(0, drawingCanvas.height - 1));
    drawingCtx.fillStyle = stroke;
    drawingCtx.fillText(regime.toUpperCase(), x1 + 4, 4);
  }

  drawingCtx.restore();
}

function drawArrowHead(ctx, x1, y1, x2, y2, color) {
  const headLen = 12;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function clearDrawing(label) {
  drawings[label] = null;
  redrawAllDrawings();
  updateDrawingStatus(label, 'Not set');
}

function clearAllDrawings() {
  for (const key of Object.keys(drawings)) {
    drawings[key] = null;
    updateDrawingStatus(key, 'Not set');
  }
  redrawAllDrawings();
}

function updateDrawingStatus(label, status) {
  const el = document.getElementById(`drawing-${label}-status`);
  if (el) el.textContent = status;
}

function updateDrawingToolButtons() {
  const labels = ['peak', 'markdown', 'base', 'markup', 'pullback', 'breakout'];
  for (const label of labels) {
    const btn = document.getElementById(`btn-draw-${label}`);
    if (btn) {
      const isActive = currentDrawingTool && currentDrawingTool.label === label;
      btn.classList.toggle('ring-2', isActive);
      btn.classList.toggle('ring-white', isActive);
    }
  }
}
