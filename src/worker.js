export default {
  // The daily send: 8:30 AM ET first pass, with a 10 AM ET sweep in case the
  // 7 AM routine ran late. The edition_sends guard makes the retry free.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendEditionToSubscribers(env).then(r => console.log('edition send:', JSON.stringify(r))));
  },

  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // API routes
      if (path.startsWith('/api/')) {
        return handleAPI(path, request, env);
      }

      // Today's front-page photo at a stable URL (for social share previews)
      if (path === '/portada.jpg') {
        const a = await env.DB.prepare(
          "SELECT image_url FROM articles WHERE image_url IS NOT NULL ORDER BY published_at DESC LIMIT 1"
        ).first();
        if (!a?.image_url?.startsWith('/img/')) return new Response('Not found', { status: 404 });
        const obj = await env.BUCKET.get(a.image_url.slice(1));
        if (!obj) return new Response('Not found', { status: 404 });
        return new Response(obj.body, {
          headers: {
            'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }

      // Generated article art, stored in R2
      if (path.startsWith('/img/')) {
        const obj = await env.BUCKET.get(path.slice(1));
        if (!obj) return new Response('Not found', { status: 404 });
        return new Response(obj.body, {
          headers: {
            'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        });
      }

      // Static assets are served by the [assets] config automatically
      // Worker only receives requests that don't match static files
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

// ─── API ────────────────────────────────────────────────────────────────

function checkAuth(request, env) {
  const key = request.headers.get('X-API-Key');
  if (!key) return false;
  // SCRAPE_KEY is the daily routine's credential; ADMIN_KEY is the local ops
  // credential (stored in the Mac's Keychain as `diariomigrante-admin`).
  return (!!env.SCRAPE_KEY && key === env.SCRAPE_KEY) || (!!env.ADMIN_KEY && key === env.ADMIN_KEY);
}

async function handleAPI(path, request, env) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  // GET /api/articles — latest published articles (optional ?date=YYYY-MM-DD for one edition)
  if (path === '/api/articles') {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const category = url.searchParams.get('category');
    const date = url.searchParams.get('date');

    const clauses = [];
    const params = [];

    if (category && category !== 'all') {
      clauses.push('category = ?');
      params.push(category);
    }
    if (date) {
      clauses.push('date(published_at) = ?');
      params.push(date);
    }

    let query = 'SELECT * FROM articles';
    if (clauses.length) query += ' WHERE ' + clauses.join(' AND ');
    query += ' ORDER BY published_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return new Response(JSON.stringify(results), { headers });
  }

  // GET /api/portada — one edition in the D1 design's shape: the five that matter + the rest.
  // Lazily translates missing Spanish fields via Gemini and caches them in D1.
  if (path === '/api/portada') {
    const url = new URL(request.url);
    let date = url.searchParams.get('date');
    if (!date) {
      const latest = await env.DB.prepare('SELECT date(published_at) AS day FROM articles ORDER BY published_at DESC LIMIT 1').first();
      if (!latest) return new Response(JSON.stringify({ empty: true }), { headers });
      date = latest.day;
    }
    const { results } = await env.DB.prepare(
      'SELECT * FROM articles WHERE date(published_at) = ? ORDER BY published_at DESC'
    ).bind(date).all();

    let translateError = null;
    const missing = results.filter(a => !a.headline_es || !a.summary_es).slice(0, 20);
    if (missing.length) {
      try { await translateArticles(missing, env); } catch (e) { translateError = e.message; }
    }

    const featured = results.slice(0, 5);
    const ids = new Set(featured.map(a => a.id));
    const image = featured.find(a => a.image_url)?.image_url || null;
    return new Response(JSON.stringify({
      date,
      total: results.length,
      image,
      featured,
      resto: results.filter(a => !ids.has(a.id)),
      ...(translateError ? { translate_error: translateError } : {})
    }), { headers });
  }

  // TEMP: doodle on an exact background color test (no DB writes)
  if (path === '/api/_test2') {
    const prompt =
      'A minimalistic illustration in the form of doodles, a single black ink pen line drawn on a plain completely flat ' +
      'solid background of exactly the color hex 3A86FF, a vivid azure blue, uniform across the entire canvas with no ' +
      'texture, no gradient, no vignette. Extremely simple shapes, an imperfect handmade line, slightly uncomfortable ' +
      'proportions, a lot of empty space, indie zine illustration style, no realism, no shading. ' +
      'A recent graduate in a gown looks up at an enormous stack of coins twice their height, holding a small rolled blank scroll. ' +
      'The ink line stays pure black. Absolutely no logos, no text, no letters, no numbers anywhere.';
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent', {
      method: 'POST',
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { imageConfig: { aspectRatio: '4:5' } } })
    });
    const j = await res.json();
    for (const c of j.candidates || []) for (const pt of c.content?.parts || []) if (pt.inlineData?.data) {
      const key = `img/${crypto.randomUUID()}.jpg`;
      await env.BUCKET.put(key, base64ToBytes(pt.inlineData.data), { httpMetadata: { contentType: pt.inlineData.mimeType || 'image/jpeg' } });
      return new Response(JSON.stringify({ a: `/${key}` }), { headers });
    }
    return new Response('{"error":"no image"}', { status: 500, headers });
  }

  // GET /api/editions — one row per day that has articles, newest first
  if (path === '/api/editions') {
    const { results } = await env.DB.prepare(
      'SELECT date(published_at) AS day, COUNT(*) AS count FROM articles GROUP BY day ORDER BY day DESC'
    ).all();
    return new Response(JSON.stringify(results), { headers });
  }

  // GET /api/article/:id
  if (path.match(/^\/api\/article\/\d+$/)) {
    const id = path.split('/').pop();
    const article = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
    if (!article) return new Response('{"error":"Not found"}', { status: 404, headers });
    return new Response(JSON.stringify(article), { headers });
  }

  // GET /api/sources
  if (path === '/api/sources') {
    const { results } = await env.DB.prepare('SELECT id, name, url, category, last_scraped FROM sources WHERE active = 1').all();
    return new Response(JSON.stringify(results), { headers });
  }

  // GET /api/stats
  if (path === '/api/stats') {
    const articles = await env.DB.prepare('SELECT COUNT(*) as count FROM articles').first();
    const sources = await env.DB.prepare('SELECT COUNT(*) as count FROM sources WHERE active = 1').first();
    const today = await env.DB.prepare("SELECT COUNT(*) as count FROM articles WHERE published_at >= datetime('now', '-24 hours')").first();
    return new Response(JSON.stringify({
      total_articles: articles.count,
      active_sources: sources.count,
      articles_today: today.count
    }), { headers });
  }

  // POST /api/ingest — accepts pre-researched, pre-written articles from an external agent
  // (the daily research routine). Dedupes by source_url.
  if (path === '/api/ingest' && request.method === 'POST') {
    if (!checkAuth(request, env)) {
      return new Response('{"error":"Unauthorized"}', { status: 401, headers });
    }
    try {
      const body = await request.json();
      const items = Array.isArray(body.articles) ? body.articles : [];
      const result = await ingestArticles(items, env);
      return new Response(JSON.stringify(result), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // POST /api/backfill-images — generate art for articles missing it (?force=1 regenerates all)
  if (path === '/api/backfill-images' && request.method === 'POST') {
    if (!checkAuth(request, env)) {
      return new Response('{"error":"Unauthorized"}', { status: 401, headers });
    }
    const params = new URL(request.url).searchParams;
    const force = params.get('force') === '1';
    const date = params.get('date');

    const clauses = [];
    const binds = [];
    if (!force) clauses.push('image_url IS NULL');
    if (date) { clauses.push('date(published_at) = ?'); binds.push(date); }
    let q = 'SELECT id, headline, image_url FROM articles';
    if (clauses.length) q += ' WHERE ' + clauses.join(' AND ');

    const { results } = await env.DB.prepare(q).bind(...binds).all();
    let generated = 0;
    const errors = [];
    for (const row of results) {
      try {
        const url = await generateArticleImage(row.headline, env, null, {
          field: ART_FIELDS[generated % ART_FIELDS.length]
        });
        await env.DB.prepare('UPDATE articles SET image_url = ? WHERE id = ?').bind(url, row.id).run();
        if (row.image_url?.startsWith('/img/')) {
          await env.BUCKET.delete(row.image_url.slice(1));
        }
        generated++;
      } catch (e) {
        errors.push({ id: row.id, error: e.message });
      }
    }
    return new Response(JSON.stringify({ success: true, pipeline: 'cartoon-editorial', targeted: results.length, generated, errors }), { headers });
  }

  // POST /api/subscribe
  if (path === '/api/subscribe' && request.method === 'POST') {
    try {
      const { email, name } = await request.json();
      if (!email) return new Response('{"error":"Email required"}', { status: 400, headers });
      await env.DB.prepare('INSERT OR IGNORE INTO subscribers (email, name) VALUES (?, ?)')
        .bind(String(email).trim().toLowerCase(), name || null).run();
      return new Response('{"success":true}', { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // GET/POST /api/unsubscribe — HMAC-tokened link from the email footer.
  // GET shows a tiny Spanish page; POST is the one-click header flow.
  if (path === '/api/unsubscribe') {
    const u = new URL(request.url);
    const email = (u.searchParams.get('email') || '').trim().toLowerCase();
    const t = u.searchParams.get('t') || '';
    const expect = email ? await unsubToken(email, env.UNSUB_SECRET || env.ADMIN_KEY) : '';
    if (!email || t !== expect) {
      return new Response('Enlace inválido.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    await env.DB.prepare('UPDATE subscribers SET active = 0 WHERE lower(email) = ?').bind(email).run();
    if (request.method === 'POST') return new Response(null, { status: 200 });
    return new Response(unsubPageHtml(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // POST /api/send-edition — email today's edition to subscribers now (admin;
  // {force} re-sends; {to} sends a test copy to one address only, guard untouched)
  if (path === '/api/send-edition' && request.method === 'POST') {
    if (!checkAuth(request, env)) {
      return new Response('{"error":"Unauthorized"}', { status: 401, headers });
    }
    const body = await request.json().catch(() => ({}));
    const result = await sendEditionToSubscribers(env, { force: !!body.force, to: body.to || null });
    return new Response(JSON.stringify(result), { headers });
  }

  return new Response('{"error":"Not found"}', { status: 404, headers });
}

// ─── SPANISH TRANSLATION (Gemini, cached in D1) ────────────────────────

async function translateArticles(items, env) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const payload = items.map(a => ({ id: a.id, headline: a.headline, summary: a.summary }));
  const prompt =
    'Traduce estos titulares y resúmenes de noticias de inmigración al español latinoamericano neutro, ' +
    'para un sitio de noticias serio. Reglas: claro y directo, cifras y nombres propios intactos, ' +
    'sin comillas tipográficas, sin guiones largos, sin anglicismos innecesarios. ' +
    'Los titulares además se condensan al traducir: máximo 12 palabras, recorta el relleno y las ' +
    'subordinadas sin perder el hecho principal ni el actor. ' +
    'Devuelve SOLO un arreglo JSON con la forma [{"id": 1, "headline_es": "...", "summary_es": "..."}].\n\n' +
    JSON.stringify(payload);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      {
        method: 'POST',
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        }),
        signal: controller.signal
      }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const j = await res.json();
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned no text');
    const translations = JSON.parse(text);

    for (const t of translations) {
      if (!t.id || !t.headline_es || !t.summary_es) continue;
      await env.DB.prepare('UPDATE articles SET headline_es = ?, summary_es = ? WHERE id = ?')
        .bind(t.headline_es, t.summary_es, t.id).run();
      const row = items.find(a => a.id === t.id);
      if (row) { row.headline_es = t.headline_es; row.summary_es = t.summary_es; }
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─── ARTICLE ART (Nano Banana 2, stored in R2) ─────────────────────────

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// One flat background field per image, rotated story to story so the portada
// never comes out monochrome.
const ART_FIELDS = ['saturated blue', 'saturated orange', 'saturated yellow', 'saturated green', 'dusty rose'];

async function generateArticleImage(headline, env, providedScene = null, opts = {}) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const model = opts.model || 'gemini-3.1-flash-image';
  const aspect = opts.aspect || '1:1';
  const field = opts.field || ART_FIELDS[Math.floor(Math.random() * ART_FIELDS.length)];

  // The routine art-directs each story (image_concept). Without one (backfills,
  // manual ingests), the model invents the scene itself.
  const scene = providedScene?.trim().replace(/^["']|["']$/g, '')
    || `a single symbolic deadpan scene of your own invention that captures the story behind this news headline: "${headline}"`;

  const prompt = `Flat cartoon illustration with clean vector lines, thick black outlines, flat bold colors, ` +
    `deadpan absurd character design. Faces are extremely simplified: tiny dot eyes, small flat expressionless mouth, ` +
    `no eyebrows, no nose or a single short line for a nose, smooth rounded heads. Characters are a natural mix of ` +
    `people, some light-skinned, some tan, some dark-skinned, with varied hair. Editorial illustration style like ` +
    `Jean Jullien and Andy Rementer, one flat ${field} background color, no gradients, no shading: ${scene}. ` +
    `The artwork fills the entire image edge to edge, no paper border, no frame, no mat, not a photo of a poster. ` +
    `Not corporate flat vector, not clip art, not a children's book style. ` +
    `Absolutely no logos, no text, no letters, no numbers anywhere.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { imageConfig: { aspectRatio: aspect } }
        }),
        signal: controller.signal
      }
    );
    if (!res.ok) throw new Error(`Nano Banana ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const j = await res.json();
    for (const c of j.candidates || []) {
      for (const p of c.content?.parts || []) {
        if (p.inlineData?.data) {
          const mime = p.inlineData.mimeType || 'image/png';
          const key = `img/${crypto.randomUUID()}.${mime.includes('jpeg') ? 'jpg' : 'png'}`;
          await env.BUCKET.put(key, base64ToBytes(p.inlineData.data), { httpMetadata: { contentType: mime } });
          return `/${key}`;
        }
      }
    }
    throw new Error('Nano Banana returned no image');
  } finally {
    clearTimeout(timer);
  }
}

// ─── INGEST (external agent submissions) ───────────────────────────────

async function findOrCreateSource(item, env) {
  const origin = item.source_url ? new URL(item.source_url).origin : null;
  const name = item.source_name || origin || 'Unknown source';

  const existing = origin
    ? await env.DB.prepare('SELECT id FROM sources WHERE url = ?').bind(origin).first()
    : await env.DB.prepare('SELECT id FROM sources WHERE name = ?').bind(name).first();
  if (existing) return existing.id;

  const created = await env.DB.prepare(
    "INSERT INTO sources (name, url, scrape_url, type, category, active) VALUES (?, ?, ?, 'agent', ?, 1) RETURNING id"
  ).bind(name, origin || name, origin || name, item.category || 'general').first();
  return created.id;
}

async function ingestArticles(items, env) {
  let inserted = 0;
  let skipped = 0;
  const errors = [];
  // Art budget: five drawings per edition (Paul, 2026-08-12). The first five
  // stories get one each; on bigger days the rest run text-only.
  let artCount = 0;

  for (const item of items) {
    try {
      if (!item.source_url || !item.headline || !item.summary || !item.body) {
        errors.push({ source_url: item.source_url || null, error: 'missing required field (source_url, headline, summary, body)' });
        continue;
      }

      const existing = await env.DB.prepare('SELECT id FROM raw_articles WHERE url = ?').bind(item.source_url).first();
      if (existing) {
        skipped++;
        continue;
      }

      const sourceId = await findOrCreateSource(item, env);

      let imageUrl = item.image_url || null;
      if (!imageUrl && artCount < 5) {
        try {
          imageUrl = await generateArticleImage(item.headline, env, item.image_concept || null, {
            field: ART_FIELDS[artCount % ART_FIELDS.length]
          });
          artCount++;
        } catch (e) {
          console.error('Image generation failed:', e.message);
        }
      }

      const raw = await env.DB.prepare(
        'INSERT INTO raw_articles (source_id, title, url, raw_content, published_at, processed) VALUES (?, ?, ?, ?, ?, 1) RETURNING id'
      ).bind(sourceId, item.headline, item.source_url, item.summary, item.published_at || null).first();

      await env.DB.prepare(
        `INSERT INTO articles (raw_article_id, source_id, headline, summary, body, category, source_name, source_url, image_url, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
      ).bind(raw.id, sourceId, item.headline, item.summary, item.body, item.category || 'general', item.source_name || 'Unknown', item.source_url, imageUrl, item.published_at || null).run();

      inserted++;
    } catch (e) {
      errors.push({ source_url: item.source_url || null, error: e.message });
    }
  }

  return { success: true, received: items.length, inserted, skipped, errors };
}

// ─── EMAIL SUBSCRIPTION (Resend) ───────────────────────────────────────
// The morning edition goes to every active subscriber, once per day. An
// edition that already went out never goes again (edition_sends guards it),
// and a day with no subscribers stays unsent so the first person to sign up
// still gets today's paper.
//
// From resend.dev until diariomigrante.com is verified on Resend; flip
// EMAIL_FROM in wrangler.toml when it is.

const ORIGIN = 'https://diariomigrante.com';
const FALLBACK_FROM = 'Diario Migrante <onboarding@resend.dev>';
const REPLY_TO = 'paul.beresuita@gmail.com';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function unsubToken(email, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(email.trim().toLowerCase()));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function fechaLarga(day) {
  return new Date(`${day}T12:00:00Z`)
    .toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .toUpperCase();
}

function editionEmailHtml({ fecha, featured, unsubUrl }) {
  const SERIF = "'Newsreader', Georgia, 'Times New Roman', serif";
  const SANS = "'Libre Franklin', -apple-system, Helvetica, Arial, sans-serif";
  // Each story carries its own illustration, like the portada.
  const storiesHtml = featured.map((a, i) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${i > 0 ? `<tr><td class="hair" style="border-top:1px solid #C9C6C0;font-size:0;line-height:0;padding-top:22px;">&nbsp;</td></tr>` : ''}
    ${a.image_url ? `<tr><td style="padding:0 0 16px;"><img src="${ORIGIN}${a.image_url}" alt="" width="560" class="hair" style="display:block;width:100%;max-width:560px;height:auto;border:1px solid #C9C6C0;"></td></tr>` : ''}
    <tr><td class="ink" style="font-family:${SERIF};font-size:19px;line-height:1.3;font-weight:700;color:#171512;">${esc(a.headline_es || a.headline)}</td></tr>
    <tr><td class="body" style="padding:8px 0 0;font-family:${SERIF};font-size:15.5px;line-height:1.65;color:#3A3733;">${esc(a.summary_es || a.summary)}</td></tr>
    <tr><td class="dim" style="padding:8px 0 22px;font-family:${SANS};font-size:11px;letter-spacing:1.5px;color:#6E6961;">${esc((a.source_name || '').toUpperCase())}</td></tr>
  </table>`).join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
  @media only screen and (max-width: 640px) {
    .outer { padding: 16px 10px !important; }
    .card { padding: 30px 22px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .bodybg { background-color: #161615 !important; }
    .card { background-color: #1e1d1b !important; border-color: #2e2d2a !important; }
    .ink { color: #f0efe9 !important; }
    .body { color: #d6d4cc !important; }
    .dim { color: #8f8d85 !important; }
    .hair { border-color: #2e2d2a !important; }
    .rule { background-color: #f0efe9 !important; }
  }
  [data-ogsc] .card { background-color: #1e1d1b !important; border-color: #2e2d2a !important; }
  [data-ogsc] .ink { color: #f0efe9 !important; }
  [data-ogsc] .body { color: #d6d4cc !important; }
  [data-ogsc] .dim { color: #8f8d85 !important; }
</style>
</head>
<body class="bodybg" style="margin:0;padding:0;background-color:#F5F4F2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="outer bodybg" style="background-color:#F5F4F2;padding:36px 16px;">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">
<tr><td class="card" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #C9C6C0;padding:40px 40px 34px;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" class="ink" style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;color:#171512;">Diario Migrante</td></tr>
    <tr><td style="padding-top:12px;"><div class="rule" style="height:3px;background-color:#171512;font-size:0;line-height:0;">&nbsp;</div><div class="rule" style="height:1px;background-color:#171512;margin-top:2px;font-size:0;line-height:0;">&nbsp;</div></td></tr>
    <tr><td align="center" class="dim" style="padding:10px 0 0;font-family:${SANS};font-size:11px;letter-spacing:2.5px;color:#6E6961;">${esc(fecha)}</td></tr>
    <tr><td style="padding-top:26px;">
${storiesHtml}
    </td></tr>
    <tr><td class="hair" style="border-top:1px solid #C9C6C0;padding-top:20px;">
      <p class="body" style="margin:0;font-family:${SERIF};font-size:15px;color:#3A3733;">La edición completa, con sus ilustraciones: <a class="ink" href="${ORIGIN}" style="color:#171512;">diariomigrante.com</a></p>
      <p class="dim" style="margin:14px 0 0;font-family:${SANS};font-size:11.5px;line-height:1.6;color:#6E6961;">Recibes este correo porque te suscribiste en diariomigrante.com. Si ya no lo quieres, <a class="dim" href="${unsubUrl}" style="color:#6E6961;">cancela aquí</a>.</p>
    </td></tr>
  </table>

</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function unsubPageHtml() {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Listo — Diario Migrante</title></head>
<body style="margin:0;background:#FFFFFF;color:#171512;font-family:Georgia,serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
<div style="text-align:center;padding:40px;">
<div style="font-size:26px;font-weight:700;">Diario Migrante</div>
<p style="font-size:17px;color:#3A3733;margin:18px 0 0;">Listo. Ya no te escribimos.<br>Si cambias de opinión, la portada siempre está en <a href="${ORIGIN}" style="color:#171512;">diariomigrante.com</a>.</p>
</div>
</body></html>`;
}

// Headlines run long; the inbox wants a short line. Gemini compresses the lead
// story into a few words, and a plain word-trim of the headline covers any failure.
async function generateEmailSubject(lead, env) {
  const headline = lead.headline_es || lead.headline || 'La edición de hoy';
  const fallback = headline.split(/\s+/).slice(0, 9).join(' ');
  if (!env.GEMINI_API_KEY) return fallback;

  const prompt =
    'Escribe el asunto de correo para la edición de hoy de un diario serio de noticias de inmigración en español. ' +
    'Máximo 8 palabras. Directo y concreto, cifras y nombres propios intactos, sin punto final, sin comillas, ' +
    'sin dos puntos, sin emojis, sin sensacionalismo. Devuelve SOLO el asunto.\n\n' +
    `Noticia principal:\nTitular: ${headline}\nResumen: ${lead.summary_es || lead.summary || ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      {
        method: 'POST',
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: controller.signal
      }
    );
    if (!res.ok) return fallback;
    const j = await res.json();
    const text = (j.candidates?.[0]?.content?.parts?.[0]?.text || '')
      .trim().replace(/^["'«]|["'»]$/g, '').replace(/\.$/, '').trim();
    if (!text || text.includes('\n') || text.split(/\s+/).length > 10 || text.length > 90) return fallback;
    return text;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

async function sendEditionToSubscribers(env, { force = false, to = null } = {}) {
  if (!env.RESEND_API_KEY) return { sent: 0, reason: 'RESEND_API_KEY not set' };

  const latest = await env.DB.prepare('SELECT date(published_at) AS day FROM articles ORDER BY published_at DESC LIMIT 1').first();
  if (!latest) return { sent: 0, reason: 'no editions' };
  const day = latest.day;

  // A test send (`to`) never consults or writes the once-per-day guard.
  const guard = await env.DB.prepare('SELECT sent_at FROM edition_sends WHERE day = ?').bind(day).first();
  if (guard?.sent_at && !force && !to) return { sent: 0, reason: `edition ${day} already sent` };

  const { results: articles } = await env.DB.prepare(
    'SELECT * FROM articles WHERE date(published_at) = ? ORDER BY published_at DESC'
  ).bind(day).all();
  if (!articles.length) return { sent: 0, reason: 'empty edition' };

  const missing = articles.filter(a => !a.headline_es || !a.summary_es).slice(0, 20);
  if (missing.length) { try { await translateArticles(missing, env); } catch (e) { console.log('translate before send failed:', e.message); } }

  const featured = articles.slice(0, 5);
  const fecha = fechaLarga(day);
  const lead = featured[0];
  const subject = (await generateEmailSubject(lead, env)).slice(0, 150);

  const subs = to
    ? [{ email: String(to).trim().toLowerCase() }]
    : (await env.DB.prepare('SELECT email FROM subscribers WHERE active = 1').all()).results;
  if (!subs.length) return { sent: 0, reason: 'no subscribers' };

  const from = env.EMAIL_FROM || FALLBACK_FROM;
  const emails = [];
  for (const s of subs) {
    const t = await unsubToken(s.email, env.UNSUB_SECRET || env.ADMIN_KEY);
    const unsubUrl = `${ORIGIN}/api/unsubscribe?email=${encodeURIComponent(s.email.trim().toLowerCase())}&t=${t}`;
    emails.push({
      from,
      to: [s.email],
      reply_to: REPLY_TO,
      subject,
      html: editionEmailHtml({ fecha, featured, unsubUrl }),
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  }

  let sent = 0;
  const errors = [];
  for (let i = 0; i < emails.length; i += 100) {
    const batch = emails.slice(i, i + 100);
    const r = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    const b = await r.json().catch(() => ({}));
    if (r.ok) sent += batch.length;
    else errors.push({ status: r.status, detail: b });
  }

  if (sent && !to) {
    await env.DB.prepare("INSERT OR REPLACE INTO edition_sends (day, sent_at, recipients) VALUES (?, datetime('now'), ?)")
      .bind(day, sent).run();
  }
  return { sent, day, subject, subscribers: subs.length, ...(errors.length ? { errors } : {}) };
}
