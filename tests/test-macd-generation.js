// Test MACD primitive generation with proper context
const http = require('http');
const fs = require('fs');

console.log('Requesting MACD primitive generation from Plugin Engineer...\n');

const context = {
  page: 'plugin_workshop',
  patternName: '',
  patternId: '',
  category: 'custom',
  status: 'experimental',
  currentCode: '',
  currentDefinition: '',
  indicatorLibrary: {
    total: 0,
    selectedPatternId: null,
    names: []
  },
  availablePrimitives: [
    { pattern_id: 'rdp_swing_structure', name: 'RDP Pivots (Primitive)', indicator_role: 'anchor_structure' },
    { pattern_id: 'ma_crossover', name: 'Moving Average Crossover (Primitive)', indicator_role: 'timing_trigger' },
    { pattern_id: 'rsi_primitive', name: 'RSI (Primitive)', indicator_role: 'timing_trigger' }
  ],
  lastTestResult: null,
  chatHistory: []
};

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
      const aiText = response?.data?.response || response?.response || '';
      
      console.log('=== AI RESPONSE ===\n');
      console.log(aiText);
      console.log('\n');
      
      // Save full response
      fs.writeFileSync('macd-full-response.txt', aiText);
      console.log('✅ Full response saved to macd-full-response.txt\n');
      
      // Verification checks
      console.log('=== VERIFICATION CHECKS ===');
      const hasGenericName = (aiText.includes('"pattern_id": "macd_primitive"') || aiText.includes('"pattern_id":"macd_primitive"')) && !aiText.includes('macd_12_26_9');
      const hasTunableParams = aiText.includes('"tunable_params"');
      const hasKwargs = aiText.includes('**kwargs');
      const hasOutputPorts = aiText.includes('"output_ports"');
      const hasExamples = aiText.includes('"examples"');
      const hasPluginCode = aiText.includes('===PLUGIN_CODE===');
      const hasPluginDef = aiText.includes('===PLUGIN_DEFINITION===');
      
      console.log(`✓ Generic name "macd_primitive": ${hasGenericName ? '✅ YES' : '❌ NO'}`);
      console.log(`✓ tunable_params in JSON: ${hasTunableParams ? '✅ YES' : '❌ NO'}`);
      console.log(`✓ **kwargs in Python function: ${hasKwargs ? '✅ YES' : '❌ NO'}`);
      console.log(`✓ output_ports in candidate: ${hasOutputPorts ? '✅ YES' : '❌ NO'}`);
      console.log(`✓ examples/presets in JSON: ${hasExamples ? '✅ YES' : '❌ NO'}`);
      console.log(`✓ ===PLUGIN_CODE=== markers: ${hasPluginCode ? '✅ YES' : '❌ NO'}`);
      console.log(`✓ ===PLUGIN_DEFINITION=== markers: ${hasPluginDef ? '✅ YES' : '❌ NO'}`);
      
      console.log('\n=== SUMMARY ===');
      if (hasGenericName && hasTunableParams && hasKwargs && hasOutputPorts && hasExamples) {
        console.log('✅ ALL REQUIREMENTS MET!');
      } else {
        console.log('❌ Some requirements missing - see details above');
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

// Send the request with proper context
req.write(JSON.stringify({
  message: 'Build me a MACD primitive',
  context: context,
  role: 'plugin_engineer'
}));

req.end();
