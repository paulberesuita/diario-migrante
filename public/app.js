// ─── Diario Migrante — el pliego llega impreso del servidor ──────────
// La portada se renderiza en el Worker (src/pages.js); aquí solo vive la
// suscripción.

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('suscribir');
  if (!form) return;
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
});
