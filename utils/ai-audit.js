const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const { getBackups } = require('../backup-db');

// ============================================================
// MOTOR DE AUDITORIA INTELIGENTE
// Varre todo o sistema (env, banco, config, arquivos, runtime)
// e gera um relatório estruturado de problemas/vulnerabilidades.
// Opcionalmente envia os achados a uma API de IA (OpenAI-compatível)
// para gerar análise em linguagem natural e recomendações.
// ============================================================

function getConfig(key, def) {
  var r = db.get("SELECT value FROM config WHERE key = ?", [key]);
  return r ? r.value : def;
}

function nowIso() {
  return new Date().toISOString();
}

// Coleta contexto do sistema para a análise de IA
function collectContext() {
  var ctx = { env: {}, db: {}, config: {}, runtime: {} };
  var check = process.env.NODE_ENV === 'production';
  ctx.runtime = {
    node: process.version,
    platform: process.platform,
    production: check,
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    pid: process.pid
  };
  var keys = ['SESSION_SECRET', 'AUTH_PEPPER', 'SESSION_ENC_KEY', 'ADMIN_PASSWORD', 'ADMIN_USERNAME', 'BASE_URL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'DISCORD_WEBHOOK_URL', 'SENDGRID_API_KEY'];
  keys.forEach(function(k) {
    ctx.env[k] = process.env[k] ? 'SET' : 'NOT_SET';
  });
  var dbInfo = db.get('SELECT COUNT(*) as c FROM sqlite_master WHERE type = "table"');
  ctx.db.tables = dbInfo ? dbInfo.c : 0;
  try {
    var f = fs.statSync(process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, '..', 'database.sqlite'));
    ctx.db.sizeBytes = f.size;
  } catch(e) {}
  return ctx;
}

// ---------------- VERIFICAÇÕES ----------------
// Cada check retorna { code, severity, category, title, description, evidence, recommendation, link }
// severity: critical | high | medium | low | info

function checkEnvSecurity(findings) {
  if (!process.env.SESSION_SECRET) {
    findings.push({
      code: 'ENV_SESSION_SECRET', severity: 'high', category: 'security', title: 'SESSION_SECRET não definida',
      description: 'O segredo de sessão é gerado aleatoriamente a cada reinício do servidor. Todos os administradores/vendedores serão deslogados a cada deploy e sessões não persistem.',
      evidence: 'process.env.SESSION_SECRET está ausente', recommendation: 'Defina SESSION_SECRET no painel do Render (Environment > Env Vars) com um valor fixo e longo.',
      link: '/admin/seguranca'
    });
  }
  if (!process.env.AUTH_PEPPER) {
    findings.push({
      code: 'ENV_AUTH_PEPPER', severity: 'high', category: 'security', title: 'AUTH_PEPPER ausente',
      description: 'Sem o pepper, os hashes de senha usam um pepper aleatório gerado a cada boot. As senhas gravadas não poderão mais ser validadas após reinício/deploy, bloqueando logins de vendedores e clientes.',
      evidence: 'process.env.AUTH_PEPPER está ausente', recommendation: 'Defina AUTH_PEPPER com um valor aleatório fixo e estável no Render.',
      link: '/admin/seguranca'
    });
  }
  if (!process.env.SESSION_ENC_KEY) {
    findings.push({
      code: 'ENV_SESSION_ENC_KEY', severity: 'high', category: 'security', title: 'SESSION_ENC_KEY ausente',
      description: 'A chave de encriptação de sessão é aleatória a cada boot, impedindo a persistência de sessões autenticadas entre reinícios.',
      evidence: 'process.env.SESSION_ENC_KEY está ausente', recommendation: 'Defina SESSION_ENC_KEY com um valor fixo de 32+ caracteres.',
      link: '/admin/seguranca'
    });
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'admn123') {
    findings.push({
      code: 'ENV_ADMIN_PASSWORD', severity: 'critical', category: 'security', title: 'Senha padrão do admin em uso',
      description: 'O servidor está usando a senha padrão "admn123" para o administrador principal. Qualquer pessoa que conheça o padrão pode tentar invadir o painel.',
      evidence: process.env.ADMIN_PASSWORD ? 'ADMIN_PASSWORD definida como valor padrão' : 'ADMIN_PASSWORD não definida (usa padrão admn123)',
      recommendation: 'Defina ADMIN_PASSWORD no Render e troque a senha em /admin/senha.',
      link: '/admin/senha'
    });
  }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    findings.push({
      code: 'ENV_VAPID_KEYS', severity: 'low', category: 'security', title: 'Chaves VAPID de notificações push ausentes',
      description: 'As chaves VAPID do web-push não estão definidas, então notificações push do navegador podem não funcionar em produção.',
      evidence: 'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes', recommendation: 'Configure as chaves VAPID no Render para ativar notificações push.',
      link: '/admin/marketing'
    });
  }
  if (process.env.NODE_ENV !== 'production') {
    findings.push({
      code: 'ENV_NODE_ENV', severity: 'low', category: 'security', title: 'NODE_ENV não é "production"',
      description: 'O sistema está rodando em modo desenvolvimento. Em produção o Express esconde stacks de erro e o comportamento de cookies/sessão muda.',
      evidence: 'NODE_ENV = ' + (process.env.NODE_ENV || 'não definido'), recommendation: 'Defina NODE_ENV=production no Render.',
      link: '/admin/config'
    });
  }
}

function checkConfigSecurity(findings) {
  var toggles = {};
  try { db.getAllToggles().forEach(function(t) { toggles[t.key] = t.value; }); } catch(e) {}
  var mp = getConfig('mp_access_token', '');
  if (!mp) {
    findings.push({
      code: 'CFG_MP_TOKEN', severity: 'medium', category: 'config', title: 'Token do Mercado Pago não configurado',
      description: 'O access token do Mercado Pago está vazio. Checkout com cartão/MP não funcionará e relatórios de pagamento ficarão incompletos.',
      evidence: 'mp_access_token = (vazio)', recommendation: 'Informe seu access token do Mercado Pago em Configurações.',
      link: '/admin/config'
    });
  }
  var pixKey = getConfig('pix_key_platform', '');
  if (!pixKey) {
    findings.push({
      code: 'CFG_PIX_KEY', severity: 'medium', category: 'config', title: 'Chave PIX da plataforma ausente',
      description: 'Não há chave PIX da plataforma configurada. Compras via PIX podem não ter um destinatário padrão.',
      evidence: 'pix_key_platform = (vazio)', recommendation: 'Cadastre a chave PIX da plataforma em Configurações.',
      link: '/admin/config'
    });
  }
  var maint = getConfig('maintenance_mode', '0');
  if (maint === '1') {
    findings.push({
      code: 'CFG_MAINTENANCE', severity: 'info', category: 'config', title: 'Modo de manutenção ATIVO',
      description: 'O site está em manutenção. Visitantes não vendedores veem a página de manutenção. Verifique se é intencional.',
      evidence: 'maintenance_mode = 1', recommendation: 'Desative o modo de manutenção quando a manutenção terminar.',
      link: '/admin/config'
    });
  }
  var commission = parseFloat(getConfig('commission_pct', '10'));
  if (isNaN(commission) || commission < 0 || commission > 100) {
    findings.push({
      code: 'CFG_COMMISSION', severity: 'medium', category: 'config', title: 'Comissão inválida',
      description: 'O percentual de comissão está fora do intervalo válido (0–100), o que pode corromper cálculos financeiros.',
      evidence: 'commission_pct = ' + getConfig('commission_pct'), recommendation: 'Corrija o percentual de comissão em Configurações.',
      link: '/admin/config'
    });
  }
  var maxProd = parseInt(getConfig('max_products_per_seller', '50'), 10);
  if (isNaN(maxProd) || maxProd <= 0) {
    findings.push({
      code: 'CFG_MAX_PRODUCTS', severity: 'low', category: 'config', title: 'Limite de produtos por vendedor inválido',
      description: 'O limite de produtos por vendedor não é um número válido, podendo bloquear ou liberar cadastros indevidamente.',
      evidence: 'max_products_per_seller = ' + getConfig('max_products_per_seller'), recommendation: 'Defina um número positivo.',
      link: '/admin/config'
    });
  }
  var uploadMax = parseInt(getConfig('upload_max_size', '5'), 10);
  if (isNaN(uploadMax) || uploadMax <= 0) {
    findings.push({
      code: 'CFG_UPLOAD_SIZE', severity: 'medium', category: 'config', title: 'Limite de upload inválido',
      description: 'upload_max_size não é um número válido; envios de imagem podem falhar ou aceitar arquivos grandes demais.',
      evidence: 'upload_max_size = ' + getConfig('upload_max_size'), recommendation: 'Defina um valor em MB (ex.: 5).',
      link: '/admin/seguranca'
    });
  } else if (uploadMax > 20) {
    findings.push({
      code: 'CFG_UPLOAD_BIG', severity: 'low', category: 'security', title: 'Limite de upload muito alto',
      description: 'O limite de upload está acima de 20MB, aumentando o risco de ataques de exaustão de disco/banda.',
      evidence: 'upload_max_size = ' + uploadMax + ' MB', recommendation: 'Reduza para 5–10 MB.',
      link: '/admin/seguranca'
    });
  }
  var loginLimit = parseInt(getConfig('login_limit_max', '30'), 10);
  if (isNaN(loginLimit) || loginLimit <= 0) {
    findings.push({
      code: 'CFG_LOGIN_LIMIT', severity: 'high', category: 'security', title: 'Proteção contra brute-force desativada',
      description: 'O limite de tentativas de login (login_limit_max) está inválido/zero, permitindo força bruta no painel.',
      evidence: 'login_limit_max = ' + getConfig('login_limit_max'), recommendation: 'Defina um limite (ex.: 30 tentativas).',
      link: '/admin/seguranca'
    });
  }
  if (toggles['mercado_pago'] === '0' || toggles['pix'] === '0') {
    findings.push({
      code: 'CFG_PAYMENT_TOGGLE', severity: 'info', category: 'config', title: 'Pagamentos desativados por toggle',
      description: 'PIX e/ou Mercado Pago estão desligados nos Toggles. Compras podem estar indisponíveis no site.',
      evidence: 'toggles: mercado_pago=' + toggles['mercado_pago'] + ', pix=' + toggles['pix'],
      recommendation: 'Se for intencional, ignore. Caso contrário, reative em Toggles.',
      link: '/admin/toggles'
    });
  }
}

function checkDatabase(findings) {
  try {
    var orphan = db.get("SELECT COUNT(*) as c FROM products WHERE seller_id NOT IN (SELECT id FROM sellers) OR seller_id IS NULL");
    if (orphan && orphan.c > 0) {
      findings.push({
        code: 'DB_ORPHAN_PRODUCTS', severity: 'high', category: 'database', title: orphan.c + ' produto(s) sem vendedor válido',
        description: 'Produtos referenciam vendedores inexistentes (órfãos). Podem aparecer com dados quebrados e nunca serão gerenciados.',
        evidence: orphan.c + ' produto(s) órfão(s)', recommendation: 'Vincule a um vendedor existente ou remova os produtos órfãos.',
        link: '/admin/products'
      });
    }
  } catch(e) {}
  try {
    var negPrice = db.get("SELECT COUNT(*) as c FROM products WHERE price <= 0");
    if (negPrice && negPrice.c > 0) {
      findings.push({
        code: 'DB_NEGATIVE_PRICE', severity: 'high', category: 'database', title: negPrice.c + ' produto(s) com preço inválido',
        description: 'Existem produtos com preço menor ou igual a zero, permitindo vendas por valores absurdos.',
        evidence: negPrice.c + ' produto(s) com price <= 0', recommendation: 'Corrija os preços ou remova os produtos inválidos.',
        link: '/admin/products'
      });
    }
  } catch(e) {}
  try {
    var pendingOld = db.get("SELECT COUNT(*) as c FROM products WHERE status = 'pending' AND created_at < datetime('now', '-7 days')");
    if (pendingOld && pendingOld.c > 0) {
      findings.push({
        code: 'DB_PENDING_OLD', severity: 'low', category: 'database', title: pendingOld.c + ' produto(s) pendentes há mais de 7 dias',
        description: 'Há produtos aguardando aprovação há mais de uma semana. Vendedores podem estar esperando liberação.',
        evidence: pendingOld.c + ' produto(s) pendente(s) antigo(s)', recommendation: 'Revise a fila de aprovação em Produtos > Pendentes.',
        link: '/admin/products?status=pending'
      });
    }
  } catch(e) {}
  try {
    var noImage = db.get("SELECT COUNT(*) as c FROM products WHERE (image IS NULL OR image = '') AND status != 'active'");
    if (noImage && noImage.c > 0) {
      findings.push({
        code: 'DB_NO_IMAGE', severity: 'info', category: 'database', title: noImage.c + ' produto(s) sem imagem',
        description: 'Produtos sem imagem tendem a ter baixa conversão e aparecem quebrados na vitrine.',
        evidence: noImage.c + ' produto(s) sem imagem', recommendation: 'Incentive vendedores a adicionarem imagens.',
        link: '/admin/products'
      });
    }
  } catch(e) {}
  try {
    var salesNoRef = db.get("SELECT COUNT(*) as c FROM sales WHERE seller_id NOT IN (SELECT id FROM sellers)");
    if (salesNoRef && salesNoRef.c > 0) {
      findings.push({
        code: 'DB_ORPHAN_SALES', severity: 'high', category: 'database', title: salesNoRef.c + ' venda(s) sem vendedor válido',
        description: 'Vendas referenciam vendedores removidos, comprometendo comissões, estornos e relatórios.',
        evidence: salesNoRef.c + ' venda(s) órfã(s)', recommendation: 'Audite as vendas órfãs em Vendas.',
        link: '/admin/sales'
      });
    }
  } catch(e) {}
  try {
    var payoutsPending = db.get("SELECT COUNT(*) as c FROM payouts WHERE status = 'pending' AND created_at < datetime('now', '-7 days')");
    if (payoutsPending && payoutsPending.c > 0) {
      findings.push({
        code: 'DB_PAYOUTS_STUCK', severity: 'medium', category: 'financeiro', title: payoutsPending.c + ' saque(s) pendente(s) há mais de 7 dias',
        description: 'Solicitações de saque aguardando há mais de uma semana podem gerar insatisfação e reclamações.',
        evidence: payoutsPending.c + ' payout(s) pendente(s) antigo(s)', recommendation: 'Processe os saques pendentes em Financeiro.',
        link: '/admin/financeiro?tab=saques'
      });
    }
  } catch(e) {}
  try {
    var coupons = db.query("SELECT code, expires_at FROM coupons WHERE active = 1 AND expires_at IS NOT NULL AND expires_at < datetime('now')");
    if (coupons && coupons.length > 0) {
      findings.push({
        code: 'DB_COUPONS_EXPIRED', severity: 'low', category: 'database', title: coupons.length + ' cupom(ns) expirado(s) ainda ativo(s)',
        description: 'Cupons com validade vencida continuam ativos e podem ser aplicados indevidamente.',
        evidence: coupons.map(function(c) { return c.code; }).join(', '),
        recommendation: 'Desative ou atualize os cupons expirados.',
        link: '/admin/cupons'
      });
    }
  } catch(e) {}
  try {
    var sellersNoPix = db.get("SELECT COUNT(*) as c FROM sellers WHERE (pix_key_recebimento IS NULL OR pix_key_recebimento = '') AND status = 'active'");
    if (sellersNoPix && sellersNoPix.c > 0) {
      findings.push({
        code: 'DB_SELLERS_NO_PIX', severity: 'medium', category: 'database', title: sellersNoPix.c + ' vendedor(es) ativo(s) sem chave PIX',
        description: 'Vendedores ativos sem chave PIX de recebimento não conseguirão receber saques.',
        evidence: sellersNoPix.c + ' vendedor(es) sem pix_key_recebimento', recommendation: 'Solicite a chave PIX a esses vendedores.',
        link: '/admin/sellers'
      });
    }
  } catch(e) {}
  try {
    var reviews = db.get('SELECT COUNT(*) as c FROM reviews WHERE approved = 0 OR approved IS NULL');
    if (reviews && reviews.c > 0) {
      findings.push({
        code: 'DB_REVIEWS_PENDING', severity: 'low', category: 'database', title: reviews.c + ' avaliação(ões) aguardando moderação',
        description: 'Avaliações pendentes de aprovação podem atrasar o feedback exibido na vitrine.',
        evidence: reviews.c + ' avaliação(ões) pendente(s)', recommendation: 'Modere as avaliações em Avaliações.',
        link: '/admin/reviews'
      });
    }
  } catch(e) {}
  try {
    var lowStock = db.get("SELECT COUNT(*) as c FROM products WHERE status = 'active' AND quantity IS NOT NULL AND quantity <= 5");
    if (lowStock && lowStock.c > 0) {
      findings.push({
        code: 'DB_LOW_STOCK', severity: 'info', category: 'database', title: lowStock.c + ' produto(s) com estoque baixo',
        description: 'Produtos ativos com quantidade igual ou menor que 5 podem esgotar sem aviso.',
        evidence: lowStock.c + ' produto(s) com quantity <= 5', recommendation: 'Revise o estoque baixo no dashboard.',
        link: '/admin/dashboard'
      });
    }
  } catch(e) {}
}

function checkRuntime(findings) {
  var ctx = collectContext();
  if (ctx.db.sizeBytes > 50 * 1024 * 1024) {
    findings.push({
      code: 'RT_DB_BIG', severity: 'low', category: 'runtime', title: 'Banco de dados grande',
      description: 'O arquivo do banco está acima de 50MB. Consultas podem começar a ficar lentas; considere limpar logs antigos.',
      evidence: (ctx.db.sizeBytes / 1048576).toFixed(1) + ' MB', recommendation: 'Use Limpar Dados ou backup/compactação.',
      link: '/admin/limpar'
    });
  }
  if (ctx.runtime.memoryMb > 800) {
    findings.push({
      code: 'RT_MEMORY_HIGH', severity: 'low', category: 'runtime', title: 'Uso de memória elevado',
      description: 'O processo está consumindo mais de 800MB de RAM, o que pode indicar vazamento ou plano insuficiente.',
      evidence: ctx.runtime.memoryMb + ' MB RSS', recommendation: 'Monitore o uso no painel do Render; considere plano maior.',
      link: '/admin/dashboard'
    });
  }
  try {
    var attempts = db.getLoginAttempts(500);
    var recentFail = (attempts || []).filter(function(a) { return !a.success && new Date(a.created_at) > new Date(Date.now() - 86400000); });
    if (recentFail.length >= 20) {
      findings.push({
        code: 'RT_BRUTEFORCE', severity: 'high', category: 'security', title: recentFail.length + ' tentativas de login falhas em 24h',
        description: 'Muitas tentativas de login malsucedidas em 24 horas indicam possível ataque de força bruta.',
        evidence: recentFail.length + ' falhas em 24h', recommendation: 'Verifique IPs em /admin/ips-bloqueados e considere bloquear os suspeitos.',
        link: '/admin/ips-bloqueados'
      });
    }
  } catch(e) {}
  try {
    var blocked = db.getBlockedIps();
    if (blocked && blocked.length > 0) {
      findings.push({
        code: 'RT_IP_BLOCKED', severity: 'info', category: 'security', title: blocked.length + ' IP(s) bloqueado(s)',
        description: 'Há IPs bloqueados ativos no sistema.',
        evidence: blocked.length + ' IP(s) bloqueado(s)', recommendation: 'Revise a lista de IPs bloqueados.',
        link: '/admin/ips-bloqueados'
      });
    }
  } catch(e) {}
  try {
    var backups = getBackups();
    if (backups.length === 0) {
      findings.push({
        code: 'RT_NO_BACKUP', severity: 'high', category: 'runtime', title: 'Nenhum backup encontrado',
        description: 'Não há backups do banco de dados registrados. Em caso de falha, os dados podem ser perdidos.',
        evidence: 'backups = 0', recommendation: 'Gere um backup agora e configure agendamento.',
        link: '/admin/backup'
      });
    } else {
      var lastB = backups[0];
      var ageDays = (Date.now() - new Date(lastB.mtime).getTime()) / 86400000;
      if (ageDays > 3) {
        findings.push({
          code: 'RT_BACKUP_OLD', severity: 'medium', category: 'runtime', title: 'Último backup com mais de 3 dias',
          description: 'O backup mais recente é antigo demais para uma recuperação segura.',
          evidence: lastB.name + ' (' + ageDays.toFixed(1) + ' dias)', recommendation: 'Execute um backup agora.',
          link: '/admin/backup'
        });
      }
    }
  } catch(e) {}
}

function checkIntegrity(findings) {
  try {
    var activity = db.get('SELECT COUNT(*) as c FROM activity_log');
    if (activity && activity.c > 50000) {
      findings.push({
        code: 'DB_ACTIVITY_LOG_BIG', severity: 'info', category: 'database', title: 'Log de atividade muito grande',
        description: 'O activity_log tem ' + activity.c + ' registros, o que infla o banco e desacelera o painel.',
        evidence: activity.c + ' registros', recommendation: 'Execute a limpeza de logs em Limpar Dados.',
        link: '/admin/limpar'
      });
    }
  } catch(e) {}
  try {
    var multiAdmin = db.query('SELECT COUNT(*) as c FROM admins');
    if (multiAdmin && multiAdmin[0] && multiAdmin[0].c > 1) {
      findings.push({
        code: 'SEC_MULTI_ADMIN', severity: 'info', category: 'security', title: 'Múltiplos administradores cadastrados',
        description: 'Há ' + multiAdmin[0].c + ' contas de administrador. Revise se todas são necessárias.',
        evidence: multiAdmin[0].c + ' admin(s)', recommendation: 'Remova contas administrativas não utilizadas.',
        link: '/admin/admins'
      });
    }
  } catch(e) {}
}

// ---------------- SCORE ----------------
var WEIGHTS = { critical: 40, high: 20, medium: 10, low: 4, info: 1 };

function computeScore(findings) {
  var score = 100;
  findings.forEach(function(f) {
    score -= (WEIGHTS[f.severity] || 0);
  });
  return Math.max(0, Math.min(100, score));
}

function severityLabel(sev) {
  return { critical: 'Crítico', high: 'Alto', medium: 'Médio', low: 'Baixo', info: 'Informativo' }[sev] || sev;
}

// ---------------- ANÁLISE COM IA ----------------
async function analyzeWithAI(findings) {
  var apiKey = getConfig('ai_api_key', process.env.AI_API_KEY || '');
  var baseUrl = (getConfig('ai_base_url', '') || 'https://api.openai.com/v1').replace(/\/+$/, '');
  var model = getConfig('ai_model', 'gpt-4o-mini');
  if (!apiKey) {
    return null;
  }
  var payload = findings.map(function(f) {
    return { codigo: f.code, severidade: severityLabel(f.severity), categoria: f.category, problema: f.title, evidencia: f.evidence, recomendacao: f.recommendation };
  });
  var system = 'Você é um especialista em segurança e manutenção de sistemas web. Analise o relatório de auditoria e escreva um resumo executivo em português do Brasil, em Markdown, com: 1) um parágrafo de diagnóstico geral, 2) lista priorizada das 3 ações mais urgentes, 3) nota de saúde geral do sistema de 0 a 100. Seja direto e técnico.';
  try {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 45000);
    var resp = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payload) }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!resp.ok) {
      return { error: 'API retornou ' + resp.status + ': ' + (await resp.text()).slice(0, 300) };
    }
    var data = await resp.json();
    var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) return { error: 'Resposta da IA vazia' };
    return { summary: content, model: model };
  } catch(e) {
    return { error: e.name === 'AbortError' ? 'Tempo esgotado (45s)' : e.message };
  }
}

// ---------------- MOTOR PRINCIPAL ----------------
async function runAudit() {
  var findings = [];
  checkEnvSecurity(findings);
  checkConfigSecurity(findings);
  checkDatabase(findings);
  checkRuntime(findings);
  checkIntegrity(findings);

  var statuses = db.getAuditFindingStatuses();
  var statusMap = {};
  (statuses || []).forEach(function(s) { statusMap[s.code] = s.status; });

  findings.forEach(function(f) {
    f.status = statusMap[f.code] || 'open';
    f.label = severityLabel(f.severity);
    f.timestamp = nowIso();
  });

  var open = findings.filter(function(f) { return f.status === 'open'; });
  var score = computeScore(open);

  var counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  open.forEach(function(f) { counts[f.severity] = (counts[f.severity] || 0) + 1; });

  var ai = await analyzeWithAI(open);
  if (ai && ai.error) {
    findings.push({
      code: 'AI_ERROR', severity: 'info', category: 'ai', status: 'open',
      title: 'Falha na análise de IA', description: ai.error,
      evidence: ai.error, recommendation: 'Verifique a chave/URL do modelo em Auditoria IA > Configurações.',
      label: 'Informativo', timestamp: nowIso()
    });
  }

  return {
    score: score,
    counts: counts,
    findings: findings,
    ai: ai && !ai.error ? ai : null,
    aiError: ai && ai.error ? ai.error : null,
    context: collectContext(),
    generatedAt: nowIso()
  };
}

module.exports = { runAudit, analyzeWithAI, computeScore, severityLabel, collectContext };