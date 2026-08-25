/**
 * Agrupa entradas flat do manifesto por groupId (ordem da primeira ocorrência).
 */

/** @type {readonly string[]} */
export const MATERIAL_CATEGORY_ORDER = [
  'Partitura',
  'Cifra nível I',
  'Cifra nível II',
  'Cifra',
  'Gestos em Gravura'
];

/**
 * @param {string | null | undefined} categoria
 * @returns {number}
 */
export function categorySortIndex(categoria) {
  const i = MATERIAL_CATEGORY_ORDER.indexOf(categoria || '');
  return i === -1 ? MATERIAL_CATEGORY_ORDER.length : i;
}

/**
 * @param {any} louvor
 * @returns {string}
 */
export function resolveGroupId(louvor) {
  if (louvor?.groupId) return String(louvor.groupId);
  if (louvor?.pdfId) return String(louvor.pdfId);
  return `solo:${louvor?.nome || ''}:${louvor?.categoria || ''}:${louvor?.pdf || ''}`;
}

/**
 * @param {any[]} list
 * @returns {{ groupId: string, nome: string, numero: string, classificacao: string, materials: any[] }[]}
 */
export function groupLouvoresByGroupId(list) {
  if (!Array.isArray(list) || list.length === 0) return [];

  /** @type {Map<string, any[]>} */
  const buckets = new Map();
  /** @type {string[]} */
  const order = [];

  for (const louvor of list) {
    const gid = resolveGroupId(louvor);
    if (!buckets.has(gid)) {
      buckets.set(gid, []);
      order.push(gid);
    }
    buckets.get(gid).push(louvor);
  }

  return order.map((groupId) => {
    const materials = [...buckets.get(groupId)].sort(
      (a, b) => categorySortIndex(a.categoria) - categorySortIndex(b.categoria)
    );
    const head = materials[0];
    return {
      groupId,
      nome: head?.nome || '',
      numero: head?.numero || '',
      classificacao: head?.classificacao || '',
      materials
    };
  });
}

/**
 * Material preferido para + / default: último aberto na sessão, senão primeiro na ordem de categoria.
 * @param {any[]} materials
 * @param {string | null | undefined} lastPdfId
 * @returns {any | null}
 */
export function pickPreferredMaterial(materials, lastPdfId) {
  if (!Array.isArray(materials) || materials.length === 0) return null;
  if (lastPdfId) {
    const found = materials.find((m) => m.pdfId === lastPdfId);
    if (found) return found;
  }
  return materials[0];
}

const LAST_MATERIAL_PREFIX = 'plpcg:lastMaterial:';

/**
 * @param {string} groupId
 * @returns {string | null}
 */
export function readLastMaterialPdfId(groupId) {
  if (typeof sessionStorage === 'undefined' || !groupId) return null;
  try {
    return sessionStorage.getItem(LAST_MATERIAL_PREFIX + groupId);
  } catch {
    return null;
  }
}

/**
 * @param {string} groupId
 * @param {string} pdfId
 */
export function writeLastMaterialPdfId(groupId, pdfId) {
  if (typeof sessionStorage === 'undefined' || !groupId || !pdfId) return;
  try {
    sessionStorage.setItem(LAST_MATERIAL_PREFIX + groupId, pdfId);
  } catch {
    // ignore quota / private mode
  }
}
