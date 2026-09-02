/**
 * A política de ordem do caminho de abertura de um PDF.
 *
 * Vive fora de `pdfValidation.js` por uma razão só: aquele módulo importa por
 * `$lib`, alias que só existe dentro do Vite, e por isso não carrega sob
 * `node --test`. A ordem das tentativas é justamente o que esta correção muda,
 * e mudança sem teste que a prenda volta sozinha — aqui os colaboradores
 * entram por parâmetro e um duplo consegue contar quantas vezes a rede foi
 * tocada. Sem `$lib`, sem `window`: importar por caminho relativo.
 */

/**
 * @typedef {{ available: boolean, needsDownload: boolean, url?: string | null, source?: string }} ValidationResult
 */

/**
 * Resolve a disponibilidade tentando primeiro o que não custa rede.
 *
 * A ordem antiga sondava a conectividade — 1,5 s de espera no pior caso —
 * *antes* de sequer olhar para o cache. Quem estava offline com o PDF já
 * baixado pagava esse tempo inteiro para receber a resposta que o cache tinha
 * de imediato. Invertido: a rede só entra quando o cache falhou, que é o único
 * caso em que ela pode acrescentar alguma coisa.
 *
 * Devolve também o veredito da sonda, porque quem chama precisa dele a seguir e
 * não deve voltar a perguntar: o leitor sondava uma segunda vez para decidir se
 * podia baixar o PDF, e essa repetição custava mais 1,5 s de ecrã morto a quem
 * já estava sem rede. `effectiveOnline` é `undefined` quando a sonda não chegou
 * a correr — houve resposta em cache, e não há veredito nenhum a dar.
 *
 * @param {Object} deps
 * @param {(options: { useIndex: boolean, checkNetwork: boolean, pdfId?: string }) => Promise<ValidationResult>} deps.validate
 * @param {() => Promise<boolean>} deps.checkConnectivity
 * @param {string | null} [deps.pdfId]
 * @returns {Promise<{ result: ValidationResult, effectiveOnline: boolean | undefined }>}
 */
export async function resolveAvailabilityInOrder({ validate, checkConnectivity, pdfId = null }) {
  // `undefined`, não `null`: é a ausência que as opções do CompositeValidator
  // declaram, e um `null` explícito faria a mesma coisa por acidente de tipo.
  const id = pdfId ?? undefined;

  const semRede = await validate({ useIndex: true, checkNetwork: false, pdfId: id });
  if (semRede?.available) {
    return { result: semRede, effectiveOnline: undefined };
  }

  // Só agora a sonda vale o que custa: sem cache, a resposta depende mesmo de
  // haver rede.
  const online = await checkConnectivity();
  if (!online) {
    // Repetir com `checkNetwork: true` estando offline daria exatamente o mesmo
    // resultado — o validador de rede é pulado quando não há rede.
    return { result: semRede, effectiveOnline: false };
  }

  const comRede = await validate({ useIndex: true, checkNetwork: true, pdfId: id });
  return { result: comRede, effectiveOnline: true };
}
