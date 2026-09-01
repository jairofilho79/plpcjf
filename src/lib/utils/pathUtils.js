import { decodeUrlUtf8Multiple } from './urlEncoding.js';

/**
 * Decodifica base64 para UTF-8 corretamente
 * 
 * CRÍTICO: Esta função deve SEMPRE ser usada para decodificar pdfId.
 * NÃO use atob() diretamente, pois atob() decodifica para latin-1, não UTF-8.
 * 
 * A função atob() nativa do JavaScript decodifica base64 para uma string
 * binária usando codificação latin-1, o que quebra caracteres UTF-8 como
 * acentos (á, é, ã, etc.) e caracteres especiais.
 * 
 * Esta implementação:
 * 1. Usa atob() para obter a string binária
 * 2. Converte cada caractere para byte usando charCodeAt()
 * 3. Usa TextDecoder('utf-8') para decodificar corretamente os bytes como UTF-8
 * 
 * @param {string} base64 - String base64 a ser decodificada
 * @returns {string} String decodificada em UTF-8
 * @throws {Error} Se a decodificação falhar
 */
export function atobUTF8(base64) {
  if (!base64 || typeof base64 !== 'string') {
    throw new Error('atobUTF8: base64 must be a non-empty string');
  }
  
  // atob() decodifica para latin-1, não UTF-8
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  // TextDecoder('utf-8') decodifica corretamente os bytes como UTF-8
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

// Retorna caminho relativo sem barra inicial, ex: "assets/ColAdultos/arquivo.pdf"
// CRÍTICO: Esta função NÃO normaliza o caminho (não converte para minúsculas, não remove acentos)
// O caminho é usado exatamente como está no pdfId decodificado em base64 UTF-8
function computePdfRelPath(louvor) {
  if (!louvor || !louvor.pdfId) {
    return null;
  }
  
  try {
    // CRÍTICO: Usar atobUTF8 (UTF-8), NÃO atob() (latin-1)
    // pdfId está codificado em base64 UTF-8, não latin-1
    const decoded = atobUTF8(louvor.pdfId);
    // Remove apenas barras iniciais, preservando o resto do caminho original
    let path = decoded.replace(/^\/+/, '').trim();
    
    if (!path) {
      return null;
    }
    
    // Decodifica caracteres URI-encoded se necessário (para evitar dupla codificação)
    // Usa UTF-8 explicitamente
    try {
      if (path.includes('%')) {
        path = decodeUrlUtf8Multiple(path, 3);
      }
    } catch (_) {
      // Se decodeUrlComponentUtf8 falhar, mantém o path original
    }
    
    // Verifica se começa com "assets/" (case-sensitive para preservar o caminho original)
    // Mas aceita variações de case para compatibilidade
    const lowerPath = path.toLowerCase();
    if (lowerPath.startsWith('assets/')) {
      // Se já começa com assets/, retorna o path original (preservando case)
      return path;
    }
    
    // Se não começa com assets/, adiciona o prefixo preservando o case original
    return `assets/${path}`;
  } catch (_) {
    return null;
  }
}

/**
 * Cache de caminho por pdfId. O pdfId é imutável para um louvor, então o
 * resultado nunca fica obsoleto. Guarda também o null, para não repetir o atob
 * de entradas quebradas.
 * @type {Map<string, string | null>}
 */
const pdfRelPathCache = new Map();

/** Só para teste. */
export function __resetPdfRelPathCache() {
  pdfRelPathCache.clear();
}

/**
 * Caminho relativo do PDF, sem barra inicial. Ex.: "assets/ColAdultos/001.pdf".
 * Memoizado por pdfId — era chamado centenas de vezes por render de página.
 * @param {any} louvor
 * @returns {string | null}
 */
export function getPdfRelPath(louvor) {
  const pdfId = louvor?.pdfId;
  if (!pdfId || typeof pdfId !== 'string') return null;

  if (pdfRelPathCache.has(pdfId)) {
    return pdfRelPathCache.get(pdfId) ?? null;
  }

  const resolved = computePdfRelPath(louvor);
  pdfRelPathCache.set(pdfId, resolved);
  return resolved;
}
