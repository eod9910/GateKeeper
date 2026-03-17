# Top Family Inspection Report

Grouping version: `v2`
Total unique families: `18`
Inspected families: `12`

## Top 10 By Occurrence

- `family_000014` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=22
- `family_000007` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=21
- `family_000016` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=17
- `family_000004` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=15
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` count=12
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=10
- `family_000013` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` count=8
- `family_000010` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=8
- `family_000012` `LTH|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` count=7
- `family_000006` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` count=7

## Top 10 By Avg Forward 10-Bar Return

- `family_000013` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` avg10=1.6008978076759584 count=8
- `family_000018` `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM` avg10=1.2161206395669408 count=5
- `family_000001` `HTL|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM` avg10=1.1660690395234317 count=6
- `family_000004` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg10=0.8860853298080856 count=15
- `family_000007` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg10=0.16077468369959563 count=21
- `family_000012` `LTH|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` avg10=0.10514540914114309 count=7
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` avg10=0.09195924377823701 count=10
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` avg10=0.07477821964009165 count=12
- `family_000006` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` avg10=0.05979725309883517 count=7
- `family_000014` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg10=-0.06804932471445392 count=22

## Top 10 By Split Consistency

- `family_000013` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` score=[1, 1, 1, -677.9162277196928, -238.77650994998075, 8, 1.6008978076759584] count=8
- `family_000014` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 4, -227.84104369262872, -253.80730806596213, 21, 0.06804932471445392] count=22
- `family_000007` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 4, -941.4997521970363, -3643.123905952444, 21, 0.16077468369959563] count=21
- `family_000004` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 3, -105.80595232110576, -336.22968341511125, 14, 0.8860853298080856] count=15
- `family_000010` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` score=[0, 1, 2, -264.50486619121494, -32.754903968021154, 8, 0.28130662690719577] count=8
- `family_000016` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 2, -1454.5045691948885, -879.134916639732, 17, 0.1547557351925248] count=17
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` score=[0, 1, 1, -338.7040003862427, -380.3641711949799, 12, 0.07477821964009165] count=12
- `family_000006` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` score=[0, 1, 1, -607.3443396919312, -142.93075565832547, 7, 0.05979725309883517] count=7
- `family_000012` `LTH|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` score=[0, 1, 1, -880.0652580951495, -916.5108578081796, 7, 0.10514540914114309] count=7
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` score=[0, 1, 1, -1453.6550854255704, -590.7933123137498, 10, 0.09195924377823701] count=10

## Family Details

### family_000001

- Signature: `HTL|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM`
- Counts: total=6 discovery=5 validation=0 holdout=1
- Forward10: avg=1.1660690395234317 median=1.2702200306966864 std=1.083520229509171
- Hit+1ATR: 0.5
- Sign consistent across splits: False
- Exact signatures contained: 6

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-LH-LL-EH|DOWN-UP-DOWN-UP|R2:SHALLOW|R3:OVERDEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-LH-LL-LH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:OVERDEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-EL-LH-LL-EH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-LH-EL-LH|DOWN-UP-DOWN-UP|R2:SHALLOW|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-LH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000009` entry=2021-08-16 00:00:00-04:00 fwd10=1.7726082108874122 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000001\family_000001_01_motif_000009.svg
- `motif_000121` entry=2025-05-22 00:00:00-04:00 fwd10=2.025801843264486 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000001\family_000001_02_motif_000121.svg
- `motif_000037` entry=2022-06-30 00:00:00-04:00 fwd10=0.7678318505059608 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000001\family_000001_03_motif_000037.svg

### family_000002

- Signature: `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=10 discovery=4 validation=1 holdout=5
- Forward10: avg=0.09195924377823701 median=0.42836613406383306 std=2.575900694895064
- Hit+1ATR: 0.6
- Sign consistent across splits: False
- Exact signatures contained: 8

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-EH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-HH-HL-EH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-EH-EL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000051` entry=2022-12-06 00:00:00-05:00 fwd10=-1.550920337465993 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000002\family_000002_01_motif_000051.svg
- `motif_000137` entry=2025-11-03 00:00:00-05:00 fwd10=-2.9727046271151942 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000002\family_000002_02_motif_000137.svg
- `motif_000135` entry=2025-10-17 00:00:00-04:00 fwd10=0.6157213996092094 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000002\family_000002_03_motif_000135.svg

### family_000003

- Signature: `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM`
- Counts: total=12 discovery=8 validation=3 holdout=1
- Forward10: avg=0.07477821964009165 median=0.3087574158857105 std=2.375420317811064
- Hit+1ATR: 0.3333333333333333
- Sign consistent across splits: False
- Exact signatures contained: 10

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-LH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-EL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-EL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000001` entry=2021-05-04 00:00:00-04:00 fwd10=-0.8363849286229914 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000003\family_000003_01_motif_000001.svg
- `motif_000145` entry=2026-01-26 00:00:00-05:00 fwd10=0.7639303008484518 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000003\family_000003_02_motif_000145.svg
- `motif_000029` entry=2022-04-05 00:00:00-04:00 fwd10=-0.1464154690770308 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000003\family_000003_03_motif_000029.svg

### family_000004

- Signature: `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=15 discovery=7 validation=5 holdout=3
- Forward10: avg=0.8860853298080856 median=1.0232962659170273 std=1.8520500849572732
- Hit+1ATR: 0.5
- Sign consistent across splits: False
- Exact signatures contained: 12

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-EH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-EH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-EH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=1

Representative motifs:
- `motif_000007` entry=2021-07-14 00:00:00-04:00 fwd10=0.48932826541083746 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000004\family_000004_01_motif_000007.svg
- `motif_000149` entry=2026-03-13 00:00:00-04:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000004\family_000004_02_motif_000149.svg
- `motif_000019` entry=2021-12-13 00:00:00-05:00 fwd10=1.2966386364934268 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000004\family_000004_03_motif_000019.svg

### family_000006

- Signature: `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM`
- Counts: total=7 discovery=5 validation=1 holdout=1
- Forward10: avg=0.05979725309883517 median=0.3574332123605653 std=2.757868478709404
- Hit+1ATR: 0.42857142857142855
- Sign consistent across splits: False
- Exact signatures contained: 6

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|EH-EL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-EL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1

Representative motifs:
- `motif_000013` entry=2021-09-30 00:00:00-04:00 fwd10=1.8431978889636613 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000006\family_000006_01_motif_000013.svg
- `motif_000147` entry=2026-02-12 00:00:00-05:00 fwd10=0.3574332123605653 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000006\family_000006_02_motif_000147.svg
- `motif_000031` entry=2022-04-22 00:00:00-04:00 fwd10=-2.2803892523624243 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000006\family_000006_03_motif_000031.svg

### family_000007

- Signature: `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=21 discovery=12 validation=5 holdout=4
- Forward10: avg=0.16077468369959563 median=0.14871846315917134 std=2.191911006923812
- Hit+1ATR: 0.5714285714285714
- Sign consistent across splits: False
- Exact signatures contained: 17

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-LL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:SHALLOW|R3:OVERDEEP|R4:OVERDEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-EH-LL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000003` entry=2021-06-17 00:00:00-04:00 fwd10=1.1274292653799607 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000007\family_000007_01_motif_000003.svg
- `motif_000141` entry=2025-12-16 00:00:00-05:00 fwd10=-0.8901181329510994 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000007\family_000007_02_motif_000141.svg
- `motif_000061` entry=2023-04-25 00:00:00-04:00 fwd10=0.14871846315917134 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000007\family_000007_03_motif_000061.svg

### family_000010

- Signature: `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=8 discovery=4 validation=2 holdout=2
- Forward10: avg=-0.28130662690719577 median=-0.1497554070139035 std=2.6030303746139976
- Hit+1ATR: 0.625
- Sign consistent across splits: False
- Exact signatures contained: 6

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-EL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-EL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-EH-EL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-EL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:DEEP` count=1

Representative motifs:
- `motif_000042` entry=2022-09-09 00:00:00-04:00 fwd10=-5.096026709839588 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000010\family_000010_01_motif_000042.svg
- `motif_000136` entry=2025-10-24 00:00:00-04:00 fwd10=-1.7166145570641003 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000010\family_000010_02_motif_000136.svg
- `motif_000090` entry=2024-03-20 00:00:00-04:00 fwd10=-0.5431684839893639 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000010\family_000010_03_motif_000090.svg

### family_000012

- Signature: `LTH|MIXED_TRANSITION|HH_ONLY|DEEP_DOM`
- Counts: total=7 discovery=5 validation=1 holdout=1
- Forward10: avg=0.10514540914114309 median=0.5132126486921352 std=1.373447989812726
- Hit+1ATR: 0.5714285714285714
- Sign consistent across splits: False
- Exact signatures contained: 7

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|EL-LH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-LH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-LH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-EL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-EL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=1

Representative motifs:
- `motif_000014` entry=2021-10-07 00:00:00-04:00 fwd10=1.1702252430824904 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000012\family_000012_01_motif_000014.svg
- `motif_000146` entry=2026-02-06 00:00:00-05:00 fwd10=-0.9056779327016514 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000012\family_000012_02_motif_000146.svg
- `motif_000084` entry=2024-02-09 00:00:00-05:00 fwd10=0.5132126486921352 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000012\family_000012_03_motif_000084.svg

### family_000013

- Signature: `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM`
- Counts: total=8 discovery=5 validation=1 holdout=2
- Forward10: avg=1.6008978076759584 median=2.2187884477599313 std=2.344167922260912
- Hit+1ATR: 0.625
- Sign consistent across splits: True
- Exact signatures contained: 7

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-LH-EL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-LH-EL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:SHALLOW|R4:DEEP` count=1

Representative motifs:
- `motif_000008` entry=2021-07-20 00:00:00-04:00 fwd10=0.5694996868073633 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000013\family_000013_01_motif_000008.svg
- `motif_000140` entry=2025-11-24 00:00:00-05:00 fwd10=2.248188254300503 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000013\family_000013_02_motif_000140.svg
- `motif_000034` entry=2022-05-17 00:00:00-04:00 fwd10=0.28122317381601125 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000013\family_000013_03_motif_000034.svg

### family_000014

- Signature: `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=22 discovery=13 validation=5 holdout=4
- Forward10: avg=-0.06804932471445392 median=-0.08799460982134459 std=1.7260423560442872
- Hit+1ATR: 0.38095238095238093
- Sign consistent across splits: False
- Exact signatures contained: 18

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-LH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:MEDIUM|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-EH-LL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-EH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000002` entry=2021-05-14 00:00:00-04:00 fwd10=0.9277576571588017 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000014\family_000014_01_motif_000002.svg
- `motif_000148` entry=2026-03-10 00:00:00-04:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000014\family_000014_02_motif_000148.svg
- `motif_000024` entry=2022-01-31 00:00:00-05:00 fwd10=-0.08799460982134459 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000014\family_000014_03_motif_000024.svg

### family_000016

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=17 discovery=10 validation=5 holdout=2
- Forward10: avg=-0.1547557351925248 median=-0.09551945196103084 std=1.5663166929413253
- Hit+1ATR: 0.4117647058823529
- Sign consistent across splits: False
- Exact signatures contained: 16

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000004` entry=2021-06-23 00:00:00-04:00 fwd10=-1.8422879009648356 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000016\family_000016_01_motif_000004.svg
- `motif_000142` entry=2025-12-22 00:00:00-05:00 fwd10=0.4548147223066667 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000016\family_000016_02_motif_000142.svg
- `motif_000012` entry=2021-09-22 00:00:00-04:00 fwd10=-0.09551945196103084 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000016\family_000016_03_motif_000012.svg

### family_000018

- Signature: `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM`
- Counts: total=5 discovery=4 validation=0 holdout=1
- Forward10: avg=1.2161206395669408 median=0.8331899742506028 std=1.2182585921296332
- Hit+1ATR: 0.6
- Sign consistent across splits: False
- Exact signatures contained: 5

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|EL-LH-LL-EH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-EH-EL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-EH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=1

Representative motifs:
- `motif_000010` entry=2021-08-23 00:00:00-04:00 fwd10=1.7604623280008982 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000018\family_000018_01_motif_000010.svg
- `motif_000122` entry=2025-06-03 00:00:00-04:00 fwd10=0.024511864174193137 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000018\family_000018_02_motif_000122.svg
- `motif_000038` entry=2022-07-08 00:00:00-04:00 fwd10=0.8331899742506028 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\iwm_v2_family_snippets\family_000018\family_000018_03_motif_000038.svg
