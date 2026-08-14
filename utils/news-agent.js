const db = require('../database/db');

function getConfig(key, def) {
  var r = db.get("SELECT value FROM config WHERE key = ?", [key]);
  return r ? r.value : def;
}

function aiClient() {
  var apiKey = getConfig('ai_api_key', '') || process.env.AI_API_KEY || process.env.GROQ_API_KEY || '';
  var baseUrl = (getConfig('ai_base_url', '') || process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  var model = getConfig('ai_model', '') || process.env.AI_MODEL || 'llama-3.3-70b-versatile';
  return { apiKey: apiKey, baseUrl: baseUrl, model: model };
}

// Gera UMA matéria original via IA. Retorna {title, excerpt, content} ou lança erro.
async function generateOne(theme, briefing, hint, index) {
  var c = aiClient();
  if (!c.apiKey) {
    return localFallback(theme, briefing, hint);
  }
  var system = 'Você é o editor de um portal brasileiro de Games & Hacking. Escreva uma notícia ORIGINAL, atual e realista sobre o tema. Responda SOMENTE com um JSON válido em UMA linha, sem explicações e sem blocos de código, no formato: {"title":"...","excerpt":"...","content":"..."}. O título deve ter até 90 caracteres. O excerpt até 160. O content deve ter 2 a 4 parágrafos em português do Brasil, separados por \\n (nunca quebra de linha real).';
  var user = 'Tema/categoria: ' + theme + '.';
  if (briefing && briefing.trim()) user += ' Briefing do editor: ' + briefing.trim() + '.';
  if (hint) user += ' Variação sugerida: ' + hint + '.';
  if (index) user += ' Evite repetir notícias anteriores (variação ' + index + ').';
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 45000);
  try {
    var resp = await fetch(c.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.apiKey },
      body: JSON.stringify({
        model: c.model,
        temperature: 0.85,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error('API retornou ' + resp.status);
    var data = await resp.json();
    var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('Resposta da IA vazia');
    var jsonStr = content.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    jsonStr = jsonStr.slice(jsonStr.indexOf('{'), jsonStr.lastIndexOf('}') + 1);
    function parseFlex(s) {
      try { return JSON.parse(s); } catch (e) {}
      try { return JSON.parse(s.replace(/\r/g, '\\r').replace(/\n/g, '\\n')); } catch (e) {}
      try { return JSON.parse(s.replace(/[\r\n]+/g, ' ')); } catch (e) {}
      throw new Error('JSON da IA inválido');
    }
    return parseFlex(jsonStr);
  } catch (e) {
    throw e;
  }
}

function localFallback(theme, briefing, hint) {
  var titulo = (briefing && briefing.trim()) ? briefing.trim().slice(0, 80) : ('Novidades de ' + theme + ' atualizadas');
  return {
    title: titulo + ' (' + new Date().toLocaleDateString('pt-BR') + ')',
    excerpt: 'Resumo gerado localmente para ' + theme + ': confira os detalhes na matéria.',
    content: 'Esta é uma notícia de exemplo sobre ' + theme + ' gerada pelo assistente sem IA (nenhuma chave de API configurada).\n\n' + (hint || 'O conteúdo foi criado como rascunho para você revisar e publicar no painel.')
  };
}

// Cria um rascunho (rascunho = published=0) no banco.
function createDraft(theme, art, video) {
  var slug = (theme + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150);
  var id = db.saveNews({
    title: art.title,
    slug: slug,
    excerpt: art.excerpt || '',
    content: art.content || '',
    category: theme,
    image: '',
    author: 'Assistente IA',
    featured: 0,
    published: 0,
    video: video || ''
  });
  return id;
}

// Executa o agente: gera N rascunhos conforme config (ou params).
// Retorna { ok, created:[{id,theme,title}], errors:[...], total }
async function runAgent(params) {
  params = params || {};
  var enabled = params.enabled !== undefined ? params.enabled : (getConfig('news_agent_enabled', '0') === '1');
  if (!enabled && !params.force) {
    return { ok: false, reason: 'agente_desativado', created: [], errors: [], total: 0 };
  }
  var themes = (params.themes || getConfig('news_agent_themes', 'Hacking,Games'))
    .split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  var count = parseInt(params.count || getConfig('news_agent_per_run', '3'), 10);
  if (isNaN(count) || count < 1) count = 1;
  if (count > 20) count = 20;
  var briefing = params.briefing || getConfig('news_agent_briefing', '');
  var addVideo = params.video !== undefined ? params.video : (getConfig('news_agent_video', '0') === '1');
    var demoVideos = ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'];

  var created = [];
  var errors = [];
  var angulos = ['lançamento de produto', 'vazamento/leak', 'vulnerabilidade de segurança', 'torneio/competição', 'análise/tutorial', 'movimento da comunidade', 'atualização de software', 'novo dispositivo', 'polêmica/contrato', 'pesquisa/estudo'];

  // Distribui 'count' notícias entre os temas
  for (var i = 0; i < count; i++) {
    var theme = themes[i % themes.length];
    var hint = angulos[Math.floor(i / themes.length) % angulos.length];
    var hasVideo = addVideo && (i % 4 === 0);
    var video = hasVideo ? demoVideos[i % demoVideos.length] : '';
    try {
      var art = await generateOne(theme, briefing, hint, i + 1);
      var id = createDraft(theme, art, video);
      created.push({ id: id, theme: theme, title: art.title, video: !!video });
    } catch (e) {
      errors.push(theme + ': ' + e.message);
    }
    await new Promise(function (r) { setTimeout(r, 500); });
  }

  try { db.saveDb(); } catch (e) {}
  var result = { ok: true, created: created, errors: errors, total: created.length };
  // Persiste última execução
  try {
    db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('news_agent_last_run', ?)", [new Date().toISOString()]);
    db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('news_agent_last_result', ?)", [JSON.stringify({ at: new Date().toISOString(), created: created.length, errors: errors.slice(0, 5) })]);
    db.saveDb();
  } catch (e) {}
  // Log de atividade
  try {
    db.logActivity('admin', 0, 'Assistente IA', 'news_agent_run', 'Agente gerou ' + created.length + ' rascunho(s) de notícia.', 'news', 0, '');
  } catch (e) {}
  return result;
}

function getAgentConfig() {
  return {
    enabled: getConfig('news_agent_enabled', '0') === '1',
    interval: parseInt(getConfig('news_agent_interval', '6'), 10) || 6,
    themes: getConfig('news_agent_themes', 'Hacking,Games'),
    perRun: parseInt(getConfig('news_agent_per_run', '3'), 10) || 3,
    video: getConfig('news_agent_video', '0') === '1',
    briefing: getConfig('news_agent_briefing', ''),
    lastRun: getConfig('news_agent_last_run', ''),
    lastResult: (function () { try { return JSON.parse(getConfig('news_agent_last_result', '{}')); } catch (e) { return {}; } })()
  };
}

module.exports = { generateOne, createDraft, runAgent, getAgentConfig, aiClient, localFallback };
