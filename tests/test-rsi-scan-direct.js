// Direct API test for RSI scan on AAPL
const http = require('http');
const fs = require('fs');

console.log('=== RSI Primitive Scan Test for AAPL ===\n');

// Step 1: Start a scan job
async function startScan() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      symbols: ['AAPL'],
      pluginId: 'rsi_primitive',
      interval: '1wk',
      period: 'max',
      timeframe: 'weekly',
      scanScope: 'research'
    });

    const options = {
      hostname: 'localhost',
      port: 3002,
      path: '/api/candidates/scan-batch/start',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    console.log('Step 1: Starting RSI scan for AAPL...');
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.success && result.data && result.data.job_id) {
            console.log(`✅ Scan job started: ${result.data.job_id}\n`);
            resolve(result.data.job_id);
          } else {
            console.log(`❌ Scan failed: ${result.error || 'Unknown error'}`);
            reject(new Error(result.error || 'Failed to start scan'));
          }
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

// Step 2: Poll scan job status
async function pollScanJob(jobId) {
  return new Promise((resolve, reject) => {
    const checkStatus = () => {
      http.get(`http://localhost:3002/api/candidates/scan-batch/job/${jobId}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (!result.success || !result.data) {
              reject(new Error('Failed to get job status'));
              return;
            }

            const job = result.data;
            const status = job.status || 'unknown';
            const progress = Math.round((job.progress || 0) * 100);
            
            console.log(`Status: ${status} | Progress: ${progress}% | Completed: ${job.completed_symbols || 0}/${job.total_symbols || 0}`);

            if (status === 'completed') {
              console.log(`✅ Scan completed!\n`);
              resolve(job);
            } else if (status === 'failed' || status === 'cancelled') {
              reject(new Error(`Scan ${status}`));
            } else {
              // Continue polling
              setTimeout(checkStatus, 1000);
            }
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    };

    checkStatus();
  });
}

// Step 3: Get scan results
async function getScanResults(jobId) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3002/api/candidates/scan-batch/job/${jobId}/results`, (res) => {
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

// Main execution
async function main() {
  try {
    console.log('Step 2: Polling scan status...');
    const jobId = await startScan();
    
    console.log('Step 3: Waiting for scan to complete...');
    const job = await pollScanJob(jobId);
    
    console.log('Step 4: Fetching scan results...');
    const results = await getScanResults(jobId);
    
    if (results.success && results.data) {
      const candidates = results.data.candidates || [];
      console.log(`\n=== SCAN RESULTS ===`);
      console.log(`Total candidates found: ${candidates.length}`);
      
      if (candidates.length > 0) {
        console.log(`\nFirst candidate details:`);
        const first = candidates[0];
        console.log(`- Symbol: ${first.symbol}`);
        console.log(`- Pattern Type: ${first.pattern_type}`);
        console.log(`- Score: ${first.score}`);
        console.log(`- Entry Ready: ${first.entry_ready}`);
        console.log(`- Window: bars ${first.window_start} to ${first.window_end}`);
        
        if (first.node_result) {
          console.log(`\nNode Result:`);
          console.log(`- Passed: ${first.node_result.passed}`);
          console.log(`- Score: ${first.node_result.score}`);
          console.log(`- Reason: ${first.node_result.reason}`);
          
          if (first.node_result.features) {
            console.log(`- Features:`, JSON.stringify(first.node_result.features, null, 2));
          }
        }
        
        if (first.output_ports) {
          console.log(`\nOutput Ports:`, JSON.stringify(first.output_ports, null, 2));
        }
        
        // Save full result to file
        fs.writeFileSync('rsi-scan-result.json', JSON.stringify(results, null, 2));
        console.log(`\n✅ Full results saved to rsi-scan-result.json`);
      }
    } else {
      console.log(`❌ No results returned`);
    }

    console.log(`\n=== CHART RENDERING TEST ===`);
    console.log(`To verify RSI sub-panel rendering:`);
    console.log(`1. Open http://localhost:3002 in browser`);
    console.log(`2. The scan results should now be visible`);
    console.log(`3. Click on the AAPL candidate in the results list`);
    console.log(`4. The chart should show:`);
    console.log(`   - Main panel: AAPL candlesticks`);
    console.log(`   - Sub-panel: RSI line (purple, 0-100 scale)`);
    console.log(`   - Reference lines at 30 (oversold) and 70 (overbought)`);

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
  }
}

main();
