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

  function median(numbers) {
    var vals = numbers
      .filter(function (value) { return Number.isFinite(value) && value > 0; })
      .sort(function (a, b) { return a - b; });
    if (!vals.length) return 0;
    var mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }

  function buildEqualVolumeBars(data, options) {
    var bars = sanitizeChartData(data);
    if (bars.length < 2) return bars;

    var volumes = bars.map(function (bar) { return Number(bar.volume) || 0; });
    var targetVolume = Number(options && options.targetVolume);
    if (!Number.isFinite(targetVolume) || targetVolume <= 0) {
      targetVolume = median(volumes);
    }
    if (!Number.isFinite(targetVolume) || targetVolume <= 0) return bars;

    var equivolBars = [];
    var bucket = null;

    function finishBucket() {
      if (!bucket) return;
      equivolBars.push(bucket);
      bucket = null;
    }

    bars.forEach(function (bar, index) {
      var rawVolume = Math.max(0, Number(bar.volume) || 0);
      var volume = rawVolume > 0 ? rawVolume : targetVolume;

      if (!bucket) {
        bucket = {
          time: bar.time,
          open: Number(bar.open),
          high: Number(bar.high),
          low: Number(bar.low),
          close: Number(bar.close),
          volume: 0,
          sourceStartIndex: index,
          sourceEndIndex: index,
          sourceStartTime: bar.time,
          sourceEndTime: bar.time,
        };
      } else {
        bucket.high = Math.max(bucket.high, Number(bar.high));
        bucket.low = Math.min(bucket.low, Number(bar.low));
        bucket.close = Number(bar.close);
        bucket.sourceEndIndex = index;
        bucket.sourceEndTime = bar.time;
      }

      bucket.volume += volume;
      bucket.time = bar.time;

      if (bucket.volume >= targetVolume) {
        finishBucket();
      }
    });

    finishBucket();
    return equivolBars.length ? equivolBars : bars;
  }

  window.SharedChartUtils = {
    sanitizeChartData: sanitizeChartData,
    getCandlestickSeriesOptions: getCandlestickSeriesOptions,
    buildEqualVolumeBars: buildEqualVolumeBars,
  };
})();
