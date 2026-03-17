@echo off
setlocal

set ROOT=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector
set LOGDIR=%ROOT%\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

cd /d "%ROOT%"
py -u backend\services\build_universe.py --source nasdaq-trader-us --lookback 5y --interval 1d --min-volume 50000 --workers 10 1>> "%LOGDIR%\universe-build-broad.out.log" 2>> "%LOGDIR%\universe-build-broad.err.log"

endlocal
