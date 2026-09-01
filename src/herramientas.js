// ─── Diario Migrante — las herramientas ─────────────────────────────────
// Living reference pages in plain Spanish, each answering one question
// people search: how long USCIS takes, what the visa bulletin says this
// month, what the forms cost, where the TPS stands country by country.
// A weekly cloud routine re-reads each official source and rewrites the
// page through the API, the way the morning routine writes the news.
//
//   /herramientas                the index
//   /herramientas/:slug          one page (+ .md twin)
//   GET /api/herramientas        JSON · POST /api/herramientas/:slug (X-API-Key)

import { ORIGIN, esc, fechaMin, headHtml, seccionesHtml, mdToHtml, SUSCRIBIR_COL } from './pages.js';

export const SLUGS = ['tiempos-de-procesamiento', 'boletin-de-visas', 'tarifas', 'tps'];

export const herramientaPath = h => `/herramientas/${h.slug}`;

// ─── Data ──────────────────────────────────────────────────────────────

export async function getHerramientas(env) {
  const { results } = await env.DB.prepare(
    'SELECT slug, title, intro, source_name, source_url, checked_at, updated_at FROM herramientas ORDER BY orden ASC, slug ASC'
  ).all();
  return results;
}

export async function getHerramienta(env, slug) {
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return null;
  return env.DB.prepare('SELECT * FROM herramientas WHERE slug = ?').bind(slug).first();
}

export async function upsertHerramienta(env, slug, raw) {
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) throw new Error('bad slug');
  const title = String(raw.title || '').trim().slice(0, 120);
  const intro = String(raw.intro || '').trim().slice(0, 300);
  const body = String(raw.body || '').trim();
  if (title.length < 4) throw new Error('title required');
  if (body.length < 200) throw new Error('body too short (min 200 chars)');
  const checked = /^\d{4}-\d{2}-\d{2}$/.test(raw.checked_at || '') ? raw.checked_at : new Date().toISOString().slice(0, 10);
  const orden = Number.isInteger(raw.orden) ? raw.orden : (SLUGS.indexOf(slug) >= 0 ? SLUGS.indexOf(slug) : 99);
  await env.DB.prepare(
    `INSERT INTO herramientas (slug, title, intro, body, source_name, source_url, checked_at, orden, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(slug) DO UPDATE SET title = excluded.title, intro = excluded.intro, body = excluded.body,
       source_name = excluded.source_name, source_url = excluded.source_url, checked_at = excluded.checked_at,
       orden = excluded.orden, updated_at = datetime('now')`
  ).bind(slug, title, intro, body, raw.source_name ? String(raw.source_name).slice(0, 120) : null,
    raw.source_url ? String(raw.source_url).slice(0, 500) : null, checked, orden).run();
  return getHerramienta(env, slug);
}

// ─── The index (/herramientas) ─────────────────────────────────────────

const fechaCorta = day => {
  const f = fechaMin(day); // "martes 1 de septiembre de 2026"
  return f.split(' ').slice(1).join(' ');
};

export function herramientasPage(items) {
  const filas = items.length ? items.map(h => `<a class="ed-fila her-fila" href="${herramientaPath(h)}">
          <span class="her-texto">
            <span class="her-tit">${esc(h.title)}</span>
            <span class="her-intro">${esc(h.intro || '')}</span>
          </span>
          <span class="ed-conteo her-fecha">ACTUALIZADA EL ${esc(fechaCorta(h.checked_at || h.updated_at.slice(0, 10)).toUpperCase())}</span>
        </a>`).join('\n        ')
    : `<p class="prep">Las primeras herramientas se están escribiendo. Vuelve pronto.</p>`;

  const description = 'Las herramientas de Diario Migrante: cuánto tarda USCIS, qué dice el boletín de visas este mes, cuánto cuesta cada formulario y cómo va el TPS país por país. En español claro, revisadas cada semana contra la fuente oficial.';

  const jsonLd = [{
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Las herramientas de Diario Migrante',
    itemListElement: items.map((h, i) => ({ '@type': 'ListItem', position: i + 1, name: h.title, url: `${ORIGIN}${herramientaPath(h)}` }))
  }];

  return `<!DOCTYPE html>
<html lang="es">
${headHtml({
    title: 'Las herramientas — tiempos de USCIS, boletín de visas, tarifas y TPS, en español — Diario Migrante',
    description,
    canonical: `${ORIGIN}/herramientas`,
    jsonLd,
    alternateMd: `${ORIGIN}/herramientas.md`
  })}
<body>

  <main class="pagina">
    <article class="pliego">

      <header class="cabecera">
        <div class="folio">
          <span class="folio-item">LAS HERRAMIENTAS</span>
          <span class="folio-item folio-centro">NOTICIAS DE INMIGRACIÓN, EN ESPAÑOL</span>
          <a class="folio-item folio-fecha" href="/">LA PORTADA DE HOY</a>
        </div>
        <h1 class="masthead"><a href="/">Diario Migrante</a></h1>
        <div class="regla-doble"><i></i><i></i></div>
        ${seccionesHtml('herramientas')}
      </header>

      <section class="ediciones herramientas">
        <span class="kicker">LAS HERRAMIENTAS</span>
        <h2 class="titulo">Lo que más se pregunta, al día</h2>
        <p class="cal-intro">Cuatro páginas en español claro que responden una pregunta cada una. Cada semana el diario vuelve a leer la fuente oficial y las reescribe con los números de hoy; cada una dice cuándo se revisó y de dónde salió.</p>
        ${filas}
      </section>

      <div class="regla-seccion"></div>
      <section class="banda banda-ancha nota-banda">${SUSCRIBIR_COL}</section>

      <footer class="colofon">
        <div class="regla-seccion"></div>
        <p class="colofon-linea">
          <span>DIARIO MIGRANTE · LAS HERRAMIENTAS · GRATIS, CADA MAÑANA A LAS 7</span>
        </p>
      </footer>

    </article>
  </main>

  <script src="/app.js"></script>
</body>
</html>`;
}

// ─── One tool (/herramientas/:slug) ────────────────────────────────────

export function herramientaPage(h, { otras = [] } = {}) {
  const url = `${ORIGIN}${herramientaPath(h)}`;
  const revisada = h.checked_at || h.updated_at.slice(0, 10);
  const title = `${h.title} — Diario Migrante`;
  const description = `${h.intro || h.title} Revisada contra la fuente oficial el ${fechaCorta(revisada)}.`;
  const cuerpo = mdToHtml(h.body);

  const jsonLd = [{
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: h.title,
    description: h.intro || undefined,
    url,
    inLanguage: 'es',
    dateModified: `${revisada}T12:00:00Z`,
    ...(h.source_url ? { isBasedOn: h.source_url } : {}),
    publisher: { '@type': 'NewsMediaOrganization', name: 'Diario Migrante', url: ORIGIN }
  }, {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Diario Migrante', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Las herramientas', item: `${ORIGIN}/herramientas` },
      { '@type': 'ListItem', position: 3, name: h.title, item: url }
    ]
  }];

  const rest = otras.filter(o => o.slug !== h.slug);
  const otrasHtml = `<div class="regla-seccion"></div>
      <section class="tambien">
        <span class="kicker">LAS DEMÁS HERRAMIENTAS</span>
        ${rest.map(o => `<a class="ed-fila" href="${herramientaPath(o)}">
          <span class="ed-resto">
            <span class="ed-tit">${esc(o.title)}</span>
            <i class="ed-puntos"></i>
            <span class="ed-conteo">${esc(fechaCorta(o.checked_at || o.updated_at.slice(0, 10)).toUpperCase())}</span>
          </span>
        </a>`).join('\n        ')}
        <a class="ed-fila ed-fila-todo" href="/herramientas"><span class="ed-resto"><span class="ed-tit">Todas las herramientas →</span></span></a>
      </section>`;

  return `<!DOCTYPE html>
<html lang="es">
${headHtml({ title, description, canonical: url, ogType: 'article', jsonLd, alternateMd: `${ORIGIN}/herramientas/${h.slug}.md` })}
<body>

  <main class="pagina">
    <article class="pliego">

      <header class="cabecera">
        <div class="folio">
          <a class="folio-item" href="/herramientas">← LAS HERRAMIENTAS</a>
          <span class="folio-item folio-centro">NOTICIAS DE INMIGRACIÓN, EN ESPAÑOL</span>
          <a class="folio-item folio-fecha" href="/">LA PORTADA DE HOY</a>
        </div>
        <div class="masthead"><a href="/">Diario Migrante</a></div>
        <div class="regla-doble"><i></i><i></i></div>
        ${seccionesHtml('herramientas')}
      </header>

      <section class="nota cal-nota">
        <div class="nota-texto">
          <span class="kicker">HERRAMIENTA · REVISADA EL ${esc(fechaCorta(revisada).toUpperCase())}</span>
          <h1 class="nota-tit">${esc(h.title)}</h1>
          ${h.intro ? `<p class="nota-resumen">${esc(h.intro)}</p>` : ''}
          ${h.source_url ? `<div class="cal-acciones"><a class="nota-fuente" href="${esc(h.source_url)}" target="_blank" rel="noopener">Fuente oficial: ${esc(h.source_name || 'ver')} ↗</a></div>` : ''}
        </div>
      </section>

      <div class="regla-seccion"></div>
      <section class="nota-cuerpo her-cuerpo">
        ${cuerpo}
        <p class="nota-nota">Diario Migrante resume la fuente oficial en español claro y la revisa cada semana; los datos y las fechas son de ${h.source_url ? `<a href="${esc(h.source_url)}" target="_blank" rel="noopener">${esc(h.source_name || 'la fuente')}</a>` : esc(h.source_name || 'la fuente')}. No es asesoría legal: antes de actuar, confirma con la fuente oficial o con un representante acreditado.</p>
      </section>

      ${otrasHtml}

      <div class="regla-seccion"></div>
      <section class="banda banda-ancha nota-banda">${SUSCRIBIR_COL}</section>

      <footer class="colofon">
        <div class="regla-seccion"></div>
        <p class="colofon-linea">
          <span>DIARIO MIGRANTE · LAS HERRAMIENTAS · GRATIS, CADA MAÑANA A LAS 7</span>
        </p>
      </footer>

    </article>
  </main>

  <script src="/app.js"></script>
</body>
</html>`;
}

// ─── Markdown twins ────────────────────────────────────────────────────

export function herramientaMarkdown(h) {
  const revisada = h.checked_at || h.updated_at.slice(0, 10);
  return [
    `# ${h.title}`,
    '',
    h.intro ? `> ${h.intro}` : '',
    '',
    `Revisada el ${revisada} · Fuente oficial: ${h.source_url ? `[${h.source_name || 'fuente'}](${h.source_url})` : (h.source_name || '')} · Permalink: ${ORIGIN}${herramientaPath(h)}`,
    '',
    h.body,
    '',
    '---',
    '',
    `Diario Migrante · gratis, cada mañana a las 7 · ${ORIGIN} · Guía para agentes: ${ORIGIN}/llms.txt`,
    ''
  ].join('\n');
}

export function herramientasMarkdown(items) {
  return [
    '# Diario Migrante — Las herramientas',
    '',
    `> Páginas de referencia en español claro, revisadas cada semana contra la fuente oficial. Índice: ${ORIGIN}/herramientas · JSON: ${ORIGIN}/api/herramientas`,
    '',
    ...items.map(h => `- [${h.title}](${ORIGIN}${herramientaPath(h)}.md) — ${h.intro || ''} (revisada el ${h.checked_at || h.updated_at.slice(0, 10)})`),
    '',
    '---',
    '',
    `Diario Migrante · gratis, cada mañana a las 7 · ${ORIGIN} · Guía para agentes: ${ORIGIN}/llms.txt`,
    ''
  ].join('\n');
}
