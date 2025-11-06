// Função helper para decodificar base64 para UTF-8 corretamente
export function atobUTF8(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

// Retorna caminho relativo sem barra inicial, ex: "assets/ColAdultos/arquivo.pdf"
export function getPdfRelPath(louvor) {
  if (!louvor || !louvor.pdfId) {
    return null;
  }
  
  try {
    const decoded = atobUTF8(louvor.pdfId);
    // normaliza removendo barras iniciais
    let path = decoded.replace(/^\/+/, '').trim();
    
    if (!path) {
      return null;
    }
    
    // Decodifica caracteres URI-encoded se necessário (para evitar dupla codificação)
    try {
      if (path.includes('%')) {
        path = decodeURIComponent(path);
      }
    } catch (_) {
      // Se decodeURIComponent falhar, mantém o path original
    }
    
    // assegura prefixo assets/
    if (path.toLowerCase().startsWith('assets/')) {
      return path;
    }
    
    return `assets/${path}`;
  } catch (_) {
    return null;
  }
}

