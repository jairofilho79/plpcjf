// Formata um tamanho em bytes como texto legível ("1.23 MB" / "456.00 KB").
// Extraído de src/routes/offline/+page.svelte (#23): usado tanto pela página
// quanto pelo painel de progresso de download que saiu dela.
/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(2)} MB`;
  }
  const kb = bytes / 1024;
  return `${kb.toFixed(2)} KB`;
}
