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
import { safeGet, safeSet, safeRemove } from '../../utils/safeStorage.js';

/**
 * Margem exigida acima do necessário.
 *
 * A cota que o navegador anuncia é um teto móvel, não uma reserva: ele encolhe
 * quando o disco do aparelho enche por outro motivo. Prometer que cabe com zero
 * de folga é prometer errado.
 */
const MARGEM = 1.1;

/**
 * Reserva fixa, além da margem, para o que precisa continuar cabendo *depois*
 * do download: o catálogo (`louvores-manifest.json` + `offline-manifest.json`,
 * ~1,4 MB) e alguns PDFs novos que cheguem antes da próxima sincronização
 * grande.
 *
 * Sem isto, `checkQuota` aprovava um download de 800+ MB que ocupava
 * exatamente a folga toda: o download em si cabia, mas terminava sem sobrar
 * um byte para a atualização automática do catálogo gravar depois — e essa
 * escrita, bem menor e em segundo plano, falhava em silêncio (ver
 * `catalogoCache.js`). Reservar aqui, na única checagem que roda antes de
 * qualquer download grande, é o que garante que sempre sobra algo.
 */
const RESERVA_ATUALIZACAO_BYTES = 40 * 1024 * 1024; // 40 MB

/**
 * Estimativa por PDF para o download automático de louvores novos
 * (`checkForNewPDFs`), que — ao contrário das partes de ZIP do acervo, que
 * declaram `size` no manifesto — não sabe o tamanho de cada PDF antes de
 * baixar. Generosa de propósito: superestimar só adia um download que ainda
 * cabe; subestimar é o que deixava a escrita falhar em silêncio.
 */
export const ESTIMATIVA_MEDIA_PDF_BYTES = 2 * 1024 * 1024; // 2 MB

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
    const exigido = necessario * MARGEM + RESERVA_ATUALIZACAO_BYTES;

    return {
      ok: disponivel >= exigido,
      desconhecido: false,
      disponivel,
      // Conta a reserva aqui também: "faltam 0" com a checagem reprovada
      // (porque só a reserva não coube) confundia mais do que ajudava.
      faltam: Math.max(0, Math.ceil(exigido - disponivel)),
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

const LS_QUOTA_BLOCKED_AT = 'plpcjf:storage:quotaBlockedAt';

/**
 * Uma atualização em segundo plano (catálogo ou PDFs novos) foi adiada por
 * falta de espaço — grava o momento para a tela `/offline` mostrar um aviso.
 *
 * É o único jeito de quem já baixou o acervo inteiro ficar sabendo que a
 * atualização automática parou de funcionar: as escritas em segundo plano são
 * melhor esforço por design (não podem travar a tela nem o download em
 * andamento) e por isso nunca lançam — sem este sinal, a falha ficava só no
 * console.
 *
 * @param {number} [now]
 */
export function markUpdateQuotaBlocked(now = Date.now()) {
  safeSet(LS_QUOTA_BLOCKED_AT, String(now));
}

/** Limpa o aviso — chamar assim que uma atualização em segundo plano vier a persistir com sucesso. */
export function clearUpdateQuotaBlocked() {
  safeRemove(LS_QUOTA_BLOCKED_AT);
}

/** @returns {number | null} momento (ms) do último bloqueio por cota, ou `null` se não há nenhum registrado. */
export function readUpdateQuotaBlockedAt() {
  const v = safeGet(LS_QUOTA_BLOCKED_AT);
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
