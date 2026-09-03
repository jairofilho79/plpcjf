/**
 * Video 5 - Problemas conhecidos.
 *
 * Só os dois avisos que o Jairo escolheu. Nenhum a mais: isto é um aviso, não
 * um inventário de defeitos, e listar tudo o que a app ainda não faz assusta
 * quem só queria saber se pode confiar nela.
 *
 * Seletores confirmados em src/routes/offline/+page.svelte e
 * src/lib/components/OfflineStatsSummary.svelte.
 */
export default {
  id: '05-problemas',
  titulo: 'Problemas conhecidos',
  url: 'https://plpcg.com/offline',

  async preparar(page, ui) {
    await ui.esperar('.availability-summary', 45000);
  },

  beats: [
    {
      id: 'abertura',
      fala: 'Duas coisas que a aplicação ainda não faz, e que é melhor você saber antes de precisar.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(500);
      }
    },
    {
      id: 'remocao-individual',
      fala: 'A primeira: não dá para apagar um louvor baixado de cada vez. A própria tela avisa isso.',
      zoom: { seletor: '.info-box', margem: 14 },
      acao: async (p, ui) => {
        await ui.esperar('.info-box');
        await ui.pausa(600);
      }
    },
    {
      id: 'remocao-como',
      fala: 'Para apagar o que já foi baixado, hoje só limpando os dados do navegador inteiro. Isso remove tudo de uma vez, não dá para escolher.',
      zoom: { seletor: '.info-box', margem: 14 },
      acao: async (p, ui) => {
        await ui.pausa(600);
      }
    },
    {
      id: 'espaco',
      fala: 'A segunda: o acervo completo pesa quase novecentos megabytes. Confira se o seu aparelho tem esse espaço livre antes de baixar tudo.',
      zoom: { seletor: '.summary-stats', margem: 14 },
      acao: async (p, ui) => {
        await ui.esperar('.availability-summary');
        await ui.pausa(600);
      }
    },
    {
      id: 'espaco-ios',
      fala: 'Em iPhone e iPad o navegador limita o espaço, e o download pode parar antes do fim. Se acontecer, toque de novo em Baixar PDFs faltantes.',
      zoom: { seletor: '.action-buttons', margem: 14 },
      acao: async (p, ui) => {
        await ui.pausa(700);
      }
    },
    {
      id: 'fecho',
      fala: 'Fora isso, o modo offline funciona. Estamos trabalhando para melhorar esses dois pontos.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.rolar(-800);
      }
    }
  ]
};
