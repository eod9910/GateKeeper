@echo off
cd /d "C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector"
python backend\scripts\warmup_cache.py --interval 1d --workers 4 >> backend\data\warmup.log 2>&1
