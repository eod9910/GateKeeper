# Top Family Inspection Report

Grouping version: `v2`
Total unique families: `23`
Inspected families: `12`

## Top 10 By Occurrence

- `family_000009` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=47
- `family_000017` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=40
- `family_000021` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=38
- `family_000005` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=26
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=23
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` count=15
- `family_000012` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=13
- `family_000007` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` count=12
- `family_000015` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` count=10
- `family_000013` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT` count=9

## Top 10 By Avg Forward 10-Bar Return

- `family_000012` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` avg10=1.649930131176125 count=13
- `family_000023` `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM` avg10=1.3271264274068113 count=7
- `family_000015` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` avg10=1.146229545159922 count=10
- `family_000007` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` avg10=1.0077416129343006 count=12
- `family_000013` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT` avg10=0.8917093171348518 count=9
- `family_000017` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg10=0.6241927563038245 count=40
- `family_000005` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg10=0.5583988831123752 count=26
- `family_000009` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg10=0.45092467819685006 count=47
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` avg10=0.18533591749572814 count=23
- `family_000021` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg10=0.0707182292130707 count=38

## Top 10 By Split Consistency

- `family_000009` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[1, 1, 10, -15.431691841194334, -69.06696731493177, 47, 0.45092467819685006] count=47
- `family_000005` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[1, 1, 4, -63.74203594698685, -62.36342855154995, 25, 0.5583988831123752] count=26
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` score=[1, 1, 2, -42.46366035421785, -55.16978505513773, 23, 0.18533591749572814] count=23
- `family_000015` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` score=[1, 1, 1, -28.379436074115777, -105.2691552222167, 10, 1.146229545159922] count=10
- `family_000023` `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM` score=[1, 1, 1, -42.94238429576667, -6.784744916028777, 7, 1.3271264274068113] count=7
- `family_000021` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 9, -36.69875013420004, -237.86783038753617, 38, 0.0707182292130707] count=38
- `family_000017` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 7, -156.66243562706853, -115.07867741123945, 39, 0.6241927563038245] count=40
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` score=[0, 1, 2, -407.2887096277594, -391.4227423983047, 15, 0.8270162226637368] count=15
- `family_000022` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT` score=[0, 1, 1, -139.37136755212026, -81.04524426128586, 4, 1.2730600989862386] count=4
- `family_000007` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` score=[0, 1, 1, -206.67458459939724, -66.8220550765276, 12, 1.0077416129343006] count=12

## Family Details

### family_000002

- Signature: `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=23 discovery=14 validation=2 holdout=7
- Forward10: avg=0.18533591749572814 median=1.1344672434147256 std=2.8382056737085226
- Hit+1ATR: 0.4782608695652174
- Sign consistent across splits: True
- Exact signatures contained: 12

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=12
- `HIGH-LOW-HIGH-LOW-HIGH|EH-EL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000024` entry=2017-01-30 00:00:00-05:00 fwd10=3.9491367223784377 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000002\family_000002_01_motif_000024.svg
- `motif_000266` entry=2026-02-13 00:00:00-05:00 fwd10=-0.8894086828246863 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000002\family_000002_02_motif_000266.svg
- `motif_000044` entry=2017-11-09 00:00:00-05:00 fwd10=1.1344672434147256 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000002\family_000002_03_motif_000044.svg

### family_000003

- Signature: `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM`
- Counts: total=15 discovery=9 validation=4 holdout=2
- Forward10: avg=-0.8270162226637368 median=-1.7259454570533328 std=3.0098674702697608
- Hit+1ATR: 0.5333333333333333
- Sign consistent across splits: False
- Exact signatures contained: 14

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-LH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-EL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-EL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-EL-HH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000030` entry=2017-05-17 00:00:00-04:00 fwd10=4.1888039389624785 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000003\family_000003_01_motif_000030.svg
- `motif_000246` entry=2025-06-20 00:00:00-04:00 fwd10=4.486112956090621 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000003\family_000003_02_motif_000246.svg
- `motif_000164` entry=2022-04-22 00:00:00-04:00 fwd10=-1.7259454570533328 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000003\family_000003_03_motif_000164.svg

### family_000005

- Signature: `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=26 discovery=17 validation=5 holdout=4
- Forward10: avg=0.5583988831123752 median=1.3204343647122785 std=3.0176215117497946
- Hit+1ATR: 0.64
- Sign consistent across splits: True
- Exact signatures contained: 19

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-EL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000014` entry=2016-09-26 00:00:00-04:00 fwd10=1.4630258591547631 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000005\family_000005_01_motif_000014.svg
- `motif_000268` entry=2026-03-12 00:00:00-04:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000005\family_000005_02_motif_000268.svg
- `motif_000234` entry=2024-12-30 00:00:00-05:00 fwd10=1.3204343647122785 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000005\family_000005_03_motif_000234.svg

### family_000007

- Signature: `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM`
- Counts: total=12 discovery=9 validation=2 holdout=1
- Forward10: avg=1.0077416129343006 median=1.1377916176827747 std=2.0974184078485707
- Hit+1ATR: 0.5
- Sign consistent across splits: False
- Exact signatures contained: 9

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-EL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-EL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000002` entry=2016-05-13 00:00:00-04:00 fwd10=2.1831497030161273 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000007\family_000007_01_motif_000002.svg
- `motif_000224` entry=2024-08-01 00:00:00-04:00 fwd10=0.5573791466844116 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000007\family_000007_02_motif_000224.svg
- `motif_000028` entry=2017-04-07 00:00:00-04:00 fwd10=0.8658741737808283 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000007\family_000007_03_motif_000028.svg

### family_000009

- Signature: `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=47 discovery=25 validation=10 holdout=12
- Forward10: avg=0.45092467819685006 median=0.7970733256677016 std=2.782189979880034
- Hit+1ATR: 0.5319148936170213
- Sign consistent across splits: True
- Exact signatures contained: 29

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:OVERDEEP` count=6
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|HH-LL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|HH-LL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=2

Representative motifs:
- `motif_000004` entry=2016-06-14 00:00:00-04:00 fwd10=-1.8075357144419952 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000009\family_000009_01_motif_000004.svg
- `motif_000262` entry=2026-01-20 00:00:00-05:00 fwd10=1.469199335361871 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000009\family_000009_02_motif_000262.svg
- `motif_000058` entry=2018-04-24 00:00:00-04:00 fwd10=0.7970733256677016 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000009\family_000009_03_motif_000058.svg

### family_000012

- Signature: `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=13 discovery=12 validation=0 holdout=1
- Forward10: avg=1.649930131176125 median=0.9344499738686781 std=2.21978836285745
- Hit+1ATR: 0.5384615384615384
- Sign consistent across splits: False
- Exact signatures contained: 13

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|EL-EH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:SHALLOW` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-EL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-HL-HH-EL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000001` entry=2016-05-10 00:00:00-04:00 fwd10=-1.0782452632398418 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000012\family_000012_01_motif_000001.svg
- `motif_000265` entry=2026-02-03 00:00:00-05:00 fwd10=0.8460252826668097 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000012\family_000012_02_motif_000265.svg
- `motif_000033` entry=2017-07-03 00:00:00-04:00 fwd10=0.9344499738686781 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000012\family_000012_03_motif_000033.svg

### family_000013

- Signature: `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT`
- Counts: total=9 discovery=4 validation=1 holdout=4
- Forward10: avg=0.8917093171348518 median=0.9849020405707224 std=1.7340191782832244
- Hit+1ATR: 0.5555555555555556
- Sign consistent across splits: False
- Exact signatures contained: 5

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:MEDIUM` count=5
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:SHALLOW` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000099` entry=2019-12-05 00:00:00-05:00 fwd10=3.4376953702428743 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000013\family_000013_01_motif_000099.svg
- `motif_000249` entry=2025-07-21 00:00:00-04:00 fwd10=-0.389973255832252 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000013\family_000013_02_motif_000249.svg
- `motif_000215` entry=2024-03-12 00:00:00-04:00 fwd10=0.9849020405707224 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000013\family_000013_03_motif_000215.svg

### family_000015

- Signature: `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM`
- Counts: total=10 discovery=4 validation=5 holdout=1
- Forward10: avg=1.146229545159922 median=1.022488110901646 std=2.847605379343906
- Hit+1ATR: 0.5
- Sign consistent across splits: True
- Exact signatures contained: 8

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-HL-EH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-LH-EL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000017` entry=2016-10-24 00:00:00-04:00 fwd10=0.26137118908872714 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000015\family_000015_01_motif_000017.svg
- `motif_000241` entry=2025-04-08 00:00:00-04:00 fwd10=1.8865612686209041 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000015\family_000015_02_motif_000241.svg
- `motif_000057` entry=2018-04-05 00:00:00-04:00 fwd10=0.33573537243344104 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000015\family_000015_03_motif_000057.svg

### family_000017

- Signature: `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=40 discovery=24 validation=7 holdout=9
- Forward10: avg=0.6241927563038245 median=1.3833498672821347 std=2.6707558398866844
- Hit+1ATR: 0.5897435897435898
- Sign consistent across splits: False
- Exact signatures contained: 25

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=7
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=5
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:OVERDEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-LH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-LH-LL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:DEEP|R4:OVERDEEP` count=2

Representative motifs:
- `motif_000003` entry=2016-05-24 00:00:00-04:00 fwd10=1.8290475625782365 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000017\family_000017_01_motif_000003.svg
- `motif_000267` entry=2026-03-10 00:00:00-04:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000017\family_000017_02_motif_000267.svg
- `motif_000079` entry=2018-12-27 00:00:00-05:00 fwd10=1.3833498672821347 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000017\family_000017_03_motif_000079.svg

### family_000021

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=38 discovery=20 validation=9 holdout=9
- Forward10: avg=0.0707182292130707 median=0.34254298659001137 std=1.9590576593708544
- Hit+1ATR: 0.5789473684210527
- Sign consistent across splits: False
- Exact signatures contained: 25

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=4
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=4
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=4
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=2

Representative motifs:
- `motif_000005` entry=2016-06-20 00:00:00-04:00 fwd10=0.2516536002564036 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000021\family_000021_01_motif_000005.svg
- `motif_000263` entry=2026-01-22 00:00:00-05:00 fwd10=-0.9078376579738785 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000021\family_000021_02_motif_000263.svg
- `motif_000009` entry=2016-08-05 00:00:00-04:00 fwd10=0.5314299268293305 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000021\family_000021_03_motif_000009.svg

### family_000022

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT`
- Counts: total=4 discovery=2 validation=1 holdout=1
- Forward10: avg=-1.2730600989862386 median=-0.6460684578588092 std=2.224529481483958
- Hit+1ATR: 0.25
- Sign consistent across splits: False
- Exact signatures contained: 3

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=2
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000071` entry=2018-10-02 00:00:00-04:00 fwd10=-4.916512243404185 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000022\family_000022_01_motif_000071.svg
- `motif_000229` entry=2024-11-06 00:00:00-05:00 fwd10=-0.5374782926339454 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000022\family_000022_02_motif_000229.svg
- `motif_000113` entry=2020-06-16 00:00:00-04:00 fwd10=-0.754658623083673 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000022\family_000022_03_motif_000113.svg

### family_000023

- Signature: `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM`
- Counts: total=7 discovery=5 validation=1 holdout=1
- Forward10: avg=1.3271264274068113 median=1.7712021598634635 std=0.8152912244224899
- Hit+1ATR: 0.7142857142857143
- Sign consistent across splits: True
- Exact signatures contained: 6

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-EH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-EH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:SHALLOW` count=1

Representative motifs:
- `motif_000015` entry=2016-10-10 00:00:00-04:00 fwd10=-0.5839748261943508 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000023\family_000023_01_motif_000015.svg
- `motif_000243` entry=2025-04-23 00:00:00-04:00 fwd10=1.323172072213298 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000023\family_000023_02_motif_000243.svg
- `motif_000161` entry=2022-03-16 00:00:00-04:00 fwd10=1.7712021598634635 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\dia_v2_family_snippets\family_000023\family_000023_03_motif_000161.svg
