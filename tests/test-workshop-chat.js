// Test script to interact with Workshop Plugin Engineer
const http = require('http');

console.log('Testing Workshop Plugin Engineer chat...\n');

// First, let's check if there's an API endpoint for the chat
const testEndpoints = [
  '/api/vision/chat',
  '/api/vision/generate-plugin',
  '/api/plugins/generate',
  '/api/chat'
];

async function testEndpoint(path) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3002,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data: data });
      });
    });

    req.on('error', (e) => {
      resolve({ status: 'error', error: e.message });
    });

    // Send test message
    req.write(JSON.stringify({
      message: 'Build me a MACD primitive',
      context: 'plugin_engineer'
    }));
    req.end();
  });
}

async function runTests() {
  console.log('Testing API endpoints...\n');
  
  for (const endpoint of testEndpoints) {
    console.log(`Testing ${endpoint}...`);
    const result = await testEndpoint(endpoint);
    console.log(`  Status: ${result.status}`);
    if (result.data) {
      console.log(`  Response: ${result.data.substring(0, 200)}${result.data.length > 200 ? '...' : ''}`);
    }
    console.log('');
  }
}

runTests();
