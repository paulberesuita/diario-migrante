# Run: python3 scripts/art-contact.py 2026-09-17 [more dates] -> contact sheet of the live drawings (one row per date)
import sys, json, subprocess, io, urllib.request
from PIL import Image
dates = sys.argv[1:-1]; out = sys.argv[-1]
S = 360; sheet = Image.new('RGB', (S*5, S*len(dates)), 'white')
for r, d in enumerate(dates):
    raw = subprocess.run(['npx','wrangler','d1','execute','newsai','--remote','--json','--command',
        f"SELECT id, image_url FROM articles WHERE date(published_at)='{d}' ORDER BY published_at, id"], capture_output=True, text=True).stdout
    rows = json.loads(raw[raw.index('['):])[0]['results']
    for c, row in enumerate(rows[:5]):
        if not row['image_url']: continue
        req = urllib.request.Request('https://diariomigrante.com'+row['image_url'], headers={'User-Agent':'Mozilla/5.0'})
        sheet.paste(Image.open(io.BytesIO(urllib.request.urlopen(req).read())).convert('RGB').resize((S,S)), (c*S, r*S))
sheet.save(out, quality=85); print(out)
