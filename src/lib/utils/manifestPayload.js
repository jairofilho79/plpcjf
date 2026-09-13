export function prepareLouvoresManifestPayload(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const pid = /** @type {{ pdfId?: unknown }} */ (item).pdfId;
    if (pid === null || pid === undefined) continue;
    if (typeof pid === 'string') {
      if (pid.trim() === '') continue;
    } else if (typeof pid === 'number') {
      if (!Number.isFinite(pid)) continue;
    } else {
      continue;
    }

    let nome = '';
    try {
      const nomeRaw = /** @type {{ nome?: unknown }} */ (item).nome;
      if (nomeRaw === null || nomeRaw === undefined) {
        nome = '';
      } else if (typeof nomeRaw === 'string') {
        nome = nomeRaw;
      } else {
        nome = String(nomeRaw);
      }
    } catch {
      continue;
    }

    out.push({ ...item, nome, pdfId: pid });
  }
  return out.length > 0 ? out : null;
}
