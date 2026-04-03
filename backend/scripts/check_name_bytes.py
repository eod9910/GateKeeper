import json, os

path = os.path.join(os.path.dirname(__file__), '..', 'data', 'strategies', 'sweep_8058e3a6-d_6_v1.json')
with open(path, 'r', encoding='utf-8') as f:
    obj = json.load(f)

name = obj['name']
print('Name as Python sees it:')
print(repr(name))
print()
print('Character codes around the first dash:')
for i, ch in enumerate(name):
    if ord(ch) > 127 or ch == '-':
        print(f'  [{i}] U+{ord(ch):04X} = {repr(ch)}')
