/**
 * @typedef {{ nome?: string; numero?: string | number; pdfId?: string; }} LouvorEntry
 */

/**
 * @typedef {{ shareUrl?: string | null; qrDataUrl?: string | null }} FolhetoShareOptions
 */

/**
 * @param {string} url
 * @returns {boolean} `true` só para o formato curto (`?s=…`, spec short-id-share D7).
 */
export function isShortShareUrl(url) {
  if (!url) return false;
  try {
    return new URL(url, 'https://plpcg.com').searchParams.has('s');
  } catch {
    return false;
  }
}

/**
 * URL impressa sob o QR: sem esquema e sem `&n=…` (o nome já está no folheto).
 * @param {string} shareUrl
 * @returns {string}
 */
export function folhetoDisplayUrl(shareUrl) {
  const semEsquema = shareUrl.replace(/^https?:\/\//, '');
  const i = semEsquema.indexOf('&n=');
  return i === -1 ? semEsquema : semEsquema.slice(0, i);
}

/**
 * Data-URL PNG do QR do link curto (import dinâmico: só quem gera folheto paga).
 * @param {string} shareUrl
 * @returns {Promise<string>}
 */
export async function generateShareQrDataUrl(shareUrl) {
  const QRCode = (await import('qrcode')).default;
  return QRCode.toDataURL(shareUrl, { errorCorrectionLevel: 'M', margin: 0, width: 300 });
}

const DIAS_SEMANA = [
  'DOMINGO',
  'SEGUNDA-FEIRA',
  'TERÇA-FEIRA',
  'QUARTA-FEIRA',
  'QUINTA-FEIRA',
  'SEXTA-FEIRA',
  'SÁBADO'
];

/**
 * Monta o HTML do folheto de louvores. Quando `shareUrl` e `qrDataUrl` vêm
 * preenchidos, acrescenta uma banda com o QR code do link curto e a URL
 * exibida por extenso (paridade com o app v2).
 *
 * O retorno vem envolvido por um `<div>` com 16px de padding: o WhatsApp iOS
 * apara ~3% da borda da imagem quando ela é enviada junto com legenda, e essa
 * margem evita que o corte alcance o conteúdo do folheto.
 *
 * @param {LouvorEntry[]} louvores
 * @param {FolhetoShareOptions} [options]
 * @returns {string}
 */
export function generateFolhetoHtml(louvores, { shareUrl = null, qrDataUrl = null } = {}) {
  const agora = new Date();
  const diaSemana = DIAS_SEMANA[agora.getDay()];
  const dia = String(agora.getDate()).padStart(2, '0');
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const ano = agora.getFullYear();
  const data = `${diaSemana} ${dia}/${mes}/${ano}`;

  const linhas = louvores
    .map((l, i) => {
      const num = l.numero != null ? String(l.numero) : 'N/A';
      let nome = (l.nome || 'Sem título').toUpperCase();
      if (nome.length > 50) {
        nome = nome.slice(0, 47) + '...';
      }
      const bgColor = i % 2 === 0 ? '#FFF8E1' : '#FFFFFF';
      return `<div style="display:flex;background:${bgColor};">
        <div style="width:148px;flex-shrink:0;padding:14px 24px 22px;text-align:center;font-weight:600;color:#4B2D2B;font-size:18px;box-sizing:border-box;">${num}</div>
        <div style="flex:1;padding:14px 24px 22px;color:#2c3e50;font-size:16px;letter-spacing:0.5px;">${nome}</div>
      </div>`;
    })
    .join('');

  const bandaQr = shareUrl && qrDataUrl
    ? `<div style="background:#4B2D2B;padding:12px 28px;text-align:center;border-top:2px solid #D4AF37;">
      <div style="display:inline-block;padding:6px;background:#FFFFFF;border:1px solid #D4AF37;border-radius:6px;line-height:0;">
        <img src="${qrDataUrl}" width="150" height="150" alt="QR code do link da lista" style="display:block;width:150px;height:150px;" />
      </div>
      <div style="margin-top:6px;font-size:12px;font-weight:700;color:#D4AF37;letter-spacing:1px;">Abrir lista no PLPCG</div>
      <div style="margin-top:4px;font-size:11px;color:#A89080;letter-spacing:0.5px;">${folhetoDisplayUrl(shareUrl)}</div>
    </div>`
    : '';

  return `<div style="padding:16px;background:#4B2D2B;display:inline-block;"><div style="
    display:inline-block;
    border:4px solid #D4AF37;
    padding:0;
    font-family:'Georgia','Times New Roman',serif;
    background:#FFF8E1;
    width:620px;
    box-sizing:border-box;
    box-shadow:0 8px 32px rgba(0,0,0,0.15);
  ">
    <div style="
      background:#4B2D2B;
      padding:20px 28px;
      display:flex;
      justify-content:space-between;
      align-items:center;
    ">
      <span style="font-size:16px;font-weight:700;color:#F0E68C;text-transform:uppercase;letter-spacing:2px;font-family:'Georgia',serif;">Louvores</span>
      <span style="font-size:16px;font-weight:500;color:#F0E68C;text-transform:uppercase;letter-spacing:1px;">${data}</span>
    </div>
    <div style="display:flex;align-items:center;background:#4B2D2B;">
      <div style="width:148px;flex-shrink:0;padding:14px 24px;text-align:center;font-weight:700;color:#D4AF37;font-size:14px;text-transform:uppercase;letter-spacing:1.5px;box-sizing:border-box;">Número</div>
      <div style="flex:1;padding:14px 24px;font-weight:700;color:#D4AF37;font-size:14px;text-transform:uppercase;letter-spacing:1.5px;">Nome do Hino</div>
    </div>
    ${linhas}
    ${bandaQr}
    <div style="
      background:#4B2D2B;
      height:6px;
      padding:0 28px;
      box-sizing:border-box;
    "></div>
    <div style="
      background:#3D2622;
      padding:16px 28px;
      text-align:center;
    ">
      <div style="
        font-size:12px;
        color:#D4AF37;
        text-transform:uppercase;
        letter-spacing:2px;
        margin-bottom:6px;
        font-weight:600;
      ">A Paz do Senhor Jesus Cristo</div>
      <div style="
        font-size:11px;
        color:#A89080;
        letter-spacing:1px;
      ">Bom culto!</div>
    </div>
  </div></div>`;
}

/**
 * @param {string} htmlString
 * @returns {Promise<Blob>}
 */
export async function generateFolhetoImage(htmlString) {
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.zIndex = '-1';
  container.innerHTML = htmlString;
  document.body.appendChild(container);

  try {
    const html2canvas = (await import('html2canvas')).default;
    const target = /** @type {HTMLElement} */ (container.firstElementChild);
    if (!target) throw new Error('Elemento do folheto não renderizado');
    await Promise.all(
      Array.from(container.querySelectorAll('img')).map(img => img.decode().catch(() => {}))
    );
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff'
    });
    return await new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Falha ao converter canvas para blob'));
      }, 'image/png');
    });
  } finally {
    container.remove();
  }
}

/**
 * Compartilha a imagem do folheto. Quando `shareUrl` é o formato curto
 * (`?s=…`), a legenda (`text`) traz o nome da playlist e a URL, para que o
 * app de destino (ex.: WhatsApp) a exiba junto da imagem.
 *
 * @param {Blob} imageBlob
 * @param {string} shareUrl
 * @param {string} playlistName
 * @returns {Promise<void>}
 */
export async function shareFolheto(imageBlob, shareUrl, playlistName) {
  try {
    const file = new File([imageBlob], `folheto-${playlistName.replace(/[^a-z0-9]/gi, '_')}.png`, { type: 'image/png' });
    /** @type {{ files: File[]; title: string; text?: string }} */
    const shareData = { files: [file], title: 'Folheto de Louvores' };
    if (isShortShareUrl(shareUrl)) shareData.text = `${playlistName}\n\n${shareUrl}`;
    if (navigator.canShare && navigator.canShare(shareData) && navigator.share) {
      await navigator.share(shareData);
      return;
    }
  } catch (e) {
    if (/** @type {{ name?: string }} */ (e).name === 'AbortError') return;
  }

  const url = URL.createObjectURL(imageBlob);
  window.open(url, '_blank');
}
