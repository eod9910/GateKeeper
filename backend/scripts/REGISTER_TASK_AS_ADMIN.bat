
@echo off
:: Right-click this file and choose "Run as administrator"
:: It registers the nightly 4am cache warmup with Task Scheduler.

echo Registering PatternDetector-CacheWarmup scheduled task...

schtasks /Delete /TN "PatternDetector-CacheWarmup" /F >nul 2>&1

schtasks /Create ^
  /TN "PatternDetector-CacheWarmup" ^
  /TR "\"C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\scripts\warmup_cache.bat\"" ^
  /SC DAILY ^
  /ST 04:00 ^
  /RU "%USERNAME%" ^
  /RL HIGHEST ^
  /F

if %ERRORLEVEL% EQU 0 (
    echo.
    echo SUCCESS - Task registered. It will run every day at 4:00 AM.
    echo.
    echo To run it right now for a test:
    echo   schtasks /Run /TN "PatternDetector-CacheWarmup"
    echo.
    echo To view the log after it runs:
    echo   type "C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\warmup.log"
) else (
    echo.
    echo FAILED - Could not register task. Make sure you ran this as Administrator.
)

pause
