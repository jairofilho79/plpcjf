/**
 * Video 3 - Uso da Biblioteca.
 *
 * O primeiro a ser construido: e o mais curto e nao tem armadilha de offline,
 * entao se a corrente estiver partida, parte aqui e barato.
 *
 * Seletores confirmados em:
 *   src/lib/components/CategoryFilters.svelte       [aria-label="Filtrar por categoria"]
 *   src/lib/components/ClassificationFilters.svelte [aria-label="Filtrar por arranjo"]
 *   src/lib/components/SpecialArrangementFilters.svelte
 *   src/lib/components/SortSelector.svelte          .sort-container / .sort-chip
 *   src/lib/components/PdfViewerSelector.svelte     .pdf-viewer-container
 *   src/lib/components/LouvorPaginationControls.svelte
 */
export default {
  id: '03-biblioteca',
  titulo: 'Uso da Biblioteca',
  url: 'https://plpcg.com/biblioteca',

  async preparar(page, ui) {
    await ui.esperar('.louvores-container', 45000);
  },

  beats: [
    {
      id: 'abertura',
      fala: 'A Biblioteca serve para percorrer o acervo inteiro. Use ela quando quiser navegar entre os louvores, e não quando já souber o número.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(400);
      }
    },
    {
      id: 'material',
      fala: 'Em Material você escolhe o que quer ver: partitura, cifra ou gestos em gravura.',
      zoom: { seletor: '[aria-label="Filtrar por categoria"]', margem: 12 },
      acao: async (p, ui) => {
        await ui.tocar('[aria-label="Categoria Cifra"]');
      }
    },
    {
      id: 'material-so-um',
      fala: 'Toque e segure em um material para deixar somente ele marcado. Toque em Todos para voltar a ver tudo.',
      zoom: { seletor: '[aria-label="Filtrar por categoria"]', margem: 12 },
      acao: async (p, ui) => {
        await ui.toqueLongo('[aria-label="Categoria Partitura"]');
        await ui.pausa(600);
        await ui.tocar('.filter-container .todos-button-tag');
      }
    },
    {
      id: 'arranjo',
      fala: 'Em Arranjo você filtra pela coletânea: avulsos diversos, coletânea de adultos, coletânea das CIAs e por aí vai.',
      zoom: { seletor: '[aria-label="Filtrar por arranjo"]', margem: 12 },
      acao: async (p, ui) => {
        await ui.tocar('[aria-label="Arranjo Coletânea Adultos"]');
      }
    },
    {
      id: 'arranjo-especial',
      fala: 'Quando os louvores filtrados tiverem arranjos especiais, aparece mais um filtro só para eles.',
      zoom: { seletor: '[aria-label="Filtrar por arranjo especial"]', margem: 12 },
      acao: async (p, ui) => {
        // Este filtro so existe quando o recorte atual tem arranjo especial.
        // Se nao aparecer, o beat narra a regra e segue - nao ha o que tocar.
        if (await ui.existe('[aria-label="Filtrar por arranjo especial"]')) {
          await ui.esperar('[aria-label="Filtrar por arranjo especial"]');
        }
      }
    },
    {
      id: 'ordenar',
      fala: 'Em Ordenar você escolhe se a lista sai por número ou por nome do louvor.',
      zoom: { seletor: '.sort-container', margem: 12 },
      acao: async (p, ui) => {
        await ui.tocar('.sort-container .sort-chip:nth-of-type(2)');
        await ui.pausa(700);
        await ui.tocar('.sort-container .sort-chip:nth-of-type(1)');
      }
    },
    {
      id: 'como-abrir',
      fala: 'Em Como abrir você decide o que acontece ao tocar num louvor: abrir no leitor, abrir em outra aba, compartilhar ou baixar.',
      zoom: { seletor: '.pdf-viewer-container', margem: 12 },
      acao: async (p, ui) => {
        await ui.tocar('.pdf-viewer-container');
      }
    },
    {
      id: 'paginacao',
      fala: 'A lista vem paginada. Você escolhe quantos itens aparecem por página e navega com as setas.',
      zoom: { seletor: '.pagination-controls', margem: 10 },
      acao: async (p, ui) => {
        await ui.tocar('.pagination-controls .pagination-button:last-of-type');
        await ui.pausa(800);
        await ui.tocar('.pagination-controls .pagination-button:first-of-type');
      }
    },
    {
      id: 'vazio',
      fala: 'Se você desmarcar filtros demais, a lista fica vazia e a tela avisa. Basta marcar de volta.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.tocar('.filter-container .todos-button-tag');
        await ui.pausa(900);
        await ui.tocar('.filter-container .todos-button-tag');
      }
    },
    {
      id: 'fecho',
      fala: 'É isso. Filtre pelo material e pelo arranjo, ordene do jeito que preferir, e toque no louvor para abrir.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.rolar(-1200);
      }
    }
  ]
};
