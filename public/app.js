// ─── Diario Migrante — la portada como periódico ─────────────────────
// Cada historia corre con su dibujo (2026-08-12). El pliego:
//   lead = historia 1 · banda de tres = 2, 3, 4 (una por columna) ·
//   el resto en bandas anchas, de dos en dos.

document.addEventListener('DOMContentLoaded', async () => {
  setupSubscribe();

  let data = null;
  try {
    const res = await fetch('/api/portada');
    data = await res.json();
  } catch (e) { console.error('portada:', e); }

  const prep = document.getElementById('prep');
  if (!data || data.empty || !data.featured?.length) {
    prep.textContent = 'La primera edición se está escribiendo. Vuelve pronto.';
    return;
  }

  const s = [...(data.featured || []), ...(data.resto || [])];

  document.getElementById('folio-fecha').textContent = formatFecha(data.date);
  numerarEdicion(data.date);

  // ── Lead ──
  const lead = document.getElementById('lead');
  const l = s[0];
  lead.innerHTML = `
    <div class="lead-texto">
      <span class="kicker">LO QUE IMPORTA HOY</span>
      <h2 class="lead-tit">${esc(l.headline_es || l.headline)}</h2>
      <p class="lead-resumen">${esc(l.summary_es || l.summary)}</p>
      ${fuente(l)}
    </div>
    ${l.image_url ? `<figure class="lead-figura"><img src="${esc(l.image_url)}" alt="" loading="eager"></figure>` : ''}`;
  lead.hidden = false;

  // ── Banda de tres columnas ──
  if (s.length > 1) {
    const banda = document.getElementById('banda-1');
    for (const idx of [1, 2, 3]) {
      if (!s[idx]) continue;
      if (banda.children.length) banda.insertAdjacentHTML('beforeend', '<div class="divisor"></div>');
      const col = document.createElement('div');
      col.className = 'col';
      col.innerHTML = historia(s[idx]);
      banda.appendChild(col);
    }
    banda.hidden = false;
    document.getElementById('regla-1').hidden = false;
  }

  // ── Bandas anchas (el resto, de dos en dos) ──
  let prevBanda = document.getElementById('banda-2');
  for (let i = 4; i < s.length; i += 2) {
    let banda2 = prevBanda;
    if (i === 4) {
      document.getElementById('regla-2').hidden = false;
    } else {
      const regla = document.createElement('div');
      regla.className = 'regla-seccion';
      banda2 = document.createElement('section');
      banda2.className = 'banda banda-ancha';
      prevBanda.after(regla, banda2);
    }
    banda2.innerHTML = `<div class="col">${historia(s[i])}</div>` +
      (s[i + 1] ? `<div class="divisor"></div><div class="col">${historia(s[i + 1])}</div>` : '');
    banda2.hidden = false;
    prevBanda = banda2;
  }

  prep.hidden = true;
});

function historia(a) {
  return `
    <h3 class="col-tit">${esc(a.headline_es || a.headline)}</h3>
    <p class="col-resumen">${esc(a.summary_es || a.summary)}</p>
    ${fuente(a)}
    ${a.image_url ? `<figure class="col-figura"><img src="${esc(a.image_url)}" alt="" loading="lazy"></figure>` : ''}`;
}

function fuente(a) {
  const hora = formatHora(a.published_at);
  const texto = `${esc(a.source_name)}${hora ? ' · ' + hora : ''}`;
  return a.source_url
    ? `<a class="fuente" href="${esc(a.source_url)}" target="_blank" rel="noopener">${texto}</a>`
    : `<span class="fuente">${texto}</span>`;
}

// La edición se numera contando los días publicados desde el primero.
async function numerarEdicion(date) {
  try {
    const eds = await (await fetch('/api/editions')).json();
    const idx = eds.findIndex(e => e.day === date);
    if (idx === -1) return;
    const num = eds.length - idx;
    document.getElementById('folio-edicion').textContent = `EDICIÓN Nº ${num}`;
    document.getElementById('colofon-texto').textContent =
      `DIARIO MIGRANTE · EDICIÓN Nº ${num} · GRATIS, CADA MAÑANA A LAS 7`;
  } catch {}
}

// ─── Subscribe ───────────────────────────────────────────────────────

function setupSubscribe() {
  const cta = document.getElementById('cta');
  const form = document.getElementById('suscribir');
  cta.addEventListener('click', () => {
    form.hidden = false;
    cta.style.display = 'none';
    document.getElementById('email').focus();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const note = document.getElementById('sus-note');
    if (!email) return;
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      note.textContent = res.ok ? 'Listo. Llega cada mañana.' : 'Algo falló. Intenta de nuevo.';
      if (res.ok) form.querySelector('input').value = '';
    } catch {
      note.textContent = 'Algo falló. Intenta de nuevo.';
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatFecha(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d)
    .toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .toUpperCase();
}

function formatHora(ts) {
  if (!ts) return '';
  let [h, min] = ts.slice(11, 16).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(min).padStart(2, '0')} ${ampm}`;
}

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
