/**
 * Video 4 - Uso das Listas.
 *
 * Começa na tela inicial, porque é lá que a playlist se monta, e só depois vai
 * para /listas. Duas armadilhas conhecidas, tratadas nos beats:
 *
 *  - "Em Abas" abre várias abas e rouba o foco, o que mataria o screencast da
 *    aba gravada. O beat mostra o botão e narra o que ele faz, sem o tocar.
 *  - "Compartilhar" escreve na área de transferência; a permissão já é
 *    concedida em `gravar.mjs`.
 *
 * Seletores confirmados em:
 *   src/lib/components/CarouselChips.svelte  [title="Compartilhar playlist"], etc.
 *   src/lib/components/LouvorCard.svelte     .add-button
 *   src/routes/listas/+page.svelte           .playlist-card, .playlist-actions
 */
export default {
  id: '04-listas',
  titulo: 'Uso das Listas',
  url: 'https://plpcg.com/',

  async preparar(page, ui) {
    await ui.esperar('[aria-label="Buscar louvor por nome ou número"]', 45000);
    await ui.escrever('[aria-label="Buscar louvor por nome ou número"]', 'senhor');
    await ui.esperar('.louvor-card', 30000);
  },

  beats: [
    {
      id: 'abertura',
      fala: 'Uma lista guarda os louvores do culto na ordem em que você vai tocar, para não ficar procurando no meio da reunião.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(500);
      }
    },
    {
      id: 'adicionar',
      fala: 'Procure o louvor e toque no botão de mais, ao lado dele. Faça isso para cada louvor do culto.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.tocar('.louvor-card .add-button');
        await ui.pausa(700);
        await ui.escrever('[aria-label="Buscar louvor por nome ou número"]', 'graça');
        await ui.esperar('.louvor-card', 30000);
        await ui.tocar('.louvor-card .add-button');
      }
    },
    {
      id: 'barra-playlist',
      fala: 'Os louvores escolhidos aparecem na barra Playlist, logo acima da busca.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.rolar(-800);
        await ui.pausa(800);
      }
    },
    {
      id: 'reordenar',
      fala: 'Para mudar a ordem, arraste o louvor com o dedo até o lugar certo.',
      zoom: null,
      acao: async (p, ui) => {
        if (await ui.existe('[title="Arraste para reordenar"]')) {
          await ui.arrastar('[title="Arraste para reordenar"]', 150, 0);
        }
      }
    },
    {
      id: 'remover-item',
      fala: 'Para tirar um louvor da lista, toque no xis dele.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(900);
      }
    },
    {
      id: 'salvar',
      fala: 'Toque em Salvar para guardar a lista com um nome. Sem isso ela se perde quando você fechar a aplicação.',
      zoom: null,
      acao: async (p, ui) => {
        if (await ui.existe('[title*="salvar" i], [title*="Salvando" i]')) {
          await ui.tocar('[title*="salvar" i], [title*="Salvando" i]');
          await ui.pausa(1200);
        }
      }
    },
    {
      id: 'compartilhar',
      fala: 'Compartilhar copia um link da lista. Quem abrir esse link recebe a mesma lista, na mesma ordem.',
      zoom: null,
      acao: async (p, ui) => {
        if (await ui.existe('[title="Compartilhar playlist"]')) {
          await ui.tocar('[title="Compartilhar playlist"]');
          await ui.pausa(1200);
        }
      }
    },
    {
      id: 'folheto-e-abas',
      fala: 'Folheto junta tudo num arquivo só, para imprimir. Em Abas abre cada louvor numa aba do navegador.',
      zoom: null,
      acao: async (p, ui) => {
        // De propósito sem tocar: "Em Abas" rouba o foco da aba gravada e
        // mataria o screencast. O botão aparece, a narração explica.
        await ui.pausa(1400);
      }
    },
    {
      id: 'ir-listas',
      fala: 'As listas salvas ficam em Listas, no canto do cabeçalho.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.tocar('.listas-button');
        await ui.esperar('.page-title', 30000);
        await ui.pausa(700);
      }
    },
    {
      id: 'buscar-favoritar',
      fala: 'Aqui você procura pelo nome e marca as listas que mais usa com a estrela.',
      zoom: null,
      acao: async (p, ui) => {
        if (await ui.existe('.playlist-card .favorite-button')) {
          await ui.tocar('.playlist-card .favorite-button');
          await ui.pausa(800);
        }
      }
    },
    {
      id: 'renomear',
      fala: 'Toque no lápis para trocar o nome da lista.',
      zoom: null,
      acao: async (p, ui) => {
        if (await ui.existe('.playlist-card .edit-icon-button')) {
          await ui.tocar('.playlist-card .edit-icon-button');
          await ui.pausa(1100);
        }
      }
    },
    {
      id: 'reproduzir',
      fala: 'Reproduzir carrega a lista e abre o primeiro louvor no leitor. De lá você passa de um para o outro sem voltar à busca.',
      zoom: null,
      acao: async (p, ui) => {
        if (await ui.existe('.playlist-actions button')) {
          await ui.tocar('.playlist-actions button');
          await ui.pausa(1600);
        }
      }
    },
    {
      id: 'fecho',
      fala: 'Monte a lista antes do culto, salve com um nome, e no dia é só reproduzir.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(900);
      }
    }
  ]
};
