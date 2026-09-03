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
/**
 * NOTA sobre o ritmo deste video.
 *
 * A tela /offline cabe exatamente no ecra do tablet em retrato (1180 px de
 * pagina para 1180 px de janela): nao ha nada para rolar, nao ha botao de
 * atualizar, e os alvos sao cartoes de largura inteira, para os quais o fator
 * de zoom honesto e 1. A primeira versao saiu com 19 quadros em 55 segundos -
 * uma imagem parada onde so a legenda mudava.
 *
 * Este e um video de AVISO e nao um passo-a-passo, entao ser sobrio e legitimo.
 * Mas comecar na tela inicial e navegar ate Offline da o unico movimento real
 * disponivel, e de brinde ensina onde essa tela fica - que e informacao que
 * faltava.
 */
export default {
  id: '05-problemas',
  titulo: 'Problemas conhecidos',
  url: 'https://plpcg.com/',

  async preparar(page, ui) {
    await ui.esperar('.header-button', 45000);
  },

  beats: [
    {
      id: 'abertura',
      fala: 'Duas coisas que a aplicação ainda não faz, e que é melhor você saber antes de precisar.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(700);
      }
    },
    {
      id: 'ir-offline',
      fala: 'As duas aparecem na tela Offline, que fica no canto direito do topo.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.tocar('.offline-button');
        await ui.esperar('.availability-summary', 45000);
        await ui.pausa(900);
      }
    },
    {
      id: 'remocao-individual',
      fala: 'A primeira: não dá para apagar um louvor baixado de cada vez. A própria tela avisa isso.',
      zoom: { seletor: '.info-box', margem: 14 },
      acao: async (p, ui) => {
        await ui.esperar('.info-box');
        await ui.trazerParaOMeio('.info-box');
      }
    },
    {
      id: 'remocao-como',
      fala: 'Para apagar o que já foi baixado, hoje só limpando os dados do navegador inteiro. Isso remove tudo de uma vez, não dá para escolher.',
      zoom: { seletor: '.info-box', margem: 14 },
      acao: async (p, ui) => {
        // Sem isto, este beat e o anterior sao 17 segundos de imagem parada.
        await ui.rolar(140);
        await ui.pausa(700);
        await ui.rolar(-140);
      }
    },
    {
      id: 'espaco',
      fala: 'A segunda: o acervo completo pesa quase novecentos megabytes. Confira se o seu aparelho tem esse espaço livre antes de baixar tudo.',
      // O painel de estatísticas mostra zeros num aparelho que ainda não
      // baixou nada, e narrar "o acervo pesa 846 MB" sobre uma fila de zeros
      // não casa. O alvo certo é o botão que dispara esse download.
      zoom: { seletor: '.action-buttons', margem: 14 },
      acao: async (p, ui) => {
        await ui.esperar('.action-buttons');
        await ui.pausa(800);
      }
    },
    {
      id: 'espaco-ios',
      fala: 'Em iPhone e iPad o navegador limita o espaço, e o download pode parar antes do fim. Se acontecer, toque de novo em Baixar PDFs faltantes.',
      zoom: { seletor: '.action-buttons', margem: 14 },
      acao: async (p, ui) => {
        await ui.trazerParaOMeio('.action-buttons');
        await ui.pausa(500);
      }
    },
    {
      id: 'fecho',
      fala: 'Fora isso, o modo offline funciona. Estamos trabalhando para melhorar esses dois pontos.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(900);
      }
    }
  ]
};
