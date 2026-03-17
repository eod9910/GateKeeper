// Test RSI scanner functionality
const http = require('http');

console.log('Testing RSI Scanner for AAPL...\n');

// First, get available indicators
function getIndicators() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3002/api/candidates', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Run a scan
function runScan(indicator, symbol) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      indicator: indicator,
      symbol: symbol,
      interval: '1wk',
      assetClass: 'stocks'
    });

    const options = {
      hostname: 'localhost',
      port: 3002,
      path: '/api/candidates/scan',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Get chart data
function getChartData(symbol, interval = '1wk') {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3002/api/saved-charts?symbol=${symbol}&interval=${interval}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  try {
    console.log('1. Checking available indicators...');
    const indicators = await getIndicators();
    console.log(`   Found ${indicators.success ? 'data' : 'no data'}\n`);

    console.log('2. Running scan with RSI Primitive for AAPL...');
    const scanResult = await runScan('rsi_primitive', 'AAPL');
    
    if (scanResult.success) {
      console.log(`   ✅ Scan completed successfully`);
      console.log(`   Candidates found: ${scanResult.data?.candidates?.length || 0}`);
      
      if (scanResult.data?.candidates?.length > 0) {
        const firstCandidate = scanResult.data.candidates[0];
        console.log(`\n   First candidate details:`);
        console.log(`   - Symbol: ${firstCandidate.symbol}`);
        console.log(`   - Score: ${firstCandidate.score}`);
        console.log(`   - Pattern Type: ${firstCandidate.pattern_type}`);
        console.log(`   - Entry Ready: ${firstCandidate.entry_ready}`);
        
        if (firstCandidate.chart_data) {
          console.log(`   - Chart data points: ${firstCandidate.chart_data.length}`);
        }
        
        if (firstCandidate.node_result) {
          console.log(`   - Node result: passed=${firstCandidate.node_result.passed}, score=${firstCandidate.node_result.score}`);
        }
      }
    } else {
      console.log(`   ❌ Scan failed: ${scanResult.error || 'Unknown error'}`);
    }

    console.log('\n3. Checking chart data for AAPL...');
    const chartData = await getChartData('AAPL', '1wk');
    
    if (chartData.success && chartData.data) {
      console.log(`   ✅ Chart data available`);
      console.log(`   - Data points: ${chartData.data.length || 0}`);
      if (chartData.data.length > 0) {
        const latest = chartData.data[chartData.data.length - 1];
        console.log(`   - Latest bar: close=${latest.close}, date=${latest.time || latest.timestamp}`);
      }
    } else {
      console.log(`   ℹ️  No saved chart data (this is normal for first scan)`);
    }

    console.log('\n=== SUMMARY ===');
    console.log('Scanner functionality test completed.');
    console.log('To verify visually:');
    console.log('1. Open http://localhost:3002 in browser');
    console.log('2. Select "RSI Primitive" from indicator dropdown');
    console.log('3. Enter "AAPL" in symbol field');
    console.log('4. Click "Scan" button');
    console.log('5. Check if candlestick chart renders');
    console.log('6. Check if RSI sub-panel appears below chart');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
