# PowerShell script to automate RSI test in browser
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Take-Screenshot {
    param([string]$filename)
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
    $bitmap.Save($filename)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "Screenshot saved: $filename"
}

# Step 1: Open browser to localhost:3002
Write-Host "Step 1: Opening browser..."
Start-Process msedge "http://localhost:3002" -WindowStyle Maximized
Start-Sleep -Seconds 4

# Take initial screenshot
Take-Screenshot "C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\step1-initial.png"

Write-Host "`nStep 2: Looking for indicator dropdown..."
Write-Host "The dropdown should be visible on the page. Taking screenshot..."
Start-Sleep -Seconds 1

# Step 3: Use Tab navigation to find controls
Write-Host "`nStep 3: Navigating to controls..."
[System.Windows.Forms.SendKeys]::SendWait("^{HOME}")  # Go to top
Start-Sleep -Milliseconds 500

# Try to find and interact with the page using JavaScript injection via address bar
Write-Host "`nStep 4: Attempting to interact with page elements..."
Write-Host "Opening developer console..."
[System.Windows.Forms.SendKeys]::SendWait("{F12}")
Start-Sleep -Seconds 2

Take-Screenshot "C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\step2-devtools.png"

# Type JavaScript to interact with elements
Write-Host "`nStep 5: Executing JavaScript to select RSI and enter AAPL..."
[System.Windows.Forms.SendKeys]::SendWait("^+k")  # Open console command line
Start-Sleep -Milliseconds 500

# JavaScript to select RSI Primitive
$js1 = "document.getElementById('scan-indicator-select').value = 'rsi_primitive'; document.getElementById('scan-indicator-select').dispatchEvent(new Event('change'));"
[System.Windows.Forms.SendKeys]::SendWait($js1)
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 800

Take-Screenshot "C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\step3-selected-rsi.png"

# JavaScript to enter AAPL
Write-Host "`nStep 6: Entering AAPL symbol..."
$js2 = "var input = document.querySelector('input[placeholder*=`"AAPL`"]'); if(input) { input.value = 'AAPL'; input.dispatchEvent(new Event('input')); }"
[System.Windows.Forms.SendKeys]::SendWait($js2)
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 800

Take-Screenshot "C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\step4-entered-aapl.png"

# JavaScript to click scan button
Write-Host "`nStep 7: Clicking scan button..."
$js3 = "document.getElementById('btn-scan').click();"
[System.Windows.Forms.SendKeys]::SendWait($js3)
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Seconds 2

Take-Screenshot "C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\step5-scan-started.png"

# Wait for scan to complete
Write-Host "`nStep 8: Waiting for scan to complete (10 seconds)..."
Start-Sleep -Seconds 10

Take-Screenshot "C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\step6-scan-complete.png"

# Close dev tools to see full chart
Write-Host "`nStep 9: Closing dev tools to see full chart..."
[System.Windows.Forms.SendKeys]::SendWait("{F12}")
Start-Sleep -Seconds 1

Take-Screenshot "C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\step7-final-chart.png"

Write-Host "`n=== Test Complete ==="
Write-Host "Screenshots saved. Check the images to verify:"
Write-Host "1. Candlestick chart showing AAPL data"
Write-Host "2. RSI sub-panel below the main chart"
Write-Host "3. RSI line (purple) oscillating between 0-100"
Write-Host "4. Reference lines at 30 and 70"
