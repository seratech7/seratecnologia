document.addEventListener('DOMContentLoaded', function () {
  // Toast helper
  window.toast = function (msg, type) {
    var t = document.createElement('div');
    t.className = 'toast ' + (type || 'ok');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 250);
    }, 2600);
  };

  // Post helper with CSRF
  window.apiPost = function (url, data, cb) {
    var meta = document.querySelector('meta[name="csrf-token"]');
    var csrf = meta ? meta.content : '';
    var body = new URLSearchParams(data);
    if (csrf && !data._csrf) body.append('_csrf', csrf);
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrf },
      body: body.toString()
    }).then(function (r) {
      return r.json().catch(function () { return { error: 'Resposta inválida do servidor' }; });
    }).then(function (json) {
      if (json.error) { toast(json.error, 'error'); if (cb && cb.onError) cb.onError(json); }
      else { if (json.message) toast(json.message); if (cb) cb(json); }
    }).catch(function () { toast('Falha de conexão', 'error'); });
  };

  // Copy address
  document.querySelectorAll('[data-copy]').forEach(function (el) {
    el.addEventListener('click', function () {
      var target = el.getAttribute('data-copy-target');
      var text = target ? document.querySelector(target).textContent : el.getAttribute('data-copy');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { toast('Copiado!'); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove(); toast('Copiado!');
      }
    });
  });
});