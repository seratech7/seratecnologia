var QRCode = require('qrcode');

function gerarPixPayload(chave, valor, nome, cidade, descricao) {
  var payload = '';

  function add(id, tamanho, valor) {
    var v = String(valor);
    var tam = String(v.length + tamanho.toString().length + 2);
    tam = String(tamanho + v.length);
    while (tam.length < 2) tam = '0' + tam;
    payload += id + tam + v;
  }

  function addStr(id, valor) {
    var v = String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s.,\-]/g, '').trim();
    if (!v) return;
    var tam = String(v.length);
    while (tam.length < 2) tam = '0' + tam;
    payload += id + tam + v;
  }

  payload = '000201';                     // Payload Format Indicator
  add('26', 2, '0014BR.GOV.BCB.PIX01' + chave.length.toString().padStart(2, '0') + chave);  // GUI + PIX key
  add('52', 0, '0000');                   // MCC
  add('53', 0, '986');                    // Currency BRL
  if (valor > 0) add('54', 0, valor.toFixed(2)); // Amount
  add('58', 0, 'BR');                     // Country
  addStr('59', nome || 'Vendedor');       // Merchant name
  addStr('60', cidade || 'Brasil');       // City
  addStr('62', descricao || '');          // Additional data

  // CRC16
  payload += '6304';
  var crc = calcularCRC16(payload);
  payload += crc;

  return payload;
}

function calcularCRC16(str) {
  var polynomial = 0x1021;
  var crc = 0xFFFF;
  for (var i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (var j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ polynomial;
      } else {
        crc = crc << 1;
      }
      crc &= 0xFFFF;
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

function gerarQRCodeBase64(pixPayload) {
  return QRCode.toDataURL(pixPayload, { width: 300, margin: 2, color: { dark: '#000', light: '#fff' } });
}

module.exports = { gerarPixPayload, gerarQRCodeBase64 };