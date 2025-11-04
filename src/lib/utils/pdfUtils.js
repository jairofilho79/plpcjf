// Utils: PDF fetch/share/save
export async function fetchPdfAsBlob(pdfPath) {
  const res = await fetch(pdfPath);
  if (!res.ok) throw new Error('Falha ao baixar PDF');
  return await res.blob();
}

// Open PDF using normal URL
export async function openPdfNewTabOfflineFirst(relPath, filename = 'file.pdf') {
  try {
    const localUrl = new URL(relPath, window.location.origin).href;
    window.open(localUrl, '_blank', 'noopener');
    return true;
  } catch (_) {
    window.open(relPath, '_blank', 'noopener');
    return false;
  }
}

export function buildOnlineReaderUrl(pdfPath) {
  const absolutePdfUrl = new URL(pdfPath, window.location.origin).href;
  const encoded = encodeURIComponent(absolutePdfUrl);
  return `https://coletaneadigitalicm.github.io/leitor-pdf/?url=${encoded}`;
}

export async function sharePdf(blob, filename, title) {
  try {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title });
      return;
    }
  } catch (_) {
    // segue para fallback
  }
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

export async function savePdf(blob, filename) {
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }
  } catch (_) {
    // segue para fallback
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

