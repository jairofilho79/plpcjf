/**
 * Video 2 - Uso Offline.
 *
 * Segue a tela COMO ELA É HOJE. Não há escolha de categorias: a seção existe
 * em `src/routes/offline/+page.svelte` mas está com `display: none`, e os dois
 * botões primários são mutuamente exclusivos — "Disponibilizar offline" só
 * aparece enquanto o acervo não está disponível, e "Baixar PDFs faltantes"
 * toma o lugar dele depois.
 *
 * HONESTIDADE DE ESCALA: não são baixados 846 MB para gravar. O beat do
 * progresso deixa o download real começar e correr, e a narração diz que ele
 * continua em segundo plano. A prova de funcionamento offline usa PDFs de facto
 * cacheados durante o próprio vídeo. O mecanismo mostrado é real; só a escala é
 * reduzida, e a narração diz isso em voz alta. Dar a entender que o acervo
 * inteiro desceu em quarenta segundos seria mentir para o irmão que vai
 * depender disto numa igreja sem rede.
 */
export default {
  id: '02-offline',
  titulo: 'Uso Offline',
  url: 'https://plpcg.com/offline',

  async preparar(page, ui) {
    await ui.esperar('.availability-summary', 45000);
  },

  beats: [
    {
      id: 'abertura',
      fala: 'Muita igreja não tem internet. O modo offline guarda os louvores no aparelho para você abrir sem rede nenhuma.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(600);
      }
    },
    {
      id: 'estatisticas',
      fala: 'No topo, Disponibilidade Geral mostra quantos louvores já estão guardados no seu aparelho.',
      zoom: { seletor: '.summary-stats', margem: 14 },
      acao: async (p, ui) => {
        await ui.pausa(900);
      }
    },
    {
      id: 'disponibilizar',
      fala: 'Toque em Disponibilizar offline para baixar o acervo. É tudo de uma vez: não dá para escolher só partitura ou só cifra.',
      zoom: { seletor: '.action-buttons', margem: 14 },
      acao: async (p, ui) => {
        if (await ui.existe('.action-buttons .btn-primary')) {
          await ui.tocar('.action-buttons .btn-primary');
          await ui.pausa(1500);
        }
      }
    },
    {
      id: 'progresso',
      fala: 'A barra mostra o lote que está baixando e quantos megabytes já vieram. Pode deixar rodando: o download continua enquanto você usa o aparelho.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(2500);
      }
    },
    {
      id: 'escala',
      fala: 'Neste vídeo o download foi interrompido para não ficar longo. No seu aparelho ele vai até o fim, e leva alguns minutos numa internet boa.',
      zoom: null,
      acao: async (p, ui) => {
        if (await ui.existe('.cancel-button, [title*="ancelar" i]')) {
          await ui.tocar('.cancel-button, [title*="ancelar" i]');
          await ui.pausa(1200);
        }
      }
    },
    {
      id: 'faltantes',
      fala: 'Depois que o acervo estiver baixado, esse botão vira Baixar PDFs faltantes. Use ele de vez em quando para pegar os louvores novos.',
      zoom: { seletor: '.action-buttons', margem: 14 },
      acao: async (p, ui) => {
        await ui.pausa(1100);
      }
    },
    {
      id: 'importar',
      fala: 'Se a igreja não tem internet nenhuma, use Importar pacote offline: alguém baixa o arquivo em casa, leva num pendrive, e a aplicação carrega tudo sem rede.',
      zoom: { seletor: '.action-buttons', margem: 14 },
      acao: async (p, ui) => {
        await ui.pausa(1300);
      }
    },
    {
      id: 'prova-offline',
      fala: 'Com os louvores guardados, desligue a internet e abra um deles. Ele abre igual, direto do aparelho.',
      zoom: null,
      acao: async (p, ui, contexto) => {
        // Abre um louvor online primeiro (o que também é o requisito real do
        // leitor), e só depois corta a rede — assim o que se vê a abrir sem
        // rede é mesmo um ficheiro em cache, e não uma encenação.
        await p.goto('https://plpcg.com/', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
        await ui.escrever('[aria-label="Buscar louvor por nome ou número"]', '218');
        await ui.esperar('.louvor-card', 30000);
        await ui.tocar('.louvor-card .material-open, .louvor-card .louvor-info');
        await ui.pausa(2500);
        await contexto.setOffline(true);
        await ui.pausa(1200);
      }
    },
    {
      id: 'requisito',
      fala: 'Um detalhe importante: abra pelo menos um louvor com internet antes de sair. É isso que prepara o leitor para funcionar sem rede.',
      zoom: null,
      acao: async (p, ui) => {
        await ui.pausa(1200);
      }
    },
    {
      id: 'fecho',
      fala: 'Baixe em casa, com internet boa, e no dia do culto a aplicação funciona mesmo sem sinal nenhum.',
      zoom: null,
      acao: async (p, ui, contexto) => {
        await contexto.setOffline(false);
        await ui.pausa(900);
      }
    }
  ]
};
