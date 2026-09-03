/**
 * Video 1 - Uso básico.
 *
 * Carrega o leitor inteiro, porque não existe vídeo dedicado a ele. Metade dos
 * beats do leitor são toque longo: é aqui que o indicador de toque de
 * `lib/toque.mjs` justifica a sua existência, porque um gesto que não se vê
 * não se aprende.
 *
 * Seletores confirmados em:
 *   src/routes/+layout.svelte                    .header-button, .plpc-title-button
 *   src/routes/+page.svelte                      .filter-collapse-trigger
 *   src/lib/components/SearchBar.svelte          [aria-label="Buscar louvor por nome ou número"]
 *   src/lib/components/LouvorCard.svelte         .material-open, .add-button
 *   src/routes/leitor/+page.svelte               .btn.zoom-fit, .btn.brightness-toggle,
 *                                                .btn.nav-mode-toggle, .btn.layer-toggle,
 *                                                .fab-exit-fullscreen
 */
export default {
  id: '01-uso-basico',
  titulo: 'Uso básico da aplicação',
  url: 'https://plpcg.com/',

  async preparar(page, ui) {
    await ui.esperar('.filter-collapse-trigger', 45000);
  },

  beats: [
    {
      id: 'cabecalho',
      fala: 'No topo ficam as cinco telas: Como Usar, Biblioteca, a tela inicial no meio, Offline e Listas.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(600);
      }
    },
    {
      id: 'busca-numero',
      fala: 'A tela inicial é para procurar. Digite o número do louvor na caixa Buscar.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.escrever('[aria-label="Buscar louvor por nome ou número"]', '218');
        await ui.pausa(900);
      }
    },
    {
      id: 'busca-nome',
      fala: 'Ou digite parte do nome, se você não lembrar o número.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.escrever('[aria-label="Buscar louvor por nome ou número"]', 'senhor');
        await ui.pausa(900);
      }
    },
    {
      id: 'cartao',
      fala: 'Cada resultado mostra o número, o nome e o arranjo do louvor. Toque no material para abrir.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.esperar('.louvor-card');
        await ui.pausa(700);
      }
    },
    {
      id: 'filtros',
      fala: 'Se vier resultado demais, abra Filtros e escolha só o material que você quer: partitura, cifra ou gestos em gravura.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.rolar(-900);
        await ui.tocar('.filter-collapse-trigger');
        await ui.pausa(700);
        await ui.tocar('[aria-label="Categoria Cifra"]');
      }
    },
    {
      id: 'como-abrir',
      fala: 'Em Como abrir você escolhe o que acontece ao tocar num louvor. Deixe em Leitor para ler dentro da aplicação.',
      zoom: { seletor: '.pdf-viewer-container', margem: 12 },
      acao: async (p, ui) => {
        await ui.tocar('.pdf-viewer-container');
        await ui.pausa(600);
      }
    },
    {
      id: 'adicionar',
      fala: 'O botão de mais, ao lado do louvor, guarda ele numa lista para você tocar em sequência. Isso é assunto do vídeo das Listas.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.rolar(700);
        await ui.pausa(800);
      }
    },
    {
      id: 'abrir-leitor',
      fala: 'Toque no material e o louvor abre no leitor.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.tocar('.material-open, .louvor-info');
        await ui.esperar('.toolbar', 45000);
        await ui.pausa(1200);
      }
    },
    {
      id: 'leitor-paginas',
      fala: 'As setas passam de página. O número no meio mostra em qual você está.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.tocar('.page-nav-next');
        await ui.pausa(800);
        await ui.tocar('.page-nav-prev');
      }
    },
    {
      id: 'leitor-primeira-ultima',
      fala: 'Toque e segure numa seta para saltar direto para a primeira ou para a última página.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.toqueLongo('.page-nav-next');
        await ui.pausa(900);
        await ui.toqueLongo('.page-nav-prev');
      }
    },
    {
      id: 'leitor-zoom',
      fala: 'Os botões de menos e mais aumentam e diminuem a página.',
      zoom: null,
      acao: async (p, ui) => {
        if (await ui.existe('.btn.zoom-plus')) {
          await ui.tocar('.btn.zoom-plus');
          await ui.pausa(600);
          await ui.tocar('.btn.zoom-minus');
        }
      }
    },
    {
      id: 'leitor-fit',
      fala: 'O botão do meio, com a porcentagem, volta ao ajuste automático. Segure nele para alternar entre caber a página inteira ou caber na largura.',
      zoom: { seletor: '.btn.zoom-fit', margem: 30 },
      acao: async (p, ui) => {
        if (await ui.existe('.btn.zoom-fit')) {
          await ui.tocar('.btn.zoom-fit');
          await ui.pausa(700);
          await ui.toqueLongo('.btn.zoom-fit');
        }
      }
    },
    {
      id: 'leitor-brilho',
      fala: 'O botão de brilho escurece a página aos poucos, para tocar sem cansar a vista. Segure nele para voltar ao normal.',
      zoom: { seletor: '.btn.brightness-toggle', margem: 30 },
      acao: async (p, ui) => {
        if (await ui.existe('.btn.brightness-toggle')) {
          await ui.tocar('.btn.brightness-toggle');
          await ui.pausa(700);
          await ui.toqueLongo('.btn.brightness-toggle');
        }
      }
    },
    {
      id: 'leitor-camadas',
      fala: 'No tablet em pé a barra não cabe inteira. O botão com o número troca de camada e mostra o resto dos controles.',
      zoom: { seletor: '.btn.layer-toggle', margem: 30 },
      acao: async (p, ui) => {
        if (await ui.existe('.btn.layer-toggle')) {
          await ui.tocar('.btn.layer-toggle');
          await ui.pausa(900);
        }
      }
    },
    {
      id: 'leitor-modo',
      fala: 'Este botão troca entre rolar continuamente e virar uma página de cada vez.',
      zoom: { seletor: '.btn.nav-mode-toggle', margem: 30 },
      acao: async (p, ui) => {
        if (await ui.existe('.btn.nav-mode-toggle')) {
          await ui.tocar('.btn.nav-mode-toggle');
          await ui.pausa(900);
          await ui.tocar('.btn.nav-mode-toggle');
        }
      }
    },
    {
      id: 'leitor-swipe',
      fala: 'Você também pode arrastar o dedo para o lado para virar a página, e juntar ou afastar dois dedos para aproximar.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.deslizar('#viewerContainer, .pdf-container, body', 'esquerda');
        await ui.pausa(500);
        await ui.pincar('#viewerContainer, .pdf-container, body', 1.6);
      }
    },
    {
      id: 'leitor-fullscreen',
      fala: 'Toque e segure na página para esconder a barra e usar a tela toda. O botão no canto traz a barra de volta.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.toqueLongo('#viewerContainer, .pdf-container, body', 800);
        await ui.pausa(1200);
        if (await ui.existe('.fab-exit-fullscreen')) {
          await ui.tocar('.fab-exit-fullscreen');
        }
      }
    },
    {
      id: 'fecho',
      fala: 'Para voltar, toque em PLPCG no canto da barra. É só isso: procure, abra e leia.',
      zoom: null,
      acao: async (p, ui) => {
        if (await ui.existe('.brand')) {
          await ui.tocar('.brand');
          await ui.pausa(1200);
        }
      }
    }
  ]
};
