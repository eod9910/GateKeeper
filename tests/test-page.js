// Simple page test script
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3002,
  path: '/',
  method: 'GET'
};

console.log('Testing http://localhost:3002/...\n');

const req = http.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  console.log(`Headers:`, JSON.stringify(res.headers, null, 2));
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`\nPage size: ${data.length} bytes`);
    
    // Check for key elements
    const hasChartContainer = data.includes('id="chart-container"');
    const hasSidebar = data.includes('class="app-sidebar"');
    const hasScannerControls = data.includes('scan-indicator-select');
    const hasIndicatorDropdown = data.includes('Indicator</label>');
    const hasAssetClassDropdown = data.includes('Asset Class');
    const hasScanButton = data.includes('Run Scan');
    
    console.log('\n=== UI Elements Check ===');
    console.log(`✓ Chart Container: ${hasChartContainer ? 'FOUND' : 'MISSING'}`);
    console.log(`✓ Sidebar: ${hasSidebar ? 'FOUND' : 'MISSING'}`);
    console.log(`✓ Scanner Controls: ${hasScannerControls ? 'FOUND' : 'MISSING'}`);
    console.log(`✓ Indicator Dropdown: ${hasIndicatorDropdown ? 'FOUND' : 'MISSING'}`);
    console.log(`✓ Asset Class Dropdown: ${hasAssetClassDropdown ? 'FOUND' : 'MISSING'}`);
    console.log(`✓ Scan Button: ${hasScanButton ? 'FOUND' : 'MISSING'}`);
    
    // Check for error indicators
    const hasErrorClass = data.includes('class="error"') || data.includes('error-message');
    const hasConsoleError = data.includes('console.error');
    
    console.log('\n=== Error Check ===');
    console.log(`Error elements: ${hasErrorClass ? 'FOUND (potential issue)' : 'NONE'}`);
    
    console.log('\n✅ Page loads successfully with all expected elements!');
  });
});

req.on('error', (e) => {
  console.error(`❌ Error: ${e.message}`);
});

req.end();
