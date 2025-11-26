import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outDir = path.resolve(process.cwd(), 'static');
const outFile = path.resolve(outDir, 'offline-setup.pdf');

fs.mkdirSync(outDir, { recursive: true });

const doc = new PDFDocument({ 
  autoFirstPage: false, 
  info: { 
    Title: 'Página de Funcionamento Offline', 
    Author: 'PLPC',
    Subject: 'Configuração para funcionamento offline'
  } 
});
const stream = fs.createWriteStream(outFile);
doc.pipe(stream);

// Add first page
doc.addPage({ size: 'A4', margin: 72 });

// Title
doc.fontSize(24)
   .font('Helvetica-Bold')
   .text('Página de Funcionamento Offline', { align: 'center' });
doc.moveDown(1.5);

// Introduction
doc.fontSize(12)
   .font('Helvetica')
   .text('Esta é uma página simples para garantir o pleno funcionamento do sistema offline da aplicação.', { align: 'justify' });
doc.moveDown(1);

doc.text('Ao abrir este PDF no leitor, o sistema será configurado para funcionar corretamente em modo offline.', { align: 'justify' });
doc.moveDown(2);

// Section: Quem somos
doc.fontSize(16)
   .font('Helvetica-Bold')
   .text('Quem somos', { align: 'left' });
doc.moveDown(0.5);

doc.fontSize(12)
   .font('Helvetica')
   .text('A Paz do Senhor Jesus. Somos irmãos da Igreja Cristã Maranata da Região do Triângulo Mineiro e servimos no Maanaim de Uberlândia-MG. Esta aplicação não é oficial da ICM, mas o objetivo é ajudar a todos que estão no louvor ajudando na Obra. Seguindo as orientações da Igreja. De forma 100% gratuita. Há custos, mas pedimos orações dos irmãos para o Senhor sempre prover.', { align: 'justify' });
doc.moveDown(1.5);

// Section: Objetivo
doc.fontSize(16)
   .font('Helvetica-Bold')
   .text('Objetivo', { align: 'left' });
doc.moveDown(0.5);

doc.fontSize(12)
   .font('Helvetica')
   .text('O objetivo da aplicação, chamada Pesquisador de Louvores em Partitura e Cifra (que também tem gestinhos), é ajudar os irmãos da equipe de louvor com os materiais mais básicos pro louvor (Partitura, Cifra e Gestos em gravura para as CIAs). Que seja fácil de pesquisar, consumir e que funcione offline, pois muita igrejas não tem internet ou é muito difícil o acesso em ESFs.', { align: 'justify' });
doc.moveDown(1);

doc.text('Portanto, estejamos em oração por todos os irmãos que estão envolvidos nesse projeto. Quer seja diretamente no desenvolvimento da aplicação, quer seja na produção dos materiais, no uso/teste da aplicação e afins.', { align: 'justify' });
doc.moveDown(2);

// Footer note
doc.fontSize(10)
   .font('Helvetica-Oblique')
   .text('Feito com amor pelos IDM (Irmãos da Maranata)', { align: 'center' });

doc.end();

stream.on('finish', () => {
  // eslint-disable-next-line no-console
  console.log(`PDF de configuração offline gerado em: ${outFile}`);
});

