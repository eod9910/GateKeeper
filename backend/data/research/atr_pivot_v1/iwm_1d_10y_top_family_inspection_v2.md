# Top Family Inspection Report

Grouping version: `v2`
Total unique families: `20`
Inspected families: `13`

## Top 10 By Occurrence

- `family_000009` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=45
- `family_000016` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=42
- `family_000018` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=37
- `family_000006` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=31
- `family_000003` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=19
- `family_000004` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` count=18
- `family_000008` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` count=14
- `family_000015` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` count=13
- `family_000012` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=11
- `family_000014` `LTH|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` count=10

## Top 10 By Avg Forward 10-Bar Return

- `family_000015` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` avg10=1.85939208034717 count=13
- `family_000001` `HTL|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM` avg10=1.1660981567681434 count=6
- `family_000008` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` avg10=1.1655973722261679 count=14
- `family_000019` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT` avg10=0.7001339754873341 count=5
- `family_000020` `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM` avg10=0.5240437939033297 count=8
- `family_000003` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` avg10=0.3780635607152964 count=19
- `family_000012` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` avg10=0.3746818661000436 count=11
- `family_000006` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg10=0.2902778964771969 count=31
- `family_000009` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg10=0.2881017583067949 count=45
- `family_000016` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg10=0.09558347993563177 count=42

## Top 10 By Split Consistency

- `family_000009` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[1, 1, 7, -465.9365608134953, -227.78129713272338, 45, 0.2881017583067949] count=45
- `family_000004` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` score=[1, 1, 4, -71.30855260095214, -67.44239361247874, 18, 0.19911954867691783] count=18
- `family_000015` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` score=[1, 1, 3, -53.69897086090387, -82.08169639346112, 13, 1.85939208034717] count=13
- `family_000001` `HTL|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM` score=[1, 1, 1, -130.68814081634878, -210.29240330437813, 6, 1.1660981567681434] count=6
- `family_000016` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 7, -1035.0726894014547, -1434.2155158303526, 41, 0.09558347993563177] count=42
- `family_000018` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 6, -1557.3154490105915, -1437.3752879760577, 37, 0.028589618447891485] count=37
- `family_000003` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` score=[0, 1, 5, -203.1930035345748, -29.61969692133744, 19, 0.3780635607152964] count=19
- `family_000006` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 4, -306.6851594883391, -1080.4093864428073, 30, 0.2902778964771969] count=31
- `family_000012` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` score=[0, 1, 3, -146.36595830306234, -58.0415042597317, 11, 0.3746818661000436] count=11
- `family_000008` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` score=[0, 1, 2, -172.28502180981164, -33.332638133064975, 14, 1.1655973722261679] count=14

## Family Details

### family_000001

- Signature: `HTL|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM`
- Counts: total=6 discovery=3 validation=2 holdout=1
- Forward10: avg=1.1660981567681434 median=1.2703073824353817 std=1.0835365307636124
- Hit+1ATR: 0.5
- Sign consistent across splits: True
- Exact signatures contained: 6

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-LH-LL-EH|DOWN-UP-DOWN-UP|R2:SHALLOW|R3:OVERDEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-LH-LL-LH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:OVERDEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-EL-LH-LL-EH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-LH-EL-LH|DOWN-UP-DOWN-UP|R2:SHALLOW|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-LH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000138` entry=2021-08-16 00:00:00-04:00 fwd10=1.7727829143601732 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000001\family_000001_01_motif_000138.svg
- `motif_000250` entry=2025-05-22 00:00:00-04:00 fwd10=2.025801843264486 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000001\family_000001_02_motif_000250.svg
- `motif_000166` entry=2022-06-30 00:00:00-04:00 fwd10=0.7678318505105902 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000001\family_000001_03_motif_000166.svg

### family_000003

- Signature: `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=19 discovery=9 validation=5 holdout=5
- Forward10: avg=0.3780635607152964 median=0.24101086851845674 std=2.4834779649191345
- Hit+1ATR: 0.42105263157894735
- Sign consistent across splits: False
- Exact signatures contained: 11

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-EH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000002` entry=2016-06-10 00:00:00-04:00 fwd10=-2.5137381287947864 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000003\family_000003_01_motif_000002.svg
- `motif_000266` entry=2025-11-03 00:00:00-05:00 fwd10=-2.9727046271151942 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000003\family_000003_02_motif_000266.svg
- `motif_000218` entry=2024-03-12 00:00:00-04:00 fwd10=0.24101086851845674 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000003\family_000003_03_motif_000218.svg

### family_000004

- Signature: `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM`
- Counts: total=18 discovery=10 validation=4 holdout=4
- Forward10: avg=-0.19911954867691783 median=-0.21500956400004936 std=2.3547435583755956
- Hit+1ATR: 0.4444444444444444
- Sign consistent across splits: True
- Exact signatures contained: 12

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|LH-EL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-LH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000028` entry=2017-06-16 00:00:00-04:00 fwd10=0.45131121680936226 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000004\family_000004_01_motif_000028.svg
- `motif_000274` entry=2026-01-26 00:00:00-05:00 fwd10=0.7639303008484518 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000004\family_000004_02_motif_000274.svg
- `motif_000158` entry=2022-04-05 00:00:00-04:00 fwd10=-0.14641546915259412 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000004\family_000004_03_motif_000158.svg

### family_000006

- Signature: `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=31 discovery=20 validation=4 holdout=7
- Forward10: avg=0.2902778964771969 median=1.3059286751160433 std=3.7115674329487685
- Hit+1ATR: 0.5666666666666667
- Sign consistent across splits: False
- Exact signatures contained: 21

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=5
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-EH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:DEEP` count=2

Representative motifs:
- `motif_000016` entry=2017-01-30 00:00:00-05:00 fwd10=2.276683248371035 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000006\family_000006_01_motif_000016.svg
- `motif_000278` entry=2026-03-13 00:00:00-04:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000006\family_000006_02_motif_000278.svg
- `motif_000148` entry=2021-12-13 00:00:00-05:00 fwd10=1.2966388256614498 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000006\family_000006_03_motif_000148.svg

### family_000008

- Signature: `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM`
- Counts: total=14 discovery=9 validation=3 holdout=2
- Forward10: avg=1.1655973722261679 median=1.9499034307393708 std=2.4068179650215646
- Hit+1ATR: 0.42857142857142855
- Sign consistent across splits: False
- Exact signatures contained: 12

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|EH-EL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-EL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=1

Representative motifs:
- `motif_000004` entry=2016-06-24 00:00:00-04:00 fwd10=3.54856534932054 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000008\family_000008_01_motif_000004.svg
- `motif_000276` entry=2026-02-12 00:00:00-05:00 fwd10=0.3574332123605653 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000008\family_000008_02_motif_000276.svg
- `motif_000142` entry=2021-09-30 00:00:00-04:00 fwd10=1.8432137137216025 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000008\family_000008_03_motif_000142.svg

### family_000009

- Signature: `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=45 discovery=29 validation=7 holdout=9
- Forward10: avg=0.2881017583067949 median=0.09240426462889216 std=2.191935384607457
- Hit+1ATR: 0.5333333333333333
- Sign consistent across splits: True
- Exact signatures contained: 29

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|HH-LL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:SHALLOW|R3:OVERDEEP|R4:OVERDEEP` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=2

Representative motifs:
- `motif_000006` entry=2016-09-09 00:00:00-04:00 fwd10=2.559502370825685 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000009\family_000009_01_motif_000006.svg
- `motif_000270` entry=2025-12-16 00:00:00-05:00 fwd10=-0.8901181329510994 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000009\family_000009_02_motif_000270.svg
- `motif_000018` entry=2017-03-06 00:00:00-05:00 fwd10=0.09240426462889216 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000009\family_000009_03_motif_000018.svg

### family_000012

- Signature: `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=11 discovery=3 validation=5 holdout=3
- Forward10: avg=0.3746818661000436 median=0.24365766996155694 std=2.7406297804402544
- Hit+1ATR: 0.7272727272727273
- Sign consistent across splits: False
- Exact signatures contained: 8

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-EL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-EL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:SHALLOW` count=1

Representative motifs:
- `motif_000001` entry=2016-05-23 00:00:00-04:00 fwd10=4.250607233456488 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000012\family_000012_01_motif_000001.svg
- `motif_000265` entry=2025-10-24 00:00:00-04:00 fwd10=-1.7166145570641003 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000012\family_000012_02_motif_000265.svg
- `motif_000263` entry=2025-10-14 00:00:00-04:00 fwd10=0.24365766996155694 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000012\family_000012_03_motif_000263.svg

### family_000014

- Signature: `LTH|MIXED_TRANSITION|HH_ONLY|DEEP_DOM`
- Counts: total=10 discovery=6 validation=2 holdout=2
- Forward10: avg=-0.016875578045701868 median=0.4284471592729603 std=1.343865825986076
- Hit+1ATR: 0.5
- Sign consistent across splits: False
- Exact signatures contained: 9

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=2
- `LOW-HIGH-LOW-HIGH-LOW|EL-LH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-LH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-LH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:MEDIUM|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-LH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:DEEP|R4:DEEP` count=1

Representative motifs:
- `motif_000027` entry=2017-06-01 00:00:00-04:00 fwd10=0.9422018052644944 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000014\family_000014_01_motif_000027.svg
- `motif_000275` entry=2026-02-06 00:00:00-05:00 fwd10=-0.9056779327016514 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000014\family_000014_02_motif_000275.svg
- `motif_000215` entry=2024-02-15 00:00:00-05:00 fwd10=0.3436816698537854 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000014\family_000014_03_motif_000215.svg

### family_000015

- Signature: `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM`
- Counts: total=13 discovery=7 validation=3 holdout=3
- Forward10: avg=1.85939208034717 median=2.248188254300503 std=1.955404310885944
- Hit+1ATR: 0.6923076923076923
- Sign consistent across splits: True
- Exact signatures contained: 12

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-HL-EH-LL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:DEEP|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-EH-EL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000017` entry=2017-02-01 00:00:00-05:00 fwd10=2.450787794848837 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000015\family_000015_01_motif_000017.svg
- `motif_000269` entry=2025-11-24 00:00:00-05:00 fwd10=2.248188254300503 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000015\family_000015_02_motif_000269.svg
- `motif_000055` entry=2018-08-07 00:00:00-04:00 fwd10=1.5921118559229774 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000015\family_000015_03_motif_000055.svg

### family_000016

- Signature: `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=42 discovery=27 validation=7 holdout=8
- Forward10: avg=0.09558347993563177 median=0.3288312966597426 std=3.081779839155569
- Hit+1ATR: 0.4878048780487805
- Sign consistent across splits: False
- Exact signatures contained: 26

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=4
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-LH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=2

Representative motifs:
- `motif_000005` entry=2016-06-29 00:00:00-04:00 fwd10=3.5014775292127784 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000016\family_000016_01_motif_000005.svg
- `motif_000277` entry=2026-03-10 00:00:00-04:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000016\family_000016_02_motif_000277.svg
- `motif_000189` entry=2023-03-30 00:00:00-04:00 fwd10=0.3288312966597426 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000016\family_000016_03_motif_000189.svg

### family_000018

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=37 discovery=24 validation=6 holdout=7
- Forward10: avg=0.028589618447891485 median=0.10514945879940324 std=1.8817327570234856
- Hit+1ATR: 0.43243243243243246
- Sign consistent across splits: False
- Exact signatures contained: 26

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=4
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=2

Representative motifs:
- `motif_000007` entry=2016-09-19 00:00:00-04:00 fwd10=0.9778538122069784 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000018\family_000018_01_motif_000007.svg
- `motif_000271` entry=2025-12-22 00:00:00-05:00 fwd10=0.4548147223066667 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000018\family_000018_02_motif_000271.svg
- `motif_000157` entry=2022-03-17 00:00:00-04:00 fwd10=0.10514945879940324 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000018\family_000018_03_motif_000157.svg

### family_000019

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT`
- Counts: total=5 discovery=3 validation=0 holdout=2
- Forward10: avg=0.7001339754873341 median=1.2047336960993298 std=1.6813674702331147
- Hit+1ATR: 0.8
- Sign consistent across splits: False
- Exact signatures contained: 5

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-EH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:SHALLOW` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000013` entry=2017-01-04 00:00:00-05:00 fwd10=-2.3035493209532056 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000019\family_000019_01_motif_000013.svg
- `motif_000261` entry=2025-10-02 00:00:00-04:00 fwd10=0.32021365181730704 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000019\family_000019_02_motif_000261.svg
- `motif_000115` entry=2020-11-16 00:00:00-05:00 fwd10=1.2047336960993298 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000019\family_000019_03_motif_000115.svg

### family_000020

- Signature: `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM`
- Counts: total=8 discovery=4 validation=3 holdout=1
- Forward10: avg=0.5240437939033297 median=0.5814740254635237 std=1.6958266922478558
- Hit+1ATR: 0.625
- Sign consistent across splits: False
- Exact signatures contained: 6

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|EL-LH-LL-EH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-EH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-EH-EL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:DEEP` count=1

Representative motifs:
- `motif_000023` entry=2017-04-20 00:00:00-04:00 fwd10=0.32975807667286366 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000020\family_000020_01_motif_000023.svg
- `motif_000251` entry=2025-06-03 00:00:00-04:00 fwd10=0.024511864174193137 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000020\family_000020_02_motif_000251.svg
- `motif_000061` entry=2018-11-28 00:00:00-05:00 fwd10=-3.0862960180816406 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000020\family_000020_03_motif_000061.svg
