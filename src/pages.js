// ─── Diario Migrante — el pliego se imprime en el servidor ─────────────
// Pure templates: the Worker passes data in, full HTML comes out. The paper
// used to assemble itself in the browser, which left Google reading an empty
// shell; now every page ships with the stories already in the HTML, each
// edition has a permanent address (/edicion/YYYY-MM-DD), and the índice and
// sitemap point at them.

export const ORIGIN = 'https://diariomigrante.com';

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Manual date words — deterministic, no ICU surprises.
const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

function partes(day) {
  const [y, m, d] = day.split('-').map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

// "SÁBADO, 16 DE AGOSTO DE 2026" — same shape the browser used to produce.
export function fechaLarga(day) {
  const p = partes(day);
  return `${DIAS[p.dow]}, ${p.d} DE ${MESES[p.m - 1]} DE ${p.y}`;
}

// "sábado 16 de agosto de 2026" — for titles and descriptions.
function fechaMin(day) {
  const p = partes(day);
  return `${DIAS[p.dow].toLowerCase()} ${p.d} de ${MESES[p.m - 1].toLowerCase()} de ${p.y}`;
}

function formatHora(ts) {
  if (!ts) return '';
  let [h, min] = ts.slice(11, 16).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(min).padStart(2, '0')} ${ampm}`;
}

const FAVICON = "data:image/png;base64,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";

function headHtml({ title, description, canonical, ogType = 'website', ogImage = `${ORIGIN}/portada.jpg`, jsonLd = [] }) {
  const ldTags = jsonLd
    .map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`)
    .join('\n  ');
  return `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="max-image-preview:large">
  <link rel="icon" href="${FAVICON}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:locale" content="es_US">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${ogImage}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=UnifrakturMaguntia&family=Newsreader:ital,opsz,wght@0,6..72,400..700;1,6..72,400..700&family=Libre+Franklin:wght@400..700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <!-- Privacy-friendly analytics by Plausible -->
  <script async src="https://plausible.io/js/pa-cJ6cNzrMxSOmIXfSiTS0o.js"></script>
  <script>
    window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
    plausible.init()
  </script>
  ${ldTags}
</head>`;
}

function orgLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsMediaOrganization',
    name: 'Diario Migrante',
    url: ORIGIN,
    logo: `${ORIGIN}/masthead-tinta.png`,
    inLanguage: 'es',
    description: 'Periódico diario de noticias de inmigración en español claro.'
  };
}

function edicionLd(stories, pageUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: stories.map((a, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'NewsArticle',
        headline: a.headline_es || a.headline,
        description: a.summary_es || a.summary,
        ...(a.image_url ? { image: `${ORIGIN}${a.image_url}` } : {}),
        ...(a.published_at ? { datePublished: `${a.published_at.slice(0, 10)}T${a.published_at.slice(11, 19) || '12:00:00'}Z` } : {}),
        inLanguage: 'es',
        mainEntityOfPage: pageUrl,
        ...(a.source_url ? { isBasedOn: a.source_url } : {}),
        publisher: { '@type': 'NewsMediaOrganization', name: 'Diario Migrante', url: ORIGIN }
      }
    }))
  };
}

// ─── El pliego (portada de hoy y ediciones permanentes) ────────────────

function fuenteHtml(a) {
  const hora = formatHora(a.published_at);
  const texto = `${esc(a.source_name)}${hora ? ' · ' + hora : ''}`;
  return a.source_url
    ? `<a class="fuente" href="${esc(a.source_url)}" target="_blank" rel="noopener">${texto}</a>`
    : `<span class="fuente">${texto}</span>`;
}

function historiaHtml(a) {
  return `
        <h3 class="col-tit">${esc(a.headline_es || a.headline)}</h3>
        <p class="col-resumen">${esc(a.summary_es || a.summary)}</p>
        ${fuenteHtml(a)}
        ${a.image_url ? `<figure class="col-figura"><img src="${esc(a.image_url)}" alt="${esc(a.headline_es || a.headline)}" loading="lazy"></figure>` : ''}`;
}

const SUSCRIBIR_COL = `<div class="col col-suscribir">
      <span class="kicker">SUSCRÍBETE</span>
      <div class="sus-tarifa">
        <div class="tarifa-fila"><span class="tarifa-rubro">Entrega</span><i class="tarifa-puntos"></i><span class="tarifa-dato">7:00 de la mañana</span></div>
        <div class="tarifa-fila"><span class="tarifa-rubro">Edición</span><i class="tarifa-puntos"></i><span class="tarifa-dato">Lunes a domingo</span></div>
        <div class="tarifa-fila"><span class="tarifa-rubro">Precio</span><i class="tarifa-puntos"></i><span class="tarifa-dato tarifa-gratis">Gratis</span></div>
      </div>
      <form class="sus-form" id="suscribir">
        <input type="email" id="email" placeholder="tu@correo.com" autocomplete="email" required>
        <button type="submit">Recíbelo cada mañana</button>
      </form>
      <p class="sus-note" id="sus-note"></p>
    </div>`;

function cabeceraHtml({ home, day }) {
  const fecha = day
    ? `<a class="folio-item folio-fecha" href="${home ? '/registro' : `/registro?date=${day}`}">${fechaLarga(day)}</a>`
    : `<span class="folio-item folio-fecha"></span>`;
  return `<header class="cabecera">
        <div class="folio">
          <a class="folio-item" href="/ediciones">EDICIONES ANTERIORES</a>
          <span class="folio-item folio-centro">NOTICIAS DE INMIGRACIÓN, EN ESPAÑOL</span>
          ${fecha}
        </div>
        <h1 class="masthead">${home ? 'Diario Migrante' : '<a href="/">Diario Migrante</a>'}</h1>
        <div class="regla-doble"><i></i><i></i></div>
      </header>`;
}

// El pliego: lead = historia 1 · banda de tres = 2, 3, 4 · el resto en
// bandas anchas de dos en dos · la suscripción cierra la última banda.
function pliegoHtml(stories) {
  const s = stories;
  const l = s[0];
  let cuerpo = `<section class="lead">
        <div class="lead-texto">
          <span class="kicker">LO QUE IMPORTA HOY</span>
          <h2 class="lead-tit">${esc(l.headline_es || l.headline)}</h2>
          <p class="lead-resumen">${esc(l.summary_es || l.summary)}</p>
          ${fuenteHtml(l)}
        </div>
        ${l.image_url ? `<figure class="lead-figura"><img src="${esc(l.image_url)}" alt="${esc(l.headline_es || l.headline)}" loading="eager"></figure>` : ''}
      </section>`;

  if (s.length > 1) {
    const cols = s.slice(1, 4).map(a => `<div class="col">${historiaHtml(a)}</div>`);
    cuerpo += `\n\n      <div class="regla-seccion"></div>
      <section class="banda">${cols.join('<div class="divisor"></div>')}</section>`;
  }

  const bandas = [];
  for (let i = 4; i < s.length; i += 2) {
    const par = [`<div class="col${s[i + 1] ? '' : ' col-sola'}">${historiaHtml(s[i])}</div>`];
    if (s[i + 1]) par.push(`<div class="col">${historiaHtml(s[i + 1])}</div>`);
    bandas.push(par);
  }
  if (!bandas.length) bandas.push([]);
  bandas[bandas.length - 1].push(SUSCRIBIR_COL);

  for (const b of bandas) {
    cuerpo += `\n\n      <div class="regla-seccion"></div>
      <section class="banda banda-ancha">${b.join('<div class="divisor"></div>')}</section>`;
  }
  return cuerpo;
}

export function portadaPage(data, { home }) {
  const empty = !data || data.empty || !data.featured?.length;
  const day = empty ? null : data.date;
  const stories = empty ? [] : [...(data.featured || []), ...(data.resto || [])];

  const canonical = home ? `${ORIGIN}/` : `${ORIGIN}/edicion/${day}`;
  const lead = stories[0];
  const title = home
    ? 'Diario Migrante — las noticias de inmigración que importan hoy'
    : `${lead.headline_es || lead.headline} — Diario Migrante, ${fechaMin(day)}`;
  const description = home
    ? 'Un periódico diario de noticias de inmigración en español claro: las historias que importan hoy, escritas cada mañana a las 7.'
    : `La edición del ${fechaMin(day)} — ${data.total} noticia${data.total === 1 ? '' : 's'} de inmigración, en español claro. ${lead.summary_es || lead.summary}`;
  const ogImage = !empty && data.image ? `${ORIGIN}${data.image}` : `${ORIGIN}/portada.jpg`;

  const jsonLd = [];
  if (home) jsonLd.push(orgLd());
  if (!empty) jsonLd.push(edicionLd(stories, canonical));

  const cuerpo = empty
    ? `<p class="prep">La primera edición se está escribiendo. Vuelve pronto.</p>`
    : pliegoHtml(stories);

  return `<!DOCTYPE html>
<html lang="es">
${headHtml({ title, description, canonical, ogType: home ? 'website' : 'article', ogImage, jsonLd })}
<body>

  <main class="pagina">
    <article class="pliego">

      ${cabeceraHtml({ home, day })}

      ${cuerpo}

      <footer class="colofon">
        <div class="regla-seccion"></div>
        <p class="colofon-linea">
          <span>DIARIO MIGRANTE · GRATIS, CADA MAÑANA A LAS 7</span>
        </p>
      </footer>

    </article>
  </main>

  <script src="/app.js"></script>
</body>
</html>`;
}

// ─── El índice (/ediciones) ────────────────────────────────────────────

export function edicionesPage(eds) {
  let indice = '';
  if (!eds.length) {
    indice = `<p class="prep">La primera edición se está escribiendo. Vuelve pronto.</p>`;
  } else {
    let mesActual = null;
    for (const e of eds) {
      const mes = e.day.slice(0, 7);
      const p = partes(e.day);
      if (mes !== mesActual) {
        if (mesActual) indice += `</div>`;
        mesActual = mes;
        indice += `<div class="ed-grupo"><div class="ed-mes"><span>${MESES[p.m - 1]} DE ${p.y}</span><i></i></div>`;
      }
      indice += `<a class="ed-fila" href="/edicion/${e.day}">
          <span class="ed-fecha">
            <span class="ed-dia">${p.d}</span>
            <span class="ed-nombre">${DIAS[p.dow]}</span>
          </span>
          <span class="ed-resto">
            <span class="ed-tit">${esc(e.lead || '')}</span>
            <i class="ed-puntos"></i>
            <span class="ed-conteo">${e.count} noticia${e.count === 1 ? '' : 's'}</span>
          </span>
        </a>`;
    }
    indice += `</div>`;
  }

  return `<!DOCTYPE html>
<html lang="es">
${headHtml({
    title: 'Ediciones anteriores — Diario Migrante',
    description: 'El índice de todas las ediciones de Diario Migrante: cada mañana, las noticias de inmigración que importan, en español.',
    canonical: `${ORIGIN}/ediciones`
  })}
<body>

  <main class="pagina">
    <article class="pliego">

      <header class="cabecera">
        <div class="folio">
          <span class="folio-item">EDICIONES ANTERIORES</span>
          <span class="folio-item folio-centro">NOTICIAS DE INMIGRACIÓN, EN ESPAÑOL</span>
          <a class="folio-item folio-fecha" href="/">LA PORTADA DE HOY</a>
        </div>
        <h1 class="masthead"><a href="/">Diario Migrante</a></h1>
        <div class="regla-doble"><i></i><i></i></div>
      </header>

      <section class="ediciones">
        <span class="kicker">EL ÍNDICE</span>
        <h2 class="titulo">Ediciones anteriores</h2>
        ${indice}
      </section>

      <footer class="colofon">
        <div class="regla-seccion"></div>
        <p class="colofon-linea">
          <span>DIARIO MIGRANTE · EDICIONES ANTERIORES · GRATIS, CADA MAÑANA A LAS 7</span>
        </p>
      </footer>

    </article>
  </main>

</body>
</html>`;
}

// ─── Sitemap + 404 ─────────────────────────────────────────────────────

export function sitemapXml(eds) {
  const urls = [
    `<url><loc>${ORIGIN}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${ORIGIN}/ediciones</loc><changefreq>daily</changefreq></url>`,
    `<url><loc>${ORIGIN}/registro</loc><changefreq>daily</changefreq></url>`,
    ...eds.map(e => `<url><loc>${ORIGIN}/edicion/${e.day}</loc><lastmod>${e.day}</lastmod></url>`)
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}

// ─── La superficie para agentes (markdown + llms.txt) ──────────────────

// An edition as clean markdown — headlines, summaries, source links — so an
// agent reads the paper without parsing HTML.
export function edicionMarkdown(data) {
  const s = [...(data.featured || []), ...(data.resto || [])];
  const lines = [
    `# Diario Migrante — ${fechaLarga(data.date)}`,
    '',
    `> Noticias de inmigración, en español claro. Edición permanente: ${ORIGIN}/edicion/${data.date}`,
    ''
  ];
  for (const a of s) {
    const hora = formatHora(a.published_at);
    lines.push(
      `## ${a.headline_es || a.headline}`,
      '',
      a.summary_es || a.summary,
      '',
      `Fuente: ${a.source_url ? `[${a.source_name}](${a.source_url})` : a.source_name}${hora ? ` · ${hora}` : ''}`,
      ''
    );
  }
  lines.push(
    '---',
    '',
    `Diario Migrante · gratis, cada mañana a las 7 · ${ORIGIN}`,
    `Suscripción: \`POST ${ORIGIN}/api/subscribe\` con \`{"email": "..."}\` · Guía para agentes: ${ORIGIN}/llms.txt`,
    ''
  );
  return lines.join('\n');
}

// The agent guide at /llms.txt — what the paper is, how to read it, the API.
export function llmsTxt(eds) {
  const recientes = eds.slice(0, 10)
    .map(e => `- [${e.day} — ${e.lead || 'edición'}](${ORIGIN}/edicion/${e.day}.md) (${e.count} noticia${e.count === 1 ? '' : 's'})`)
    .join('\n');
  return `# Diario Migrante

> Periódico diario de noticias de inmigración en español claro. Un agente de IA lo investiga, escribe, ilustra y envía cada mañana a las 7 (hora del este de EE. UU.). Análisis transformativo con enlaces a las fuentes originales en cada noticia. Una edición por día, sin registro, gratis.

## Leer el diario (markdown)

- [La portada de hoy](${ORIGIN}/portada.md)
- Cualquier edición: \`${ORIGIN}/edicion/YYYY-MM-DD.md\`

Ediciones recientes (${eds.length} en total):

${recientes}

## API (JSON, sin autenticación)

- \`GET ${ORIGIN}/api/portada\` — la edición de hoy: \`{ date, total, featured[], resto[] }\`; cada noticia trae \`headline_es\`, \`summary_es\`, \`source_name\`, \`source_url\`, \`published_at\`, \`image_url\`.
- \`GET ${ORIGIN}/api/portada?date=YYYY-MM-DD\` — la edición de ese día.
- \`GET ${ORIGIN}/api/editions\` — todas las ediciones: \`[{ day, count, lead }]\`, la más nueva primero.
- \`GET ${ORIGIN}/api/articles?limit=&offset=&category=&date=\` — noticias sueltas, las más nuevas primero.
- \`GET ${ORIGIN}/api/article/:id\` — una noticia completa.
- \`POST ${ORIGIN}/api/subscribe\` con \`{"email": "..."}\` — suscribe un correo a la edición diaria (confirma con la persona antes de usarla).

## MCP

Servidor MCP (Streamable HTTP, sin autenticación) en \`${ORIGIN}/mcp\` — herramientas: \`leer_edicion\`, \`listar_ediciones\`, \`buscar_noticias\`, \`noticia_completa\`, \`suscribir\`.

- Claude Code: \`claude mcp add --transport http diario https://diariomigrante.com/mcp\`
- claude.ai: Settings → Connectors → Add custom connector → \`https://diariomigrante.com/mcp\`

## Páginas (HTML)

- [Portada](${ORIGIN}/) — la edición de hoy.
- [Ediciones anteriores](${ORIGIN}/ediciones) — el índice completo; cada día vive en \`/edicion/YYYY-MM-DD\`.
- [El registro](${ORIGIN}/registro) — todo lo que llegó hoy, con hora y fuente.
- [Changelog](${ORIGIN}/changelog.md) — qué ha cambiado en el diario.
`;
}

export function notFoundPage() {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>No existe esa edición — Diario Migrante</title></head>
<body style="margin:0;background:#FFFFFF;color:#171512;font-family:Georgia,serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
<div style="text-align:center;padding:40px;">
<div style="font-size:26px;font-weight:700;">Diario Migrante</div>
<p style="font-size:17px;color:#3A3733;margin:18px 0 0;">Esa edición no existe.<br>El índice completo está en <a href="/ediciones" style="color:#171512;">diariomigrante.com/ediciones</a>.</p>
</div>
</body></html>`;
}
