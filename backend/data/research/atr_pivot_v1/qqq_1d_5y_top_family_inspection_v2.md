# Top Family Inspection Report

Grouping version: `v2`
Total unique families: `18`
Inspected families: `11`

## Top 10 By Occurrence

- `family_000013` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=26
- `family_000007` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=25
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=19
- `family_000016` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=15
- `family_000009` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=14
- `family_000004` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=14
- `family_000008` `LTH|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM` count=6
- `family_000017` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT` count=5
- `family_000006` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` count=5
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` count=5

## Top 10 By Avg Forward 10-Bar Return

- `family_000017` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT` avg10=2.2018858344389978 count=5
- `family_000007` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg10=1.5522320260288365 count=25
- `family_000006` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` avg10=1.1101496812398726 count=5
- `family_000016` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg10=1.059054699019122 count=15
- `family_000008` `LTH|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM` avg10=0.8865792725856323 count=6
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` avg10=0.6716344914388841 count=5
- `family_000004` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg10=0.26803300013006426 count=14
- `family_000009` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` avg10=-0.10026424786425074 count=14
- `family_000013` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg10=-0.15463795709443923 count=26
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` avg10=-0.2278096272154319 count=19

## Top 10 By Split Consistency

- `family_000007` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[1, 1, 3, -57.244667092892534, -42.051847066907385, 25, 1.5522320260288365] count=25
- `family_000006` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` score=[1, 1, 1, -62.88365396270474, -546.3744709055412, 5, 1.1101496812398726] count=5
- `family_000017` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT` score=[1, 1, 1, -65.15824925733715, -61.48050302253535, 5, 2.2018858344389978] count=5
- `family_000013` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 4, -624.8458275395597, -740.7198643347701, 26, 0.15463795709443923] count=26
- `family_000009` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` score=[0, 1, 3, -86.61507389599647, -255.41055249457548, 14, 0.10026424786425074] count=14
- `family_000004` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 3, -845.707293331592, -36.585396528746, 13, 0.26803300013006426] count=14
- `family_000016` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 2, -49.71311674002529, -144.04160776673913, 15, 1.059054699019122] count=15
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` score=[0, 1, 2, -358.35190899484627, -674.8116574894541, 19, 0.2278096272154319] count=19
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` score=[0, 1, 1, -300.31950984667395, -29.68844541588817, 5, 0.6716344914388841] count=5
- `family_000018` `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM` score=[0, 0, 0, -999999.0, -11.950489413812377, 3, 1.823335856634807] count=3

## Family Details

### family_000002

- Signature: `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=19 discovery=11 validation=6 holdout=2
- Forward10: avg=-0.2278096272154319 median=0.40444776219852263 std=2.606453846543653
- Hit+1ATR: 0.6842105263157895
- Sign consistent across splits: False
- Exact signatures contained: 10

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-EH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-EL-EH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-EL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:OVERDEEP` count=2

Representative motifs:
- `motif_000011` entry=2021-09-13 00:00:00-04:00 fwd10=-1.4919402632357293 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000002\family_000002_01_motif_000011.svg
- `motif_000145` entry=2026-01-29 00:00:00-05:00 fwd10=-3.445459524744076 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000002\family_000002_02_motif_000145.svg
- `motif_000109` entry=2024-12-18 00:00:00-05:00 fwd10=0.40444776219852263 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000002\family_000002_03_motif_000109.svg

### family_000003

- Signature: `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM`
- Counts: total=5 discovery=1 validation=1 holdout=3
- Forward10: avg=0.6716344914388841 median=2.8618129431671675 std=3.5720802323272944
- Hit+1ATR: 0.4
- Sign consistent across splits: False
- Exact signatures contained: 4

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-EL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|LH-EL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-EH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000041` entry=2022-07-26 00:00:00-04:00 fwd10=3.0359063280411376 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000003\family_000003_01_motif_000041.svg
- `motif_000135` entry=2025-10-13 00:00:00-04:00 fwd10=3.412627277104702 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000003\family_000003_02_motif_000135.svg
- `motif_000133` entry=2025-09-25 00:00:00-04:00 fwd10=2.8618129431671675 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000003\family_000003_03_motif_000133.svg

### family_000004

- Signature: `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=14 discovery=8 validation=3 holdout=3
- Forward10: avg=0.26803300013006426 median=0.5933537178554451 std=1.8268468269521694
- Hit+1ATR: 0.46153846153846156
- Sign consistent across splits: False
- Exact signatures contained: 11

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|LH-EL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1

Representative motifs:
- `motif_000019` entry=2021-12-14 00:00:00-05:00 fwd10=1.9474739094195446 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000004\family_000004_01_motif_000019.svg
- `motif_000149` entry=2026-03-03 00:00:00-05:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000004\family_000004_02_motif_000149.svg
- `motif_000147` entry=2026-02-13 00:00:00-05:00 fwd10=0.5933537178554451 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000004\family_000004_03_motif_000147.svg

### family_000006

- Signature: `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM`
- Counts: total=5 discovery=2 validation=1 holdout=2
- Forward10: avg=1.1101496812398726 median=0.8231099464690993 std=1.5091804180684094
- Hit+1ATR: 0.2
- Sign consistent across splits: True
- Exact signatures contained: 4

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=1

Representative motifs:
- `motif_000001` entry=2021-05-10 00:00:00-04:00 fwd10=1.2670393706915006 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000006\family_000006_01_motif_000001.svg
- `motif_000139` entry=2025-11-14 00:00:00-05:00 fwd10=0.8231099464690993 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000006\family_000006_02_motif_000139.svg
- `motif_000013` entry=2021-09-28 00:00:00-04:00 fwd10=-0.5413874521482663 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000006\family_000006_03_motif_000013.svg

### family_000007

- Signature: `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=25 discovery=18 validation=4 holdout=3
- Forward10: avg=1.5522320260288365 median=1.2832565951208288 std=2.2265674060058305
- Hit+1ATR: 0.68
- Sign consistent across splits: True
- Exact signatures contained: 19

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-EH-LL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000003` entry=2021-07-08 00:00:00-04:00 fwd10=1.3212034358141818 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000007\family_000007_01_motif_000003.svg
- `motif_000143` entry=2026-01-20 00:00:00-05:00 fwd10=1.0203300541615856 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000007\family_000007_02_motif_000143.svg
- `motif_000051` entry=2022-11-29 00:00:00-05:00 fwd10=1.2832565951208288 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000007\family_000007_03_motif_000051.svg

### family_000008

- Signature: `LTH|CONTINUATION_DOWN|LL_ONLY|DEEP_DOM`
- Counts: total=6 discovery=4 validation=0 holdout=2
- Forward10: avg=0.8865792725856323 median=2.3787103120139275 std=1.9958098659319776
- Hit+1ATR: 0.8
- Sign consistent across splits: False
- Exact signatures contained: 4

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-EL-EH-EL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-EL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000026` entry=2022-02-25 00:00:00-05:00 fwd10=-2.030078671060468 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000008\family_000008_01_motif_000026.svg
- `motif_000150` entry=2026-03-10 00:00:00-04:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000008\family_000008_02_motif_000150.svg
- `motif_000124` entry=2025-04-08 00:00:00-04:00 fwd10=2.3787103120139275 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000008\family_000008_03_motif_000124.svg

### family_000009

- Signature: `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=14 discovery=6 validation=5 holdout=3
- Forward10: avg=-0.10026424786425074 median=-0.07919456334098252 std=2.3243708243265035
- Hit+1ATR: 0.42857142857142855
- Sign consistent across splits: False
- Exact signatures contained: 10

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:DEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-EL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-EL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-HH-EL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1

Representative motifs:
- `motif_000012` entry=2021-09-22 00:00:00-04:00 fwd10=-2.155383285092421 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000009\family_000009_01_motif_000012.svg
- `motif_000138` entry=2025-11-10 00:00:00-05:00 fwd10=-1.8699180197390515 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000009\family_000009_02_motif_000138.svg
- `motif_000084` entry=2024-03-07 00:00:00-05:00 fwd10=0.175196546654645 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000009\family_000009_03_motif_000084.svg

### family_000013

- Signature: `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=26 discovery=17 validation=5 holdout=4
- Forward10: avg=-0.15463795709443923 median=-0.2167449818836837 std=2.713800779919147
- Hit+1ATR: 0.4230769230769231
- Sign consistent across splits: False
- Exact signatures contained: 20

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-EL-EH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:OVERDEEP` count=2

Representative motifs:
- `motif_000002` entry=2021-05-20 00:00:00-04:00 fwd10=1.1497626815923763 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000013\family_000013_01_motif_000002.svg
- `motif_000148` entry=2026-02-25 00:00:00-05:00 fwd10=-0.9096920436827155 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000013\family_000013_02_motif_000148.svg
- `motif_000032` entry=2022-05-17 00:00:00-04:00 fwd10=-0.016518716127863115 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000013\family_000013_03_motif_000032.svg

### family_000016

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=15 discovery=11 validation=2 holdout=2
- Forward10: avg=1.059054699019122 median=1.1342215265428355 std=2.0539763914500018
- Hit+1ATR: 0.4666666666666667
- Sign consistent across splits: False
- Exact signatures contained: 13

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=3
- `LOW-HIGH-LOW-HIGH-LOW|EL-EH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|EL-EH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=1

Representative motifs:
- `motif_000004` entry=2021-07-12 00:00:00-04:00 fwd10=1.6022606127014156 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000016\family_000016_01_motif_000004.svg
- `motif_000144` entry=2026-01-23 00:00:00-05:00 fwd10=-1.5738957036323726 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000016\family_000016_02_motif_000144.svg
- `motif_000062` entry=2023-04-27 00:00:00-04:00 fwd10=1.1342215265428355 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000016\family_000016_03_motif_000062.svg

### family_000017

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT`
- Counts: total=5 discovery=2 validation=2 holdout=1
- Forward10: avg=2.2018858344389978 median=3.150869793654841 std=1.6584379239648486
- Hit+1ATR: 0.8
- Sign consistent across splits: True
- Exact signatures contained: 4

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:SHALLOW` count=2
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:SHALLOW` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:SHALLOW` count=1

Representative motifs:
- `motif_000064` entry=2023-05-25 00:00:00-04:00 fwd10=3.244881741503754 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000017\family_000017_01_motif_000064.svg
- `motif_000128` entry=2025-08-05 00:00:00-04:00 fwd10=1.3759686824499704 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000017\family_000017_02_motif_000128.svg
- `motif_000092` entry=2024-06-28 00:00:00-04:00 fwd10=3.150869793654841 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000017\family_000017_03_motif_000092.svg

### family_000018

- Signature: `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM`
- Counts: total=3 discovery=2 validation=0 holdout=1
- Forward10: avg=1.823335856634807 median=1.6720441164878017 std=1.1480450762124395
- Hit+1ATR: 1.0
- Sign consistent across splits: False
- Exact signatures contained: 3

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-EH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-EH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000040` entry=2022-07-18 00:00:00-04:00 fwd10=3.2989261372282086 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000018\family_000018_01_motif_000040.svg
- `motif_000126` entry=2025-04-23 00:00:00-04:00 fwd10=1.6720441164878017 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000018\family_000018_02_motif_000126.svg
- `motif_000050` entry=2022-11-10 00:00:00-05:00 fwd10=0.49903731618841096 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\qqq_v2_family_snippets\family_000018\family_000018_03_motif_000050.svg
