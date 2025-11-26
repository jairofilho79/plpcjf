import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outDir = path.resolve(process.cwd(), 'static', 'pdfs');
const outFile = path.resolve(outDir, 'exemplo.pdf');

fs.mkdirSync(outDir, { recursive: true });

const doc = new PDFDocument({ autoFirstPage: false, info: { Title: 'Exemplo 3 páginas', Author: 'PLPCJF' } });
const stream = fs.createWriteStream(outFile);
doc.pipe(stream);

function addPage(num) {
  doc.addPage({ size: 'A4', margin: 72 });
  doc.fontSize(22).text('Leitor de PDF - Exemplo', { align: 'center' });
  doc.moveDown(1);
  doc.fontSize(16).text(`Página ${num} de 3`, { align: 'center' });
  doc.moveDown(2);
  doc.fontSize(12).text(
    'Use os botões de zoom, atalhos (Ctrl/Cmd +/−/0) e setas PgUp/PgDn para navegar.',
    { align: 'left' }
  );
  doc.moveDown(1);
  doc.text('Conteúdo de teste:');
  doc.moveDown(0.5);
  doc.text(
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. ' +
    'Suspendisse lectus tortor, dignissim sit amet, adipiscing nec, ultricies sed, dolor. '
  , { paragraphGap: 6 });
  for (let i = 0; i < 12; i++) {
    doc.text(`Linha de exemplo ${i + 1} na página ${num}.`);
  }
}

addPage(1);
addPage(2);
addPage(3);

doc.end();

stream.on('finish', () => {
  // eslint-disable-next-line no-console
  console.log(`PDF de exemplo gerado em: ${outFile}`);
});


