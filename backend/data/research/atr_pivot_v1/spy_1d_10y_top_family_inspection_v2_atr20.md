# Top Family Inspection Report

Grouping version: `v2`
Total unique families: `21`
Inspected families: `12`

## Top 10 By Occurrence

- `family_000008` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=45
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=39
- `family_000016` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=34
- `family_000019` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count=31
- `family_000011` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count=30
- `family_000004` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count=21
- `family_000006` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` count=19
- `family_000012` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT` count=10
- `family_000020` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT` count=9
- `family_000014` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` count=8

## Top 10 By Avg Forward 10-Bar Return

- `family_000006` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` avg10=1.2525816753931074 count=19
- `family_000021` `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM` avg10=1.0775285233443768 count=6
- `family_000011` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` avg10=1.0208454001605043 count=30
- `family_000004` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg10=0.8302331965501312 count=21
- `family_000014` `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM` avg10=0.7492389023028045 count=8
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` avg10=0.7085868929531673 count=39
- `family_000008` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg10=0.706642716193632 count=45
- `family_000019` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg10=0.5630984741740376 count=31
- `family_000016` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg10=0.4684982605090764 count=34
- `family_000012` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT` avg10=0.23754267108118549 count=10

## Top 10 By Split Consistency

- `family_000008` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[1, 1, 9, -121.71832956584903, -75.94297956214146, 45, 0.706642716193632] count=45
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` score=[1, 1, 9, -543.198947137154, -673.328624407973, 39, 0.7085868929531673] count=39
- `family_000019` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` score=[1, 1, 4, -185.3194359485657, -20.621433758460476, 31, 0.5630984741740376] count=31
- `family_000021` `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM` score=[1, 1, 1, -61.666884932648124, -65.37084345165134, 6, 1.0775285233443768] count=6
- `family_000011` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` score=[0, 1, 7, -15.584414869134783, -102.47667777846736, 30, 1.0208454001605043] count=30
- `family_000016` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 5, -519.0788313253054, -119.22122882459864, 34, 0.4684982605090764] count=34
- `family_000006` `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM` score=[0, 1, 4, -174.82352167814042, -21.426225619164782, 18, 1.2525816753931074] count=19
- `family_000004` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` score=[0, 1, 2, -376.49970947608205, -312.09131087261807, 21, 0.8302331965501312] count=21
- `family_000003` `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM` score=[0, 1, 1, -182.88935489306436, -555.2452191453509, 8, 0.6554083941325581] count=8
- `family_000020` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT` score=[0, 1, 1, -429.947651210007, -131.1932346210809, 9, 0.08963152468339555] count=9

## Family Details

### family_000002

- Signature: `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=39 discovery=20 validation=10 holdout=9
- Forward10: avg=0.7085868929531673 median=1.4685516367416969 std=2.9635646819620227
- Hit+1ATR: 0.6153846153846154
- Sign consistent across splits: True
- Exact signatures contained: 11

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=11
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=9
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=9
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-EL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-EH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=2

Representative motifs:
- `motif_000002` entry=2016-04-28 00:00:00-04:00 fwd10=-0.4970579114545315 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000002\family_000002_01_motif_000002.svg
- `motif_000278` entry=2026-02-12 00:00:00-05:00 fwd10=0.5745151722425377 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000002\family_000002_02_motif_000278.svg
- `motif_000094` entry=2020-01-24 00:00:00-05:00 fwd10=1.4685516367416969 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000002\family_000002_03_motif_000094.svg

### family_000003

- Signature: `HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM`
- Counts: total=8 discovery=5 validation=2 holdout=1
- Forward10: avg=-0.6554083941325581 median=-1.6804781762223104 std=2.516640375132225
- Hit+1ATR: 0.5
- Sign consistent across splits: False
- Exact signatures contained: 7

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-HL-HH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-EL-EH-EL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000030` entry=2017-06-27 00:00:00-04:00 fwd10=1.8846532535667222 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000003\family_000003_01_motif_000030.svg
- `motif_000258` entry=2025-08-01 00:00:00-04:00 fwd10=3.909650069527578 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000003\family_000003_02_motif_000258.svg
- `motif_000056` entry=2018-06-19 00:00:00-04:00 fwd10=-2.022430973090778 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000003\family_000003_03_motif_000056.svg

### family_000004

- Signature: `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=21 discovery=17 validation=2 holdout=2
- Forward10: avg=0.8302331965501312 median=1.1215589415231153 std=2.772420016644538
- Hit+1ATR: 0.47619047619047616
- Sign consistent across splits: False
- Exact signatures contained: 16

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-LL-HH-LL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-EH-LL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000008` entry=2016-06-24 00:00:00-04:00 fwd10=4.340527082201019 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000004\family_000004_01_motif_000008.svg
- `motif_000252` entry=2025-04-03 00:00:00-04:00 fwd10=-0.9380295993237271 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000004\family_000004_02_motif_000252.svg
- `motif_000084` entry=2019-08-14 00:00:00-04:00 fwd10=1.1215589415231153 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000004\family_000004_03_motif_000084.svg

### family_000006

- Signature: `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM`
- Counts: total=19 discovery=10 validation=4 holdout=5
- Forward10: avg=1.2525816753931074 median=1.950834153206213 std=2.5323978503482842
- Hit+1ATR: 0.5555555555555556
- Sign consistent across splits: False
- Exact signatures contained: 14

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|LH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:DEEP` count=2
- `HIGH-LOW-HIGH-LOW-HIGH|EH-HL-HH-HL-LH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `HIGH-LOW-HIGH-LOW-HIGH|HH-EL-EH-EL-LH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:DEEP` count=1

Representative motifs:
- `motif_000004` entry=2016-05-13 00:00:00-04:00 fwd10=2.837525999910335 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000006\family_000006_01_motif_000004.svg
- `motif_000280` entry=2026-03-03 00:00:00-05:00 fwd10=None snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000006\family_000006_02_motif_000280.svg
- `motif_000106` entry=2020-06-26 00:00:00-04:00 fwd10=2.1797528313420993 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000006\family_000006_03_motif_000106.svg

### family_000008

- Signature: `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=45 discovery=27 validation=9 holdout=9
- Forward10: avg=0.706642716193632 median=1.485907643605558 std=3.1443198371488723
- Hit+1ATR: 0.6666666666666666
- Sign consistent across splits: True
- Exact signatures contained: 26

Representative exact signatures:
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:OVERDEEP|R4:OVERDEEP` count=5
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=5
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-LH-LL-HH|DOWN-UP-DOWN-UP|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=4
- `HIGH-LOW-HIGH-LOW-HIGH|LH-LL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP` count=3
- `HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-LL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:OVERDEEP|R4:OVERDEEP` count=2

Representative motifs:
- `motif_000006` entry=2016-06-13 00:00:00-04:00 fwd10=-4.483820508453668 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000008\family_000008_01_motif_000006.svg
- `motif_000274` entry=2026-01-20 00:00:00-05:00 fwd10=1.899868512013641 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000008\family_000008_02_motif_000274.svg
- `motif_000146` entry=2021-11-10 00:00:00-05:00 fwd10=1.485907643605558 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000008\family_000008_03_motif_000146.svg

### family_000011

- Signature: `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM`
- Counts: total=30 discovery=16 validation=7 holdout=7
- Forward10: avg=1.0208454001605043 median=1.0778708773920749 std=1.852332532733647
- Hit+1ATR: 0.4666666666666667
- Sign consistent across splits: False
- Exact signatures contained: 14

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:MEDIUM` count=5
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:DEEP` count=5
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:DEEP` count=4
- `LOW-HIGH-LOW-HIGH-LOW|EL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:OVERDEEP|R4:SHALLOW` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-EL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=2

Representative motifs:
- `motif_000001` entry=2016-04-13 00:00:00-04:00 fwd10=0.669530320158037 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000011\family_000011_01_motif_000001.svg
- `motif_000279` entry=2026-02-25 00:00:00-05:00 fwd10=-2.109935379571387 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000011\family_000011_02_motif_000279.svg
- `motif_000089` entry=2019-10-04 00:00:00-04:00 fwd10=0.9825024630383193 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000011\family_000011_03_motif_000089.svg

### family_000012

- Signature: `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT`
- Counts: total=10 discovery=6 validation=1 holdout=3
- Forward10: avg=0.23754267108118549 median=0.8801059392744562 std=2.5999281652792603
- Hit+1ATR: 0.3
- Sign consistent across splits: False
- Exact signatures contained: 4

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:MEDIUM` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:SHALLOW` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:SHALLOW` count=2

Representative motifs:
- `motif_000023` entry=2017-03-15 00:00:00-04:00 fwd10=-1.62825395338509 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000012\family_000012_01_motif_000023.svg
- `motif_000261` entry=2025-08-22 00:00:00-04:00 fwd10=0.6254282732209153 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000012\family_000012_02_motif_000261.svg
- `motif_000137` entry=2021-07-12 00:00:00-04:00 fwd10=1.1347836053279972 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000012\family_000012_03_motif_000137.svg

### family_000014

- Signature: `LTH|MIXED_TRANSITION|LL_ONLY|DEEP_DOM`
- Counts: total=8 discovery=5 validation=3 holdout=0
- Forward10: avg=0.7492389023028045 median=0.776387109353386 std=2.0336677876669818
- Hit+1ATR: 0.75
- Sign consistent across splits: False
- Exact signatures contained: 8

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-EH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-LH-EL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:OVERDEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-LH-LL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:MEDIUM|R4:OVERDEEP` count=1

Representative motifs:
- `motif_000015` entry=2016-10-24 00:00:00-04:00 fwd10=-0.9819136396870062 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000014\family_000014_01_motif_000015.svg
- `motif_000207` entry=2023-10-06 00:00:00-04:00 fwd10=-1.5948112872623212 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000014\family_000014_02_motif_000207.svg
- `motif_000069` entry=2018-10-31 00:00:00-04:00 fwd10=-0.0849459180098581 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000014\family_000014_03_motif_000069.svg

### family_000016

- Signature: `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM`
- Counts: total=34 discovery=23 validation=6 holdout=5
- Forward10: avg=0.4684982605090764 median=0.8626955954124582 std=2.7945548929950568
- Hit+1ATR: 0.5
- Sign consistent across splits: False
- Exact signatures contained: 25

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-LH-LL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:DEEP|R4:OVERDEEP` count=4
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-LH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:MEDIUM|R4:OVERDEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-HL-LH-LL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:OVERDEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-LL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:OVERDEEP` count=2

Representative motifs:
- `motif_000005` entry=2016-05-24 00:00:00-04:00 fwd10=2.197347388636819 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000016\family_000016_01_motif_000005.svg
- `motif_000271` entry=2025-11-25 00:00:00-05:00 fwd10=1.2636113281821248 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000016\family_000016_02_motif_000271.svg
- `motif_000035` entry=2017-08-22 00:00:00-04:00 fwd10=0.8777214686074628 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000016\family_000016_03_motif_000035.svg

### family_000019

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM`
- Counts: total=31 discovery=20 validation=7 holdout=4
- Forward10: avg=0.5630984741740376 median=0.7600745210238833 std=2.3991032963770107
- Hit+1ATR: 0.7096774193548387
- Sign consistent across splits: True
- Exact signatures contained: 23

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=3
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=3
- `LOW-HIGH-LOW-HIGH-LOW|EL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:MEDIUM` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-HH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=2
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:SHALLOW` count=2

Representative motifs:
- `motif_000007` entry=2016-06-20 00:00:00-04:00 fwd10=0.29434575753643655 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000019\family_000019_01_motif_000007.svg
- `motif_000275` entry=2026-01-22 00:00:00-05:00 fwd10=-1.7282974716870507 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000019\family_000019_02_motif_000275.svg
- `motif_000169` entry=2022-07-08 00:00:00-04:00 fwd10=0.7600745210238833 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000019\family_000019_03_motif_000169.svg

### family_000020

- Signature: `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_PRESENT`
- Counts: total=9 discovery=5 validation=1 holdout=3
- Forward10: avg=0.08963152468339555 median=-0.08482497227211047 std=2.0733797839359593
- Hit+1ATR: 0.5555555555555556
- Sign consistent across splits: False
- Exact signatures contained: 5

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:SHALLOW` count=3
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=3
- `LOW-HIGH-LOW-HIGH-LOW|LL-HH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:MEDIUM|R3:OVERDEEP|R4:SHALLOW` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-HL-HH-HL|UP-DOWN-UP-DOWN|R2:SHALLOW|R3:OVERDEEP|R4:MEDIUM` count=1

Representative motifs:
- `motif_000021` entry=2017-02-03 00:00:00-05:00 fwd10=3.8467112421078196 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000020\family_000020_01_motif_000021.svg
- `motif_000257` entry=2025-06-03 00:00:00-04:00 fwd10=0.16229663393417024 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000020\family_000020_02_motif_000257.svg
- `motif_000235` entry=2024-11-06 00:00:00-05:00 fwd10=-0.08482497227211047 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000020\family_000020_03_motif_000235.svg

### family_000021

- Signature: `LTH|REVERSAL_UP|LL_ONLY|DEEP_DOM`
- Counts: total=6 discovery=4 validation=1 holdout=1
- Forward10: avg=1.0775285233443768 median=1.4540888324748606 std=1.4414861009282256
- Hit+1ATR: 0.8333333333333334
- Sign consistent across splits: True
- Exact signatures contained: 6

Representative exact signatures:
- `LOW-HIGH-LOW-HIGH-LOW|EL-LH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-EH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:MEDIUM` count=1
- `LOW-HIGH-LOW-HIGH-LOW|HL-LH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-EH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:OVERDEEP|R4:DEEP` count=1
- `LOW-HIGH-LOW-HIGH-LOW|LL-LH-LL-LH-HL|UP-DOWN-UP-DOWN|R2:OVERDEEP|R3:DEEP|R4:DEEP` count=1

Representative motifs:
- `motif_000027` entry=2017-04-24 00:00:00-04:00 fwd10=1.3971869951980196 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000021\family_000021_01_motif_000027.svg
- `motif_000255` entry=2025-04-23 00:00:00-04:00 fwd10=1.4705575278301066 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000021\family_000021_02_motif_000255.svg
- `motif_000185` entry=2023-01-23 00:00:00-05:00 fwd10=1.4376201371196147 snippet=C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector\backend\data\research\atr_pivot_v1\v2_family_snippets\family_000021\family_000021_03_motif_000185.svg
