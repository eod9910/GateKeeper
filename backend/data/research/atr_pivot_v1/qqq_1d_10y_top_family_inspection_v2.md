# Top Family Inspection Report

Grouping version: `v2`
Total unique families: `19`
Inspected families: `13`

## Top 10 By Occurrence

- `family_000007` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=44
- `family_000014` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=42
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=42
- `family_000009` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=31
- `family_000017` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=30
- `family_000004` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=25
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` count=13
- `family_000006` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` count=10
- `family_000010` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT` count=9
- `family_000008` `LTH|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM` count=9

## Top 10 By Avg Forward 10-Bar Return

- `family_000010` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT` avg10=2.0957184186473885 count=9
- `family_000018` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT` avg10=1.5271564000705744 count=8
- `family_000006` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` avg10=1.4824012018714536 count=10
- `family_000019` `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM` avg10=1.4256897747081088 count=6
- `family_000007` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg10=1.3992802160041262 count=44
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` avg10=1.2330058731903504 count=13
- `family_000001` `HTL|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM` avg10=1.224058923633262 count=6
- `family_000009` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` avg10=0.9040729708590797 count=31
- `family_000017` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg10=0.8827201560954097 count=30
- `family_000008` `LTH|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM` avg10=0.6234771088978928 count=9

## Top 10 By Split Consistency

- `family_000007` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[1, 1, 6, -106.79624520341015, -59.850041902570986, 44, 1.3992802160041262] count=44
- `family_000017` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[1, 1, 4, -164.0533504969805, -0.2947541575734827, 30, 0.8827201560954097] count=30
- `family_000018` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT` score=[1, 1, 2, -752.3723566204337, -11.292218337279419, 8, 1.5271564000705744] count=8
- `family_000019` `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM` score=[1, 1, 1, -84.71799788617149, -62.64329310366335, 6, 1.4256897747081088] count=6
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` score=[1, 1, 1, -91.67733278485349, -94.91328903064833, 13, 1.2330058731903504] count=13
- `family_000001` `HTL|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM` score=[1, 1, 1, -445.1461072855911, -575.4211135242947, 6, 1.224058923633262] count=6
- `family_000008` `LTH|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM` score=[1, 1, 1, -15105.142809909794, -14309.475171744762, 8, 0.6234771088978928] count=9
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` score=[0, 1, 8, -124.19855589600317, -99.9795213849049, 42, 0.6027215347899147] count=42
- `family_000014` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 8, -383.3153162645996, -498.08827287222755, 42, 0.11063816014258743] count=42
- `family_000009` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` score=[0, 1, 5, -126.94167641521325, -76.96048162871854, 31, 0.9040729708590797] count=31

## Family Details

### family_000001

- Signature: `HTL|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM`
- Counts: total=6 discovery=4 validation=1 holdout=1
- Forward10: avg=1.224058923633262 median=2.5001330748471884 std=2.5380807463114996
- Hit+1ATR: 0.6666666666666666
- Sign consistent across splits: True
- Exact signatures contained: 6

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-LH-LL-LH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:OVERDEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-EL-EH-LL-EH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-LH-LL-EH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-LH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-LH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000076` entry=2018-11-12 00:00:00-05:00 fwd10=-0.677511431110491 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000001\family_000001_01_motif_000076.svg
- `motif_000264` entry=2025-04-21 00:00:00-04:00 fwd10=3.0609846871019126 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000001\family_000001_02_motif_000264.svg
- `motif_000166` entry=2022-03-07 00:00:00-05:00 fwd10=2.5296832004475753 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000001\family_000001_03_motif_000166.svg

### family_000002

- Signature: `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=42 discovery=24 validation=10 holdout=8
- Forward10: avg=0.6027215347899147 median=1.299602633101887 std=3.2689795541526085
- Hit+1ATR: 0.6428571428571429
- Sign consistent across splits: False
- Exact signatures contained: 19

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=9
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=8
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=5
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-EH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=2

Representative motifs:
- `motif_000022` entry=2017-01-31 00:00:00-05:00 fwd10=3.9520678375878058 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000002\family_000002_01_motif_000022.svg
- `motif_000284` entry=2026-01-29 00:00:00-05:00 fwd10=-3.445459524744076 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000002\family_000002_02_motif_000284.svg
- `motif_000220` entry=2024-02-13 00:00:00-05:00 fwd10=1.252057345742496 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000002\family_000002_03_motif_000220.svg

### family_000003

- Signature: `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM`
- Counts: total=13 discovery=8 validation=1 holdout=4
- Forward10: avg=1.2330058731903504 median=1.6787313620719848 std=2.685484357989422
- Hit+1ATR: 0.6153846153846154
- Sign consistent across splits: True
- Exact signatures contained: 12

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-EL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-EL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-EL-HH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-HL-EH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-EL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000020` entry=2016-12-30 00:00:00-05:00 fwd10=3.671316415060633 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000003\family_000003_01_motif_000020.svg
- `motif_000274` entry=2025-10-13 00:00:00-04:00 fwd10=3.412627277104702 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000003\family_000003_02_motif_000274.svg
- `motif_000034` entry=2017-06-27 00:00:00-04:00 fwd10=1.6787313620719848 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000003\family_000003_03_motif_000034.svg

### family_000004

- Signature: `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=25 discovery=15 validation=4 holdout=6
- Forward10: avg=0.3641856804464893 median=0.7424097769971415 std=2.1991224317376847
- Hit+1ATR: 0.5
- Sign consistent across splits: False
- Exact signatures contained: 15

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=5
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-LL-LH-EL-EH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:OVERDEEP|R4:DEEP` count=2

Representative motifs:
- `motif_000002` entry=2016-05-19 00:00:00-04:00 fwd10=3.5090240981878513 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000004\family_000004_01_motif_000002.svg
- `motif_000288` entry=2026-03-03 00:00:00-05:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000004\family_000004_02_motif_000288.svg
- `motif_000038` entry=2017-08-10 00:00:00-04:00 fwd10=0.8244429432365121 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000004\family_000004_03_motif_000038.svg

### family_000006

- Signature: `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM`
- Counts: total=10 discovery=7 validation=0 holdout=3
- Forward10: avg=1.4824012018714536 median=1.037223520204158 std=2.158520534382354
- Hit+1ATR: 0.4
- Sign consistent across splits: False
- Exact signatures contained: 7

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000006` entry=2016-06-24 00:00:00-04:00 fwd10=4.681007210494678 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000006\family_000006_01_motif_000006.svg
- `motif_000278` entry=2025-11-14 00:00:00-05:00 fwd10=0.8231099464690993 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000006\family_000006_02_motif_000278.svg
- `motif_000140` entry=2021-05-10 00:00:00-04:00 fwd10=1.2513370939392165 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000006\family_000006_03_motif_000140.svg

### family_000007

- Signature: `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=44 discovery=27 validation=11 holdout=6
- Forward10: avg=1.3992802160041262 median=1.4570523521779037 std=2.592722967266719
- Hit+1ATR: 0.7272727272727273
- Sign consistent across splits: True
- Exact signatures contained: 30

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=6
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-EH-LL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=2

Representative motifs:
- `motif_000004` entry=2016-06-10 00:00:00-04:00 fwd10=-4.041033707044501 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000007\family_000007_01_motif_000004.svg
- `motif_000282` entry=2026-01-20 00:00:00-05:00 fwd10=1.0203300541615856 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000007\family_000007_02_motif_000282.svg
- `motif_000122` entry=2020-11-10 00:00:00-05:00 fwd10=1.4855439343909056 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000007\family_000007_03_motif_000122.svg

### family_000008

- Signature: `LTH|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM`
- Counts: total=9 discovery=6 validation=1 holdout=2
- Forward10: avg=0.6234771088978928 median=0.7244252122117936 std=1.702785931461902
- Hit+1ATR: 0.875
- Sign consistent across splits: True
- Exact signatures contained: 5

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-EL-EH-EL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-EL-EH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-EL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000077` entry=2018-11-28 00:00:00-05:00 fwd10=-0.8939299182579241 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000008\family_000008_01_motif_000077.svg
- `motif_000289` entry=2026-03-10 00:00:00-04:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000008\family_000008_02_motif_000289.svg
- `motif_000079` entry=2018-12-28 00:00:00-05:00 fwd10=1.2769356120274284 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000008\family_000008_03_motif_000079.svg

### family_000009

- Signature: `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=31 discovery=18 validation=5 holdout=8
- Forward10: avg=0.9040729708590797 median=1.035306795074662 std=2.379597933852958
- Hit+1ATR: 0.5483870967741935
- Sign consistent across splits: False
- Exact signatures contained: 18

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:DEEP` count=5
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:DEEP` count=5
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=4
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-EL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-EL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=2

Representative motifs:
- `motif_000021` entry=2017-01-05 00:00:00-05:00 fwd10=2.0671451723214527 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000009\family_000009_01_motif_000021.svg
- `motif_000277` entry=2025-11-10 00:00:00-05:00 fwd10=-1.8699180197390515 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000009\family_000009_02_motif_000277.svg
- `motif_000269` entry=2025-08-22 00:00:00-04:00 fwd10=1.035306795074662 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000009\family_000009_03_motif_000269.svg

### family_000010

- Signature: `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT`
- Counts: total=9 discovery=7 validation=2 holdout=0
- Forward10: avg=2.0957184186473885 median=2.279894664391019 std=1.8291015155912267
- Hit+1ATR: 0.5555555555555556
- Sign consistent across splits: False
- Exact signatures contained: 5

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:SHALLOW` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:SHALLOW` count=2
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:SHALLOW` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:SHALLOW` count=1

Representative motifs:
- `motif_000023` entry=2017-02-03 00:00:00-05:00 fwd10=4.296065269450632 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000010\family_000010_01_motif_000023.svg
- `motif_000219` entry=2024-02-02 00:00:00-05:00 fwd10=0.2915966914321324 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000010\family_000010_02_motif_000219.svg
- `motif_000127` entry=2021-01-07 00:00:00-05:00 fwd10=2.279894664391019 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000010\family_000010_03_motif_000127.svg

### family_000014

- Signature: `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=42 discovery=25 validation=8 holdout=9
- Forward10: avg=0.11063816014258743 median=0.8557035710595609 std=2.871968246899449
- Hit+1ATR: 0.5238095238095238
- Sign consistent across splits: False
- Exact signatures contained: 30

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-LH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:MEDIUM|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=2

Representative motifs:
- `motif_000001` entry=2016-05-10 00:00:00-04:00 fwd10=0.8822163032281105 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000014\family_000014_01_motif_000001.svg
- `motif_000287` entry=2026-02-25 00:00:00-05:00 fwd10=-0.9096920436827155 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000014\family_000014_02_motif_000287.svg
- `motif_000251` entry=2025-01-06 00:00:00-05:00 fwd10=0.8291908388910113 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000014\family_000014_03_motif_000251.svg

### family_000017

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=30 discovery=19 validation=7 holdout=4
- Forward10: avg=0.8827201560954097 median=1.2235929826265606 std=1.7085727338827368
- Hit+1ATR: 0.5666666666666667
- Sign consistent across splits: True
- Exact signatures contained: 22

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=4
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=2
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=2

Representative motifs:
- `motif_000005` entry=2016-06-23 00:00:00-04:00 fwd10=1.3129644387102857 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000017\family_000017_01_motif_000005.svg
- `motif_000283` entry=2026-01-23 00:00:00-05:00 fwd10=-1.5738957036323726 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000017\family_000017_02_motif_000283.svg
- `motif_000009` entry=2016-09-06 00:00:00-04:00 fwd10=-0.6547753473877284 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000017\family_000017_03_motif_000009.svg

### family_000018

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT`
- Counts: total=8 discovery=3 validation=3 holdout=2
- Forward10: avg=1.5271564000705744 median=1.5255528152403173 std=1.7664125734152163
- Hit+1ATR: 0.75
- Sign consistent across splits: True
- Exact signatures contained: 5

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=3
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:SHALLOW` count=2
- `LOW-HIGH-LOW-HIGH-LOW|LL-EH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:SHALLOW` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:SHALLOW` count=1

Representative motifs:
- `motif_000083` entry=2019-04-01 00:00:00-04:00 fwd10=1.6751369480306644 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000018\family_000018_01_motif_000083.svg
- `motif_000267` entry=2025-08-05 00:00:00-04:00 fwd10=1.3759686824499704 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000018\family_000018_02_motif_000267.svg
- `motif_000109` entry=2020-06-16 00:00:00-04:00 fwd10=0.930493971234367 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000018\family_000018_03_motif_000109.svg

### family_000019

- Signature: `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM`
- Counts: total=6 discovery=3 validation=2 holdout=1
- Forward10: avg=1.4256897747081088 median=1.7422445630263252 std=1.4974411165361385
- Hit+1ATR: 1.0
- Sign consistent across splits: True
- Exact signatures contained: 6

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|EL-EH-LL-EH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-EH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-EH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-EH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=1

Representative motifs:
- `motif_000017` entry=2016-11-17 00:00:00-05:00 fwd10=-1.3171411330363059 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000019\family_000019_01_motif_000017.svg
- `motif_000265` entry=2025-04-23 00:00:00-04:00 fwd10=1.6720441164878017 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000019\family_000019_02_motif_000265.svg
- `motif_000123` entry=2020-11-17 00:00:00-05:00 fwd10=1.8124450095648488 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000019\family_000019_03_motif_000123.svg
