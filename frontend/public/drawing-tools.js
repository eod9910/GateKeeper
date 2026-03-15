// =========================================================================
// drawing-tools.js — Universal drawing tools module for Lightweight Charts
//
// Pluggable into ANY chart instance. Provides TradingView-style tools:
//   trendline, ray, extended-line, horizontal-line, vertical-line,
//   parallel-channel, fibonacci-retracement, rectangle, cross-line
//
// Usage:
//   const dt = new DrawingToolsManager(chart, series, containerEl);
//   dt.activate('trendline');
//   dt.deactivate();
//   dt.clear();
//   dt.getDrawings();
//   dt.loadDrawings(arr);
//   dt.destroy();
// =========================================================================

class DrawingToolsManager {
  static DEFAULT_TOOLBAR_VARIANT = 'grouped-dock';

  static TOOL_DEFS = {
    trendline:    { clicks: 2, label: 'Trendline',      icon: '╱',  color: '#06b6d4' },
    ray:          { clicks: 2, label: 'Ray',             icon: '→',  color: '#8b5cf6' },
    'ext-line':   { clicks: 2, label: 'Extended Line',   icon: '⟷', color: '#14b8a6' },
    'reg-channel':{ clicks: 2, label: 'Regression Channel (StdDev)', icon: 'Regσ', color: '#38bdf8' },
    hline:        { clicks: 1, label: 'Horizontal Line', icon: '─',  color: '#d1d5db' },
    vline:        { clicks: 1, label: 'Vertical Line',   icon: '│',  color: '#a78bfa' },
    channel:      { clicks: 3, label: 'Parallel Channel', icon: '▬', color: '#f59e0b' },
    fib:          { clicks: 2, label: 'Fibonacci',       icon: 'Fib', color: '#d97706' },
    rect:         { clicks: 2, label: 'Rectangle',       icon: '▭',  color: '#3b82f6' },
    crossline:    { clicks: 1, label: 'Cross',           icon: '✚',  color: '#ec4899' },
    'pattern-head-shoulders': { clicks: 5, label: 'Head and Shoulders', icon: 'H&S', color: '#f97316' },
    'pattern-three-drives': { clicks: 6, label: 'Three Drives', icon: '3D', color: '#eab308' },
    'pattern-abcd': { clicks: 4, label: 'ABCD Pattern', icon: 'ABCD', color: '#22c55e' },
    'pattern-xabcd': { clicks: 5, label: 'XABCD Pattern', icon: 'XABCD', color: '#06b6d4' },
    'pattern-cypher': { clicks: 5, label: 'Cypher Pattern', icon: 'CYP', color: '#a855f7' },
    'pattern-triangle': { clicks: 3, label: 'Triangle Pattern', icon: 'TRI', color: '#f43f5e' },
    'pattern-swing-path': { clicks: 999, label: 'Swing Path', icon: 'PATH', color: '#facc15' },
  };

  static FIB_DEFAULTS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
  static FIB_COLORS = {
    0:     '#22c55e', 0.236: '#3b82f6', 0.382: '#8b5cf6',
    0.5:   '#f59e0b', 0.618: '#f97316', 0.786: '#ef4444', 1.0: '#dc2626',
  };

  static PATTERN_TOOL_LABELS = {
    'pattern-head-shoulders': ['LS', 'NL', 'H', 'NR', 'RS'],
    'pattern-three-drives': ['1', '2', '3', '4', '5', '6'],
    'pattern-abcd': ['A', 'B', 'C', 'D'],
    'pattern-xabcd': ['X', 'A', 'B', 'C', 'D'],
    'pattern-cypher': ['X', 'A', 'B', 'C', 'D'],
    'pattern-triangle': ['A', 'B', 'C'],
    'pattern-swing-path': [],
  };

  constructor(chart, series, container, opts = {}) {
    this._chart = chart;
    this._series = series;
    this._container = container;
    this._drawings = [];
    this._activeTool = null;
    this._state = {};
    this._hoveredIdx = -1;
    this._selectedIdx = -1;
    this._shiftPressed = false;

    this._canvas = null;
    this._ctx = null;
    this._rafId = null;
    this._lastFingerprint = null;
    this._fibLevels = this._loadFibLevels();

    this._onChartClick = this._onChartClick.bind(this);
    this._onCrosshairMove = this._onCrosshairMove.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onContainerMouseDown = this._onContainerMouseDown.bind(this);
    this._onContainerMouseMove = this._onContainerMouseMove.bind(this);
    this._onContainerClick = this._onContainerClick.bind(this);
    this._onContainerDblClick = this._onContainerDblClick.bind(this);
    this._onDocumentMouseUp = this._onDocumentMouseUp.bind(this);

    this._onChange = opts.onChange || null;
    this._getBars = typeof opts.getBars === 'function' ? opts.getBars : null;

    this._init();
  }

  // ── public API ───────────────────────────────────────────────

  activate(toolName) {
    if (!DrawingToolsManager.TOOL_DEFS[toolName]) return;
    this.deactivate();
    this._activeTool = toolName;
    this._state = { clicks: 0 };
    this._container.classList.add('dt-drawing-active');
    this._updateToolbarActive();
    this._setStatus(this._statusText());
  }

  deactivate() {
    this._activeTool = null;
    this._state = {};
    this._dragGesture = null;
    this._container.classList.remove('dt-drawing-active');
    this._updateToolbarActive();
    this._setStatus('');
    this._render();
  }

  toggle(toolName) {
    if (this._activeTool === toolName) this.deactivate();
    else this.activate(toolName);
  }

  clear() {
    this._drawings = [];
    this._selectedIdx = -1;
    this._hoveredIdx = -1;
    this.deactivate();
    this._render();
    this._fireChange();
  }

  deleteSelected() {
    const idx = (this._selectedIdx >= 0 && this._selectedIdx < this._drawings.length)
      ? this._selectedIdx
      : ((this._hoveredIdx >= 0 && this._hoveredIdx < this._drawings.length) ? this._hoveredIdx : -1);
    if (idx >= 0) {
      this._drawings.splice(idx, 1);
      this._selectedIdx = -1;
      this._hoveredIdx = -1;
      this._render();
      this._fireChange();
    }
  }

  getDrawings() { return JSON.parse(JSON.stringify(this._drawings)); }

  loadDrawings(arr) {
    if (!Array.isArray(arr)) return;
    this._drawings = JSON.parse(JSON.stringify(arr));
    this._normalizeLoadedDrawings();
    this._selectedIdx = -1;
    this._render();
  }

  getActiveTool() { return this._activeTool; }

  setChart(chart, series) {
    this._unsubscribe();
    this._chart = chart;
    this._series = series;
    this._subscribe();
    this._render();
  }

  setBarsProvider(providerFn) {
    this._getBars = typeof providerFn === 'function' ? providerFn : null;
  }

  destroy() {
    this._stopLoop();
    this._unsubscribe();
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    this._container.removeEventListener('mousedown', this._onContainerMouseDown);
    this._container.removeEventListener('mousemove', this._onContainerMouseMove);
    this._container.removeEventListener('click', this._onContainerClick);
    this._container.removeEventListener('dblclick', this._onContainerDblClick);
    document.removeEventListener('mouseup', this._onDocumentMouseUp);
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._canvas = null;
    this._ctx = null;
  }

  // ── setup ────────────────────────────────────────────────────

  _init() {
    this._createCanvas();
    this._subscribe();
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    this._container.addEventListener('mousedown', this._onContainerMouseDown);
    this._container.addEventListener('mousemove', this._onContainerMouseMove);
    this._container.addEventListener('click', this._onContainerClick);
    this._container.addEventListener('dblclick', this._onContainerDblClick);
    document.addEventListener('mouseup', this._onDocumentMouseUp);
    this._startLoop();
  }

  _createCanvas() {
    this._canvas = document.createElement('canvas');
    this._canvas.className = 'dt-overlay-canvas';
    this._canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:15;';
    this._container.style.position = 'relative';
    this._container.appendChild(this._canvas);
    this._resizeCanvas();
    this._ctx = this._canvas.getContext('2d');

    const ro = new ResizeObserver(() => this._resizeCanvas());
    ro.observe(this._container);
    this._resizeObs = ro;
  }

  _resizeCanvas() {
    if (!this._canvas) return;
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas.width = w;
      this._canvas.height = h;
      this._render();
    }
  }

  _subscribe() {
    if (!this._chart) return;
    this._chart.subscribeClick(this._onChartClick);
    this._chart.subscribeCrosshairMove(this._onCrosshairMove);
  }

  _unsubscribe() {
    if (!this._chart) return;
    try { this._chart.unsubscribeClick(this._onChartClick); } catch(e) {}
    try { this._chart.unsubscribeCrosshairMove(this._onCrosshairMove); } catch(e) {}
  }

  // ── render loop (sync with zoom/pan) ─────────────────────────

  _startLoop() {
    const tick = () => {
      const fp = this._fingerprint();
      if (fp !== this._lastFingerprint) {
        this._lastFingerprint = fp;
        this._render();
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  _fingerprint() {
    try {
      const p = this._series.coordinateToPrice(100);
      const t = this._chart.timeScale().coordinateToTime(100);
      return `${p?.toFixed(4)}|${t}`;
    } catch(e) { return null; }
  }

  // ── coordinate helpers ───────────────────────────────────────

  _toPixel(time, price, logical = null) {
    if (!this._chart || !this._series) return null;
    if ((!Number.isFinite(logical) && time == null) || !Number.isFinite(price)) return null;
    let x = null;
    let y = null;
    if (Number.isFinite(logical)) {
      x = this._logicalToX(logical);
    }
    if (x === null) {
      try {
        x = this._chart.timeScale().timeToCoordinate(time);
      } catch (e) {
        return null;
      }
    }
    try {
      y = this._series.priceToCoordinate(price);
    } catch (e) {
      return null;
    }
    if (x === null || y === null) return null;
    return { x, y };
  }

  _priceToY(price) {
    if (!this._series) return null;
    if (!Number.isFinite(price)) return null;
    try {
      return this._series.priceToCoordinate(price);
    } catch (e) {
      return null;
    }
  }

  _timeToX(time, logical = null) {
    if (!this._chart) return null;
    if (Number.isFinite(logical)) {
      const x = this._logicalToX(logical);
      if (x !== null) return x;
    }
    if (time == null) return null;
    try {
      return this._chart.timeScale().timeToCoordinate(time);
    } catch (e) {
      return null;
    }
  }

  _xToLogical(x) {
    if (!this._chart || !Number.isFinite(x)) return null;
    try {
      const logical = this._chart.timeScale().coordinateToLogical?.(x);
      return Number.isFinite(logical) ? logical : null;
    } catch (e) {
      return null;
    }
  }

  _logicalToX(logical) {
    if (!this._chart || !Number.isFinite(logical)) return null;
    try {
      const x = this._chart.timeScale().logicalToCoordinate?.(logical);
      return Number.isFinite(x) ? x : null;
    } catch (e) {
      return null;
    }
  }

  _getLocalPointFromClient(e) {
    if (!e) return null;
    const rect = this._container.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  _captureAnchor(point, snapTime = true) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const price = this._series.coordinateToPrice(point.y);
    let time = this._chart.timeScale().coordinateToTime(point.x);
    if (time == null && snapTime) time = this._resolveTimeFromX(point.x);
    const logical = this._xToLogical(point.x);
    if (price === null) return null;
    return { price, time, logical, point: { x: point.x, y: point.y } };
  }

  _storeAnchor(prefix, anchor) {
    if (!anchor) return;
    this._state[`price${prefix}`] = anchor.price;
    this._state[`time${prefix}`] = anchor.time;
    this._state[`logical${prefix}`] = anchor.logical;
    this._state[`point${prefix}`] = anchor.point;
  }

  _supportsDragCreate(tool = this._activeTool) {
    return tool === 'trendline' || tool === 'ray' || tool === 'ext-line';
  }

  _normalizeLoadedDrawings() {
    if (!Array.isArray(this._drawings)) return;
    this._drawings.forEach((drawing) => {
      if (!drawing || drawing.type !== 'reg-channel') return;
      if (drawing.anchorTime1 == null) drawing.anchorTime1 = drawing.time1 ?? null;
      if (drawing.anchorTime2 == null) drawing.anchorTime2 = drawing.time2 ?? null;
      if (drawing.anchorLogical1 == null) drawing.anchorLogical1 = drawing.logical1 ?? null;
      if (drawing.anchorLogical2 == null) drawing.anchorLogical2 = drawing.logical2 ?? null;
    });
  }

  _isPatternTool(tool = this._activeTool) {
    return typeof tool === 'string' && tool.startsWith('pattern-');
  }

  _isOpenEndedPatternTool(tool = this._activeTool) {
    return tool === 'pattern-swing-path';
  }

  _getPatternPointCount(tool = this._activeTool) {
    return Number(DrawingToolsManager.TOOL_DEFS[tool]?.clicks || 0);
  }

  _getPatternLabels(tool = this._activeTool) {
    return DrawingToolsManager.PATTERN_TOOL_LABELS[tool] || [];
  }

  _pointsEqual(a, b) {
    if (!a || !b) return false;
    const sameTime = this._timeToComparable(a.time) === this._timeToComparable(b.time);
    const sameLogical = Number.isFinite(a.logical) && Number.isFinite(b.logical)
      ? Math.abs(a.logical - b.logical) < 0.0001
      : a.logical == null && b.logical == null;
    const samePrice = Number.isFinite(a.price) && Number.isFinite(b.price)
      ? Math.abs(a.price - b.price) < 0.0001
      : false;
    return sameTime && samePrice && sameLogical;
  }

  _collapseConsecutiveDuplicatePoints(points) {
    if (!Array.isArray(points) || points.length < 2) return Array.isArray(points) ? points : [];
    const collapsed = [points[0]];
    for (let i = 1; i < points.length; i += 1) {
      if (!this._pointsEqual(points[i], collapsed[collapsed.length - 1])) {
        collapsed.push(points[i]);
      }
    }
    return collapsed;
  }

  // ── events ───────────────────────────────────────────────────

  _onChartClick(param) {
    if (!this._activeTool || !param.point) return;
    if (this._dragGesture?.dragging) return;
    const anchor = this._captureAnchor(param.point, true);
    if (!anchor) return;
    const price = anchor.price;
    const time = anchor.time;
    const isTimeRequiredTool = this._activeTool !== 'hline';
    if (isTimeRequiredTool && time == null) {
      this._setStatus('Click inside visible bars to place this tool.');
      return;
    }

    const def = DrawingToolsManager.TOOL_DEFS[this._activeTool];
    this._state.clicks = (this._state.clicks || 0) + 1;

    if (this._isPatternTool()) {
      this._storeAnchor(this._state.clicks, anchor);
      if (!this._isOpenEndedPatternTool() && this._state.clicks >= def.clicks) {
        this._commitDrawing();
      } else {
        this._setStatus(this._statusText());
      }
      return;
    }

    if (this._state.clicks === 1) {
      this._storeAnchor(1, anchor);
    }
    if (this._state.clicks === 2) {
      if (this._shiftPressed && (this._activeTool === 'trendline' || this._activeTool === 'ray' || this._activeTool === 'ext-line')) {
        this._state.price2 = this._state.price1;
      } else {
        this._state.price2 = price;
      }
      this._state.time2 = time;
      this._state.logical2 = anchor.logical;
      this._state.point2 = anchor.point;
    }
    if (this._state.clicks === 3) {
      this._storeAnchor(3, anchor);
    }

    if (this._state.clicks >= def.clicks) {
      this._commitDrawing();
    } else {
      this._setStatus(this._statusText());
    }
  }

  _onCrosshairMove(param) {
    if (!this._activeTool || !this._state.clicks || !param.point) return;
    if (this._dragGesture?.dragging) return;
    const anchor = this._captureAnchor(param.point, true);
    if (!anchor) return;
    const price = anchor.price;
    const time = anchor.time;
    if (this._shiftPressed && (this._activeTool === 'trendline' || this._activeTool === 'ray' || this._activeTool === 'ext-line') && this._state.clicks >= 1) {
      this._state.previewPrice = this._state.price1;
    } else {
      this._state.previewPrice = price;
    }
    this._state.previewTime = time;
    this._state.previewLogical = anchor.logical;
    this._state.previewPoint = anchor.point;
    this._render();
  }

  _onKeyDown(e) {
    if (e.key === 'Shift') this._shiftPressed = true;
    if (e.key === 'Escape') {
      if (this._activeTool) { this.deactivate(); e.preventDefault(); }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this._selectedIdx >= 0 && document.activeElement === document.body) {
        this.deleteSelected();
        e.preventDefault();
      }
    }
  }

  _onKeyUp(e) {
    if (e.key === 'Shift') this._shiftPressed = false;
  }

  _onContainerMouseDown(e) {
    if (!this._activeTool || e.button !== 0 || !this._supportsDragCreate()) return;
    const point = this._getLocalPointFromClient(e);
    const anchor = this._captureAnchor(point, true);
    if (!anchor) return;
    this._dragGesture = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startAnchor: anchor,
      dragging: false,
    };
  }

  _onContainerMouseMove(e) {
    if (this._dragGesture) {
      const point = this._getLocalPointFromClient(e);
      if (!point) return;
      const dx = e.clientX - this._dragGesture.startClientX;
      const dy = e.clientY - this._dragGesture.startClientY;
      const moved = Math.hypot(dx, dy) >= 4;
      if (!this._dragGesture.dragging && !moved) return;

      if (!this._dragGesture.dragging) {
        this._dragGesture.dragging = true;
        this._state = { clicks: 1 };
        this._storeAnchor(1, this._dragGesture.startAnchor);
      }

      const anchor = this._captureAnchor(point, true);
      if (!anchor) return;
      this._state.previewPrice = this._shiftPressed ? this._state.price1 : anchor.price;
      this._state.previewTime = anchor.time;
      this._state.previewLogical = anchor.logical;
      this._state.previewPoint = anchor.point;
      this._render();
      return;
    }

    if (this._activeTool) return;
    const rect = this._container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const oldHover = this._hoveredIdx;
    this._hoveredIdx = this._hitTest(mx, my);
    this._container.style.cursor = this._hoveredIdx >= 0 ? 'pointer' : '';
    if (this._hoveredIdx !== oldHover) this._render();
  }

  _onContainerClick(e) {
    // While placing a drawing, chart clicks are used for anchors.
    if (this._activeTool) return;
    const rect = this._container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    this._selectedIdx = this._hitTest(mx, my);
    this._render();
  }

  _onContainerDblClick(e) {
    if (this._activeTool && this._isOpenEndedPatternTool() && (this._state.clicks || 0) >= 2) {
      this._commitDrawing();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const rect = this._container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const idx = this._hitTest(mx, my);
    if (idx >= 0 && this._drawings[idx].type === 'fib') {
      this._openFibEditor(idx);
    }
  }

  _onDocumentMouseUp(e) {
    if (!this._dragGesture) return;
    const gesture = this._dragGesture;
    this._dragGesture = null;
    if (!gesture.dragging) return;

    const point = this._getLocalPointFromClient(e);
    const anchor = this._captureAnchor(point, true);
    if (!anchor) {
      this._state = {};
      this._render();
      return;
    }

    this._state.price2 = this._shiftPressed ? this._state.price1 : anchor.price;
    this._state.time2 = anchor.time;
    this._state.logical2 = anchor.logical;
    this._state.point2 = anchor.point;
    this._commitDrawing();
    e.preventDefault();
  }

  // ── drawing commit ───────────────────────────────────────────

  _commitDrawing() {
    const tool = this._activeTool;
    const s = this._state;
    const def = DrawingToolsManager.TOOL_DEFS[tool];
    const d = { type: tool, color: def.color, id: Date.now() + '_' + Math.random().toString(36).slice(2,6) };

    if (this._isPatternTool(tool)) {
      const pointCount = this._isOpenEndedPatternTool(tool)
        ? Number(s.clicks || 0)
        : this._getPatternPointCount(tool);
      d.points = [];
      d.labels = this._getPatternLabels(tool);
      for (let i = 1; i <= pointCount; i += 1) {
        if (!Number.isFinite(s[`price${i}`])) continue;
        d.points.push({
          price: s[`price${i}`],
          time: s[`time${i}`],
          logical: s[`logical${i}`],
        });
      }
      if (this._isOpenEndedPatternTool(tool)) {
        d.points = this._collapseConsecutiveDuplicatePoints(d.points);
      }
      const minimumPoints = this._isOpenEndedPatternTool(tool) ? 2 : pointCount;
      if (d.points.length < minimumPoints || (!this._isOpenEndedPatternTool(tool) && d.points.length !== pointCount)) {
        this._state = { clicks: 0 };
        this._setStatus('Pattern points are incomplete. Try again.');
        return;
      }
    } else if (tool === 'hline') {
      d.price = s.price1;
    } else if (tool === 'vline') {
      d.time = s.time1;
      d.logical = s.logical1;
    } else if (tool === 'crossline') {
      d.price = s.price1; d.time = s.time1; d.logical = s.logical1;
    } else if (tool === 'channel') {
      d.price1 = s.price1; d.time1 = s.time1; d.logical1 = s.logical1;
      d.price2 = s.price2; d.time2 = s.time2; d.logical2 = s.logical2;
      d.price3 = s.price3; d.time3 = s.time3; d.logical3 = s.logical3;
    } else if (tool === 'reg-channel') {
      const reg = this._buildRegressionChannel(s.time1, s.time2);
      if (!reg) {
        this._setStatus('Regression channel needs visible OHLCV data and at least 3 bars in range.');
        this._state = { clicks: 0 };
        return;
      }
      reg.anchorTime1 = s.time1;
      reg.anchorTime2 = s.time2;
      reg.anchorLogical1 = s.logical1;
      reg.anchorLogical2 = s.logical2;
      Object.assign(d, reg);
    } else {
      d.price1 = s.price1; d.time1 = s.time1; d.logical1 = s.logical1;
      d.price2 = s.price2; d.time2 = s.time2; d.logical2 = s.logical2;
      if (tool === 'fib') d.levels = [...this._fibLevels];
    }

    this._drawings.push(d);
    this._selectedIdx = this._drawings.length - 1;
    this.deactivate();
    this._fireChange();
  }

  // ── hit testing ──────────────────────────────────────────────

  _hitTest(mx, my) {
    for (let i = this._drawings.length - 1; i >= 0; i--) {
      if (this._hitTestDrawing(this._drawings[i], mx, my)) return i;
    }
    return -1;
  }

  _hitTestDrawing(d, mx, my) {
    const threshold = 8;

    if (this._isPatternTool(d.type)) {
      return this._hitTestPattern(d, mx, my, threshold);
    }
    if (d.type === 'hline') {
      const y = this._priceToY(d.price);
      return y !== null && Math.abs(my - y) < threshold;
    }
    if (d.type === 'vline') {
      const x = this._timeToX(d.time, d.logical);
      return x !== null && Math.abs(mx - x) < threshold;
    }
    if (d.type === 'crossline') {
      const y = this._priceToY(d.price);
      const x = this._timeToX(d.time, d.logical);
      return (y !== null && Math.abs(my - y) < threshold) || (x !== null && Math.abs(mx - x) < threshold);
    }
    if (d.type === 'trendline' || d.type === 'ray' || d.type === 'ext-line') {
      return this._hitTestLine(d, mx, my, threshold);
    }
    if (d.type === 'reg-channel') {
      return this._hitTestRegressionChannel(d, mx, my, threshold);
    }
    if (d.type === 'rect') {
      const p1 = this._toPixel(d.time1, d.price1);
      const p2 = this._toPixel(d.time2, d.price2);
      if (!p1 || !p2) return false;
      const x1 = Math.min(p1.x, p2.x), x2 = Math.max(p1.x, p2.x);
      const y1 = Math.min(p1.y, p2.y), y2 = Math.max(p1.y, p2.y);
      return mx >= x1 - threshold && mx <= x2 + threshold && my >= y1 - threshold && my <= y2 + threshold;
    }
    if (d.type === 'fib') {
      const range = d.price2 - d.price1;
      const levels = d.levels || DrawingToolsManager.FIB_DEFAULTS;
      for (const lvl of levels) {
        const y = this._priceToY(d.price1 + range * lvl);
        if (y !== null && Math.abs(my - y) < threshold) return true;
      }
      return false;
    }
    if (d.type === 'channel') {
      return this._hitTestLine({ ...d, type: 'trendline' }, mx, my, threshold) ||
             this._hitTestChannelParallel(d, mx, my, threshold);
    }
    return false;
  }

  _hitTestPattern(d, mx, my, threshold) {
    const points = Array.isArray(d.points) ? d.points : [];
    if (points.length < 2) return false;
    for (let i = 1; i < points.length; i += 1) {
      const p1 = this._toPixel(points[i - 1].time, points[i - 1].price, points[i - 1].logical);
      const p2 = this._toPixel(points[i].time, points[i].price, points[i].logical);
      if (!p1 || !p2) continue;
      if (this._pointToSegmentDist(mx, my, p1.x, p1.y, p2.x, p2.y) < threshold) return true;
      if (Math.hypot(mx - p1.x, my - p1.y) < threshold) return true;
    }
    const last = points[points.length - 1];
    const lastPixel = this._toPixel(last.time, last.price, last.logical);
    return Boolean(lastPixel && Math.hypot(mx - lastPixel.x, my - lastPixel.y) < threshold);
  }

  _hitTestLine(d, mx, my, threshold) {
    const p1 = this._toPixel(d.time1, d.price1, d.logical1);
    const p2 = this._toPixel(d.time2, d.price2, d.logical2);
    if (!p1 || !p2) return false;
    return this._pointToSegmentDist(mx, my, p1.x, p1.y, p2.x, p2.y) < threshold;
  }

  _hitTestRegressionChannel(d, mx, my, threshold) {
    const channel = this._resolveRegressionChannelGeometry(d);
    const lines = [
      { time1: channel.time1, price1: channel.mid1,  time2: channel.time2, price2: channel.mid2 },
      { time1: channel.time1, price1: channel.up11,  time2: channel.time2, price2: channel.up12 },
      { time1: channel.time1, price1: channel.dn11,  time2: channel.time2, price2: channel.dn12 },
      { time1: channel.time1, price1: channel.up21,  time2: channel.time2, price2: channel.up22 },
      { time1: channel.time1, price1: channel.dn21,  time2: channel.time2, price2: channel.dn22 },
    ];
    for (const ln of lines) {
      if (this._hitTestLine(ln, mx, my, threshold)) return true;
    }
    return false;
  }

  _hitTestChannelParallel(d, mx, my, threshold) {
    const p1 = this._toPixel(d.time1, d.price1, d.logical1);
    const p2 = this._toPixel(d.time2, d.price2, d.logical2);
    if (!p1 || !p2 || d.price3 === undefined) return false;
    const dy = this._priceToY(d.price3) - this._priceToY(d.price1);
    if (dy === null) return false;
    const offset = (this._priceToY(d.price3) || 0) - (this._priceToY(d.price1) || 0);
    return this._pointToSegmentDist(mx, my, p1.x + 0, p1.y + offset, p2.x + 0, p2.y + offset) < threshold;
  }

  _pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  _resolveTimeFromX(x) {
    if (!Number.isFinite(x)) return null;
    try {
      const direct = this._chart.timeScale().coordinateToTime(x);
      if (direct != null) return direct;
    } catch (e) {}

    const bars = this._getBars ? this._getBars() : null;
    if (!Array.isArray(bars) || bars.length === 0) return null;

    let bestTime = null;
    let bestDist = Infinity;
    for (const bar of bars) {
      const t = bar?.time;
      if (t == null) continue;
      const px = this._timeToX(t);
      if (!Number.isFinite(px)) continue;
      const d = Math.abs(px - x);
      if (d < bestDist) {
        bestDist = d;
        bestTime = t;
      }
    }
    return bestTime;
  }

  // ── rendering ────────────────────────────────────────────────

  _render() {
    if (!this._ctx || !this._canvas) return;
    const ctx = this._ctx;
    const W = this._canvas.width;
    const H = this._canvas.height;
    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < this._drawings.length; i++) {
      const d = this._drawings[i];
      const highlight = (i === this._hoveredIdx || i === this._selectedIdx);
      ctx.save();
      this._renderDrawing(ctx, d, W, H, highlight);
      ctx.restore();
    }

    if (this._activeTool && this._state.clicks > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([5, 4]);
      this._renderPreview(ctx, W, H);
      ctx.restore();
    }
  }

  _renderDrawing(ctx, d, W, H, highlight) {
    const color = d.color || '#d1d5db';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = highlight ? 3 : 1.5;

    if (this._isPatternTool(d.type)) this._drawPattern(ctx, d);
    else if (d.type === 'hline')       this._drawHLine(ctx, d, W, highlight);
    else if (d.type === 'vline')  this._drawVLine(ctx, d, H, highlight);
    else if (d.type === 'crossline') { this._drawHLine(ctx, d, W, highlight); this._drawVLine(ctx, d, H, highlight); }
    else if (d.type === 'trendline') this._drawTrendline(ctx, d);
    else if (d.type === 'ray')    this._drawRay(ctx, d, W, H);
    else if (d.type === 'ext-line') this._drawExtLine(ctx, d, W, H);
    else if (d.type === 'reg-channel') this._drawRegressionChannel(ctx, d);
    else if (d.type === 'rect')   this._drawRect(ctx, d);
    else if (d.type === 'fib')    this._drawFib(ctx, d, W, highlight);
    else if (d.type === 'channel') this._drawChannel(ctx, d, W, H);
  }

  _drawHLine(ctx, d, W, highlight) {
    const y = this._priceToY(d.price);
    if (y === null) return;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(W, y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.font = 'bold 11px sans-serif';
    const label = `$${d.price.toFixed(2)}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = d.color || '#d1d5db';
    ctx.fillRect(W - tw - 10, y - 8, tw + 8, 16);
    ctx.fillStyle = '#111827';
    ctx.fillText(label, W - tw - 6, y + 4);
  }

  _drawVLine(ctx, d, H, highlight) {
    const x = this._timeToX(d.time, d.logical);
    if (x === null) return;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, H);
    ctx.stroke();
  }

  _drawTrendline(ctx, d) {
    const p1 = this._toPixel(d.time1, d.price1, d.logical1);
    const p2 = this._toPixel(d.time2, d.price2, d.logical2);
    if (!p1 || !p2) return;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    this._drawAnchor(ctx, p1); this._drawAnchor(ctx, p2);
  }

  _drawRay(ctx, d, W, H) {
    const p1 = this._toPixel(d.time1, d.price1, d.logical1);
    const p2 = this._toPixel(d.time2, d.price2, d.logical2);
    if (!p1 || !p2) return;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const scale = Math.max(W, H) * 2 / len;
    ctx.lineTo(p1.x + dx * scale, p1.y + dy * scale);
    ctx.stroke();
    this._drawAnchor(ctx, p1); this._drawAnchor(ctx, p2);
  }

  _drawExtLine(ctx, d, W, H) {
    const p1 = this._toPixel(d.time1, d.price1, d.logical1);
    const p2 = this._toPixel(d.time2, d.price2, d.logical2);
    if (!p1 || !p2) return;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const scale = Math.max(W, H) * 2 / len;
    ctx.beginPath();
    ctx.moveTo(p1.x - dx * scale, p1.y - dy * scale);
    ctx.lineTo(p2.x + dx * scale, p2.y + dy * scale);
    ctx.stroke();
    this._drawAnchor(ctx, p1); this._drawAnchor(ctx, p2);
  }

  _drawRegressionChannel(ctx, d) {
    const channel = this._resolveRegressionChannelGeometry(d);
    const midA = this._toPixel(channel.time1, channel.mid1);
    const midB = this._toPixel(channel.time2, channel.mid2);
    const up1A = this._toPixel(channel.time1, channel.up11);
    const up1B = this._toPixel(channel.time2, channel.up12);
    const dn1A = this._toPixel(channel.time1, channel.dn11);
    const dn1B = this._toPixel(channel.time2, channel.dn12);
    const up2A = this._toPixel(channel.time1, channel.up21);
    const up2B = this._toPixel(channel.time2, channel.up22);
    const dn2A = this._toPixel(channel.time1, channel.dn21);
    const dn2B = this._toPixel(channel.time2, channel.dn22);
    if (!midA || !midB || !up1A || !up1B || !dn1A || !dn1B || !up2A || !up2B || !dn2A || !dn2B) return;

    const ext = 0.12;
    const extend = (a, b) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      return { a: { x: a.x - dx * ext, y: a.y - dy * ext }, b: { x: b.x + dx * ext, y: b.y + dy * ext } };
    };
    const m = extend(midA, midB);
    const u1 = extend(up1A, up1B);
    const d1 = extend(dn1A, dn1B);
    const u2 = extend(up2A, up2B);
    const d2 = extend(dn2A, dn2B);

    const c = channel.color || d.color || '#38bdf8';

    ctx.fillStyle = c + '10';
    ctx.beginPath();
    ctx.moveTo(u2.a.x, u2.a.y);
    ctx.lineTo(u2.b.x, u2.b.y);
    ctx.lineTo(d2.b.x, d2.b.y);
    ctx.lineTo(d2.a.x, d2.a.y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = c + '16';
    ctx.beginPath();
    ctx.moveTo(u1.a.x, u1.a.y);
    ctx.lineTo(u1.b.x, u1.b.y);
    ctx.lineTo(d1.b.x, d1.b.y);
    ctx.lineTo(d1.a.x, d1.a.y);
    ctx.closePath();
    ctx.fill();

    const drawLine = (ln, width, dashed) => {
      ctx.strokeStyle = c;
      ctx.lineWidth = width;
      ctx.setLineDash(dashed ? [6, 4] : []);
      ctx.beginPath();
      ctx.moveTo(ln.a.x, ln.a.y);
      ctx.lineTo(ln.b.x, ln.b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    drawLine(m, 2, false);
    drawLine(u1, 1.5, true);
    drawLine(d1, 1.5, true);
    drawLine(u2, 1, true);
    drawLine(d2, 1, true);

    this._drawAnchor(ctx, midA);
    this._drawAnchor(ctx, midB);
  }

  _drawRect(ctx, d) {
    const p1 = this._toPixel(d.time1, d.price1, d.logical1);
    const p2 = this._toPixel(d.time2, d.price2, d.logical2);
    if (!p1 || !p2) return;
    const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
    const c = d.color || '#3b82f6';
    ctx.fillStyle = c + '18';
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  _drawFib(ctx, d, W, highlight) {
    const levels = d.levels || DrawingToolsManager.FIB_DEFAULTS;
    const range = d.price2 - d.price1;

    for (let i = 0; i < levels.length; i++) {
      const lvl = levels[i];
      const price = d.price1 + range * lvl;
      const y = this._priceToY(price);
      if (y === null) continue;
      const c = DrawingToolsManager.FIB_COLORS[lvl] || d.color || '#d97706';

      if (i < levels.length - 1) {
        const nextPrice = d.price1 + range * levels[i + 1];
        const nextY = this._priceToY(nextPrice);
        if (nextY !== null) {
          ctx.fillStyle = c + '10';
          ctx.fillRect(0, Math.min(y, nextY), W, Math.abs(nextY - y));
        }
      }

      ctx.strokeStyle = c;
      ctx.lineWidth = (lvl === 0.5 || lvl === 0.618) ? 2 : 1;
      ctx.setLineDash(lvl === 0 || lvl === 1 ? [] : [6, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y); ctx.lineTo(W, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = c;
      ctx.fillText(`${(lvl * 100).toFixed(1)}%  $${price.toFixed(2)}`, 5, y - 4);
    }
  }

  _drawChannel(ctx, d, W, H) {
    const p1 = this._toPixel(d.time1, d.price1, d.logical1);
    const p2 = this._toPixel(d.time2, d.price2, d.logical2);
    if (!p1 || !p2) return;
    const y3 = this._priceToY(d.price3);
    const y1 = this._priceToY(d.price1);
    if (y3 === null || y1 === null) return;
    const offset = y3 - y1;

    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const ext = 0.1;

    ctx.beginPath();
    ctx.moveTo(p1.x - dx * ext, p1.y - dy * ext);
    ctx.lineTo(p2.x + dx * ext, p2.y + dy * ext);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p1.x - dx * ext, p1.y + offset - dy * ext);
    ctx.lineTo(p2.x + dx * ext, p2.y + offset + dy * ext);
    ctx.stroke();

    ctx.fillStyle = (d.color || '#f59e0b') + '12';
    ctx.beginPath();
    ctx.moveTo(p1.x - dx * ext, p1.y - dy * ext);
    ctx.lineTo(p2.x + dx * ext, p2.y + dy * ext);
    ctx.lineTo(p2.x + dx * ext, p2.y + offset + dy * ext);
    ctx.lineTo(p1.x - dx * ext, p1.y + offset - dy * ext);
    ctx.closePath();
    ctx.fill();

    this._drawAnchor(ctx, p1); this._drawAnchor(ctx, p2);
  }

  _drawPattern(ctx, d) {
    const points = Array.isArray(d.points) ? d.points : [];
    if (!points.length) return;
    const pixels = points.map((point) => this._toPixel(point.time, point.price, point.logical));
    if (pixels.some((pixel) => !pixel)) return;

    const color = d.color || '#d1d5db';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    if (d.type === 'pattern-triangle' && pixels.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(pixels[0].x, pixels[0].y);
      ctx.lineTo(pixels[1].x, pixels[1].y);
      ctx.lineTo(pixels[2].x, pixels[2].y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = color + '14';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(pixels[0].x, pixels[0].y);
      for (let i = 1; i < pixels.length; i += 1) {
        ctx.lineTo(pixels[i].x, pixels[i].y);
      }
      ctx.stroke();
    }

    if (d.type === 'pattern-head-shoulders' && pixels.length >= 5) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pixels[1].x, pixels[1].y);
      ctx.lineTo(pixels[3].x, pixels[3].y);
      ctx.stroke();
      ctx.restore();
    }

    const labels = Array.isArray(d.labels) ? d.labels : [];
    ctx.font = 'bold 11px sans-serif';
    for (let i = 0; i < pixels.length; i += 1) {
      const pixel = pixels[i];
      this._drawAnchor(ctx, pixel);
      if (d.type === 'pattern-swing-path') continue;
      const label = labels[i] || `${i + 1}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = '#111827';
      ctx.fillRect(pixel.x - (tw / 2) - 4, pixel.y - 24, tw + 8, 15);
      ctx.fillStyle = color;
      ctx.fillText(label, pixel.x - (tw / 2), pixel.y - 13);
    }
  }

  _drawAnchor(ctx, pt) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── preview while placing ────────────────────────────────────

  _renderPreview(ctx, W, H) {
    const tool = this._activeTool;
    const s = this._state;
    if (!s.previewPrice) return;

    const def = DrawingToolsManager.TOOL_DEFS[tool];
    const color = def.color;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;

    if (this._isPatternTool(tool)) {
      const pixels = [];
      for (let i = 1; i <= (s.clicks || 0); i += 1) {
        const px = this._toPixel(s[`time${i}`], s[`price${i}`], s[`logical${i}`]);
        if (px) pixels.push(px);
      }
      if (s.previewPoint) pixels.push(s.previewPoint);
      if (pixels.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(pixels[0].x, pixels[0].y);
        for (let i = 1; i < pixels.length; i += 1) {
          ctx.lineTo(pixels[i].x, pixels[i].y);
        }
        if (tool === 'pattern-triangle' && pixels.length >= 3) {
          ctx.closePath();
          ctx.fillStyle = color + '14';
          ctx.fill();
        }
        ctx.stroke();
      }
      if (tool === 'pattern-head-shoulders' && s.clicks >= 3 && Number.isFinite(s.price2) && Number.isFinite(s.price4 || s.previewPrice)) {
        const leftNeck = this._toPixel(s.time2, s.price2, s.logical2);
        const rightLogical = Number.isFinite(s.logical4) ? s.logical4 : s.previewLogical;
        const rightTime = s.time4 ?? s.previewTime;
        const rightPrice = s.price4 ?? s.previewPrice;
        const rightNeck = this._toPixel(rightTime, rightPrice, rightLogical);
        if (leftNeck && rightNeck) {
          ctx.save();
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(leftNeck.x, leftNeck.y);
          ctx.lineTo(rightNeck.x, rightNeck.y);
          ctx.stroke();
          ctx.restore();
        }
      }
    } else if (tool === 'hline') {
      const y = this._priceToY(s.previewPrice);
      if (y !== null) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    } else if (tool === 'vline') {
      const x = s.previewPoint ? s.previewPoint.x : null;
      if (x !== null) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    } else if (tool === 'crossline') {
      const y = this._priceToY(s.previewPrice);
      const x = s.previewPoint ? s.previewPoint.x : null;
      if (y !== null) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      if (x !== null) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    } else if (s.clicks === 1 && (tool === 'trendline' || tool === 'ray' || tool === 'ext-line' || tool === 'reg-channel')) {
      const p1 = this._toPixel(s.time1, s.price1, s.logical1);
      const p2 = s.previewPoint;
      if (p1 && p2) {
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      }
    } else if (s.clicks === 1 && tool === 'rect') {
      const p1 = this._toPixel(s.time1, s.price1, s.logical1);
      const p2 = s.previewPoint;
      if (p1 && p2) {
        const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
        ctx.fillStyle = color + '18';
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }
    } else if (s.clicks === 1 && tool === 'fib') {
      const levels = this._fibLevels;
      const range = s.previewPrice - s.price1;
      ctx.globalAlpha = 0.4;
      for (const lvl of levels) {
        const price = s.price1 + range * lvl;
        const y = this._priceToY(price);
        if (y === null) continue;
        ctx.strokeStyle = DrawingToolsManager.FIB_COLORS[lvl] || color;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.font = '10px sans-serif';
        ctx.fillStyle = DrawingToolsManager.FIB_COLORS[lvl] || color;
        ctx.fillText(`${(lvl * 100).toFixed(1)}%`, 5, y - 3);
      }
    } else if (tool === 'channel') {
      if (s.clicks === 1) {
        const p1 = this._toPixel(s.time1, s.price1, s.logical1);
        if (p1 && s.previewPoint) {
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(s.previewPoint.x, s.previewPoint.y); ctx.stroke();
        }
      } else if (s.clicks === 2) {
        const p1 = this._toPixel(s.time1, s.price1, s.logical1);
        const p2 = this._toPixel(s.time2, s.price2, s.logical2);
        if (p1 && p2) {
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          const y1 = this._priceToY(s.price1);
          const yPreview = this._priceToY(s.previewPrice);
          if (y1 !== null && yPreview !== null) {
            const offset = yPreview - y1;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y + offset);
            ctx.lineTo(p2.x, p2.y + offset);
            ctx.stroke();
          }
        }
      }
    }
  }

  // ── toolbar ──────────────────────────────────────────────────

  _updateToolbarActive() {
    const toolbar = this._container.closest('[data-dt-toolbar]') ||
                    document.querySelector(`[data-dt-for="${this._container.id}"]`);
    if (!toolbar) return;
    toolbar.querySelectorAll('[data-dt-tool]').forEach(btn => {
      const isActive = btn.dataset.dtTool === this._activeTool;
      btn.classList.toggle('active', isActive);
    });
    toolbar.querySelectorAll('[data-dt-group-trigger]').forEach(btn => {
      const groupName = btn.dataset.dtGroupTrigger;
      const isActive = Boolean(
        groupName && toolbar.querySelector(`[data-dt-tool][data-dt-group="${groupName}"].active`)
      );
      btn.classList.toggle('active', isActive);
    });
  }

  _setStatus(msg) {
    const toolbar = this._container.closest('[data-dt-toolbar]') ||
                    document.querySelector(`[data-dt-for="${this._container.id}"]`);
    if (!toolbar) return;
    const el = toolbar.querySelector('[data-dt-status]');
    if (el) el.textContent = msg;
  }

  _statusText() {
    const def = DrawingToolsManager.TOOL_DEFS[this._activeTool];
    if (!def) return '';
    if (this._isPatternTool(this._activeTool)) {
      if (this._isOpenEndedPatternTool(this._activeTool)) {
        const placed = this._state.clicks || 0;
        const nextAnchor = `Point ${placed + 1}`;
        return placed < 2
          ? `${def.label}: place ${nextAnchor} - double-click after at least 2 points - Esc cancel`
          : `${def.label}: place ${nextAnchor} or double-click to finish - Esc cancel`;
      }
      const placed = this._state.clicks || 0;
      const remaining = def.clicks - placed;
      if (remaining <= 0) return '';
      const labels = this._getPatternLabels(this._activeTool);
      const nextAnchor = labels[placed] || `Point ${placed + 1}`;
      const clickWord = remaining === 1 ? 'click' : 'clicks';
      return `${def.label}: place ${nextAnchor} (${remaining} ${clickWord} left) - Esc cancel`;
    }
    if ((this._state.clicks || 0) === 0 && this._supportsDragCreate(this._activeTool)) {
      return `${def.label}: click twice or drag - Esc cancel`;
    }
    const remaining = def.clicks - (this._state.clicks || 0);
    if (remaining <= 0) return '';
    const clickWord = remaining === 1 ? 'click' : 'clicks';
    return `${def.label}: ${remaining} ${clickWord} remaining - Esc cancel`;
  }

  // ── fib editor ───────────────────────────────────────────────

  _loadFibLevels() {
    try {
      const s = localStorage.getItem('dt-fib-levels');
      if (s) return JSON.parse(s);
    } catch(e) {}
    return [...DrawingToolsManager.FIB_DEFAULTS];
  }

  _saveFibLevels(levels) {
    this._fibLevels = levels;
    localStorage.setItem('dt-fib-levels', JSON.stringify(levels));
  }

  _openFibEditor(idx) {
    const d = this._drawings[idx];
    const levels = d.levels || [...DrawingToolsManager.FIB_DEFAULTS];

    let existingDialog = document.getElementById('dt-fib-editor-dialog');
    if (existingDialog) existingDialog.remove();

    const dialog = document.createElement('div');
    dialog.id = 'dt-fib-editor-dialog';
    dialog.className = 'dt-fib-editor-backdrop';
    dialog.innerHTML = `
      <div class="dt-fib-editor-panel">
        <h3 style="margin:0 0 12px;font-size:14px;color:#e5e7eb;">Fibonacci Levels</h3>
        <div id="dt-fib-list" style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;"></div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <input type="number" id="dt-fib-new" step="0.001" placeholder="New level (e.g. 1.618)" style="flex:1;background:#1f2937;border:1px solid #374151;color:#e5e7eb;padding:4px 8px;border-radius:4px;font-size:12px;">
          <button id="dt-fib-add-btn" style="background:#374151;color:#e5e7eb;border:none;padding:4px 12px;border-radius:4px;font-size:12px;cursor:pointer;">Add</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button id="dt-fib-reset-btn" style="background:#374151;color:#9ca3af;border:none;padding:6px 14px;border-radius:4px;font-size:12px;cursor:pointer;">Reset</button>
          <button id="dt-fib-save-btn" style="background:#6366f1;color:#fff;border:none;padding:6px 14px;border-radius:4px;font-size:12px;cursor:pointer;flex:1;">Save</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);

    const list = dialog.querySelector('#dt-fib-list');
    const addRow = (val) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;';
      row.innerHTML = `
        <input type="number" step="0.001" value="${val}" min="0" max="10" style="width:80px;background:#1f2937;border:1px solid #374151;color:#e5e7eb;padding:4px 8px;border-radius:4px;font-size:12px;" class="dt-fib-val">
        <span style="font-size:11px;color:#6b7280;">(${(val * 100).toFixed(1)}%)</span>
        <button style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;padding:0 4px;" title="Remove">×</button>`;
      row.querySelector('button').onclick = () => row.remove();
      list.appendChild(row);
    };
    levels.forEach(addRow);

    dialog.querySelector('#dt-fib-add-btn').onclick = () => {
      const v = parseFloat(dialog.querySelector('#dt-fib-new').value);
      if (!isNaN(v)) { addRow(v); dialog.querySelector('#dt-fib-new').value = ''; }
    };
    dialog.querySelector('#dt-fib-reset-btn').onclick = () => {
      list.innerHTML = '';
      DrawingToolsManager.FIB_DEFAULTS.forEach(addRow);
    };
    dialog.querySelector('#dt-fib-save-btn').onclick = () => {
      const newLevels = [];
      list.querySelectorAll('.dt-fib-val').forEach(inp => {
        const v = parseFloat(inp.value);
        if (!isNaN(v)) newLevels.push(v);
      });
      newLevels.sort((a, b) => a - b);
      this._drawings[idx].levels = newLevels;
      this._saveFibLevels(newLevels);
      dialog.remove();
      this._render();
      this._fireChange();
    };
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
  }

  _fireChange() {
    if (this._onChange) this._onChange(this.getDrawings());
  }

  _timeToComparable(timeValue) {
    if (timeValue == null) return Number.NaN;
    if (typeof timeValue === 'number') return timeValue;
    if (typeof timeValue === 'string') {
      const parsed = Date.parse(timeValue.includes('T') ? timeValue : `${timeValue}T00:00:00Z`);
      return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Number.NaN;
    }
    if (typeof timeValue === 'object' && Number.isFinite(timeValue.year) && Number.isFinite(timeValue.month) && Number.isFinite(timeValue.day)) {
      const iso = `${String(timeValue.year).padStart(4, '0')}-${String(timeValue.month).padStart(2, '0')}-${String(timeValue.day).padStart(2, '0')}T00:00:00Z`;
      const parsed = Date.parse(iso);
      return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Number.NaN;
    }
    return Number.NaN;
  }

  _closeFromBar(bar) {
    if (!bar || typeof bar !== 'object') return Number.NaN;
    if (Number.isFinite(bar.close)) return bar.close;
    const hi = Number.isFinite(bar.high) ? bar.high : Number.NaN;
    const lo = Number.isFinite(bar.low) ? bar.low : Number.NaN;
    if (Number.isFinite(hi) && Number.isFinite(lo)) return (hi + lo) / 2;
    return Number.NaN;
  }

  _buildRegressionChannel(timeA, timeB) {
    const bars = this._getBars ? this._getBars() : null;
    if (!Array.isArray(bars) || bars.length < 3) return null;

    const ta = this._timeToComparable(timeA);
    const tb = this._timeToComparable(timeB);
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
    const idxA = this._findNearestBarIndex(bars, ta);
    const idxB = this._findNearestBarIndex(bars, tb);
    if (!Number.isFinite(idxA) || !Number.isFinite(idxB)) return null;

    const loIdx = Math.min(idxA, idxB);
    const hiIdx = Math.max(idxA, idxB);
    const sample = bars.slice(loIdx, hiIdx + 1);
    if (sample.length < 3) return null;

    const ys = [];
    const ts = [];
    for (const bar of sample) {
      const y = this._closeFromBar(bar);
      if (!Number.isFinite(y)) continue;
      ys.push(y);
      ts.push(bar.time);
    }
    if (ys.length < 3) return null;

    const n = ys.length;
    const meanX = (n - 1) / 2;
    const meanY = ys.reduce((acc, v) => acc + v, 0) / n;
    let varX = 0;
    let covXY = 0;
    for (let i = 0; i < n; i++) {
      const dx = i - meanX;
      varX += dx * dx;
      covXY += dx * (ys[i] - meanY);
    }
    if (varX === 0) return null;

    const slope = covXY / varX;
    const intercept = meanY - slope * meanX;

    let rss = 0;
    for (let i = 0; i < n; i++) {
      const fit = intercept + slope * i;
      const resid = ys[i] - fit;
      rss += resid * resid;
    }
    const sigma = Math.sqrt(rss / n);

    const mid1 = intercept;
    const mid2 = intercept + slope * (n - 1);
    return {
      time1: ts[0],
      time2: ts[n - 1],
      mid1,
      mid2,
      up11: mid1 + sigma,
      up12: mid2 + sigma,
      dn11: mid1 - sigma,
      dn12: mid2 - sigma,
      up21: mid1 + sigma * 2,
      up22: mid2 + sigma * 2,
      dn21: mid1 - sigma * 2,
      dn22: mid2 - sigma * 2,
      sigma,
      slope,
      bars: n,
    };
  }

  _findNearestBarIndex(bars, targetComparable) {
    if (!Array.isArray(bars) || !bars.length || !Number.isFinite(targetComparable)) return Number.NaN;
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < bars.length; i += 1) {
      const barComparable = this._timeToComparable(bars[i]?.time);
      if (!Number.isFinite(barComparable)) continue;
      const distance = Math.abs(barComparable - targetComparable);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  // ── static helper: create toolbar HTML ───────────────────────

  static createToolbar(containerId, opts = {}) {
    const variant = String(opts.variant || DrawingToolsManager.DEFAULT_TOOLBAR_VARIANT || 'default').trim().toLowerCase();
    const tools = opts.tools || ['trendline', 'ray', 'ext-line', 'reg-channel', 'hline', 'vline', 'fib', 'rect', 'channel', 'crossline'];
    const div = document.createElement('div');
    div.className = variant === 'grouped-dock' ? 'dt-toolbar dt-toolbar--dock dt-toolbar--grouped' : 'dt-toolbar';
    div.setAttribute('data-dt-for', containerId);

    let html = '';
    if (variant === 'grouped-dock') {
      const groups = [
        {
          id: 'fib',
          label: 'Fib',
          sections: [
            { label: 'Fibonacci', tools: ['fib'] },
          ],
        },
        {
          id: 'lines',
          label: 'Lines',
          sections: [
            { label: 'Lines', tools: ['trendline', 'hline', 'vline'] },
            { label: 'Channels', tools: ['channel', 'reg-channel'] },
          ],
        },
        {
          id: 'patterns',
          label: 'Pattern',
          sections: [
            {
              label: 'Chart Patterns',
              tools: [
                'pattern-xabcd',
                'pattern-cypher',
                'pattern-head-shoulders',
                'pattern-abcd',
                'pattern-triangle',
                'pattern-three-drives',
                'pattern-swing-path',
              ],
            },
          ],
        },
      ];

      for (const group of groups) {
        html += `<div class="dt-tool-group" data-dt-group="${group.id}">`;
        html += `<button type="button" class="dt-tool-btn dt-group-trigger" data-dt-group-trigger="${group.id}" title="${group.label} tools">${group.label}</button>`;
        html += `<div class="dt-group-menu" data-dt-group-menu="${group.id}">`;
        for (const section of group.sections) {
          html += `<div class="dt-group-section">`;
          html += `<div class="dt-group-section-label">${section.label}</div>`;
          for (const toolName of section.tools) {
            const def = DrawingToolsManager.TOOL_DEFS[toolName];
            if (!def) continue;
            html += `<button type="button" class="dt-tool-btn dt-group-item" data-dt-tool="${toolName}" data-dt-group="${group.id}" title="${def.label}">${def.label}</button>`;
          }
          html += `</div>`;
        }
        html += `</div>`;
        html += `</div>`;
      }
      html += `<div class="dt-toolbar-actions">`;
      html += `<button class="dt-tool-btn dt-del-btn" data-dt-action="delete" title="Delete selected drawing">Del</button>`;
      html += `<button class="dt-tool-btn dt-clear-btn" data-dt-action="clear" title="Clear all drawings">Clear</button>`;
      html += `</div>`;
      html += `<span data-dt-status class="dt-status"></span>`;

      div.innerHTML = html;
      return div;
    }
    for (const t of tools) {
      const def = DrawingToolsManager.TOOL_DEFS[t];
      if (!def) continue;
      html += `<button class="dt-tool-btn" data-dt-tool="${t}" title="${def.label}">${def.icon}</button>`;
    }
    html += '<span class="dt-divider"></span>';
    html += `<button class="dt-tool-btn dt-clear-btn" data-dt-action="clear" title="Clear Drawings">✕</button>`;
    html += `<button class="dt-tool-btn dt-del-btn" data-dt-action="delete" title="Delete Selected (Del)">🗑</button>`;
    html += `<span data-dt-status class="dt-status"></span>`;

    div.innerHTML = html;
    return div;
  }

  _resolveRegressionChannelGeometry(d) {
    if (!d || d.type !== 'reg-channel') return d;

    const anchorTime1 = d.anchorTime1 ?? d.time1;
    const anchorTime2 = d.anchorTime2 ?? d.time2;
    const bars = this._getBars ? this._getBars() : null;
    const barsFingerprint = Array.isArray(bars) && bars.length
      ? `${bars.length}|${this._timeToComparable(bars[0]?.time)}|${this._timeToComparable(bars[bars.length - 1]?.time)}`
      : 'no-bars';
    const cacheKey = `${this._timeToComparable(anchorTime1)}|${this._timeToComparable(anchorTime2)}|${barsFingerprint}`;

    if (d._geometryCacheKey === cacheKey && d._resolvedGeometry) {
      return d._resolvedGeometry;
    }

    const recomputed = this._buildRegressionChannel(anchorTime1, anchorTime2);
    if (!recomputed) {
      d._geometryCacheKey = cacheKey;
      d._resolvedGeometry = {
        ...d,
        anchorTime1,
        anchorTime2,
        anchorLogical1: d.anchorLogical1 ?? d.logical1 ?? null,
        anchorLogical2: d.anchorLogical2 ?? d.logical2 ?? null,
      };
      return d._resolvedGeometry;
    }

    d._geometryCacheKey = cacheKey;
    d._resolvedGeometry = {
      ...d,
      ...recomputed,
      anchorTime1,
      anchorTime2,
      anchorLogical1: d.anchorLogical1 ?? d.logical1 ?? null,
      anchorLogical2: d.anchorLogical2 ?? d.logical2 ?? null,
    };
    return d._resolvedGeometry;
  }

  static attachToolbar(hostEl, containerId, manager, opts = {}) {
    if (!hostEl || !manager) return null;
    const toolbar = DrawingToolsManager.createToolbar(containerId, {
      variant: DrawingToolsManager.DEFAULT_TOOLBAR_VARIANT,
      ...opts,
    });

    hostEl.innerHTML = toolbar.innerHTML;
    for (const className of String(toolbar.className || '').split(/\s+/)) {
      if (className) hostEl.classList.add(className);
    }

    DrawingToolsManager.wireToolbar(hostEl, manager);
    return hostEl;
  }

  static wireToolbar(toolbar, manager) {
    const closeGroupedMenus = () => {
      toolbar.querySelectorAll('.dt-tool-group.open').forEach(group => group.classList.remove('open'));
    };

    toolbar.querySelectorAll('[data-dt-group-trigger]').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const groupEl = btn.closest('.dt-tool-group');
        if (!groupEl) return;
        const shouldOpen = !groupEl.classList.contains('open');
        closeGroupedMenus();
        if (shouldOpen) groupEl.classList.add('open');
      });
    });

    toolbar.querySelectorAll('[data-dt-tool]').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        manager.toggle(btn.dataset.dtTool);
        closeGroupedMenus();
      });
    });
    toolbar.querySelectorAll('[data-dt-action="clear"]').forEach(btn => {
      btn.addEventListener('click', () => {
        manager.clear();
        closeGroupedMenus();
      });
    });
    toolbar.querySelectorAll('[data-dt-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        manager.deleteSelected();
        closeGroupedMenus();
      });
    });

    if (toolbar._dtOutsideHandler) {
      document.removeEventListener('click', toolbar._dtOutsideHandler);
    }
    toolbar._dtOutsideHandler = (event) => {
      if (!toolbar.contains(event.target)) closeGroupedMenus();
    };
    document.addEventListener('click', toolbar._dtOutsideHandler);
  }
}

// Export for module or global use
if (typeof window !== 'undefined') window.DrawingToolsManager = DrawingToolsManager;
