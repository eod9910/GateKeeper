// Get full MACD primitive response from Plugin Engineer
const http = require('http');
const fs = require('fs');

console.log('Requesting MACD primitive from Plugin Engineer...\n');

const options = {
  hostname: 'localhost',
  port: 3002,
  path: '/api/vision/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      console.log('=== API Response ===');
      console.log(JSON.stringify(response, null, 2));
      
      // Save to file for detailed analysis
      fs.writeFileSync('macd-response.json', JSON.stringify(response, null, 2));
      console.log('\n✅ Full response saved to macd-response.json');
      
      if (response.success && response.data && response.data.response) {
        console.log('\n=== AI Response Text ===');
        console.log(response.data.response);
        
        // Check for key requirements
        console.log('\n=== Verification Checks ===');
        const text = response.data.response;
        
        const hasGenericName = text.includes('macd_primitive') || text.includes('"macd"') || (text.includes('macd') && !text.includes('macd_12_26_9'));
        const hasTunableParams = text.includes('tunable_params');
        const hasKwargs = text.includes('**kwargs');
        const hasOutputPorts = text.includes('output_ports');
        const hasExamples = text.includes('examples') || text.includes('presets');
        
        console.log(`✓ Generic name (not macd_12_26_9): ${hasGenericName ? 'YES' : 'NO'}`);
        console.log(`✓ tunable_params in JSON: ${hasTunableParams ? 'YES' : 'NO'}`);
        console.log(`✓ **kwargs in Python function: ${hasKwargs ? 'YES' : 'NO'}`);
        console.log(`✓ output_ports in JSON: ${hasOutputPorts ? 'YES' : 'NO'}`);
        console.log(`✓ examples/presets in JSON: ${hasExamples ? 'YES' : 'NO'}`);
      }
    } catch (e) {
      console.error('Error parsing response:', e.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

// Send the request
req.write(JSON.stringify({
  message: 'Build me a MACD primitive',
  context: 'plugin_engineer'
}));

req.end();
