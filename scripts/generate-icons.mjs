import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function generateIcons() {
  try {
    // Tentar importar sharp dinamicamente
    const sharp = (await import('sharp')).default;
    
    const svgPath = join(__dirname, '..', 'static', 'favicon.svg');
    const svgBuffer = readFileSync(svgPath);
    
    const sizes = [192, 512];
    
    for (const size of sizes) {
      const outputPath = join(__dirname, '..', 'static', `icon-${size}.png`);
      
      await sharp(svgBuffer)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 }
        })
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Generated icon-${size}.png`);
    }
    
    console.log('\n✅ All icons generated successfully!');
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('sharp')) {
      console.error('\n❌ Error: sharp is not installed.');
      console.log('\n📦 Please install sharp first:');
      console.log('   npm install sharp --save-dev\n');
      console.log('Then run this script again:');
      console.log('   npm run generate-icons\n');
      process.exit(1);
    } else {
      console.error('\n❌ Error generating icons:', error.message);
      process.exit(1);
    }
  }
}

generateIcons();

