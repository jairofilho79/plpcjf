/**
 * Espaço em disco: verificar antes, reconhecer depois.
 *
 * O acervo inteiro passa de 800 MB. Sem esta verificação, um aparelho sem
 * espaço chegava à metade do download e o `cache.put` começava a lançar
 * `QuotaExceededError` — que o gravador em lote engolia por PDF, um a um. O
 * download "terminava com sucesso" e nada tinha sido gravado. Verificar antes
 * transforma isso num aviso; reconhecer o erro depois transforma o resto numa
 * mensagem em vez de silêncio.
 *
 * Só importa por caminho relativo e não toca em `$app/*`: precisa rodar sob
 * `node --test`.
 */

import { formatSize } from '../../utils/formatSize.js';

/**
 * Margem exigida acima do necessário.
 *
 * A cota que o navegador anuncia é um teto móvel, não uma reserva: ele encolhe
 * quando o disco do aparelho enche por outro motivo. Prometer que cabe com zero
 * de folga é prometer errado.
 */
const MARGEM = 1.1;

/**
 * @typedef {Object} QuotaCheck
 * @property {boolean} ok cabe (ou não dá para saber — ver `desconhecido`)
 * @property {boolean} desconhecido o navegador não soube estimar
 * @property {number} disponivel bytes livres estimados
 * @property {number} faltam bytes que faltam (0 quando cabe)
 * @property {number} necessario bytes pedidos
 */

/**
 * O download pedido cabe no que o navegador reserva para esta origem?
 *
 * Nunca bloqueia por falta de informação: quando a estimativa não existe ou vem
 * zerada, devolve `ok: true` com `desconhecido: true`. Falha de estimativa não
 * é motivo para impedir alguém de tentar.
 *
 * @param {any} nav objeto `navigator` (injetável em teste)
 * @param {number} bytesNecessarios
 * @returns {Promise<QuotaCheck>}
 */
export async function checkQuota(nav, bytesNecessarios) {
  const necessario = Number(bytesNecessarios) || 0;
  const desconhecido = {
    ok: true,
    desconhecido: true,
    disponivel: 0,
    faltam: 0,
    necessario
  };

  if (necessario <= 0) return { ...desconhecido, desconhecido: false };
  if (typeof nav?.storage?.estimate !== 'function') return desconhecido;

  try {
    const { usage = 0, quota = 0 } = (await nav.storage.estimate()) || {};
    if (!quota) return desconhecido;

    const disponivel = Math.max(0, quota - usage);
    const exigido = necessario * MARGEM;

    return {
      ok: disponivel >= exigido,
      desconhecido: false,
      disponivel,
      faltam: Math.max(0, Math.ceil(necessario - disponivel)),
      necessario
    };
  } catch {
    // `estimate()` lança em Firefox com dados do site bloqueados.
    return desconhecido;
  }
}

/**
 * Pede ao navegador que não descarte este armazenamento.
 *
 * Sem isto o cache dos PDFs é "best-effort": o navegador pode apagar tudo sob
 * pressão de disco, e a pessoa reabre o app sem o acervo que baixou. Chrome
 * concede sem perguntar a sites instalados como PWA; Safari concede a partir do
 * uso. Recusa não é erro — só significa "melhor esforço", como antes.
 *
 * @param {any} nav objeto `navigator` (injetável em teste)
 * @returns {Promise<boolean>} true se o armazenamento é persistente ao sair
 */
export async function ensurePersistentStorage(nav) {
  try {
    if (typeof nav?.storage?.persisted === 'function' && (await nav.storage.persisted())) {
      return true;
    }
    if (typeof nav?.storage?.persist !== 'function') return false;
    return (await nav.storage.persist()) === true;
  } catch {
    return false;
  }
}

/**
 * O erro é falta de espaço?
 *
 * Vai por nome e por mensagem: `QuotaExceededError` é o caso do Chrome, mas
 * Safari e Firefox chegam com textos diferentes, e o Chrome em disco cheio
 * chega com "No space left on device" dentro de um erro genérico.
 *
 * @param {unknown} erro
 * @returns {boolean}
 */
export function isQuotaError(erro) {
  if (!erro) return false;
  const e = /** @type {any} */ (erro);
  if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  const msg = String(e.message || e);
  return /quota|no space left|disk is full|allocation failed|out of memory/i.test(msg);
}

/**
 * Mensagem para quem está olhando a tela, não para o console.
 *
 * @param {{ faltam?: number, necessario?: number }} [dados]
 * @returns {string}
 */
export function quotaErrorMessage(dados = {}) {
  const base = 'Não há espaço suficiente no aparelho para guardar os PDFs.';
  const fim =
    ' Libere espaço no aparelho e tente de novo: o download continua de onde parou, e o que já foi baixado continua guardado.';

  if (dados.faltam && dados.faltam > 0) {
    return `${base} Faltam cerca de ${formatSize(dados.faltam)}.${fim}`;
  }
  return `${base}${fim}`;
}
