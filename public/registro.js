// ─── El registro — todo lo que llegó hoy ─────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  const q = params.get('date') ? `?date=${encodeURIComponent(params.get('date'))}` : '';

  let data;
  try {
    const res = await fetch(`/api/portada${q}`);
    data = await res.json();
  } catch (e) {
    console.error('registro:', e);
    return;
  }
  if (!data || data.empty) return;

  document.getElementById('fecha').textContent = formatFecha(data.date);

  const destacados = new Set((data.featured || []).map(a => a.id));
  const todos = [...(data.featured || []), ...(data.resto || [])]
    .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));

  const rows = document.getElementById('rows');
  todos.forEach(a => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <span class="dotlane">${destacados.has(a.id) ? '<i></i>' : ''}</span>
      <span class="hora">${formatHora(a.published_at)}</span>
      <p class="texto"><a href="${escapeHtml(a.source_url || '#')}" target="_blank" rel="noopener">${escapeHtml(a.headline_es || a.headline)}</a> <span class="fuente-inline">${escapeHtml(a.source_name)}</span></p>`;
    rows.appendChild(row);
  });

  const fuentes = new Set(todos.map(a => a.source_name)).size;
  document.getElementById('conteo').textContent =
    `${todos.length} expedientes · ${fuentes} fuentes · escrito a las 7:00`;

  // Day navigation from the editions list
  try {
    const eds = await (await fetch('/api/editions')).json();
    const i = eds.findIndex(e => e.day === data.date);
    const nav = document.getElementById('dias');
    if (nav && i !== -1) {
      const links = [];
      if (i + 1 < eds.length) links.push(`<a class="nav-link" href="/registro?date=${eds[i + 1].day}">← ayer</a>`);
      if (i > 0) links.push(`<a class="nav-link" href="/registro?date=${eds[i - 1].day}">siguiente →</a>`);
      if (i !== 0) links.push(`<a class="nav-link" href="/registro">hoy →</a>`);
      nav.innerHTML = links.join('');
      nav.style.display = 'flex';
    }
  } catch {}
});

function formatFecha(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatHora(ts) {
  if (!ts) return '';
  return ts.slice(11, 16);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
