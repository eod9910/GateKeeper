"""
Fix double-encoded UTF-8 characters in all strategy JSON files.
PowerShell's ConvertTo-Json reads UTF-8 bytes as Latin-1, so e.g.
em-dash (U+2014, bytes E2 80 94) becomes â€" (three Latin-1 chars).
"""
import json, os, glob

STRATEGIES_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'strategies')

def fix_string(s):
    if not isinstance(s, str):
        return s
    try:
        # Attempt to re-decode bytes that were misread as Latin-1
        fixed = s.encode('latin-1').decode('utf-8')
        return fixed
    except (UnicodeEncodeError, UnicodeDecodeError):
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
error_count = 0

for path in sorted(glob.glob(os.path.join(STRATEGIES_DIR, '*.json'))):
    fname = os.path.basename(path)
    with open(path, 'r', encoding='utf-8-sig') as fh:
        try:
            obj = json.load(fh)
        except json.JSONDecodeError as e:
            print(f'SKIP (parse error): {fname}: {e}')
            error_count += 1
            continue

    original_name = obj.get('name', '')
    fixed_obj = fix_value(obj)
    new_name = fixed_obj.get('name', '')

    changed = (json.dumps(obj, ensure_ascii=False) != json.dumps(fixed_obj, ensure_ascii=False))

    if changed:
        with open(path, 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(fixed_obj, fh, indent=2, ensure_ascii=False)
        print(f'Fixed: {fname}')
        if original_name != new_name:
            print(f'  name: {new_name}')
        fixed_count += 1

print(f'\nDone. Fixed {fixed_count} files, {error_count} errors.')
