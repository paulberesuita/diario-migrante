// Run: node scripts/art-bakeoff.mjs   (key: Keychain item openai-api-key; QUALITY=high|xhigh|max)
// Diario Migrante art bake-off: GPT Image 2.5 (Flare + Sunburst) vs the
// Nano Banana 2 drawings already on the Sep 8 edition. Same headlines, the
// Worker's exact prompt, headline-only scene (the backfill path).
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const DIR = new URL('.', import.meta.url).pathname;
const OUT = DIR + 'out/';
mkdirSync(OUT, { recursive: true });

const KEY = execSync('security find-generic-password -s openai-api-key -w').toString().trim();
if (!KEY) throw new Error('no key');

const stories = JSON.parse(readFileSync(DIR + 'art-bakeoff-sep8.json', 'utf8')).reverse(); // ingest order
const ART_FIELDS = ['saturated blue', 'saturated orange', 'saturated yellow', 'saturated green', 'dusty rose'];
const MODELS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];
const QUALITY = process.env.QUALITY || 'high';

function prompt(headline, field, concept) {
  const scene = concept || `a single symbolic deadpan scene of your own invention that captures the story behind this news headline: "${headline}"`;
  return `Flat cartoon illustration with clean vector lines, thick black outlines, flat bold colors, ` +
    `deadpan absurd character design. Faces are extremely simplified: tiny dot eyes, small flat expressionless mouth, ` +
    `no eyebrows, no nose or a single short line for a nose, smooth rounded heads. Characters are a natural mix of ` +
    `people, some light-skinned, some tan, some dark-skinned, with varied hair. Editorial illustration style like ` +
    `Jean Jullien and Andy Rementer, one flat ${field} background color, no gradients, no shading: ${scene}. ` +
    `The artwork fills the entire image edge to edge, no paper border, no frame, no mat, not a photo of a poster. ` +
    `Not corporate flat vector, not clip art, not a children's book style. ` +
    `Absolutely no logos, no text, no letters, no numbers anywhere.`;
}

// mode 'concept' = the routine's one-line scene (the daily path); 'headline' = the backfill path.
async function gen(model, story, field, mode) {
  const file = `${story.id}-${model}${mode === 'concept' ? '-concept' : ''}.jpg`;
  if (existsSync(OUT + file)) return { file, secs: 'cached' };
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt: prompt(story.headline, field, mode === 'concept' ? story.concept : null),
      size: '1024x1024', quality: QUALITY, output_format: 'jpeg', output_compression: 85, n: 1
    }),
    signal: AbortSignal.timeout(240000)
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res.ok) throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${model}: no image`);
  writeFileSync(OUT + file, Buffer.from(b64, 'base64'));
  const usage = j.usage ? ` out=${j.usage.output_tokens}tok` : '';
  console.log(`ok  ${file}  ${secs}s${usage}`);
  return { file, secs, usage: j.usage };
}

// Existing Nano Banana 2 art, saved locally so the sheet is self-contained.
for (const s of stories) {
  const r = await fetch('https://diariomigrante.com' + s.image_url);
  writeFileSync(OUT + `${s.id}-nano-banana-2.jpg`, Buffer.from(await r.arrayBuffer()));
}

const jobs = [];
stories.forEach((s, i) => {
  const field = ART_FIELDS[i % ART_FIELDS.length];
  for (const mode of ['concept', 'headline']) for (const m of MODELS)
    jobs.push(gen(m, s, field, mode).then(r => ({ ...r, id: s.id, model: m, mode }), e => ({ id: s.id, model: m, mode, error: e.message })));
});
const results = await Promise.all(jobs);
const errors = results.filter(r => r.error);
for (const e of errors) console.error('ERR', e.id, e.model, e.error);

const label = m => m.replace('gpt-image-2.5-', 'GPT Image 2.5 ').replace('flare', 'Flare').replace('sunburst', 'Sunburst');
const cell = (s, m, mode) => {
  const r = results.find(x => x.id === s.id && x.model === m && x.mode === mode);
  return r?.error
    ? `<figure><div class="err">${r.error}</div><figcaption>${label(m)}</figcaption></figure>`
    : `<figure><img src="out/${r.file}" alt=""><figcaption>${label(m)} <span>${r.secs === 'cached' ? '' : r.secs + 's'}</span></figcaption></figure>`;
};
const rows = stories.map(s => `
  <section class="story">
    <h2>${s.headline_es || s.headline}</h2>
    <p class="en">${s.headline}</p>
    <p class="mode">Same scene line <span>${s.concept}</span></p>
    <div class="row">
      <figure><img src="out/${s.id}-nano-banana-2.jpg" alt=""><figcaption>Nano Banana 2 <span>(current, Sep 8 edition)</span></figcaption></figure>
      ${MODELS.map(m => cell(s, m, 'concept')).join('')}
    </div>
    <p class="mode">Headline only <span>the model invents the scene (backfill path)</span></p>
    <div class="row">
      <figure class="blank"></figure>
      ${MODELS.map(m => cell(s, m, 'headline')).join('')}
    </div>
  </section>`).join('');

const html = `<!doctype html><meta charset="utf-8"><title>Art bake-off</title>
<style>
  :root { --ink:#1a1a1a; --paper:#f4f1ea; --rule:#c9c3b5; }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.4 Georgia, 'Times New Roman', serif; }
  header { padding:40px 48px 24px; border-bottom:2px solid var(--ink); }
  header h1 { margin:0; font-size:34px; letter-spacing:-0.01em; }
  header p { margin:6px 0 0; color:#555; }
  .story { padding:32px 48px; border-bottom:1px solid var(--rule); }
  .story h2 { margin:0 0 4px; font-size:22px; font-weight:700; max-width:900px; }
  .story .en { margin:0 0 18px; color:#666; font-style:italic; font-size:15px; }
  .row { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:20px; }
  figure { margin:0; }
  img { width:100%; aspect-ratio:1; object-fit:cover; display:block; background:#ddd; }
  .err { aspect-ratio:1; display:flex; align-items:center; padding:20px; background:#eee; color:#900; font:13px/1.4 ui-monospace, monospace; word-break:break-word; }
  figcaption { margin-top:8px; font-size:14px; font-weight:700; }
  figcaption span { font-weight:400; color:#666; }
  .mode { margin:22px 0 10px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; }
  .mode span { font-weight:400; text-transform:none; letter-spacing:0; color:#666; font-style:italic; margin-left:8px; }
  @media (max-width:900px) { .row { grid-template-columns:1fr; } .story, header { padding-left:16px; padding-right:16px; } }
</style>
<header><h1>Art bake-off · Diario Migrante</h1><p>Sep 8 edition · same headline, same prompt · GPT Image 2.5 at quality "${QUALITY}", 1024×1024</p></header>
${rows}`;
writeFileSync(DIR + 'art-bakeoff.html', html);
console.log(`\nsheet: ${DIR}art-bakeoff.html  (${results.length - errors.length}/${results.length} generated)`);
