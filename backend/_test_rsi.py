import urllib.request
import json

url = "http://localhost:3002/api/candidates/scan"
body = {
    "symbol": "AAPL",
    "pluginId": "rsi_primitive",
    "interval": "1d",
    "timeframe": "D",
    "period": "2y",
    "skipSave": True,
}
req = urllib.request.Request(
    url,
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json"},
)
resp = urllib.request.urlopen(req, timeout=60)
d = json.loads(resp.read())
cs = d.get("data", {}).get("candidates", [])
print(f"Success={d.get('success')}, Candidates={len(cs)}")
if cs:
    c = cs[0]
    print(f"chart_data bars={len(c.get('chart_data', []))}")
    v = c.get("visual", {})
    os_panels = v.get("overlay_series", [])
    print(f"overlay_series panels={len(os_panels)}")
    if os_panels:
        p = os_panels[0]
        print(f"Panel title={p.get('title')}, height={p.get('height')}")
        print(f"  series_count={len(p.get('series', []))}, hlines={len(p.get('hlines', []))}")
        series_list = p.get("series", [])
        if series_list:
            s = series_list[0]
            print(f"  RSI data points={len(s.get('data', []))}, color={s.get('color')}")
            # Print first 3 data points
            for dp in s.get("data", [])[:3]:
                print(f"    {dp}")
        for hl in p.get("hlines", []):
            print(f"  hline: value={hl.get('value')}, label={hl.get('label')}")
    # Print markers
    markers = v.get("markers", [])
    print(f"markers={len(markers)}")
    if markers:
        print(f"  First marker: {markers[0]}")
else:
    print("No candidates returned")
