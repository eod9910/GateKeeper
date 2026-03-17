# Top Family Inspection Report

Grouping version: `v2`
Total unique families: `18`
Inspected families: `11`

## Top 10 By Occurrence

- `family_000008` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=25
- `family_000015` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=22
- `family_000016` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=20
- `family_000005` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=14
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=10
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` count=8
- `family_000014` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` count=7
- `family_000013` `LTH|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` count=5
- `family_000012` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT` count=5
- `family_000007` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` count=5

## Top 10 By Avg Forward 10-Bar Return

- `family_000014` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` avg10=0.8732504089170844 count=7
- `family_000015` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg10=0.7159815959362266 count=22
- `family_000008` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg10=0.5807782950362546 count=25
- `family_000012` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT` avg10=0.528125606500023 count=5
- `family_000005` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg10=0.3086340541133882 count=14
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` avg10=0.23995047332610672 count=10
- `family_000016` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg10=-0.06946494938515925 count=20
- `family_000007` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` avg10=-0.4464485109043913 count=5
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` avg10=-1.9826540417068736 count=8
- `family_000013` `LTH|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` avg10=-2.289622750699087 count=5

## Top 10 By Split Consistency

- `family_000008` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[1, 1, 5, -26.749958929280076, -75.58520141568734, 25, 0.5807782950362546] count=25
- `family_000015` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[1, 1, 4, -240.49004252952773, -619.2201447061087, 21, 0.7159815959362266] count=22
- `family_000016` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 4, -358.7317762357488, -959.9179901914365, 20, 0.06946494938515925] count=20
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` score=[0, 1, 2, -88.87158872341972, -268.36945100071966, 10, 0.23995047332610672] count=10
- `family_000005` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 1, -41.507755887374266, -999999.0, 13, 0.3086340541133882] count=14
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` score=[0, 1, 1, -55.51242687657045, -242.09441136704504, 8, 1.9826540417068736] count=8
- `family_000012` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT` score=[0, 1, 1, -157.1994539655167, -146.9227552102833, 5, 0.528125606500023] count=5
- `family_000013` `LTH|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` score=[0, 0, 0, -8.622083186558397, -999999.0, 5, 2.289622750699087] count=5
- `family_000017` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT` score=[0, 0, 0, -148.14350355908164, -999999.0, 2, 0.2894652352714516] count=2
- `family_000007` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` score=[0, 0, 0, -179.92182544943262, -999999.0, 5, 0.4464485109043913] count=5

## Family Details

### family_000002

- Signature: `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=10 discovery=2 validation=4 holdout=4
- Forward10: avg=0.23995047332610672 median=0.7526465740625866 std=1.9178980749213752
- Hit+1ATR: 0.4
- Sign consistent across splits: False
- Exact signatures contained: 4

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=7
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-EH-EL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-EH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000001` entry=2021-05-11 00:00:00-04:00 fwd10=0.2903575281042097 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000002\family_000002_01_motif_000001.svg
- `motif_000135` entry=2026-02-13 00:00:00-05:00 fwd10=-0.8894086828246863 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000002\family_000002_02_motif_000135.svg
- `motif_000053` entry=2022-12-14 00:00:00-05:00 fwd10=-1.409101219620729 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000002\family_000002_03_motif_000053.svg

### family_000003

- Signature: `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM`
- Counts: total=8 discovery=6 validation=1 holdout=1
- Forward10: avg=-1.9826540417068736 median=-2.123154613224402 std=2.7938623325700678
- Hit+1ATR: 0.5
- Sign consistent across splits: False
- Exact signatures contained: 8

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-LH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-HL-EH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-HL-HH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-EL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000019` entry=2021-11-11 00:00:00-05:00 fwd10=-3.383735058904684 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000003\family_000003_01_motif_000019.svg
- `motif_000115` entry=2025-06-20 00:00:00-04:00 fwd10=4.486112956090621 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000003\family_000003_02_motif_000115.svg
- `motif_000033` entry=2022-04-22 00:00:00-04:00 fwd10=-1.725945457372352 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000003\family_000003_03_motif_000033.svg

### family_000005

- Signature: `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=14 discovery=10 validation=3 holdout=1
- Forward10: avg=0.3086340541133882 median=0.7848651049288515 std=2.010794022889989
- Hit+1ATR: 0.6923076923076923
- Sign consistent across splits: False
- Exact signatures contained: 10

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-EL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-EH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000003` entry=2021-05-19 00:00:00-04:00 fwd10=1.8493327800230699 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000005\family_000005_01_motif_000003.svg
- `motif_000137` entry=2026-03-12 00:00:00-04:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000005\family_000005_02_motif_000137.svg
- `motif_000041` entry=2022-06-30 00:00:00-04:00 fwd10=0.7848651049288515 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000005\family_000005_03_motif_000041.svg

### family_000007

- Signature: `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM`
- Counts: total=5 discovery=4 validation=1 holdout=0
- Forward10: avg=-0.4464485109043913 median=0.07091059277836725 std=2.1833670674743337
- Hit+1ATR: 0.2
- Sign consistent across splits: False
- Exact signatures contained: 4

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-EL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000021` entry=2021-12-17 00:00:00-05:00 fwd10=2.7254677072481703 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000007\family_000007_01_motif_000021.svg
- `motif_000093` entry=2024-08-01 00:00:00-04:00 fwd10=0.5573791466844116 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000007\family_000007_02_motif_000093.svg
- `motif_000073` entry=2023-09-06 00:00:00-04:00 fwd10=0.07091059277836725 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000007\family_000007_03_motif_000073.svg

### family_000008

- Signature: `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=25 discovery=13 validation=5 holdout=7
- Forward10: avg=0.5807782950362546 median=0.7913720191083058 std=1.9456353068804741
- Hit+1ATR: 0.48
- Sign consistent across splits: True
- Exact signatures contained: 19

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:OVERDEEP` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-LL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-LL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000005` entry=2021-06-14 00:00:00-04:00 fwd10=-0.33996101457286504 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000008\family_000008_01_motif_000005.svg
- `motif_000131` entry=2026-01-20 00:00:00-05:00 fwd10=1.469199335361871 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000008\family_000008_02_motif_000131.svg
- `motif_000061` entry=2023-04-26 00:00:00-04:00 fwd10=0.7913720191083058 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000008\family_000008_03_motif_000061.svg

### family_000012

- Signature: `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT`
- Counts: total=5 discovery=1 validation=2 holdout=2
- Forward10: avg=0.528125606500023 median=0.9849020405707224 std=1.7954787624880557
- Hit+1ATR: 0.6
- Sign consistent across splits: False
- Exact signatures contained: 3

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:MEDIUM` count=3
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000052` entry=2022-12-13 00:00:00-05:00 fwd10=-2.4395050319572267 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000012\family_000012_01_motif_000052.svg
- `motif_000118` entry=2025-07-21 00:00:00-04:00 fwd10=-0.389973255832252 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000012\family_000012_02_motif_000118.svg
- `motif_000084` entry=2024-03-12 00:00:00-04:00 fwd10=0.9849020405707224 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000012\family_000012_03_motif_000084.svg

### family_000013

- Signature: `LTH|MIXED_TRANSITION|HH_ONLY|DEEP_DOM`
- Counts: total=5 discovery=4 validation=1 holdout=0
- Forward10: avg=-2.289622750699087 median=-2.4448760790538704 std=2.3294029986759885
- Hit+1ATR: 0.4
- Sign consistent across splits: False
- Exact signatures contained: 5

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|EL-LH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-EL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-LH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000022` entry=2021-12-22 00:00:00-05:00 fwd10=1.087570267460288 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000013\family_000013_01_motif_000022.svg
- `motif_000092` entry=2024-07-26 00:00:00-04:00 fwd10=-2.4448760790538704 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000013\family_000013_02_motif_000092.svg
- `motif_000024` entry=2022-01-12 00:00:00-05:00 fwd10=-5.385080251440342 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000013\family_000013_03_motif_000024.svg

### family_000014

- Signature: `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM`
- Counts: total=7 discovery=6 validation=0 holdout=1
- Forward10: avg=0.8732504089170844 median=1.7092408493698508 std=3.0734424732579813
- Hit+1ATR: 0.5714285714285714
- Sign consistent across splits: False
- Exact signatures contained: 5

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-HL-EH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-LH-EL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-EH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000028` entry=2022-02-25 00:00:00-05:00 fwd10=-1.6732741959501904 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000014\family_000014_01_motif_000028.svg
- `motif_000110` entry=2025-04-08 00:00:00-04:00 fwd10=1.8865612686209041 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000014\family_000014_02_motif_000110.svg
- `motif_000060` entry=2023-03-21 00:00:00-04:00 fwd10=1.7092408493698508 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000014\family_000014_03_motif_000060.svg

### family_000015

- Signature: `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=22 discovery=13 validation=5 holdout=4
- Forward10: avg=0.7159815959362266 median=0.5421486580975725 std=1.684165824986194
- Hit+1ATR: 0.5714285714285714
- Sign consistent across splits: True
- Exact signatures contained: 15

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=5
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-LH-LL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:DEEP|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-EL-HH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000002` entry=2021-05-14 00:00:00-04:00 fwd10=0.5421486580975725 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000015\family_000015_01_motif_000002.svg
- `motif_000136` entry=2026-03-10 00:00:00-04:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000015\family_000015_02_motif_000136.svg
- `motif_000004` entry=2021-05-21 00:00:00-04:00 fwd10=1.1774191539164955 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000015\family_000015_03_motif_000004.svg

### family_000016

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=20 discovery=11 validation=4 holdout=5
- Forward10: avg=-0.06946494938515925 median=-0.45623488412112967 std=2.044776519376377
- Hit+1ATR: 0.5
- Sign consistent across splits: False
- Exact signatures contained: 16

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=2
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-LL-EH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=1

Representative motifs:
- `motif_000008` entry=2021-07-09 00:00:00-04:00 fwd10=0.6151826627422738 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000016\family_000016_01_motif_000008.svg
- `motif_000132` entry=2026-01-22 00:00:00-05:00 fwd10=-0.9078376579738785 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000016\family_000016_02_motif_000132.svg
- `motif_000122` entry=2025-10-01 00:00:00-04:00 fwd10=-0.42338214059791585 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000016\family_000016_03_motif_000122.svg

### family_000017

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT`
- Counts: total=2 discovery=1 validation=1 holdout=0
- Forward10: avg=0.2894652352714516 median=0.2894652352714516 std=0.826943527905397
- Hit+1ATR: 0.5
- Sign consistent across splits: False
- Exact signatures contained: 2

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000082` entry=2024-02-15 00:00:00-05:00 fwd10=1.1164087631768487 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000017\family_000017_01_motif_000082.svg
- `motif_000098` entry=2024-11-06 00:00:00-05:00 fwd10=-0.5374782926339454 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000017\family_000017_02_motif_000098.svg
