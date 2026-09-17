// Run: node scripts/art-styles.mjs   (after art-bakeoff.mjs; key: Keychain item openai-api-key)
// Style riff on GPT Image 2.5 Flare: the same Sep 8 scene lines, three takes on
// "a bit more real, less muted", beside the current house prompt.
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const DIR = new URL('.', import.meta.url).pathname;
const OUT = DIR + 'out/';
const KEY = execSync('security find-generic-password -s openai-api-key -w').toString().trim();
const MODEL = 'gpt-image-2.5-flare';
const stories = JSON.parse(readFileSync(DIR + 'art-bakeoff-sep8.json', 'utf8')).reverse();
const FIELDS = ['vivid cobalt blue', 'bright orange', 'sunny yellow', 'bright emerald green', 'hot coral pink'];

const PEOPLE = `People are a natural mix, some light-skinned, some tan, some dark-skinned, with varied hair.`;
const COLOR = f => `Vivid, punchy, fully saturated colors throughout: bright clothing, bright objects, clean whites. ` +
  `No dusty, grayish, muddy or washed-out tones. One flat ${f} background color.`;
const TAIL = `The artwork fills the entire image edge to edge, no paper border, no frame, no mat, not a photo of a poster. ` +
  `Absolutely no logos, no text, no letters, no numbers anywhere.`;

const STYLES = {
  notch: {
    label: 'One notch more real',
    note: 'same cartoon, real proportions, a nose, one tone of shadow',
    lead: `Cartoon editorial illustration with clean confident black outlines and flat bold colors, deadpan tone. ` +
      `People have natural, believable proportions and posture, real hands, and simple but human faces: small eyes, ` +
      `a simple nose, a calm neutral mouth. Still simplified, never caricatured. Objects are drawn with accurate, ` +
      `observed detail. A single flat tone of cel shadow gives forms a little weight. No gradients, no texture.`
  },
  ligne: {
    label: 'Clear line',
    note: 'classic comic album: realistic drawing, flat vivid color, no shading',
    lead: `Ligne claire illustration in the tradition of classic Franco-Belgian comic albums: uniform clean black outlines, ` +
      `realistic proportions, carefully observed objects and settings, flat vivid colors with no shading and no gradients. ` +
      `Faces are simple but human, with deadpan expressions.`
  },
  painted: {
    label: 'Painted editorial',
    note: 'newspaper opinion-page look: semi-real figures, light shading, a hint of gouache',
    lead: `Contemporary editorial illustration as seen on a major newspaper's opinion pages: semi-realistic figures with ` +
      `natural proportions, simplified faces, confident shapes with minimal outlines, subtle two-tone shading and a hint ` +
      `of gouache texture. Deadpan, quiet mood.`
  }
};

async function gen(key, story, field) {
  const file = `${story.id}-style-${key}.jpg`;
  if (existsSync(OUT + file)) return { file };
  const prompt = `${STYLES[key].lead} ${PEOPLE} ${COLOR(field)} The scene: ${story.concept} ${TAIL}`;
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, size: '1024x1024', quality: 'high', output_format: 'jpeg', output_compression: 85, n: 1 }),
    signal: AbortSignal.timeout(240000)
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  const b64 = (await res.json()).data?.[0]?.b64_json;
  if (!b64) throw new Error('no image');
  writeFileSync(OUT + file, Buffer.from(b64, 'base64'));
  console.log('ok ', file);
  return { file };
}

const jobs = [];
stories.forEach((s, i) => Object.keys(STYLES).forEach(k =>
  jobs.push(gen(k, s, FIELDS[i % FIELDS.length]).then(r => ({ ...r, id: s.id, k }), e => ({ id: s.id, k, error: e.message })))));
const results = await Promise.all(jobs);
for (const e of results.filter(r => r.error)) console.error('ERR', e.id, e.k, e.error);

const cell = (s, k) => {
  const r = results.find(x => x.id === s.id && x.k === k);
  return r.error ? `<figure><div class="err">${r.error}</div></figure>` : `<figure><img src="out/${r.file}" alt=""></figure>`;
};
const html = `<!doctype html><meta charset="utf-8"><title>Art styles</title>
<style>
  :root { --ink:#1a1a1a; --paper:#f4f1ea; --rule:#c9c3b5; }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.4 Georgia, 'Times New Roman', serif; }
  header { padding:40px 48px 24px; border-bottom:2px solid var(--ink); }
  header h1 { margin:0; font-size:34px; letter-spacing:-0.01em; }
  header p { margin:6px 0 0; color:#555; }
  .cols, .row { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:20px; }
  .cols { position:sticky; top:0; z-index:1; background:var(--paper); padding:14px 48px; border-bottom:1px solid var(--rule); }
  .cols b { display:block; font-size:15px; }
  .cols span { font-size:13px; color:#666; font-style:italic; }
  .story { padding:28px 48px; border-bottom:1px solid var(--rule); }
  .story h2 { margin:0 0 14px; font-size:18px; font-weight:400; font-style:italic; color:#444; }
  figure { margin:0; }
  img { width:100%; aspect-ratio:1; object-fit:cover; display:block; background:#ddd; }
  .err { aspect-ratio:1; display:flex; align-items:center; padding:20px; background:#eee; color:#900; font:13px/1.4 ui-monospace, monospace; word-break:break-word; }
  @media (max-width:900px) { .cols, .row { grid-template-columns:repeat(2, minmax(0, 1fr)); } .cols { position:static; } .cols, .story, header { padding-left:16px; padding-right:16px; } }
</style>
<header><h1>Art styles · a bit more real, less muted</h1><p>GPT Image 2.5 Flare · same five scene lines · brighter palette on all three new takes</p></header>
<div class="cols">
  <div><b>Today's prompt</b><span>flat cartoon, dot eyes</span></div>
  ${Object.values(STYLES).map(s => `<div><b>${s.label}</b><span>${s.note}</span></div>`).join('')}
</div>
${stories.map(s => `
  <section class="story">
    <h2>${s.concept}</h2>
    <div class="row">
      <figure><img src="out/${s.id}-${MODEL}-concept.jpg" alt=""></figure>
      ${Object.keys(STYLES).map(k => cell(s, k)).join('')}
    </div>
  </section>`).join('')}`;
writeFileSync(DIR + 'art-styles.html', html);
console.log(`\nsheet: ${DIR}art-styles.html  (${results.filter(r => !r.error).length}/${results.length})`);
