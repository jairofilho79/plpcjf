// JWT verification using Web Crypto API
export async function verifyJWT(token, secret) {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    const payload = JSON.parse(atob(payloadB64));
    
    // Check expiration
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return false;
    }
    
    // Verify signature using Web Crypto API
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signature = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, signature, data);
    
    return valid;
  } catch (error) {
    return false;
  }
}

// Helper: base64 to buffer
export function base64ToBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

