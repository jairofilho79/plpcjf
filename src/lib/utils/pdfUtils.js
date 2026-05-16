import { getConfig } from '$lib/offline/core/OfflineConfig.js';
import indexedDbAssetRepository from '$lib/offline/storage/IndexedDbAssetRepository.js';
import { withObjectUrl } from '$lib/offline/ui/objectUrlLifecycle.js';

// Utils: PDF fetch/share/save
export async function fetchPdfAsBlob(pdfPath) {
  const idbEnabled = getConfig('OFFLINE_IDB_ENABLED') === true;
  const useCacheFallback = getConfig('OFFLINE_READTHROUGH_CACHE_FALLBACK_ENABLED') !== false;

  // Read-through: IndexedDB first
  if (idbEnabled) {
    try {
      const idbBlob = await indexedDbAssetRepository.getAssetBlob(pdfPath);
      if (idbBlob) {
        return idbBlob;
      }
    } catch (idbError) {
      console.warn('[fetchPdfAsBlob] Erro ao verificar IndexedDB, tentando fallback:', idbError);
    }
  }

  // Primeiro, tentar obter do Cache Storage usando CacheStorageAdapter (otimizado)
  // Isso elimina o delay de 5s quando o PDF está em cache
  if (useCacheFallback && typeof window !== 'undefined' && typeof caches !== 'undefined') {
    try {
      const cacheStorageAdapter = await import('$lib/offline/storage/CacheStorageAdapter.js');
      const cachedResponse = await cacheStorageAdapter.default.getPdf(pdfPath);
      
      if (cachedResponse) {
        // PDF encontrado no cache - retornar blob imediatamente (sem delay)
        return await cachedResponse.blob();
      }
    } catch (cacheError) {
      // Se houver erro ao acessar cache, continuar com fetch normal
      console.warn('[fetchPdfAsBlob] Erro ao verificar cache, usando fetch:', cacheError);
    }
  }
  
  // Se não estiver em cache, fazer fetch de rede com timeout
  const FETCH_TIMEOUT = 3000; // 3 segundos
  const normalizedPath = pdfPath.startsWith('/') ? pdfPath : `/${pdfPath}`;
  
  // Verificar se estamos no browser antes de criar URL
  if (typeof window === 'undefined') {
    throw new Error('fetchPdfAsBlob só pode ser usado no browser');
  }
  
  const fullUrl = new URL(normalizedPath, window.location.origin).href;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  
  try {
    const res = await fetch(fullUrl, { 
      signal: controller.signal,
      cache: 'default' // Permitir uso do cache HTTP
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) throw new Error('Falha ao baixar PDF');
    return await res.blob();
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Se timeout ou erro, tentar fetch sem timeout como fallback
    if (error.name === 'AbortError') {
      console.warn('[fetchPdfAsBlob] Timeout ao buscar PDF, tentando sem timeout...');
      const res = await fetch(fullUrl);
      if (!res.ok) throw new Error('Falha ao baixar PDF');
      return await res.blob();
    }
    
    throw error;
  }
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
  withObjectUrl(blob, (url) => {
    window.open(url, '_blank');
  }, {
    revokeDelayMs: 30000
  });
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
  withObjectUrl(blob, (url) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  });
}

