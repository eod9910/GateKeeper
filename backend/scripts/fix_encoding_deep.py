"""
Fix double/triple-encoded UTF-8 strings in strategy JSON files.
U+00E2 U+20AC U+201D is the Latin-1 misread of UTF-8 em-dash (E2 80 94).
We detect this pattern and unwrap by encoding as latin-1 then decoding as utf-8.
"""
import json, os, glob

STRATEGIES_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'strategies')

# Sentinel codepoints that only appear when UTF-8 was misread as Latin-1
MISREAD_CODEPOINTS = {0x00E2, 0x00E3, 0x00C2, 0x00C3, 0x00C0, 0x00C1}

def needs_unwrap(s):
    return any(ord(ch) in MISREAD_CODEPOINTS for ch in s)

def unwrap_once(s):
    # cp1252 (Windows-1252) maps U+20AC (€) to byte 0x80, U+201D (") to 0x94, etc.
    # This matches how PowerShell misread UTF-8 bytes as Windows-1252 characters.
    try:
        return s.encode('cp1252').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None

def fix_string(s):
    if not isinstance(s, str):
        return s
    for _ in range(5):
        if not needs_unwrap(s):
            break
        result = unwrap_once(s)
        if result is None or result == s:
            break
        s = result
    return s

def fix_value(v):
    if isinstance(v, str):
        return fix_string(v)
    if isinstance(v, list):
        return [fix_value(i) for i in v]
    if isinstance(v, dict):
        return {k: fix_value(val) for k, val in v.items()}
    return v

fixed_count = 0

for path in sorted(glob.glob(os.path.join(STRATEGIES_DIR, '*.json'))):
    fname = os.path.basename(path)
    with open(path, 'r', encoding='utf-8') as fh:
        try:
            obj = json.load(fh)
        except Exception as e:
            print(f'SKIP {fname}: {e}')
            continue

    fixed_obj = fix_value(obj)
    if json.dumps(obj, ensure_ascii=False) != json.dumps(fixed_obj, ensure_ascii=False):
        with open(path, 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(fixed_obj, fh, indent=2, ensure_ascii=False)
        print(f'Fixed: {fname}')
        print(f'  name: {fixed_obj.get("name", "")[:100]}')
        fixed_count += 1

print(f'\nTotal fixed: {fixed_count}')
