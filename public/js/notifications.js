/* ============================================================
   Notificações modernas: sino + painel dropdown + toasts
   Auto-inicializa em qualquer elemento .notif-bell-btn
   ============================================================ */
(function () {
  'use strict';

  function csrfToken() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }
  function esc(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var TYPES = {
    info:    { icon: 'bell',                 cls: 'nt-info' },
    welcome: { icon: 'user-plus',            cls: 'nt-welcome' },
    alert:   { icon: 'exclamation-triangle', cls: 'nt-alert' },
    promo:   { icon: 'tag',                  cls: 'nt-promo' },
    sale:    { icon: 'shopping-cart',        cls: 'nt-sale' },
    payment: { icon: 'credit-card',          cls: 'nt-payment' },
    order:   { icon: 'box',                  cls: 'nt-order' },
    success: { icon: 'check-circle',         cls: 'nt-success' },
    error:   { icon: 'times-circle',         cls: 'nt-error' }
  };
  function typeOf(t) { return TYPES[t] || TYPES.info; }

  function timeAgo(str) {
    if (!str) return '';
    var d;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
      d = new Date(str.replace(' ', 'T') + 'Z');
    } else {
      d = new Date(str);
    }
    if (isNaN(d.getTime())) return str;
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 0) s = 0;
    if (s < 60) return 'agora';
    if (s < 3600) return 'há ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'há ' + Math.floor(s / 3600) + ' h';
    if (s < 2592000) return 'há ' + Math.floor(s / 86400) + ' d';
    return d.toLocaleDateString('pt-BR');
  }

  function showToast(n) {
    var tm = typeOf(n.type);
    var wrap = document.querySelector('.notif-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'notif-toast-wrap';
      document.body.appendChild(wrap);
    }
    var t = document.createElement('div');
    t.className = 'notif-toast';
    t.innerHTML =
      '<div class="nt-ic ' + tm.cls + '"><i class="fas fa-' + tm.icon + '"></i></div>' +
      '<div class="nt-body">' +
        '<div class="nt-title">Nova notificação</div>' +
        '<div class="nt-msg">' + esc(n.message) + '</div>' +
      '</div>' +
      '<button class="nt-close" aria-label="Fechar"><i class="fas fa-times"></i></button>';
    wrap.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    var close = function () {
      t.classList.remove('show');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    };
    t.querySelector('.nt-close').addEventListener('click', close);
    setTimeout(close, 6000);
  }

  function initBell(bell) {
    if (bell._notifInit) return;
    bell._notifInit = true;

    var endpoint = bell.getAttribute('data-endpoint') || '/api/notifications/recent';
    var center = bell.closest('.notif-center');
    if (!center) return;
    var panel = center.querySelector('.notif-panel');
    var badge = bell.querySelector('.notif-badge');
    var listEl = panel ? panel.querySelector('.notif-list') : null;
    if (!panel || !listEl) return;

    var countPill = panel.querySelector('.notif-count-pill');
    var lastCount = 0;

    function updateBadge(c) {
      if (!badge) return;
      if (c > 0) {
        badge.hidden = false;
        badge.textContent = c > 99 ? '99+' : c;
        bell.classList.add('has-unread');
      } else {
        badge.hidden = true;
        badge.textContent = '0';
        bell.classList.remove('has-unread');
      }
    }

    function render(list) {
      if (!list || !list.length) {
        listEl.innerHTML = '<div class="notif-empty"><i class="fas fa-bell-slash"></i>Nenhuma notificação por aqui</div>';
        return;
      }
      listEl.innerHTML = list.map(function (n) {
        var tm = typeOf(n.type);
        var unread = !n.read;
        return '' +
          '<div class="notif-card ' + (unread ? 'unread' : '') + ' ' + tm.cls + '" data-id="' + n.id + '" data-link="' + esc(n.link || '') + '">' +
            '<div class="notif-card-ic"><i class="fas fa-' + tm.icon + '"></i></div>' +
            '<div class="notif-card-body">' +
              '<div class="notif-card-msg">' + esc(n.message) + '</div>' +
              '<div class="notif-card-meta">' +
                '<span class="notif-type-chip">' + esc(n.type || 'info') + '</span>' +
                '<span class="notif-card-time">' + timeAgo(n.created_at) + '</span>' +
              '</div>' +
            '</div>' +
            (unread ? '<button class="notif-card-read" title="Marcar como lida"><i class="fas fa-check"></i></button>' : '') +
          '</div>';
      }).join('');
    }

    function load(isPoll) {
      fetch(endpoint).then(function (r) { return r.json(); }).then(function (d) {
        var count = d.count || 0;
        updateBadge(count);
        if (countPill) countPill.textContent = count;
        render(d.notifications || []);
        if (isPoll && count > lastCount && lastCount > 0) {
          var newest = (d.notifications || [])[0];
          if (newest) showToast(newest);
        }
        lastCount = count;
      }).catch(function () {});
    }

    function markRead(id, cb) {
      var url = endpoint.replace(/\/recent$/, '') + '/read/' + id;
      fetch(url, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken() } })
        .then(function () { if (cb) cb(); })
        .catch(function () { if (cb) cb(); });
    }
    function markAll() {
      var url = endpoint.replace(/\/recent$/, '') + '/read-all';
      fetch(url, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken() } })
        .then(function () { load(false); }).catch(function () {});
    }

    bell.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = panel.classList.toggle('open');
      if (open) load(false);
    });

    document.addEventListener('click', function (e) {
      if (panel.classList.contains('open') && !center.contains(e.target)) {
        panel.classList.remove('open');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') panel.classList.remove('open');
    });

    panel.addEventListener('click', function (e) {
      if (e.target.closest('.notif-mark-all')) { markAll(); return; }
      var card = e.target.closest('.notif-card');
      if (!card) return;
      var id = card.getAttribute('data-id');
      var link = card.getAttribute('data-link');
      var go = function () { if (link) window.location.href = link; };
      if (!card.classList.contains('unread')) { go(); return; }
      markRead(id, function () {
        card.classList.remove('unread');
        var rb = card.querySelector('.notif-card-read');
        if (rb) rb.parentNode.removeChild(rb);
        load(false);
        go();
      });
    });

    load(false);
    setInterval(function () { load(true); }, 20000);
  }

  function boot() {
    document.querySelectorAll('.notif-bell-btn').forEach(initBell);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
