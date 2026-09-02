/**
 * Chaves de armazenamento usadas em mais de um módulo.
 *
 * Só entram aqui as chaves com mais de um dono. As que vivem inteiras dentro de
 * um módulo (`pdfPreferredFitMode`, `STATS_CACHE_KEY`, `PDF_INDEX_KEY`) ficam
 * onde estão — mover tudo para cá seria centralizar sem ganho.
 */

/**
 * Marca que o utilizador entrou na rota `/leitor`. Escrita em
 * `routes/leitor/+page.svelte`, lida em `stores/offline.js`,
 * `OfflineIndicator.svelte` e `OfflineRequirementsAlert.svelte` — quatro sítios
 * que até 2026-09-02 repetiam a string à mão.
 */
export const IS_LEITOR_OFFLINE_KEY = 'IS_LEITOR_OFFLINE';
