/**
 * @typedef {{ nome?: string; numero?: string | number; pdfId?: string; }} LouvorEntry
 */

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
 * @param {LouvorEntry[]} louvores
 * @returns {string}
 */
export function generateFolhetoHtml(louvores) {
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
      return `<tr style="background:${bgColor};">
        <td style="padding:0;width:100px;font-weight:600;color:#4B2D2B;font-size:18px;"><div style="display:flex;align-items:center;justify-content:center;min-height:46px;padding:0 24px;line-height:1;">${num}</div></td>
        <td style="padding:0;color:#2c3e50;font-size:16px;letter-spacing:0.5px;"><div style="display:flex;align-items:center;min-height:46px;padding:0 24px;line-height:1;">${nome}</div></td>
      </tr>`;
    })
    .join('');

  return `<div style="
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
    <table style="
      width:100%;
      border-collapse:collapse;
      margin-top:0;
    ">
      <thead>
        <tr style="background:#4B2D2B;">
          <th style="
            padding:14px 24px;
            text-align:center;
            font-weight:700;
            color:#D4AF37;
            font-size:14px;
            text-transform:uppercase;
            letter-spacing:1.5px;
            width:100px;
          ">Número</th>
          <th style="
            padding:14px 24px;
            text-align:left;
            font-weight:700;
            color:#D4AF37;
            font-size:14px;
            text-transform:uppercase;
            letter-spacing:1.5px;
          ">Nome do Hino</th>
        </tr>
      </thead>
      <tbody>
        ${linhas}
      </tbody>
    </table>
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
  </div>`;
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
 * @param {Blob} imageBlob
 * @param {string} shareUrl
 * @param {string} playlistName
 * @returns {Promise<void>}
 */
export async function shareFolheto(imageBlob, shareUrl, playlistName) {
  try {
    const file = new File([imageBlob], `folheto-${playlistName.replace(/[^a-z0-9]/gi, '_')}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: 'Folheto de Louvores' });
      return;
    }
  } catch (e) {
    if (/** @type {{ name?: string }} */ (e).name === 'AbortError') return;
  }

  const url = URL.createObjectURL(imageBlob);
  window.open(url, '_blank');
}
