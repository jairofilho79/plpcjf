# Análise de Viabilidade: Carousel de PDFs na Página de Leitor

## Resumo Executivo

Esta análise avalia a viabilidade técnica de adicionar um controle de carousel de PDFs na página de leitor, permitindo navegação entre PDFs do carousel diretamente na interface do leitor, com sincronização em tempo real entre abas.

**Status:** ✅ **VIÁVEL** - A implementação é tecnicamente viável com baixo risco.

---

## 1. Requisitos da Feature

### 1.1 Funcionalidades Solicitadas

1. **Ícone de PDFs na barra superior**
   - Posicionado à direita do título/subtítulo
   - Clique: carrega próximo PDF do carousel
   - Long press: volta ao PDF anterior
   - Uso do componente `GestureButton` existente

2. **Responsividade**
   - Mobile (telas pequenas): apenas ícone
   - Tablet+ (telas maiores): ícone + texto "Lista"

3. **Sincronização em tempo real**
   - Carousel deve estar 100% sincronizado entre página inicial e página de leitor
   - Sincronização entre abas do navegador

---

## 2. Análise da Infraestrutura Existente

### 2.1 Store de Carousel (`src/lib/stores/carousel.js`)

**Status:** ✅ **Pronto para uso**

- Store Svelte gerenciando array de louvores no carousel
- Persistência via `localStorage` (chave: `carouselLouvores`)
- Métodos disponíveis:
  - `addLouvor(louvor)` - Adiciona PDF ao carousel
  - `removeLouvor(pdfId)` - Remove PDF do carousel
  - `clearCarousel()` - Limpa o carousel
  - `reorderCarousel(fromIndex, toIndex)` - Reordena itens
  - `setCarousel(louvoresList)` - Define carousel completo
  - `loadPlaylist(pdfIds, allLouvores)` - Carrega playlist

**Observação:** O store não rastreia explicitamente o índice do PDF atual sendo visualizado. Isso precisará ser implementado.

### 2.2 Componente GestureButton (`src/lib/components/GestureButton.svelte`)

**Status:** ✅ **Pronto para uso**

- Suporta eventos `click` e `longpress`
- Configurável: `longPressDuration`, `hapticFeedback`, `visualFeedback`
- Funciona em dispositivos touch e mouse
- Já está sendo usado na página de leitor para outros controles

**Capacidade:** Pode ser usado diretamente para a nova feature.

### 2.3 Mecanismo de Sincronização entre Abas

**Status:** ✅ **Infraestrutura existente**

- **BroadcastChannel** implementado em `src/lib/utils/cacheSync.js`
- Canal: `pdf-cache-sync`
- Atualmente usado para sincronização de cache de PDFs
- Pode ser estendido para sincronizar estado do carousel

**Observação:** O BroadcastChannel atual é focado em cache. Será necessário criar um novo canal ou estender o existente para sincronizar mudanças no carousel.

### 2.4 Página de Leitor (`src/routes/leitor/+page.svelte`)

**Status:** ✅ **Estrutura adequada**

- Toolbar existente com título/subtítulo
- Grid layout responsivo já implementado
- Suporta query params: `file`, `titulo`, `subtitulo`, `validated`
- Já usa `GestureButton` para outros controles

**Estrutura da Toolbar:**
- Grid responsivo com breakpoints para mobile/tablet
- Área de título/subtítulo já existe (`.title-wrap`)
- Espaço disponível à direita do título para novo controle

---

## 3. Desafios Técnicos e Soluções

### 3.1 Rastreamento do PDF Atual no Carousel

**Desafio:** Identificar qual PDF do carousel está sendo visualizado atualmente.

**Solução:**
1. Extrair `pdfId` do arquivo atual sendo visualizado
2. Buscar índice no array do carousel usando `pdfId`
3. Criar store derivado ou função helper para obter índice atual

**Implementação sugerida:**
```javascript
// Em leitor/+page.svelte
$: currentPdfId = extractPdfIdFromFile(file);
$: currentIndex = $carousel.findIndex(l => l.pdfId === currentPdfId);
$: nextPdf = currentIndex >= 0 && $carousel.length > 0 
  ? $carousel[(currentIndex + 1) % $carousel.length] 
  : null;
$: prevPdf = currentIndex >= 0 && $carousel.length > 0 
  ? $carousel[(currentIndex - 1 + $carousel.length) % $carousel.length] 
  : null;
```

### 3.2 Navegação para Próximo/Anterior

**Desafio:** Navegar para próximo/anterior PDF do carousel.

**Solução:**
1. Calcular próximo índice: `(currentIndex + 1) % carousel.length`
2. Calcular índice anterior: `(currentIndex - 1 + carousel.length) % carousel.length`
3. Construir URL com `goto()` ou `window.location.href`
4. Usar mesma estrutura de URL que já existe: `/leitor?file=...&titulo=...&subtitulo=...`

**Edge cases:**
- Se PDF atual não estiver no carousel: desabilitar botão
- Se carousel estiver vazio: mostrar desabilitado
- Se for último item: próximo volta ao primeiro (circular)

### 3.3 Sincronização em Tempo Real

**Desafio:** Sincronizar mudanças no carousel entre abas.

**Solução:**
1. **Opção A (Recomendada):** Usar `storage` event do `localStorage`
   - O store já persiste no `localStorage`
   - `storage` event dispara automaticamente quando outra aba modifica
   - Mais simples e já funciona com a infraestrutura existente

2. **Opção B:** Estender BroadcastChannel
   - Criar novo canal `carousel-sync`
   - Enviar mensagens quando carousel mudar
   - Mais controle, mas requer mais código

**Recomendação:** Usar `storage` event, pois:
- O carousel já persiste no `localStorage`
- Evento dispara automaticamente
- Menos código necessário
- Funciona entre abas do mesmo domínio

**Implementação sugerida:**
```javascript
// No store carousel.js ou em leitor/+page.svelte
if (browser) {
  window.addEventListener('storage', (e) => {
    if (e.key === 'carouselLouvores') {
      // Recarregar carousel do localStorage
      carousel.setCarousel(JSON.parse(e.newValue || '[]'));
    }
  });
}
```

### 3.4 UI Responsiva: Ícone + Texto "Lista"

**Desafio:** Mostrar apenas ícone em mobile, ícone + texto "Lista" em tablet+.

**Solução:**
1. Usar media queries CSS existentes (já há breakpoint em 768px)
2. Criar componente que mostra:
   - Mobile: apenas ícone de PDF
   - Tablet+: ícone + texto "Lista"
3. Usar `GestureButton` como wrapper, com slot para conteúdo responsivo

**Estrutura sugerida:**
```svelte
<GestureButton on:click={nextPdf} on:longpress={prevPdf} disabled={isDisabled}>
  <div class="carousel-control">
    <svg><!-- ícone PDF --></svg>
    {#if isTabletOrLarger}
      <span class="carousel-label">Lista</span>
    {/if}
  </div>
</GestureButton>
```

### 3.5 Integração com Toolbar Existente

**Desafio:** Adicionar controle sem quebrar layout existente.

**Solução:**
- Toolbar já usa grid layout responsivo
- Adicionar nova coluna no grid após `.title-wrap`
- Em mobile: coluna menor (apenas ícone)
- Em tablet+: coluna maior (ícone + lista)

**Modificações no CSS:**
```css
/* Mobile: grid-template-columns: 1fr repeat(6, max-content); */
/* Tablet+: grid-template-columns: auto 1fr [nova-coluna] repeat(6, max-content); */
/* Nova coluna: ícone (mobile) ou ícone + "Lista" (tablet+) */
```

---

## 4. Componentes a Criar/Modificar

### 4.1 Novo Componente: `CarouselNavigator.svelte`

**Responsabilidades:**
- Exibir ícone de PDF
- Exibir texto "Lista" em tablet+
- Gerenciar navegação próximo/anterior
- Gerenciar estado desabilitado (carousel vazio ou PDF não está no carousel)

**Props:**
- `currentPdfId` - ID do PDF atual
- `carousel` - Store do carousel (reactive)

**Eventos:**
- `navigate` - Dispara ao navegar para outro PDF

### 4.2 Modificações em `leitor/+page.svelte`

**Mudanças necessárias:**
1. Importar store `carousel`
2. Importar novo componente `CarouselNavigator`
3. Adicionar componente na toolbar (após `.title-wrap`)
4. Calcular `currentIndex` baseado no `file` atual
5. Implementar funções `nextPdf()` e `prevPdf()`
6. Adicionar listener para `storage` event para sincronização

### 4.3 Modificações em `carousel.js` (Opcional)

**Melhorias sugeridas:**
1. Adicionar método `getCurrentIndex(pdfId)` - helper para encontrar índice
2. Adicionar método `getNext(pdfId)` - retorna próximo PDF
3. Adicionar método `getPrevious(pdfId)` - retorna PDF anterior
4. Adicionar listener para `storage` event para sincronização automática

---

## 5. Fluxo de Funcionamento

### 5.1 Navegação Próximo PDF

1. Usuário clica no ícone de PDF
2. `GestureButton` dispara evento `click`
3. Função `nextPdf()` é chamada
4. Usa `nextPdf` já calculado (reativo) - apenas carrega informações do próximo PDF
5. Constrói URL: `/leitor?file=...&titulo=...&subtitulo=...`
6. Navega usando `goto()` ou atualiza `window.location`
7. Página recarrega com novo PDF

### 5.2 Navegação PDF Anterior

1. Usuário faz long press no ícone
2. `GestureButton` dispara evento `longpress`
3. Função `prevPdf()` é chamada
4. Usa `prevPdf` já calculado (reativo) - apenas carrega informações do PDF anterior
5. Segue mesmo fluxo de navegação

### 5.3 Sincronização entre Abas

1. Usuário modifica carousel na página inicial
2. Store `carousel` atualiza `localStorage`
3. Evento `storage` dispara em todas as abas
4. Página de leitor detecta mudança
5. Recarrega carousel do `localStorage`
6. Atualiza UI (estado do botão, verifica se PDF atual ainda está no carousel)

---

## 6. Riscos e Mitigações

### 6.1 Risco: PDF Atual Não Está no Carousel

**Probabilidade:** Média  
**Impacto:** Baixo

**Mitigação:**
- Verificar se `currentIndex >= 0` antes de habilitar navegação
- Se não estiver no carousel, desabilitar botão
- Mostrar indicador visual quando PDF não está no carousel (estado desabilitado)

### 6.2 Risco: Carousel Vazio

**Probabilidade:** Baixa  
**Impacto:** Baixo

**Mitigação:**
- Sempre mostrar botão, mas desabilitado quando carousel estiver vazio
- Mostrar tooltip explicativo quando desabilitado
- Estado visual claro de desabilitado (opacidade reduzida, cursor not-allowed)

### 6.3 Risco: Sincronização Não Funciona

**Probabilidade:** Baixa  
**Impacto:** Médio

**Mitigação:**
- `storage` event funciona nativamente entre abas
- Testar em diferentes navegadores
- Fallback: polling periódico do `localStorage` (menos eficiente, mas funciona)

### 6.4 Risco: Performance com Carousel Grande

**Probabilidade:** Baixa  
**Impacto:** Baixo

**Mitigação:**
- Apenas carregar informações do próximo PDF e do PDF anterior (se houver)
- Não processar todo o carousel, apenas os itens necessários para navegação
- Usar cálculos simples de índice sem iterar sobre todo o array

---

## 7. Estimativa de Esforço

### 7.1 Componentes Novos

- `CarouselNavigator.svelte`: **2-3 horas**
  - Estrutura básica
  - Lógica de navegação
  - UI responsiva

### 7.2 Modificações

- `leitor/+page.svelte`: **2-3 horas**
  - Integração do componente
  - Funções de navegação
  - Sincronização

- `carousel.js` (opcional): **1 hora**
  - Helpers de navegação
  - Listener de sincronização

### 7.3 Testes

- Testes manuais: **2 horas**
- Ajustes e refinamentos: **1-2 horas**

**Total estimado:** **8-11 horas**

---

## 8. Dependências e Pré-requisitos

### 8.1 Dependências Existentes

✅ Todas as dependências necessárias já existem:
- Svelte stores
- GestureButton component
- localStorage API
- BroadcastChannel API (opcional, para solução alternativa)

### 8.2 Pré-requisitos

- Store `carousel` funcionando corretamente
- Página de leitor carregando PDFs corretamente
- Query params `file`, `titulo`, `subtitulo` funcionando

---

## 9. Recomendações de Implementação

### 9.1 Fase 1: Funcionalidade Básica

1. Criar componente `CarouselNavigator` básico (apenas ícone)
2. Integrar na toolbar do leitor
3. Implementar navegação próximo/anterior
4. Testar em mobile e desktop

### 9.2 Fase 2: UI Responsiva

1. Adicionar texto "Lista" ao lado do ícone em tablet+
2. Ajustar CSS para diferentes breakpoints
3. Garantir que layout não quebre com texto adicional
4. Testar responsividade em diferentes tamanhos de tela

### 9.3 Fase 3: Sincronização

1. Implementar listener de `storage` event
2. Testar sincronização entre abas
3. Adicionar indicadores visuais de sincronização
4. Tratar edge cases (carousel vazio, PDF não encontrado)

### 9.4 Fase 4: Melhorias (Opcional)

1. Adicionar animações de transição
2. Adicionar atalhos de teclado (setas)
3. Melhorar acessibilidade (ARIA labels)
4. Adicionar tooltips informativos

---

## 10. Conclusão

### 10.1 Viabilidade

✅ **A feature é totalmente viável** com a infraestrutura existente.

### 10.2 Pontos Fortes

- Infraestrutura já existe (stores, componentes, sincronização)
- Baixo risco técnico
- Esforço moderado (8-11 horas)
- Melhora significativamente a UX

### 10.3 Pontos de Atenção

- Rastreamento do PDF atual no carousel (solução simples)
- Sincronização entre abas (solução nativa disponível)
- UI responsiva (padrão já usado na aplicação)

### 10.4 Próximos Passos

1. ✅ Aprovação da análise
2. Implementação seguindo fases recomendadas
3. Testes em diferentes dispositivos e navegadores
4. Deploy e monitoramento

---

## 11. Referências Técnicas

### Arquivos Relevantes

- `src/lib/stores/carousel.js` - Store do carousel
- `src/lib/components/GestureButton.svelte` - Componente de gestos
- `src/routes/leitor/+page.svelte` - Página de leitor
- `src/lib/utils/cacheSync.js` - Sincronização entre abas
- `src/lib/components/CarouselChips.svelte` - Componente de carousel na página inicial

### APIs Utilizadas

- Svelte Stores API
- localStorage API
- Storage Event API
- BroadcastChannel API (opcional)

---

**Data da Análise:** 2024  
**Versão:** 1.0  
**Status:** ✅ Aprovado para implementação

