/**
 * Traduz o cabeçalho `Range` de uma requisição para o formato que o R2 espera.
 *
 * Vive aqui, e não dentro de `hooks.server.js`, pela mesma razão que
 * `pdfKeyResolution.js`: para ser testável sob `node --test` sem precisar do
 * alias `$lib` nem de um ambiente de Worker.
 *
 * Um `<video>` pede o ficheiro aos pedaços. Se o servidor ignorar o `Range` e
 * devolver sempre o ficheiro inteiro, o navegador tem de baixar tudo antes de
 * começar a tocar e não consegue saltar para o meio — num vídeo de vários
 * megabytes, numa igreja com internet fraca, isso é a diferença entre tocar e
 * não tocar.
 *
 * Só a forma `bytes=` de um único intervalo é suportada. Intervalos múltiplos
 * (`bytes=0-99,200-299`) devolvem `null`, o que faz o chamador servir o
 * ficheiro inteiro: é uma resposta válida e nenhum navegador conhecido pede
 * intervalos múltiplos para vídeo.
 *
 * @param {string | null | undefined} cabecalho
 * @returns {{offset?: number, length?: number, suffix?: number} | null}
 */
export function analisarRange(cabecalho) {
  if (!cabecalho) return null;

  const m = /^bytes=(\d*)-(\d*)$/.exec(cabecalho.trim());
  if (!m) return null;

  const [, cru1, cru2] = m;
  if (cru1 === '' && cru2 === '') return null;

  // `bytes=-500`: os últimos 500 bytes.
  if (cru1 === '') {
    const suffix = Number(cru2);
    return suffix > 0 ? { suffix } : null;
  }

  const offset = Number(cru1);

  // `bytes=1000-`: daí até ao fim.
  if (cru2 === '') return { offset };

  const fim = Number(cru2);
  // Um intervalo invertido é um pedido inválido, não um pedido de zero bytes.
  if (fim < offset) return null;

  return { offset, length: fim - offset + 1 };
}
