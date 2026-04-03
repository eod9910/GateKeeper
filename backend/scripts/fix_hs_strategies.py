import os, json

dir_ = os.path.join(os.path.dirname(__file__), '..', 'data', 'strategies')
files = [
    'sweep_5c11d73b-8_0_69_v1.json',
    'sweep_7c9b035a-3_0_1_v1.json',
    'sweep_8058e3a6-d_6_v1.json',
    'sweep_b28b016e-0_0_1_v1.json',
]

for f in files:
    path = os.path.join(dir_, f)
    with open(path, 'r', encoding='utf-8-sig') as fh:
        text = fh.read()

    stripped = text.lstrip()
    if not stripped.startswith('{'):
        stripped = '{\n' + stripped

    # Unescape \u0026 -> & (PowerShell JSON escaping)
    stripped = stripped.replace(r'\u0026', '&')

    try:
        obj = json.loads(stripped)
    except json.JSONDecodeError as e:
        print(f'PARSE FAILED {f}: {e}')
        print(repr(stripped[:300]))
        continue

    # Fix name/description: replace garbled em-dash sequences with plain dash
    for field in ('name', 'description'):
        if field in obj and isinstance(obj[field], str):
            # Various mangled representations of em-dash from double-encoding
            val = obj[field]
            val = val.replace('\u00e2\u0080\u0093', '-')   # UTF-8 en-dash bytes read as latin-1
            val = val.replace('\u00e2\u0080\u0094', '-')   # UTF-8 em-dash bytes read as latin-1
            val = val.replace('\u2013', '-')               # en-dash
            val = val.replace('\u2014', '-')               # em-dash
            obj[field] = val

    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
    print(f'Fixed: {f}')
    print(f'  name: {obj.get("name", "?")}')
