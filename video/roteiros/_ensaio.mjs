// Roteiro de ensaio: prova o encanamento inteiro (narracao, toque visivel,
// captura de quadros, zoom) antes de existir roteiro de verdade. Nao e um dos
// cinco videos e nao vai para lado nenhum.
export default {
  id: '_ensaio',
  titulo: 'Ensaio',
  url: 'https://plpcg.com/',
  beats: [
    {
      id: 'um',
      fala: 'Na tela inicial, toque em Filtros para escolher entre partitura, cifra e gestos em gravura.',
      zoom: { seletor: '.filter-collapse-outer', margem: 16 },
      acao: async (p, ui) => {
        await ui.esperar('.filter-collapse-trigger');
        await ui.tocar('.filter-collapse-trigger');
      }
    },
    {
      id: 'dois',
      fala: 'Depois, busque o louvor pelo número ou pelo nome.',
      zoom: { seletor: '[aria-label="Buscar louvor por nome ou número"]', margem: 20 },
      acao: async (p, ui) => {
        await ui.escrever('[aria-label="Buscar louvor por nome ou número"]', '218');
      }
    }
  ]
};
