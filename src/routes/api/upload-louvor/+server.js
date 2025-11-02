import { json } from '@sveltejs/kit';
import { verifyJWT, base64ToBuffer } from '$lib/utils/jwtUtils';

export async function POST({ request, platform }) {
  try {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Verify JWT token
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response('Unauthorized', { 
        status: 401, 
        headers: corsHeaders 
      });
    }
    
    const token = authHeader.substring(7);
    const isValid = await verifyJWT(token, platform.env.JWT_SECRET);
    
    if (!isValid) {
      return new Response('Invalid token', { 
        status: 401, 
        headers: corsHeaders 
      });
    }
    
    // Parse request body
    const body = await request.json();
    const { file, metadata } = body;
    
    if (!file || !metadata) {
      return new Response('Missing file or metadata', { 
        status: 400, 
        headers: corsHeaders 
      });
    }
    
    // Validate metadata
    const { nome, classificacao, numero, categoria } = metadata;
    if (!nome || !classificacao || !categoria) {
      return new Response('Missing required metadata fields', { 
        status: 400, 
        headers: corsHeaders 
      });
    }
    
    // Convert base64 to buffer
    const fileData = base64ToBuffer(file);
    if (fileData.length > 10 * 1024 * 1024) {
      return new Response('File too large (max 10MB)', { 
        status: 400, 
        headers: corsHeaders 
      });
    }
    
    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedName = nome.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${timestamp}-${sanitizedName}.pdf`;
    
    // Save PDF to R2
    await platform.env.LOUVORES_BUCKET.put(filename, fileData, {
      httpMetadata: {
        contentType: 'application/pdf',
      },
    });
    
    // Update manifest.json
    const manifest = await platform.env.LOUVORES_BUCKET.get('louvores-manifest.json');
    let louvores = [];
    
    if (manifest) {
      louvores = await manifest.json();
    }
    
    // Add new louvor to manifest
    const newLouvor = {
      nome,
      classificacao,
      numero: numero || '',
      categoria,
      pdf: filename,
      pdfId: btoa(`${classificacao}/${filename}`).replace(/[+\/=]/g, c => ({'+':'-', '/':'_', '=':''})[c])
    };
    
    louvores.push(newLouvor);
    
    // Save updated manifest
    await platform.env.LOUVORES_BUCKET.put('louvores-manifest.json', JSON.stringify(louvores, null, 2), {
      httpMetadata: {
        contentType: 'application/json',
      },
    });
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Louvor adicionado com sucesso',
        louvor: newLouvor 
      }), 
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
    
  } catch (error) {
    console.error('Upload error:', error);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    return new Response(
      JSON.stringify({ success: false, error: error.message }), 
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
}

