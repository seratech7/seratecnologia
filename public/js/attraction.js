(function() {
  'use strict';

  // ============================================================
  // UTILIDADES
  // ============================================================
  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function postJSON(url, data) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken()
      },
      body: JSON.stringify(data || {})
    });
  }

  function showModal(html, title) {
    var overlay = document.createElement('div');
    overlay.id = 'attractionModalOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:14px;max-width:420px;width:100%;padding:26px;position:relative;box-shadow:0 10px 40px rgba(0,0,0,.3);text-align:center;font-family:Arial,sans-serif;';
    if (title) {
      var h = document.createElement('h2');
      h.textContent = title;
      h.style.cssText = 'margin:0 0 12px;font-size:22px;color:#222;';
      box.appendChild(h);
    }
    var close = document.createElement('button');
    close.textContent = 'Ã—';
    close.style.cssText = 'position:absolute;top:8px;right:12px;border:none;background:none;font-size:26px;cursor:pointer;color:#999;';
    close.onclick = function() { overlay.remove(); };
    box.appendChild(close);
    var content = document.createElement('div');
    content.innerHTML = html;
    box.appendChild(content);
    overlay.appendChild(box);
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    return { overlay: overlay, box: box };
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function() {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  function showToast(msg) {
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1565c0;color:#fff;padding:12px 22px;border-radius:8px;font-family:Arial,sans-serif;font-size:14px;z-index:10000;box-shadow:0 4px 16px rgba(0,0,0,.25);';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 4000);
  }

  // ============================================================
  // 5. PROVA SOCIAL â€” Ticker ao vivo
  // ============================================================
  function initSocialTicker() {
    if (sessionStorage.getItem('tickerShown')) return;
    sessionStorage.setItem('tickerShown', '1');
    fetch('/api/social/ticker').then(function(r) { return r.json(); }).then(function(data) {
      if (!data || !data.ok || !data.items || !data.items.length) return;
      var idx = Math.floor(Math.random() * data.items.length);
      var item = data.items[idx];
      var toast = document.createElement('div');
      toast.id = 'socialTicker';
      toast.style.cssText = 'position:fixed;bottom:24px;left:24px;background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:12px 16px;box-shadow:0 6px 20px rgba(0,0,0,.18);z-index:9990;display:flex;align-items:center;gap:10px;font-family:Arial,sans-serif;font-size:13px;color:#333;max-width:320px;animation:fadeInUp .4s ease;';
      var img = document.createElement('div');
      img.style.cssText = 'width:36px;height:36px;border-radius:50%;background:#e3f2fd;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;';
      img.textContent = 'ðŸ›’';
      var text = document.createElement('div');
      text.innerHTML = item.message;
      var closeBtn = document.createElement('button');
      closeBtn.textContent = 'Ã—';
      closeBtn.style.cssText = 'position:absolute;top:4px;right:8px;border:none;background:none;font-size:18px;cursor:pointer;color:#bbb;';
      closeBtn.onclick = function() { toast.remove(); };
      toast.appendChild(img);
      toast.appendChild(text);
      toast.appendChild(closeBtn);
      var style = document.createElement('style');
      style.textContent = '@keyframes fadeInUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(style);
      document.body.appendChild(toast);
      setTimeout(function() { if (toast.parentNode) toast.remove(); }, 9000);
    }).catch(function() {});
  }

  // ============================================================
  // 4. NOTIFICAÃ‡Ã•ES PUSH (PWA)
  // ============================================================
  function initPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification && Notification.permission === 'granted') return;
    if (localStorage.getItem('pushPromptShown')) return;

    // Registra o service worker
    navigator.serviceWorker.register('/sw.js').then(function() {
      // Pergunta apÃ³s 20s
      setTimeout(function() {
        if (Notification && Notification.permission === 'default') {
          localStorage.setItem('pushPromptShown', '1');
          Notification.requestPermission().then(function(perm) {
            if (perm === 'granted') {
              fetch('/api/push/public-key').then(function(r) { return r.json(); }).then(function(data) {
                if (!data || !data.publicKey) return;
                // Requer import de urlBase64ToUint8Array
                var base64 = data.publicKey;
                var padding = '='.repeat((4 - base64.length % 4) % 4);
                var base64p = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
                var raw = atob(base64p);
                var key = new Uint8Array(raw.length);
                for (var i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
                navigator.serviceWorker.ready.then(function(reg) {
                  reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).then(function(sub) {
                    fetch('/api/push/subscribe', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys })
                    }).catch(function() {});
                  }).catch(function() {});
                });
              }).catch(function() {});
            }
          });
        }
      }, 20000);
    }).catch(function() {});
  }

  // ============================================================
  // 2. SORTEIO AUTOMÃTICO â€” popup + formulÃ¡rio
  // ============================================================
  function initGiveaway() {
    if (localStorage.getItem('giveawayShown')) return;
    fetch('/api/sorteio/stats').then(function(r) { return r.json(); }).then(function(stats) {
      localStorage.setItem('giveawayShown', '1');
      setTimeout(function() {
        var total = (stats && stats.total) || 0;
        var html =
          '<div style="font-size:14px;color:#555;">' +
          '<p style="font-size:15px;line-height:1.5;">Participe do <strong style="color:#1565c0;">Sorteio Mensal</strong> e concorra a um prÃªmio incrÃ­vel!</p>' +
          '<p style="color:#777;font-size:13px;">' + (total > 0 ? 'ðŸ”¥ ' + total + ' pessoas jÃ¡ participaram!' : 'ðŸ”¥ Vagas limitadas!') + '</p>' +
          '<div style="margin:14px 0;display:flex;flex-direction:column;gap:8px;">' +
          '<input id="gaName" placeholder="Seu nome" style="padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;">' +
          '<input id="gaWhats" placeholder="WhatsApp (ex: 5511999998888)" style="padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;">' +
          '</div>' +
          '<button id="gaBtn" style="width:100%;padding:13px;background:#1565c0;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;">ðŸŽŸï¸ Quero Participar</button>' +
          '<p style="font-size:11px;color:#aaa;margin-top:10px;">Sorteio 100% online. Resultado divulgado no nosso canal.</p>' +
          '</div>';
        var modal = showModal(html, 'ðŸŽ Sorteio do MÃªs');
        var btn = document.getElementById('gaBtn');
        if (btn) {
          btn.onclick = function() {
            var name = document.getElementById('gaName').value.trim();
            var whats = document.getElementById('gaWhats').value.replace(/\D/g, '');
            if (!name || !whats) { showToast('Preencha nome e WhatsApp'); return; }
            btn.disabled = true;
            btn.textContent = 'Enviando...';
            postJSON('/api/sorteio/participar', { name: name, email: '', whatsapp: whatsapp }).then(function(r) { return r.json(); }).then(function(data) {
              if (data.ok) {
                modal.overlay.remove();
                showToast('ðŸŽ‰ ParticipaÃ§Ã£o confirmada! Boa sorte!');
              } else {
                btn.disabled = false;
                btn.textContent = 'ðŸŽŸï¸ Quero Participar';
                showToast(data.error || 'Erro ao participar');
              }
            }).catch(function() {
              btn.disabled = false;
              btn.textContent = 'ðŸŽŸï¸ Quero Participar';
              showToast('Erro de conexÃ£o');
            });
          };
        }
      }, 12000);
    }).catch(function() {});
  }

  // ============================================================
  // 1. PROGRAMA DE INDICAÃ‡ÃƒO â€” botÃ£o "Convide amigos"
  // ============================================================
  function initReferral() {
    fetch('/api/convite').then(function(r) { return r.json(); }).then(function(data) {
      var refCode = data && data.code ? data.code : '';
      if (!refCode) return;
      var link = location.origin + '/convite/' + refCode;
      // BotÃ£o flutuante
      var btn = document.createElement('div');
      btn.id = 'referralBtn';
      btn.style.cssText = 'position:fixed;bottom:24px;right:24px;background:linear-gradient(135deg,#7c4dff,#1565c0);color:#fff;border-radius:50px;padding:12px 18px;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;cursor:pointer;box-shadow:0 6px 20px rgba(21,101,192,.4);z-index:9995;display:flex;align-items:center;gap:8px;';
      btn.innerHTML = 'ðŸŽ Convide e ganhe';
      btn.onclick = function() {
        var html =
          '<div style="font-size:14px;color:#555;">' +
          '<p style="margin:0 0 8px;">Compartilhe seu link e <strong style="color:#1565c0;">ganhe cupons de 5%</strong> para cada amigo que visitar! Seu amigo tambÃ©m ganha <strong style="color:#7c4dff;">10% na primeira compra</strong>.</p>' +
          '<div style="display:flex;gap:8px;margin:14px 0;">' +
          '<input id="refLink" readonly value="' + link + '" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:12px;background:#f7f7f7;">' +
          '<button id="refCopy" style="padding:10px 16px;background:#1565c0;color:#fff;border:none;border-radius:8px;cursor:pointer;">Copiar</button>' +
          '</div>' +
          '<a id="refWa" href="https://wa.me/?text=' + encodeURIComponent('Confira o ' + document.title + ' e ganhe desconto! ' + link) + '" target="_blank" style="display:block;text-align:center;padding:12px;background:#25D366;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;margin-bottom:8px;">ðŸ“± Enviar no WhatsApp</a>' +
          '<p style="font-size:12px;color:#999;margin:0;">Visitas: <strong id="refVisits">' + (data.visits || 0) + '</strong></p>' +
          '</div>';
        var modal = showModal(html, 'ðŸŽ Convide & Ganhe');
        var copyBtn = document.getElementById('refCopy');
        if (copyBtn) copyBtn.onclick = function() {
          copyToClipboard(link);
          copyBtn.textContent = 'Copiado!';
          setTimeout(function() { copyBtn.textContent = 'Copiar'; }, 1500);
        };
      };
      document.body.appendChild(btn);
      document.addEventListener('scroll', function() {
        var y = window.scrollY || 0;
        var ticker = document.getElementById('socialTicker');
        if (ticker && y > 40) ticker.style.display = 'none';
      });
    }).catch(function() {});
  }

  // ============================================================
  // 3. RECUPERAÃ‡ÃƒO DE VISITAS â€” integrado no product.ejs
  // ExpÃµe funÃ§Ãµes globais para serem chamadas pelas pÃ¡ginas
  // ============================================================
  window.MartplaceAttraction = {
    trackVisit: function(productId) {
      fetch('/api/visita', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: productId })
      }).catch(function() {});
    },
    checkRescue: function(productId) {
      if (sessionStorage.getItem('rescueShown_' + productId)) return;
      fetch('/api/visita/resgate?productId=' + productId).then(function(r) { return r.json(); }).then(function(data) {
        if (data && data.ok && data.elegivel) {
          sessionStorage.setItem('rescueShown_' + productId, '1');
          setTimeout(function() {
            fetch('/api/visita/cupom', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ productId: productId })
            }).then(function(r) { return r.json(); }).then(function(d) {
              if (d && d.ok) {
                var html =
                  '<div style="font-size:14px;color:#555;">' +
                  '<p>Notamos que vocÃª voltou para ver este produto. ðŸ˜Š</p>' +
                  '<p style="margin:14px 0;">Aqui estÃ¡ um cupom especial sÃ³ para vocÃª:</p>' +
                  '<div style="background:#fff3cd;border:2px dashed #f9a825;border-radius:8px;padding:14px;font-size:20px;font-weight:bold;color:#e65100;letter-spacing:2px;margin-bottom:14px;">' + d.code + '</div>' +
                  '<p style="font-size:12px;color:#999;">5% de desconto â€” use no checkout!</p>' +
                  '</div>';
                var modal = showModal(html, 'ðŸŽ‰ VocÃª ganhou um cupom!');
                modal.overlay.onclick = function(e) {
                  if (e.target === modal.overlay) modal.overlay.remove();
                };
              }
            }).catch(function() {});
          }, 5000);
        }
      }).catch(function() {});
    },
    showToast: showToast
  };

  // ============================================================
  // INICIALIZAÃ‡ÃƒO
  // ============================================================
  document.addEventListener('DOMContentLoaded', function() {
    initPush();
    initGiveaway();
    initReferral();
    // Ticker sÃ³ aparece apÃ³s alguns segundos
    setTimeout(initSocialTicker, 5000);
  });
})();
