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
    .map(l => {
      const num = l.numero != null ? String(l.numero) : 'N/A';
      let nome = (l.nome || 'Sem título').toUpperCase();
      if (nome.length > 30) {
        nome = nome.slice(0, 27) + '...';
      }
      return `<tr><td style="padding:8px 28px;">${num}</td><td style="padding:8px 28px;">${nome}</td></tr>`;
    })
    .join('');

  return `<div style="
    display:inline-block;
    border:5px solid #000;
    padding:0;
    font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
    background:#fff;
    width:620px;
    box-sizing:border-box;
  ">
    <div style="
      display:flex;
      justify-content:space-between;
      align-items:center;
      padding:18px 28px 10px 28px;
      font-size:16px;
      font-weight:700;
      color:#000;
      text-transform:uppercase;
    ">
      <span>LOUVORES</span>
      <span>${data}</span>
    </div>
    <table style="
      width:100%;
      border-collapse:collapse;
      color:#000;
      font-size:15px;
      text-transform:uppercase;
    ">
      <thead>
        <tr style="background:#6b7280;">
          <th style="
            padding:10px 28px;
            text-align:left;
            font-weight:700;
            border-bottom:2px solid #000;
            width:120px;
          ">NÚMERO</th>
          <th style="
            padding:10px 28px;
            text-align:left;
            font-weight:700;
            border-bottom:2px solid #000;
          ">NOME DO HINO</th>
        </tr>
      </thead>
      <tbody>
        ${linhas}
      </tbody>
    </table>
    <div style="height:28px;"></div>
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
  const filename = `folheto-${playlistName.replace(/[^a-z0-9]/gi, '_')}.png`;

  try {
    const file = new File([imageBlob], filename, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: 'Folheto de Louvores' });
      return;
    }
  } catch (e) {
    if (/** @type {{ name?: string }} */ (e).name === 'AbortError') return;
  }

  const url = URL.createObjectURL(imageBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
