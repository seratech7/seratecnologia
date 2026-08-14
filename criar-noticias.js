const db = require('./database/db');

function getConfig(key, def) {
  var r = db.get("SELECT value FROM config WHERE key = ?", [key]);
  return r ? r.value : def;
}

async function gerarComIA(theme, apiKey, baseUrl, model) {
  var system = 'Você é um redator de um site brasileiro de Games & Hacking. Escreva uma notícia original, atual e realista sobre o tema informado. Responda SOMENTE com um JSON válido em UMA ÚNICA LINHA, sem explicações e sem blocos de código, no formato: {"title":"...","excerpt":"...","content":"..."}. O excerpt deve ter no máximo 160 caracteres. O content deve ser 2 a 4 parágrafos em português do Brasil, usando \\n para separar parágrafos (nunca quebras de linha reais).';
  var user = 'Tema da notícia: ' + theme;
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 45000);
  var resp = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: model,
      temperature: 0.8,
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
}

function gerarLocal(theme, i) {
  var titulos = {
    'Hacking': ['Nova falha crítica explorada em roteadores populares', 'Grupo de pesquisa divulga técnica de bypass em 2FA', 'Atualização de segurança corrige vulnerabilidade zero-day'],
    'Games': ['Studio anuncia remake do clássico cult de RPG', 'Patch surpreende jogadores com modo cooperativo', 'Torneio brasileiro bate recorde de audiência'],
    'Tecnologia': ['Processador de baixo custo promete ganho de desempenho', 'Nova geração de SSDs chega com preços acessíveis', 'Framework open-source agiliza automação residencial']
  };
  var lista = titulos[theme] || ['Notícia de ' + theme + ' atualizada hoje'];
  var title = lista[i % lista.length] + ' (' + new Date().toLocaleDateString('pt-BR') + ')';
  var excerpt = 'Resumo gerado localmente para o tema ' + theme + ': confira os detalhes e contexto completo na matéria.';
  var content = 'Esta é uma notícia de exemplo sobre ' + theme + ' publicada automaticamente pelo script de criação de notícias.\n\nO conteúdo foi gerado sem IA (fallback local) porque nenhuma chave de API está configurada. Para notícias reais, configure ai_api_key nas configurações do sistema.\n\nAtualize o banco e recarregue a página /noticias para ver esta publicação no tema ' + theme + '.';
  return { title: title, excerpt: excerpt, content: content };
}

async function criar(theme, usarIA) {
  var art;
  if (usarIA) {
    var apiKey = getConfig('ai_api_key', '') || process.env.AI_API_KEY || process.env.GROQ_API_KEY || '';
    var baseUrl = (getConfig('ai_base_url', '') || process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
    var model = getConfig('ai_model', '') || process.env.AI_MODEL || 'llama-3.3-70b-versatile';
    art = await gerarComIA(theme, apiKey, baseUrl, model);
  } else {
    art = gerarLocal(theme, 0);
  }
  var slug = (theme + '-' + Date.now()).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  var id = db.saveNews({
    title: art.title,
    slug: slug,
    excerpt: art.excerpt,
    content: art.content,
    category: theme,
    image: '',
    author: 'Redação Automática',
    featured: 0,
    published: 1
  });
  return id;
}

(async () => {
  try { await db.initDb(); } catch (e) { console.log('init err', e.message); }
  var temas = (process.argv[2] || 'Hacking,Games').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  var usarIA = !!(getConfig('ai_api_key', '') || process.env.AI_API_KEY || process.env.GROQ_API_KEY);
  console.log('Modo IA:', usarIA ? 'ligado' : 'fallback local (sem chave de API)');
  var criados = [];
  for (var i = 0; i < temas.length; i++) {
    try {
      var id = await criar(temas[i], usarIA);
      criados.push(temas[i] + ' (id ' + id + ')');
      console.log('Criada notícia para tema:', temas[i]);
    } catch (e) {
      console.log('Falha no tema', temas[i], '-', e.message, '| usando fallback local');
      try {
        var id2 = await criar(temas[i], false);
        criados.push(temas[i] + ' (id ' + id2 + ', local)');
      } catch (e2) { console.log('Fallback também falhou:', e2.message); }
    }
  }
  try { db.saveDb(); } catch (e) { console.log('saveDb err', e.message); }
  console.log('Total criadas:', criados.length, criados.join(', '));
})();
