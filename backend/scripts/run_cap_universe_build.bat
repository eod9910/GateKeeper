@echo off
echo ============================================================
echo  Building Large/Mid/Small Cap Universe Lists
echo  ~3 hrs at 0.3s per request (10,419 tickers)
echo  Safe to leave running. Checkpoints every 500 tickers.
echo  Resume anytime with --resume flag if interrupted.
echo ============================================================
echo.

cd /d "%~dp0..\..\"
python backend\scripts\build_large_cap_universe.py --top 500 --delay 0.3 --resume

echo.
echo Done! Check backend\data\ for large_cap_500.json etc.
pause
