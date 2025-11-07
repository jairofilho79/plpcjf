/**
 * Share playlist link using Web Share API or clipboard fallback
 * @param {string} url - The playlist share URL
 * @param {string} title - The playlist name/title
 * @returns {Promise<void>}
 */
export async function sharePlaylistLink(url, title) {
  // Try Web Share API first if available
  if (navigator.share) {
    try {
      const shareData = {
        url,
        title: `Playlist: ${title}`,
        text: `Confira esta playlist: ${title}`
      };
      
      // Check if canShare is available and use it to validate
      if (navigator.canShare) {
        if (!navigator.canShare(shareData)) {
          // Can't share this data, fall through to clipboard
          throw new Error('Cannot share this data');
        }
      }
      
      await navigator.share(shareData);
      // Share successful, return undefined (no clipboard copy needed)
      return;
    } catch (error) {
      // User cancelled (AbortError) or share failed
      if (error.name === 'AbortError') {
        // User cancelled, don't copy to clipboard
        return;
      }
      // Share failed for other reason, fall through to clipboard
      console.warn('Erro ao compartilhar via Web Share API:', error);
    }
  }
  
  // Fallback to clipboard
  try {
    await navigator.clipboard.writeText(url);
    // Return success indicator for UI feedback
    return { copied: true };
  } catch (error) {
    console.error('Erro ao copiar link para clipboard:', error);
    throw error;
  }
}

/**
 * Generate share URL for a playlist
 * @param {string[]} pdfIds - Array of PDF IDs in order
 * @param {string} nome - Playlist name
 * @returns {string}
 */
export function generatePlaylistShareUrl(pdfIds, nome) {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const pdfIdsParam = pdfIds.join(',');
  const nameParam = encodeURIComponent(nome);
  return `${baseUrl}/?sharepdfs=${pdfIdsParam}&sharename=${nameParam}`;
}

