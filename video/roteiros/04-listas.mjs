/**
 * Video 4 - Uso das Listas.
 *
 * A ORDEM DOS BEATS NAO E LIVRE. "Salvar" chama `goto('/listas?editId=...')`
 * (ver `CarouselChips.svelte:520`): guardar SAI da tela inicial na hora. Na
 * primeira versao o Salvar vinha a meio, e os beats seguintes continuavam a
 * narrar "Em Abas", "Folheto" e "Compartilhar" — botoes que ja tinham saido do
 * ecra. A voz falava de uma tela que ninguem estava a ver.
 *
 * Agora Salvar e o ULTIMO beat da tela inicial e serve de transicao, o que
 * tambem e mais verdadeiro: e isso que a app faz. E como o `editId` chega com o
 * campo de nome ja em edicao, dar nome a lista vem logo a seguir, sem procurar
 * botao nenhum.
 *
 * Duas armadilhas conhecidas, tratadas nos beats:
 *  - "Em Abas" abre varias abas e rouba o foco, o que mataria o screencast da
 *    aba gravada. O beat mostra o botao e narra o que ele faz, sem o tocar.
 *  - "Compartilhar" escreve na area de transferencia; a permissao ja e
 *    concedida em `gravar.mjs`.
 */
/** Os títulos dos chips, na ordem em que estão. */
async function ordemDosChips(p) {
  return p.locator('.carousel-chip .chip-title').allInnerTexts();
}

/**
 * Arrasta o primeiro chip até à posicao do chip `destino`.
 *
 * Distancia MEDIDA e nao fixa. A primeira versao arrastava 170 px para a
 * direita e o gesto nao reordenava nada: `chipPointerReorder.js` abandona o
 * arrasto quando o ponteiro sai da lista por mais de `DRAG_CANCEL_MARGIN_PX`
 * (48 px), e com tres chips numa lista curta 170 px passavam disso. O video
 * mostrava um gesto que nao fazia nada.
 *
 * O eixo tambem nao e livre: a lista e horizontal encolhida e VERTICAL
 * expandida (`isExpanded ? 'y' : 'x'` em CarouselChips.svelte), entao arrastar
 * no eixo errado tambem nao reordena.
 */
async function arrastarChip(p, ui, destino, eixo) {
  const pegas = p.locator('[title="Arraste para reordenar"]');
  if ((await pegas.count()) <= destino) return false;

  const de = await pegas.nth(0).boundingBox();
  const para = await pegas.nth(destino).boundingBox();
  if (!de || !para) return false;

  const dx = eixo === 'x' ? para.x - de.x : 0;
  const dy = eixo === 'y' ? para.y - de.y : 0;
  await ui.arrastar('[title="Arraste para reordenar"]', dx, dy, 28);
  return true;
}

/** Guarda a ordem antes do arrasto, para o beat poder verificar que mudou. */
let ordemAntes = [];

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
        await ui.pausa(500);
        await ui.escrever('[aria-label="Buscar louvor por nome ou número"]', 'aleluia');
        await ui.esperar('.louvor-card', 30000);
        await ui.tocar('.louvor-card .add-button');
      }
    },
    {
      id: 'barra-playlist',
      fala: 'Os louvores escolhidos aparecem na barra Playlist, logo acima da busca.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.rolar(-900);
        await ui.pausa(900);
      }
    },
    {
      id: 'reordenar',
      fala: 'Para mudar a ordem, arraste o louvor pela alça até o lugar certo.',
      zoom: null,
      acao: async (p, ui) => {
        ordemAntes = await ordemDosChips(p);
        await arrastarChip(p, ui, 1, 'x');
        await ui.pausa(700);
      },
      verificar: async (p) => {
        const depois = await ordemDosChips(p);
        return (
          JSON.stringify(depois) !== JSON.stringify(ordemAntes) ||
          `a ordem nao mudou: ${ordemAntes.join(' | ')}`
        );
      }
    },
    {
      id: 'expandir',
      fala: 'Se a lista ficar comprida, toque em Expandir para ver todos os louvores um debaixo do outro.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.tocarPrimeiro(['[title="Expandir lista"]']);
        await ui.pausa(1200);
      },
      verificar: async (p) =>
        (await p.locator('.carousel-chips-list.expanded').count()) > 0 ||
        'a lista nao expandiu',
    },
    {
      id: 'reordenar-expandido',
      fala: 'Expandida, a lista também reordena: arraste a alça para cima ou para baixo.',
      zoom: null,
      acao: async (p, ui) => {
        ordemAntes = await ordemDosChips(p);
        await arrastarChip(p, ui, 1, 'y');
        await ui.pausa(700);
      },
      verificar: async (p) => {
        const depois = await ordemDosChips(p);
        return (
          JSON.stringify(depois) !== JSON.stringify(ordemAntes) ||
          `a ordem nao mudou no modo expandido: ${ordemAntes.join(' | ')}`
        );
      }
    },
    {
      id: 'remover-item',
      fala: 'Para tirar um louvor da lista, toque no xis dele.',
      zoom: null,
      acao: async (p, ui) => {
        // Encolhe de volta antes de seguir: os beats seguintes falam de botões
        // da barra, e é assim que a maioria vai ver a tela.
        if (await ui.existe('[title="Encolher lista"]')) {
          await ui.tocar('[title="Encolher lista"]');
          await ui.pausa(700);
        }
        if (await ui.existe('[title="Remover"]')) {
          await ui.tocar('[title="Remover"]');
          await ui.pausa(900);
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
          await ui.pausa(1400);
        }
      }
    },
    {
      id: 'folheto-e-abas',
      fala: 'Folheto junta os louvores num arquivo só, para imprimir. Em Abas abre cada um numa aba do navegador.',
      zoom: null,
      acao: async (p, ui) => {
        // De propósito sem tocar: "Em Abas" rouba o foco da aba gravada e
        // mataria o screencast. O botão aparece, a narração explica.
        await ui.pausa(1400);
      }
    },
    {
      id: 'salvar',
      fala: 'Toque em Salvar para guardar a lista. A aplicação leva você direto para a tela Listas, com o nome pronto para ser escrito.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.tocarPrimeiro(['[title="Toque para salvar"]', '[title*="salvar" i]']);
        await ui.esperar('.page-title', 30000);
        await ui.pausa(900);
      }
    },
    {
      id: 'nomear',
      fala: 'Dê um nome que você reconheça depois, como a data do culto, e confirme.',
      zoom: null,
      acao: async (p, ui) => {
        if (await ui.existe('.playlist-name-input')) {
          await ui.escrever('.playlist-name-input', 'Culto de domingo');
          await ui.pausa(600);
          if (await ui.existe('[title="Salvar"]')) await ui.tocar('[title="Salvar"]');
        }
        await ui.pausa(700);
      }
    },
    {
      id: 'favoritar',
      fala: 'A estrela marca as listas que você mais usa, e o filtro no topo mostra só as favoritas.',
      zoom: null,
      acao: async (p, ui) => {
        if (await ui.existe('.playlist-card .favorite-button')) {
          await ui.tocar('.playlist-card .favorite-button');
          await ui.pausa(900);
        }
      }
    },
    {
      id: 'reproduzir',
      // NAO toca no botao, de proposito.
      //
      // `handlePlay` (listas/+page.svelte:151) carrega a lista e faz
      // `goto('/')`: leva para a tela INICIAL, nao para o leitor. Quem abre o
      // leitor e `handlePlayOpenLeitor`, que vive no botao "Abrir no leitor"
      // dentro de "Ver". A primeira versao deste beat narrava que Reproduzir
      // abria o leitor - informacao falsa, apanhada pelo aviso de navegacao.
      // Tocar aqui tambem sairia de /listas e estragaria os beats seguintes.
      fala: 'O botão Reproduzir carrega a lista e leva você de volta à tela inicial, com os louvores já na barra Playlist.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(1300);
      }
    },
    {
      id: 'ver',
      fala: 'Para conferir o que está guardado, toque em Ver.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.tocarPrimeiro(['[title="Ver louvores da playlist"]']);
        await ui.esperar('.view-playlist-actions', 30000);
        await ui.pausa(900);
      }
    },
    {
      id: 'abrir-no-leitor',
      fala: 'E Abrir no leitor começa o culto: carrega a lista e abre o primeiro louvor.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.tocarPrimeiro(['.leitor-button', '[title*="abrir o primeiro louvor" i]']);
        await ui.esperar('.toolbar', 45000);
        await ui.pausa(2200);
      }
    },
    {
      id: 'navegador',
      fala: 'Dentro do leitor aparece o botão Lista. Com ele você passa de um louvor ao outro sem voltar à busca.',
      zoom: null,
      acao: async (p, ui) => {
        if (await ui.existe('.carousel-label')) {
          await ui.tocar('.carousel-label');
          await ui.pausa(1600);
        }
      }
    },
    {
      id: 'fecho',
      fala: 'Monte a lista antes do culto, salve com um nome, e no dia é só abrir no leitor.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(900);
      }
    }
  ]
};
