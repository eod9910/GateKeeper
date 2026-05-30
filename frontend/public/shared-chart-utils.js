(function () {
  function sanitizeChartData(data) {
    if (!data || !Array.isArray(data)) return [];

    var isIntraday = false;
    var dateCounts = {};
    for (var i = 0; i < data.length; i += 1) {
      var bar = data[i];
      if (!bar || bar.time == null) continue;
      var ts = String(bar.time);
      if (ts.length >= 10 && /^\d{4}-/.test(ts)) {
        var dateKey = ts.substring(0, 10);
        dateCounts[dateKey] = (dateCounts[dateKey] || 0) + 1;
        if (dateCounts[dateKey] > 1) {
          isIntraday = true;
          break;
        }
      }
    }

    var seen = new Set();
    var sanitized = data.filter(function (bar) {
      if (!bar || bar.time == null || bar.time === '') return false;
      var o = bar.open;
      var h = bar.high;
      var l = bar.low;
      var c = bar.close;
      if (o == null || h == null || l == null || c == null || Number.isNaN(o) || Number.isNaN(h) || Number.isNaN(l) || Number.isNaN(c)) {
        return false;
      }

      var time = bar.time;
      if (typeof time === 'string') {
        if (isIntraday && time.length > 10) {
          var dt = new Date(time.replace(' ', 'T'));
          time = Number.isNaN(dt.getTime()) ? time.substring(0, 10) : Math.floor(dt.getTime() / 1000);
        } else {
          time = time.substring(0, 10);
        }
      }

      if (seen.has(time)) return false;
      seen.add(time);

      return true;
    }).map(function (bar) {
      var next = Object.assign({}, bar);
      if (typeof next.time === 'string') {
        if (isIntraday && next.time.length > 10) {
          var dt = new Date(next.time.replace(' ', 'T'));
          next.time = Number.isNaN(dt.getTime()) ? next.time.substring(0, 10) : Math.floor(dt.getTime() / 1000);
        } else {
          next.time = next.time.substring(0, 10);
        }
      }
      return next;
    });

    sanitized.sort(function (a, b) {
      var av = a.time;
      var bv = b.time;
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return String(av).localeCompare(String(bv));
    });

    return sanitized;
  }

  function getCandlestickSeriesOptions(overrides) {
    var base = {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    };
    return Object.assign(base, overrides || {});
  }

  window.SharedChartUtils = {
    sanitizeChartData: sanitizeChartData,
    getCandlestickSeriesOptions: getCandlestickSeriesOptions,
  };
})();
