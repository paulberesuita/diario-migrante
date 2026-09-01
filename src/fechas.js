// ─── Diario Migrante — el calendario ────────────────────────────────────
// The dates that matter to immigrants, kept by the paper: TPS end dates,
// rules taking effect, forms that change, comment deadlines, hearings.
// Every date comes out of a story the paper ran and links to its source.
//
//   /calendario                 the page (esta semana · próximas · ya pasaron)
//   /calendario/:id/:slug       one date on its own sheet
//   /calendario.ics             subscribable feed (webcal://) + /calendario/:id.ics
//   /calendario.md              the markdown twin for agents
//   GET /api/fechas             JSON · POST /api/fechas (X-API-Key) to add dates

import { ORIGIN, esc, slugify, fechaLarga, fechaMin, partes, DIAS, MESES, headHtml, seccionesHtml, noticiaPath } from './pages.js';

export const TIPOS = {
  tps: 'TPS', regla: 'REGLA NUEVA', tarifas: 'TARIFAS', corte: 'TRIBUNALES', formulario: 'FORMULARIOS',
  visas: 'VISAS', plazo: 'PLAZO', beneficios: 'BENEFICIOS', otro: 'FECHA'
};
const tipoEs = k => TIPOS[k] || TIPOS.otro;

export const fechaPath = f => `/calendario/${f.id}/${slugify(f.title)}`;

const hoyET = () => new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(new Date(day + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

// ─── Data ──────────────────────────────────────────────────────────────

export async function getFechas(env, { desde = null, hasta = null, limit = 500 } = {}) {
  const clauses = ["status != 'cancelada'"];
  const binds = [];
  if (desde) { clauses.push('day >= ?'); binds.push(desde); }
  if (hasta) { clauses.push('day <= ?'); binds.push(hasta); }
  const { results } = await env.DB.prepare(
    `SELECT f.*, a.headline_es, a.headline, a.summary_es, a.summary
     FROM fechas f LEFT JOIN articles a ON a.id = f.article_id
     WHERE ${clauses.join(' AND ')} ORDER BY f.day ASC, f.id ASC LIMIT ?`
  ).bind(...binds, limit).all();
  return results;
}

export async function getFecha(env, id) {
  const n = parseInt(id);
  if (!n) return null;
  return env.DB.prepare(
    `SELECT f.*, a.headline_es, a.headline, a.summary_es, a.summary, a.source_name AS art_source, a.published_at
     FROM fechas f LEFT JOIN articles a ON a.id = f.article_id WHERE f.id = ?`
  ).bind(n).first();
}

// Insert a batch of dates; the same event twice (same day + same title, or
// same day + same TPS country) is skipped, not doubled.
export async function insertFechas(items, env, { article = null } = {}) {
  let inserted = 0, skipped = 0;
  const errors = [];
  for (const raw of items) {
    try {
      const f = normalizeFecha(raw, article);
      if (!f) { errors.push({ title: raw?.title || null, error: 'invalid date or title' }); continue; }
      const dup = await env.DB.prepare(
        `SELECT id FROM fechas WHERE day = ? AND (lower(title) = lower(?) OR (kind = 'tps' AND country IS NOT NULL AND kind = ? AND lower(country) = lower(?)))`
      ).bind(f.day, f.title, f.kind, f.country || '').first();
      if (dup) { skipped++; continue; }
      await env.DB.prepare(
        `INSERT INTO fechas (day, title, detail, kind, country, article_id, source_name, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(f.day, f.title, f.detail, f.kind, f.country, f.article_id, f.source_name, f.source_url).run();
      inserted++;
    } catch (e) {
      errors.push({ title: raw?.title || null, error: e.message });
    }
  }
  return { inserted, skipped, errors };
}

function normalizeFecha(raw, article) {
  if (!raw || typeof raw !== 'object') return null;
  const day = String(raw.day || raw.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || isNaN(new Date(day + 'T00:00:00Z'))) return null;
  const title = String(raw.title || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (title.length < 6) return null;
  const kind = TIPOS[raw.kind] ? raw.kind : 'otro';
  return {
    day, title, kind,
    detail: raw.detail ? String(raw.detail).trim().slice(0, 600) : null,
    country: raw.country ? String(raw.country).trim().slice(0, 60) : null,
    article_id: raw.article_id || article?.id || null,
    source_name: raw.source_name || article?.source_name || null,
    source_url: raw.source_url || article?.source_url || null
  };
}

// The morning email's "esta semana vence" strip and the MCP tool read this.
export async function getProximas(env, dias = 7) {
  const hoy = hoyET();
  return getFechas(env, { desde: hoy, hasta: addDays(hoy, dias) });
}

// ─── Rows ──────────────────────────────────────────────────────────────

// "HOY" / "MAÑANA" / "EN 8 DÍAS" for the near band; the weekday otherwise.
function etiquetaDia(f, hoy) {
  const d = diffDays(hoy, f.day);
  if (d === 0) return 'HOY';
  if (d === 1) return 'MAÑANA';
  if (d > 1 && d <= 14) return `EN ${d} DÍAS`;
  return DIAS[partes(f.day).dow];
}

function filaHtml(f, hoy, { conMes = false } = {}) {
  const p = partes(f.day);
  const titulo = f.country && !f.title.toLowerCase().includes(f.country.toLowerCase()) ? `${f.title} · ${f.country}` : f.title;
  return `<a class="ed-fila cal-fila" href="${fechaPath(f)}">
          <span class="ed-fecha">
            <span class="ed-dia">${p.d}${conMes ? ` <span class="cal-mes">${MESES[p.m - 1].slice(0, 3)}</span>` : ''}</span>
            <span class="ed-nombre">${etiquetaDia(f, hoy)}</span>
          </span>
          <span class="ed-resto">
            <span class="ed-tit">${esc(titulo)}</span>
            <i class="ed-puntos"></i>
            <span class="ed-conteo">${tipoEs(f.kind)}</span>
          </span>
        </a>`;
}

function gruposPorMes(fechas, hoy) {
  let out = '', mesActual = null;
  for (const f of fechas) {
    const mes = f.day.slice(0, 7);
    const p = partes(f.day);
    if (mes !== mesActual) {
      if (mesActual) out += `</div>`;
      mesActual = mes;
      out += `<div class="ed-grupo"><div class="ed-mes"><span>${MESES[p.m - 1]} DE ${p.y}</span><i></i></div>`;
    }
    out += filaHtml(f, hoy);
  }
  if (mesActual) out += `</div>`;
  return out;
}

const CAL_AD = `<div class="col col-suscribir col-calendario">
      <span class="kicker">EN TU CALENDARIO</span>
      <div class="sus-tarifa">
        <div class="tarifa-fila"><span class="tarifa-rubro">Formato</span><i class="tarifa-puntos"></i><span class="tarifa-dato">iCal, el de tu teléfono</span></div>
        <div class="tarifa-fila"><span class="tarifa-rubro">Se actualiza</span><i class="tarifa-puntos"></i><span class="tarifa-dato">Solo, cada mañana</span></div>
        <div class="tarifa-fila"><span class="tarifa-rubro">Precio</span><i class="tarifa-puntos"></i><span class="tarifa-dato tarifa-gratis">Gratis</span></div>
      </div>
      <a class="cal-boton" href="webcal://diariomigrante.com/calendario.ics">Añadir a mi calendario</a>
      <p class="sus-note">En Google Calendar: Otros calendarios → Desde URL → pega <code>diariomigrante.com/calendario.ics</code></p>
    </div>`;

// ─── The page (/calendario) ────────────────────────────────────────────

export function calendarioPage(fechas) {
  const hoy = hoyET();
  const semana = fechas.filter(f => f.day >= hoy && diffDays(hoy, f.day) <= 7);
  const proximas = fechas.filter(f => f.day >= hoy && diffDays(hoy, f.day) > 7);
  const pasadas = fechas.filter(f => f.day < hoy).reverse().slice(0, 14);

  const semanaHtml = semana.length ? `<div class="cal-semana">
          <div class="ed-mes"><span>ESTA SEMANA</span><i></i></div>
          ${semana.map(f => filaHtml(f, hoy, { conMes: true })).join('\n          ')}
        </div>` : '';

  const proximasHtml = proximas.length ? gruposPorMes(proximas, hoy)
    : (semana.length ? '' : `<p class="prep">No hay fechas próximas registradas todavía.</p>`);

  const pasadasHtml = pasadas.length ? `<div class="cal-pasadas">
          <div class="ed-mes"><span>YA PASARON</span><i></i></div>
          ${pasadas.map(f => filaHtml(f, hoy, { conMes: true })).join('\n          ')}
        </div>` : '';

  const proxima = fechas.find(f => f.day >= hoy);
  const description = proxima
    ? `Las fechas que importan a los inmigrantes en EE. UU., en un solo lugar: vencimientos del TPS, reglas que entran en vigor, formularios que cambian, plazos y audiencias. La próxima: ${proxima.title}, el ${fechaMin(proxima.day)}.`
    : 'Las fechas que importan a los inmigrantes en EE. UU., en un solo lugar: vencimientos del TPS, reglas que entran en vigor, formularios que cambian, plazos y audiencias.';

  const jsonLd = [{
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'El calendario de Diario Migrante',
    itemListElement: fechas.filter(f => f.day >= hoy).slice(0, 30).map((f, i) => ({
      '@type': 'ListItem', position: i + 1, name: `${f.title} (${f.day})`, url: `${ORIGIN}${fechaPath(f)}`
    }))
  }];

  return `<!DOCTYPE html>
<html lang="es">
${headHtml({
    title: 'El calendario — fechas límite de TPS, reglas nuevas y plazos de inmigración — Diario Migrante',
    description,
    canonical: `${ORIGIN}/calendario`,
    jsonLd,
    alternateMd: `${ORIGIN}/calendario.md`
  })}
<body>

  <main class="pagina">
    <article class="pliego">

      <header class="cabecera">
        <div class="folio">
          <span class="folio-item">EL CALENDARIO</span>
          <span class="folio-item folio-centro">NOTICIAS DE INMIGRACIÓN, EN ESPAÑOL</span>
          <a class="folio-item folio-fecha" href="/">LA PORTADA DE HOY</a>
        </div>
        <h1 class="masthead"><a href="/">Diario Migrante</a></h1>
        <div class="regla-doble"><i></i><i></i></div>
        ${seccionesHtml('calendario')}
      </header>

      <section class="ediciones calendario">
        <span class="kicker">EL CALENDARIO</span>
        <h2 class="titulo">Las fechas que importan</h2>
        <p class="cal-intro">Vencimientos del TPS, reglas que entran en vigor, formularios que cambian, plazos para comentar y audiencias. Cada fecha sale de una noticia del diario y enlaza a su fuente.</p>
        ${semanaHtml}
        ${proximasHtml}
        ${pasadasHtml}
      </section>

      <div class="regla-seccion"></div>
      <section class="banda banda-ancha nota-banda">${CAL_AD}</section>

      <footer class="colofon">
        <div class="regla-seccion"></div>
        <p class="colofon-linea">
          <span>DIARIO MIGRANTE · EL CALENDARIO · GRATIS, CADA MAÑANA A LAS 7</span>
        </p>
      </footer>

    </article>
  </main>

</body>
</html>`;
}

// ─── One date on its own sheet (/calendario/:id/:slug) ─────────────────

export function fechaPage(f, { mismasMes = [] } = {}) {
  const hoy = hoyET();
  const url = `${ORIGIN}${fechaPath(f)}`;
  const d = diffDays(hoy, f.day);
  const cuando = d === 0 ? 'Es hoy.' : d === 1 ? 'Es mañana.' : d > 1 ? `Faltan ${d} días.` : d === -1 ? 'Fue ayer.' : `Pasó hace ${-d} días.`;
  const titular = f.headline_es || f.headline;
  const resumen = f.summary_es || f.summary;
  const title = `${f.title} — ${fechaMin(f.day)} — Diario Migrante`;
  const description = `${f.detail || f.title}. ${fechaLarga(f.day).charAt(0) + fechaLarga(f.day).slice(1).toLowerCase()}.`.replace(/\.\./g, '.');

  const jsonLd = [{
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Diario Migrante', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'El calendario', item: `${ORIGIN}/calendario` },
      { '@type': 'ListItem', position: 3, name: f.title, item: url }
    ]
  }];

  const otras = mismasMes.filter(o => o.id !== f.id);
  const otrasHtml = otras.length ? `<div class="regla-seccion"></div>
      <section class="tambien">
        <span class="kicker">TAMBIÉN EN ${MESES[partes(f.day).m - 1]}</span>
        ${otras.map(o => `<a class="ed-fila" href="${fechaPath(o)}">
          <span class="ed-fecha"><span class="ed-dia">${partes(o.day).d}</span><span class="ed-nombre">${DIAS[partes(o.day).dow]}</span></span>
          <span class="ed-resto">
            <span class="ed-tit">${esc(o.title)}</span>
            <i class="ed-puntos"></i>
            <span class="ed-conteo">${tipoEs(o.kind)}</span>
          </span>
        </a>`).join('\n        ')}
        <a class="ed-fila ed-fila-todo" href="/calendario"><span class="ed-resto"><span class="ed-tit">El calendario completo →</span></span></a>
      </section>` : `<div class="regla-seccion"></div>
      <section class="tambien">
        <a class="ed-fila ed-fila-todo" href="/calendario"><span class="ed-resto"><span class="ed-tit">El calendario completo →</span></span></a>
      </section>`;

  return `<!DOCTYPE html>
<html lang="es">
${headHtml({ title, description, canonical: url, ogType: 'article', jsonLd })}
<body>

  <main class="pagina">
    <article class="pliego">

      <header class="cabecera">
        <div class="folio">
          <a class="folio-item" href="/calendario">← EL CALENDARIO</a>
          <span class="folio-item folio-centro">NOTICIAS DE INMIGRACIÓN, EN ESPAÑOL</span>
          <a class="folio-item folio-fecha" href="/">LA PORTADA DE HOY</a>
        </div>
        <div class="masthead"><a href="/">Diario Migrante</a></div>
        <div class="regla-doble"><i></i><i></i></div>
        ${seccionesHtml('calendario')}
      </header>

      <section class="nota cal-nota">
        <div class="nota-texto">
          <span class="kicker">${tipoEs(f.kind)}${f.country ? ` · ${esc(f.country.toUpperCase())}` : ''}</span>
          <p class="cal-fecha-grande">${fechaLarga(f.day)}</p>
          <h1 class="nota-tit">${esc(f.title)}</h1>
          ${f.detail ? `<p class="nota-resumen">${esc(f.detail)}</p>` : ''}
          <p class="cal-cuando">${cuando}</p>
          <div class="cal-acciones">
            <a class="nota-fuente" href="/calendario/${f.id}.ics">Añadir a mi calendario</a>
            ${f.source_url ? `<a class="nota-fuente cal-fuente" href="${esc(f.source_url)}" target="_blank" rel="noopener">Fuente: ${esc(f.source_name || 'la nota original')} ↗</a>` : ''}
          </div>
        </div>
      </section>

      ${f.article_id && titular ? `<div class="regla-seccion"></div>
      <section class="nota-cuerpo">
        <span class="kicker">LA NOTICIA QUE LO CUENTA</span>
        <h2 class="cal-noticia-tit"><a href="${noticiaPath({ id: f.article_id, headline_es: f.headline_es, headline: f.headline })}">${esc(titular)}</a></h2>
        ${resumen ? `<p>${esc(resumen)}</p>` : ''}
        <p class="nota-nota">Fecha registrada por Diario Migrante a partir de esa noticia${f.source_name ? `, con base en ${f.source_url ? `<a href="${esc(f.source_url)}" target="_blank" rel="noopener">${esc(f.source_name)}</a>` : esc(f.source_name)}` : ''}. Verifica siempre con la fuente oficial antes de actuar.</p>
      </section>` : ''}

      ${otrasHtml}

      <div class="regla-seccion"></div>
      <section class="banda banda-ancha nota-banda">${CAL_AD}</section>

      <footer class="colofon">
        <div class="regla-seccion"></div>
        <p class="colofon-linea">
          <span>DIARIO MIGRANTE · EL CALENDARIO · GRATIS, CADA MAÑANA A LAS 7</span>
        </p>
      </footer>

    </article>
  </main>

</body>
</html>`;
}

// ─── iCalendar feed ────────────────────────────────────────────────────

const icsEscape = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545: lines fold at 75 octets, continuation lines start with a space.
function icsFold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ' ' + ch; }
    else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

function icsEvent(f, stamp) {
  const url = `${ORIGIN}${fechaPath(f)}`;
  const desc = [f.detail, f.source_name ? `Fuente: ${f.source_name}` : null, url].filter(Boolean).join('\n\n');
  return [
    'BEGIN:VEVENT',
    `UID:fecha-${f.id}@diariomigrante.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${f.day.replace(/-/g, '')}`,
    `DTEND;VALUE=DATE:${addDays(f.day, 1).replace(/-/g, '')}`,
    `SUMMARY:${icsEscape(f.country && !f.title.toLowerCase().includes(f.country.toLowerCase()) ? `${f.title} (${f.country})` : f.title)}`,
    `DESCRIPTION:${icsEscape(desc)}`,
    `URL:${url}`,
    `CATEGORIES:${icsEscape(tipoEs(f.kind))}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT'
  ];
}

export function calendarioIcs(fechas, { nombre = 'Diario Migrante · El calendario' } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Diario Migrante//El calendario//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(nombre)}`,
    'X-WR-CALDESC:Las fechas que importan a los inmigrantes en EE. UU.\\, registradas por Diario Migrante.',
    'X-WR-TIMEZONE:America/New_York',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    `URL:${ORIGIN}/calendario`,
    ...fechas.flatMap(f => icsEvent(f, stamp)),
    'END:VCALENDAR'
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

// ─── Markdown twin + email strip ───────────────────────────────────────

export function calendarioMarkdown(fechas) {
  const hoy = hoyET();
  const prox = fechas.filter(f => f.day >= hoy);
  const pas = fechas.filter(f => f.day < hoy).reverse().slice(0, 10);
  const linea = f => `- **${f.day}** — ${f.title}${f.country && !f.title.toLowerCase().includes(f.country.toLowerCase()) ? ` (${f.country})` : ''} · ${tipoEs(f.kind).toLowerCase()}${f.detail ? `\n  ${f.detail}` : ''}\n  ${ORIGIN}${fechaPath(f)}${f.source_url ? ` · Fuente: ${f.source_url}` : ''}`;
  return [
    '# Diario Migrante — El calendario',
    '',
    `> Las fechas que importan a los inmigrantes en EE. UU.: vencimientos del TPS, reglas que entran en vigor, formularios que cambian, plazos y audiencias. Cada fecha sale de una noticia del diario. Página: ${ORIGIN}/calendario · Feed iCal: ${ORIGIN}/calendario.ics · JSON: ${ORIGIN}/api/fechas`,
    '',
    `Hoy es ${hoy}.`,
    '',
    '## Próximas fechas',
    '',
    prox.length ? prox.map(linea).join('\n') : '_No hay fechas próximas registradas._',
    '',
    '## Ya pasaron',
    '',
    pas.length ? pas.map(linea).join('\n') : '_Nada todavía._',
    '',
    '---',
    '',
    `Diario Migrante · gratis, cada mañana a las 7 · ${ORIGIN} · Guía para agentes: ${ORIGIN}/llms.txt`,
    ''
  ].join('\n');
}

// "ESTA SEMANA VENCE" — a short strip for the morning email when a date is
// within the week. Returns '' when there is nothing close.
export function fechasEmailHtml(fechas) {
  if (!fechas.length) return '';
  const SERIF = "'Newsreader', Georgia, 'Times New Roman', serif";
  const SANS = "'Libre Franklin', -apple-system, Helvetica, Arial, sans-serif";
  const hoy = hoyET();
  const rows = fechas.slice(0, 4).map(f => {
    const p = partes(f.day);
    const cuando = etiquetaDia(f, hoy);
    return `<tr>
      <td class="dim" valign="top" style="padding:7px 12px 7px 0;font-family:${SANS};font-size:10.5px;font-weight:700;letter-spacing:1.5px;color:#6E6961;white-space:nowrap;">${DIAS[p.dow].slice(0, 3)} ${p.d}${cuando === 'HOY' || cuando === 'MAÑANA' ? ` &middot; ${cuando}` : ''}</td>
      <td class="ink" valign="top" style="padding:7px 0;font-family:${SERIF};font-size:15.5px;line-height:1.4;color:#171512;"><a class="ink" href="${ORIGIN}${fechaPath(f)}" style="color:#171512;text-decoration:none;">${esc(f.title)}${f.country && !f.title.toLowerCase().includes(f.country.toLowerCase()) ? ` &middot; ${esc(f.country)}` : ''}</a></td>
    </tr>`;
  }).join('\n');
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td class="hair" style="border-top:1px solid #C9C6C0;font-size:0;line-height:0;padding-top:22px;">&nbsp;</td></tr>
    <tr><td class="ink" style="padding:0 0 4px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:2px;color:#171512;">ESTA SEMANA VENCE</td></tr>
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
    <tr><td class="dim" style="padding:8px 0 24px;font-family:${SANS};font-size:11px;letter-spacing:1.5px;color:#6E6961;"><a class="dim" href="${ORIGIN}/calendario" style="color:#6E6961;text-decoration:none;">EL CALENDARIO COMPLETO &#8599;</a></td></tr>
  </table>`;
}
