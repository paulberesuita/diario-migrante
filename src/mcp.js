// ─── Diario Migrante — servidor MCP (/mcp) ─────────────────────────────
// The paper as a tool: any MCP client (Claude Code, claude.ai connectors,
// other agents) connects over Streamable HTTP and reads the news. Hand-rolled
// stateless JSON-RPC — no sessions, no SSE, no dependencies.
//
//   claude mcp add --transport http diario https://diariomigrante.com/mcp

import { edicionMarkdown, fechaLarga, ORIGIN } from './pages.js';

const PROTOCOL = '2025-06-18';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id'
};

const TOOLS = [
  {
    name: 'leer_edicion',
    description: 'Lee una edición completa del diario en markdown: titulares, resúmenes y enlaces a las fuentes originales. Sin fecha devuelve la edición de hoy.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Día de la edición, formato YYYY-MM-DD. Omitir para la edición de hoy.' }
      }
    }
  },
  {
    name: 'listar_ediciones',
    description: 'Lista todas las ediciones publicadas, la más nueva primero: fecha, titular principal y número de noticias.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'buscar_noticias',
    description: 'Busca en todas las noticias del diario por palabra clave (titulares y resúmenes, en español e inglés). Devuelve las coincidencias más recientes primero, con el id de cada noticia.',
    inputSchema: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Palabra o frase a buscar' },
        limite: { type: 'number', description: 'Máximo de resultados (1-50, default 10)' }
      },
      required: ['consulta']
    }
  },
  {
    name: 'noticia_completa',
    description: 'Devuelve una noticia completa por su id, incluido el cuerpo del artículo. El titular y el resumen van en español; el cuerpo está en inglés.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'El id de la noticia (lo dan buscar_noticias y la API)' } },
      required: ['id']
    }
  },
  {
    name: 'suscribir',
    description: 'Suscribe un correo a la edición diaria por email (gratis, cada mañana a las 7, hora del este de EE. UU.). Confirma con la persona antes de suscribirla.',
    inputSchema: {
      type: 'object',
      properties: { email: { type: 'string', description: 'El correo a suscribir' } },
      required: ['email']
    }
  }
];

class ToolError extends Error {}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

const rpcResult = (id, result) => json({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

// deps = { getPortadaData, getEditions, subscribeEmail } — handed in by
// worker.js so the data layer stays in one place (and imports stay acyclic).
export async function handleMCP(request, env, deps) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') {
    return new Response('Diario Migrante MCP. POST JSON-RPC here (Streamable HTTP). Guía: https://diariomigrante.com/llms.txt\n', {
      status: 405, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS }
    });
  }

  let msg;
  try { msg = await request.json(); } catch { return rpcError(null, -32700, 'Parse error'); }
  if (!msg || Array.isArray(msg) || !msg.method) return rpcError(msg?.id, -32600, 'Invalid request');

  const { id, method, params = {} } = msg;

  // Notifications (no id) are acknowledged and dropped — this server keeps no state.
  if (id === undefined) return new Response(null, { status: 202, headers: CORS });

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: 'diario-migrante', title: 'Diario Migrante', version: '1.0.0' },
      instructions: 'El diario de noticias de inmigración en español, escrito cada mañana. leer_edicion devuelve la portada de hoy (o de cualquier día) en markdown; buscar_noticias encuentra coberturas pasadas; noticia_completa da el cuerpo entero; suscribir apunta un correo a la edición diaria.'
    });
  }
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });

  if (method === 'tools/call') {
    const name = params.name;
    if (!TOOLS.some(t => t.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
    try {
      const text = await callTool(name, params.arguments || {}, env, deps);
      return rpcResult(id, { content: [{ type: 'text', text }] });
    } catch (e) {
      if (e instanceof ToolError) return rpcResult(id, { content: [{ type: 'text', text: e.message }], isError: true });
      return rpcError(id, -32603, e.message);
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

async function callTool(name, args, env, deps) {
  if (name === 'leer_edicion') {
    const fecha = args.fecha ? String(args.fecha).trim() : null;
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ToolError('La fecha debe tener formato YYYY-MM-DD.');
    const data = await deps.getPortadaData(env, fecha);
    if (!data || data.empty || !data.featured?.length) {
      throw new ToolError(`No existe una edición del ${fecha}. listar_ediciones da el índice completo.`);
    }
    return edicionMarkdown(data);
  }

  if (name === 'listar_ediciones') {
    const eds = await deps.getEditions(env);
    if (!eds.length) return 'Todavía no hay ediciones publicadas.';
    const lineas = eds.map(e => `- ${e.day} (${fechaLarga(e.day).toLowerCase()}) — «${e.lead}» — ${e.count} noticia${e.count === 1 ? '' : 's'}`);
    return `${eds.length} ediciones publicadas, la más nueva primero:\n\n${lineas.join('\n')}\n\nCada una se lee con leer_edicion o en ${ORIGIN}/edicion/YYYY-MM-DD`;
  }

  if (name === 'buscar_noticias') {
    const q = String(args.consulta || '').trim();
    if (!q) throw new ToolError('Falta la consulta.');
    const limite = Math.min(Math.max(parseInt(args.limite) || 10, 1), 50);
    const like = `%${q.replace(/[%_]/g, ' ')}%`;
    const { results } = await env.DB.prepare(
      `SELECT id, headline, headline_es, summary, summary_es, source_name, source_url, date(published_at) AS day
       FROM articles
       WHERE headline LIKE ?1 OR headline_es LIKE ?1 OR summary LIKE ?1 OR summary_es LIKE ?1
       ORDER BY published_at DESC LIMIT ?2`
    ).bind(like, limite).all();
    if (!results.length) return `Sin resultados para «${q}».`;
    const lineas = results.map(a =>
      `- [id ${a.id} · ${a.day}] ${a.headline_es || a.headline}\n  ${a.summary_es || a.summary}\n  Fuente: ${a.source_name}${a.source_url ? ` — ${a.source_url}` : ''}`
    );
    return `${results.length} resultado${results.length === 1 ? '' : 's'} para «${q}»:\n\n${lineas.join('\n\n')}`;
  }

  if (name === 'noticia_completa') {
    const artId = parseInt(args.id);
    if (!artId) throw new ToolError('Falta el id de la noticia.');
    const a = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(artId).first();
    if (!a) throw new ToolError(`No existe la noticia ${artId}.`);
    return [
      `# ${a.headline_es || a.headline}`,
      '',
      a.summary_es || a.summary,
      '',
      `Edición: ${a.published_at?.slice(0, 10)} · Fuente: ${a.source_name}${a.source_url ? ` — ${a.source_url}` : ''}`,
      '',
      '## Cuerpo (en inglés)',
      '',
      a.body || '(sin cuerpo)'
    ].join('\n');
  }

  if (name === 'suscribir') {
    const r = await deps.subscribeEmail(env, args.email);
    if (!r.ok) throw new ToolError('Ese correo no es válido.');
    return r.nuevo
      ? `Listo. ${r.email} recibirá la edición cada mañana a las 7 (hora del este). Se puede cancelar desde cualquier correo.`
      : `${r.email} ya estaba suscrito.`;
  }

  throw new ToolError(`Unknown tool: ${name}`);
}
