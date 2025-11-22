// Manifest Validation Utility
// Validates integrity between louvores-manifest.json and offline-manifest.json

/**
 * Validates integrity between louvores-manifest.json and offline-manifest.json
 * Checks if all PDFs in louvores-manifest.json are present in offline-manifest.json
 * and if all PDFs in offline-manifest.json exist in louvores-manifest.json
 * 
 * @returns {Promise<{valid: boolean, missingInOffline: string[], extraInOffline: string[], stats: object}>}
 */
export async function validateManifestsIntegrity() {
  try {
    // Load both manifests in parallel
    const [louvoresResponse, offlineResponse] = await Promise.all([
      fetch('/louvores-manifest.json', { cache: 'no-cache' }),
      fetch('/offline-manifest.json', { cache: 'no-cache' })
    ]);

    if (!louvoresResponse.ok) {
      throw new Error(`Failed to fetch louvores-manifest.json: ${louvoresResponse.status}`);
    }

    if (!offlineResponse.ok) {
      throw new Error(`Failed to fetch offline-manifest.json: ${offlineResponse.status}`);
    }

    const [louvoresManifest, offlineManifest] = await Promise.all([
      louvoresResponse.json(),
      offlineResponse.json()
    ]);

    // Extract all pdfIds from louvores-manifest.json
    const louvoresPdfIds = new Set();
    if (Array.isArray(louvoresManifest)) {
      for (const louvor of louvoresManifest) {
        if (louvor && louvor.pdfId) {
          louvoresPdfIds.add(louvor.pdfId);
        }
      }
    }

    // Extract all pdfIds from offline-manifest.json
    const offlinePdfIds = new Set();
    if (offlineManifest && offlineManifest.packages) {
      for (const [category, packageData] of Object.entries(offlineManifest.packages)) {
        if (packageData && packageData.parts && Array.isArray(packageData.parts)) {
          for (const part of packageData.parts) {
            if (part && part.pdfs && Array.isArray(part.pdfs)) {
              for (const pdfId of part.pdfs) {
                if (pdfId) {
                  offlinePdfIds.add(pdfId);
                }
              }
            }
          }
        }
      }
    }

    // Find PDFs in louvores-manifest.json that are missing in offline-manifest.json
    const missingInOffline = [];
    for (const pdfId of louvoresPdfIds) {
      if (!offlinePdfIds.has(pdfId)) {
        missingInOffline.push(pdfId);
      }
    }

    // Find PDFs in offline-manifest.json that don't exist in louvores-manifest.json
    const extraInOffline = [];
    for (const pdfId of offlinePdfIds) {
      if (!louvoresPdfIds.has(pdfId)) {
        extraInOffline.push(pdfId);
      }
    }

    const valid = missingInOffline.length === 0 && extraInOffline.length === 0;

    const stats = {
      louvoresCount: louvoresPdfIds.size,
      offlineCount: offlinePdfIds.size,
      missingCount: missingInOffline.length,
      extraCount: extraInOffline.length
    };

    return {
      valid,
      missingInOffline,
      extraInOffline,
      stats
    };
  } catch (error) {
    console.error('[Manifest Validation] Error validating manifests:', error);
    return {
      valid: false,
      missingInOffline: [],
      extraInOffline: [],
      stats: {
        louvoresCount: 0,
        offlineCount: 0,
        missingCount: 0,
        extraCount: 0
      },
      error: error.message
    };
  }
}

