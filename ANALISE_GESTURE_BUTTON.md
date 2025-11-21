# Análise de Viabilidade: Expansão do GestureButton

## 1. Estado Atual do GestureButton

### 1.1 Funcionalidades Implementadas

O componente `GestureButton.svelte` atualmente suporta:

- **Toque Simples (Click)**: Detecção de toque/clique único
- **Long Press**: Detecção de pressionamento prolongado (configurável via `longPressDuration`, padrão 500ms)
- **Compatibilidade Mouse/Touch**: Suporte híbrido para dispositivos touch e mouse
- **Feedback Háptico**: Vibração quando disponível (`hapticFeedback`)
- **Feedback Visual**: Indicador visual durante long press (`visualFeedback`)
- **Prevenção de Conflitos**: Sistema para evitar duplicação de eventos entre touch e mouse

### 1.2 Arquitetura Atual

**Estrutura:**
- Componente Svelte monolítico (~278 linhas)
- Gerenciamento de estado interno com variáveis reativas
- Handlers separados para `touchstart`, `touchmove`, `touchend`, `touchcancel`, `mousedown`, `mouseup`, `mouseleave`, `click`
- Sistema de timers para long press
- Threshold de movimento fixo (10px) para cancelar long press

**Eventos Disparados:**
- `click`: Toque simples
- `longpress`: Long press detectado
- `longpressstart`: Início do long press
- `longpressend`: Fim do long press
- `gesturecancel`: Cancelamento do gesto

**Props Configuráveis:**
- `longPressDuration`: Duração do long press (ms)
- `hapticFeedback`: Ativar feedback háptico
- `visualFeedback`: Ativar feedback visual
- `disabled`: Desabilitar componente
- `preventClickOnLongPress`: Prevenir click após long press
- `clickDelay`: Delay para emitir click
- `preventDefault`: Prevenir comportamento padrão

### 1.3 Uso no Projeto

O componente é utilizado em:
- **Leitor de PDF** (`/leitor`): Navegação de páginas, zoom, toolbar
- **Biblioteca** (`/biblioteca`): Paginação, filtros de categoria e classificação
- **Filtros**: Seleção de categorias e classificações com long press para "selecionar apenas"

---

## 2. Requisitos Solicitados

### 2.1 Novos Gestos a Implementar

1. **Gestos de 1 Dedo:**
   - Toque simples (já existe)
   - Long press (já existe)
   - Deslizar (swipe) - horizontal e vertical
   - Diferenciar scroll de swipe

2. **Gestos de 2 Dedicados:**
   - Pinch (zoom)
   - Deslizar com 2 dedos (swipe de 2 dedos)

3. **Detecções Avançadas:**
   - Velocidade do gesto (px/ms)
   - Direção do gesto (N, NE, E, SE, S, SW, W, NW)
   - Distinção entre scroll e swipe baseada em:
     - Velocidade
     - Distância percorrida
     - Tempo de duração
     - Direção predominante

4. **Gerenciamento de Hierarquia de Gestos (Divs Aninhadas):**
   - **Problema:** Gestos em múltiplas camadas (pai e filho) sem conflitos
   - **Exemplo do Leitor de PDF:**
     - **Nível Pai (Canvas do PDF):**
       - Pinch to zoom (2 dedos) - Aplicado em toda área do canvas
     - **Nível Filho (Zonas de Navegação):**
       - Toque simples → mudar página
       - Long press → ir para primeira/última página
       - Deslize lateral de 1 dedo → mudar página (NOVO)
       - Deslize lateral de 2 dedos → mudar PDF (NOVO)
   - **Requisitos:**
     - Gestos do nível filho não devem ser capturados pelo pai
     - Gestos específicos do pai (pinch) devem funcionar mesmo dentro de áreas filhas
     - Múltiplos GestureButtons aninhados devem coexistir
     - Propagação seletiva de eventos (stopPropagation quando necessário)
     - Priorização de gestos baseada na hierarquia DOM

### 2.2 Requisitos de Qualidade

- **Manutenibilidade**: Código facilmente compreensível e modificável
- **Boas Práticas**: Padrões de projeto apropriados
- **Clean Code**: Princípios de código limpo
- **Extensibilidade**: Fácil adicionar novos gestos no futuro
- **Performance**: Sem impacto negativo na responsividade

---

## 3. Análise de Viabilidade Técnica

### 3.1 Viabilidade: ✅ ALTA

**Justificativa:**

1. **APIs Nativas Disponíveis:**
   - `TouchEvent` API fornece todos os dados necessários:
     - `touches`: Array de todos os toques ativos
     - `changedTouches`: Toques que mudaram neste evento
     - Posição (clientX, clientY) e timestamp de cada toque
   
2. **Cálculos Simples:**
   - Distância entre pontos: `Math.sqrt((x2-x1)² + (y2-y1)²)`
   - Velocidade: `distância / tempo`
   - Direção: `Math.atan2(dy, dx)` convertido para direções cardinais
   - Pinch: Razão entre distâncias inicial e atual

3. **Svelte Facilita:**
   - Reatividade nativa para estados complexos
   - Event handlers eficientes
   - Composição de componentes
   - Context API para compartilhar estado

4. **Browser Support:**
   - Touch Events API: Suportada universalmente em dispositivos móveis
   - Pointer Events API (alternativa moderna): Boa suporte, mas pode usar como fallback
   - Performance adequada para detecção em tempo real

### 3.2 Gerenciamento de Hierarquia: ✅ VIABILIDADE ALTA

**Justificativa:**

1. **DOM Event Bubbling/Capture:**
   - Eventos de toque seguem o modelo de bubbling do DOM
   - Podemos usar `event.stopPropagation()` para interromper propagação
   - Fase de capture permite interceptação antes dos filhos
   - `event.target` e `event.currentTarget` identificam origem e elemento atual

2. **Hierarquia de Contexto:**
   - Cada `GestureButton` pode ter um contexto único
   - Svelte Context API permite compartilhar estado hierárquico
   - Registro de camadas permite mapear hierarquia
   - Priorização baseada em profundidade DOM

3. **Gestos Específicos por Camada:**
   - Configuração por componente define gestos permitidos
   - Flags de gestos globais vs locais
   - Pinch pode ser "global" (propaga mesmo em filhos)
   - Swipe pode ser "local" (apenas no elemento específico)

4. **Resolução de Conflitos:**
   - Sistema de prioridades configurável
   - Detecção de posição relativa (dentro de qual elemento)
   - Timeout para decidir qual gesto processar
   - Fallback para gesto mais específico

**Desafios Identificados:**
- Decisão em tempo real de qual camada processa o gesto
- Gestos de 2 dedos podem começar em elementos diferentes
- Performance ao verificar hierarquia em cada evento

### 3.3 Tecnologias e APIs Utilizadas

- **Touch Events API** (padrão atual)
- **Pointer Events API** (opcional, para melhor compatibilidade desktop)
- **RequestAnimationFrame** (para cálculos suaves de pinch)
- **Performance.now()** (para timestamps precisos)

---

## 4. Estratégia de Implementação

### 4.1 Refatoração Arquitetural

#### 4.1.1 Padrão Strategy

**Aplicação:** Cada tipo de gesto terá uma estratégia própria de detecção.

**Estrutura:**
```
GestureDetector (classe principal)
  ├── SimpleTapStrategy
  ├── LongPressStrategy
  ├── SwipeStrategy (1 dedo)
  ├── TwoFingerSwipeStrategy
  ├── PinchStrategy
  └── ScrollDetectionStrategy
```

**Benefícios:**
- Separação de responsabilidades
- Fácil adicionar novos gestos
- Testabilidade individual
- Manutenção simplificada

#### 4.1.2 Padrão State Machine

**Aplicação:** Gerencia o estado do reconhecimento de gestos.

**Estados:**
```
IDLE → TOUCH_START → GESTURE_RECOGNITION → GESTURE_COMPLETE → IDLE
                            ↓
                      GESTURE_CANCELLED → IDLE
```

**Benefícios:**
- Comportamento previsível
- Evita conflitos entre gestos
- Transições claras e documentadas

#### 4.1.3 Padrão Observer

**Aplicação:** Sistema de eventos para notificar gestos reconhecidos.

**Estrutura:**
- Event dispatcher customizado ou uso do `createEventDispatcher` do Svelte
- Callbacks configuráveis por tipo de gesto

#### 4.1.4 Factory Pattern

**Aplicação:** Criação de detectores específicos baseado no número de dedos.

**Exemplo:**
```javascript
function createGestureDetector(touchCount) {
  if (touchCount === 1) return new SingleTouchDetector();
  if (touchCount === 2) return new TwoTouchDetector();
  return null;
}
```

#### 4.1.5 Composite Pattern (para Hierarquia)

**Aplicação:** Gerencia múltiplos GestureButtons aninhados como uma árvore composta.

**Estrutura:**
```
GestureLayerManager (Composite)
  ├── GestureLayer (leaf) - Canvas pai (pinch)
  │   └── GestureLayer (leaf) - Zona navegação esquerda
  │   └── GestureLayer (leaf) - Zona navegação direita
  └── GestureLayer (leaf) - Toolbar
```

**Benefícios:**
- Trata elementos individuais e grupos uniformemente
- Facilita navegação pela hierarquia
- Permite operações em toda árvore (reset, cancelamento)

#### 4.1.6 Chain of Responsibility (para Resolução de Camadas)

**Aplicação:** Cadeia de handlers onde cada camada decide se processa ou passa adiante.

**Fluxo:**
```
Touch Event
  └─> Verificar camada mais profunda (filho)
      ├─> Se gesto compatível → PROCESSAR + STOP
      └─> Se não compatível → PASSAR PARA PAI
          └─> Pai verifica seus gestos
              ├─> Se gesto global (pinch) → PROCESSAR
              └─> Se não compatível → IGNORAR
```

**Benefícios:**
- Decisão dinâmica de qual camada processa
- Fácil adicionar novas camadas
- Desacoplamento entre camadas

#### 4.1.7 Event Delegation Pattern

**Aplicação:** Centralizar gerenciamento de eventos na camada raiz, delegando para filhos.

**Exemplo:**
```javascript
class GestureLayerManager {
  handleEvent(event) {
    const targetLayer = this.findLayerByElement(event.target);
    if (targetLayer) {
      return targetLayer.handleEvent(event);
    }
    // Fallback para camada pai
    return this.parent?.handleEvent(event);
  }
}
```

**Benefícios:**
- Performance: menos event listeners
- Centralização de lógica de roteamento
- Fácil rastreamento de gestos em múltiplas camadas

### 4.2 Estrutura de Classes/Module

#### 4.2.1 GestureDetector (Core)

**Responsabilidades:**
- Coordenar detecção de gestos
- Gerenciar estado da máquina de estados
- Orquestrar estratégias de detecção
- Emitir eventos

**Interface:**
```typescript
class GestureDetector {
  constructor(config: GestureConfig)
  handleTouchStart(event: TouchEvent): void
  handleTouchMove(event: TouchEvent): void
  handleTouchEnd(event: TouchEvent): void
  handleTouchCancel(event: TouchEvent): void
  reset(): void
  on(event: string, callback: Function): void
  off(event: string, callback: Function): void
}
```

#### 4.2.2 GestureStrategies

**SwipeDetector:**
```typescript
class SwipeDetector {
  detect(start: Touch, end: Touch, duration: number): SwipeResult | null
  calculateVelocity(distance: number, duration: number): number
  calculateDirection(dx: number, dy: number): Direction
  isSwipe(distance: number, velocity: number, duration: number): boolean
  isScroll(direction: Direction, velocity: number): boolean
}
```

**PinchDetector:**
```typescript
class PinchDetector {
  detect(touch1: Touch, touch2: Touch, initialDistance: number): PinchResult
  calculateDistance(touch1: Touch, touch2: Touch): number
  calculateScale(initialDistance: number, currentDistance: number): number
}
```

**ScrollDetector:**
```typescript
class ScrollDetector {
  isScroll(gesture: GestureData, element: HTMLElement): boolean
  checkScrollability(direction: Direction, element: HTMLElement): boolean
}
```

#### 4.2.3 Gesture Types & Interfaces

```typescript
interface GestureConfig {
  swipeThreshold?: number        // Distância mínima para swipe (px)
  swipeVelocityThreshold?: number // Velocidade mínima para swipe (px/ms)
  swipeTimeThreshold?: number     // Tempo máximo para swipe (ms)
  scrollVelocityThreshold?: number // Velocidade para considerar scroll
  pinchSensitivity?: number       // Sensibilidade do pinch
  longPressDuration?: number      // Duração do long press (ms)
  preventDefault?: boolean        // Prevenir comportamento padrão
}

interface SwipeResult {
  direction: Direction
  velocity: number
  distance: number
  duration: number
  isScroll: boolean
}

interface PinchResult {
  scale: number
  center: { x: number, y: number }
  distance: number
}

enum Direction {
  UP = 'up',
  DOWN = 'down',
  LEFT = 'left',
  RIGHT = 'right',
  UP_LEFT = 'up-left',
  UP_RIGHT = 'up-right',
  DOWN_LEFT = 'down-left',
  DOWN_RIGHT = 'down-right'
}

interface GestureLayerConfig {
  element: HTMLElement
  gestures: GestureType[]
  priority: number
  propagateToParent?: boolean  // Se gestos devem propagar para pai
  allowParentGestures?: boolean // Se gestos do pai devem ser processados
  globalGestures?: GestureType[] // Gestos que funcionam mesmo em filhos
}

interface GestureLayer {
  id: string
  config: GestureLayerConfig
  detector: GestureDetector
  parent: GestureLayer | null
  children: GestureLayer[]
  handleEvent(event: TouchEvent): boolean  // Retorna true se processou
  findLayerByElement(element: HTMLElement): GestureLayer | null
}
```

### 4.3 Organização de Arquivos

**Estrutura Proposta:**
```
src/lib/components/GestureButton/
  ├── GestureButton.svelte          # Componente principal (orquestrador)
  ├── core/
  │   ├── GestureDetector.ts        # Detector principal
  │   ├── GestureState.ts           # Máquina de estados
  │   ├── GestureConfig.ts          # Tipos e interfaces
  │   └── GestureLayerManager.ts    # Gerenciador de hierarquia
  ├── strategies/
  │   ├── BaseStrategy.ts           # Classe base abstrata
  │   ├── TapStrategy.ts            # Detecção de tap
  │   ├── LongPressStrategy.ts      # Detecção de long press
  │   ├── SwipeStrategy.ts          # Detecção de swipe (1 dedo)
  │   ├── TwoFingerSwipeStrategy.ts # Detecção de swipe (2 dedos)
  │   ├── PinchStrategy.ts          # Detecção de pinch
  │   └── ScrollStrategy.ts         # Detecção de scroll
  ├── hierarchy/
  │   ├── GestureLayer.ts           # Representação de camada
  │   ├── LayerRegistry.ts          # Registro de camadas
  │   └── EventRouter.ts            # Roteamento de eventos
  ├── utils/
  │   ├── touchUtils.ts             # Utilitários de toque
  │   ├── mathUtils.ts              # Cálculos matemáticos
  │   ├── directionUtils.ts         # Cálculos de direção
  │   └── domUtils.ts               # Utilitários DOM (hierarquia)
  └── types/
      └── index.ts                  # Definições TypeScript
```

### 4.3.1 Implementação de Hierarquia

#### GestureLayerManager

**Responsabilidades:**
- Manter registro de todas as camadas ativas
- Rotear eventos para a camada apropriada
- Gerenciar prioridades entre camadas
- Detectar conflitos entre camadas

**Interface:**
```typescript
class GestureLayerManager {
  private layers: Map<string, GestureLayer>
  private rootLayer: GestureLayer | null
  
  register(layer: GestureLayer): void
  unregister(layerId: string): void
  handleTouchEvent(event: TouchEvent): boolean
  findLayerByElement(element: HTMLElement): GestureLayer | null
  findLayersByPoint(x: number, y: number): GestureLayer[]
  getLayerHierarchy(layerId: string): GestureLayer[]
}
```

#### Fluxo de Roteamento de Eventos

```javascript
function routeTouchEvent(event) {
  const touch = event.touches[0];
  const point = { x: touch.clientX, y: touch.clientY };
  
  // 1. Encontrar todas as camadas que contêm o ponto (bottom-up)
  const candidateLayers = findLayersByPoint(point.x, point.y);
  
  // 2. Para gestos de 1 dedo: processar da camada mais profunda primeiro
  if (event.touches.length === 1) {
    for (let i = candidateLayers.length - 1; i >= 0; i--) {
      const layer = candidateLayers[i];
      if (layer.config.gestures.includes(getGestureType(event))) {
        const handled = layer.handleEvent(event);
        if (handled && !layer.config.propagateToParent) {
          event.stopPropagation();
          return true;
        }
      }
    }
  }
  
  // 3. Para gestos de 2 dedos: verificar se começaram na mesma camada
  if (event.touches.length === 2) {
    const layer1 = findLayerByPoint(event.touches[0].clientX, event.touches[0].clientY);
    const layer2 = findLayerByPoint(event.touches[1].clientX, event.touches[1].clientY);
    
    // Se começaram na mesma camada, processar nela
    if (layer1 === layer2 && layer1?.config.gestures.includes('pinch')) {
      return layer1.handleEvent(event);
    }
    
    // Se começaram em camadas diferentes, verificar gestos globais no pai
    const commonAncestor = findCommonAncestor(layer1, layer2);
    if (commonAncestor?.config.globalGestures?.includes('pinch')) {
      return commonAncestor.handleEvent(event);
    }
  }
  
  return false;
}
```

#### Exemplo de Configuração para Leitor de PDF

```typescript
// Canvas pai (nível 0)
const canvasLayer = {
  element: canvasElement,
  gestures: ['pinch'],  // Apenas pinch
  priority: 0,
  globalGestures: ['pinch'],  // Pinch funciona mesmo dentro de filhos
  allowParentGestures: false,
  propagateToParent: false
};

// Zona de navegação esquerda (nível 1)
const leftNavLayer = {
  element: leftNavElement,
  gestures: ['tap', 'longpress', 'swipe-left', 'swipe-right', 'two-finger-swipe-left', 'two-finger-swipe-right'],
  priority: 1,
  allowParentGestures: true,  // Permite pinch do pai passar
  propagateToParent: false    // Não propagar para não interferir no pinch
};

// Zona de navegação direita (nível 1)
const rightNavLayer = {
  element: rightNavElement,
  gestures: ['tap', 'longpress', 'swipe-left', 'swipe-right', 'two-finger-swipe-left', 'two-finger-swipe-right'],
  priority: 1,
  allowParentGestures: true,
  propagateToParent: false
};
```

### 4.4 Fluxo de Detecção

#### 4.4.1 Fluxo para Gestos de 1 Dedo

```
1. touchstart
   └─> Inicializar detecção
       ├─> Registrar posição inicial
       ├─> Registrar timestamp
       └─> Iniciar timer de long press

2. touchmove
   └─> Analisar movimento
       ├─> Calcular distância percorrida
       ├─> Calcular direção predominante
       ├─> Cancelar long press se movimento > threshold
       └─> Verificar se é scroll ou swipe
           ├─> Se movimento vertical predominante + elemento scrollável → SCROLL
           └─> Se movimento rápido + horizontal → SWIPE

3. touchend
   └─> Finalizar detecção
       ├─> Calcular velocidade final
       ├─> Determinar gesto final
       └─> Emitir evento apropriado
           ├─> TAP (sem movimento significativo)
           ├─> LONG_PRESS (se timer completou)
           ├─> SWIPE (se velocidade/ângulo adequados)
           └─> SCROLL (se foi identificado como scroll)
```

#### 4.4.2 Fluxo para Gestos de 2 Dedicados

```
1. touchstart (2 toques)
   └─> Inicializar detecção de 2 dedos
       ├─> Calcular distância inicial entre toques
       ├─> Calcular ponto central
       └─> Iniciar modo PINCH ou TWO_FINGER_SWIPE

2. touchmove (2 toques)
   └─> Analisar movimento
       ├─> Calcular nova distância entre toques
       ├─> Calcular centro de rotação
       ├─> Verificar mudança de distância
       │   ├─> Se mudança significativa → PINCH
       │   └─> Se distância constante + movimento → TWO_FINGER_SWIPE
       └─> Emitir eventos contínuos (pinchmove, swipemove)

3. touchend (1 toque restante)
   └─> Finalizar gesto de 2 dedos
       └─> Voltar para modo 1 dedo ou resetar
```

### 4.5 Algoritmos de Detecção

#### 4.5.1 Detecção de Swipe vs Scroll

**Critérios:**

1. **Direção Predominante:**
   ```javascript
   const isVertical = Math.abs(dy) > Math.abs(dx) * 1.5;
   const isHorizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
   ```

2. **Velocidade:**
   ```javascript
   const velocity = distance / duration;
   const isFastSwipe = velocity > SWIPE_VELOCITY_THRESHOLD; // ex: 0.5 px/ms
   ```

3. **Scrollabilidade do Elemento:**
   ```javascript
   const isScrollable = element.scrollHeight > element.clientHeight ||
                        element.scrollWidth > element.clientWidth;
   const canScrollInDirection = 
     (direction === 'vertical' && element.scrollHeight > element.clientHeight) ||
     (direction === 'horizontal' && element.scrollWidth > element.clientWidth);
   ```

4. **Heurística Combinada:**
   ```javascript
   function isScroll(gesture, element) {
     const isVertical = gesture.direction.includes('up') || 
                       gesture.direction.includes('down');
     const isSlow = gesture.velocity < SCROLL_VELOCITY_THRESHOLD;
     const canScroll = canScrollInDirection(gesture.direction, element);
     
     return isVertical && canScroll && (isSlow || element.scrollTop !== 0);
   }
   ```

#### 4.5.2 Cálculo de Velocidade

```javascript
function calculateVelocity(start, end, startTime, endTime) {
  const distance = Math.sqrt(
    Math.pow(end.x - start.x, 2) + 
    Math.pow(end.y - start.y, 2)
  );
  const duration = endTime - startTime;
  return duration > 0 ? distance / duration : 0;
}
```

#### 4.5.3 Cálculo de Direção

```javascript
function calculateDirection(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  
  // Normalizar para 0-360
  const normalizedAngle = (angle + 360) % 360;
  
  // Mapear para direções
  if (normalizedAngle >= 337.5 || normalizedAngle < 22.5) return 'right';
  if (normalizedAngle >= 22.5 && normalizedAngle < 67.5) return 'down-right';
  if (normalizedAngle >= 67.5 && normalizedAngle < 112.5) return 'down';
  // ... etc
}
```

#### 4.5.4 Detecção de Pinch

```javascript
function detectPinch(touch1, touch2, initialDistance) {
  const currentDistance = calculateDistance(touch1, touch2);
  const scale = currentDistance / initialDistance;
  
  const center = {
    x: (touch1.clientX + touch2.clientX) / 2,
    y: (touch1.clientY + touch2.clientY) / 2
  };
  
  return { scale, center, distance: currentDistance };
}
```

#### 4.5.5 Encontrar Camada por Ponto

```javascript
function findLayersByPoint(x, y, layers) {
  const found = [];
  
  for (const layer of layers) {
    const rect = layer.config.element.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right &&
        y >= rect.top && y <= rect.bottom) {
      found.push(layer);
    }
  }
  
  // Ordenar por profundidade (mais profundo primeiro)
  return found.sort((a, b) => {
    const depthA = getDOMDepth(a.config.element);
    const depthB = getDOMDepth(b.config.element);
    return depthB - depthA;
  });
}

function getDOMDepth(element) {
  let depth = 0;
  let current = element;
  while (current.parentElement) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}
```

#### 4.5.6 Ancestral Comum de Duas Camadas

```javascript
function findCommonAncestor(layer1, layer2) {
  if (!layer1 || !layer2) return null;
  
  const ancestors1 = getAncestors(layer1);
  const ancestors2 = getAncestors(layer2);
  
  // Encontrar primeiro ancestral comum
  for (const ancestor1 of ancestors1) {
    for (const ancestor2 of ancestors2) {
      if (ancestor1 === ancestor2) {
        return ancestor1;
      }
    }
  }
  
  return null;
}

function getAncestors(layer) {
  const ancestors = [];
  let current = layer.parent;
  while (current) {
    ancestors.push(current);
    current = current.parent;
  }
  return ancestors;
}
```

#### 4.5.7 Resolução de Conflitos entre Camadas

```javascript
function resolveLayerConflict(event, candidateLayers) {
  const touch = event.touches[0];
  const gestureType = detectGestureType(event);
  
  // 1. Filtrar camadas que suportam este gesto
  const compatibleLayers = candidateLayers.filter(
    layer => layer.config.gestures.includes(gestureType)
  );
  
  if (compatibleLayers.length === 0) return null;
  if (compatibleLayers.length === 1) return compatibleLayers[0];
  
  // 2. Priorizar por configuração explícita
  const prioritized = compatibleLayers.filter(
    layer => layer.config.priority !== undefined
  );
  if (prioritized.length > 0) {
    prioritized.sort((a, b) => b.config.priority - a.config.priority);
    return prioritized[0];
  }
  
  // 3. Priorizar camada mais profunda (mais específica)
  compatibleLayers.sort((a, b) => {
    const depthA = getDOMDepth(a.config.element);
    const depthB = getDOMDepth(b.config.element);
    return depthB - depthA;
  });
  
  return compatibleLayers[0];
}
```

#### 4.5.8 Verificação de Gestos Globais

```javascript
function shouldProcessGlobalGesture(event, targetLayer, parentLayer) {
  if (!parentLayer || !targetLayer) return false;
  
  const gestureType = detectGestureType(event);
  
  // Se o gesto é global no pai E o pai permite gestos globais
  if (parentLayer.config.globalGestures?.includes(gestureType) &&
      targetLayer.config.allowParentGestures) {
    return true;
  }
  
  return false;
}
```

---

## 5. Riscos e Desafios

### 5.1 Riscos Técnicos

#### 🔴 ALTO RISCO

1. **Conflitos entre Gestos:**
   - **Problema:** Scroll nativo vs Swipe customizado podem competir
   - **Mitigação:** 
     - Detecção precisa de scrollabilidade
     - Thresholds configuráveis
     - `passive: false` para controle total
     - Debounce para evitar eventos múltiplos

2. **Performance em Dispositivos Móveis:**
   - **Problema:** Cálculos em tempo real podem causar lag
   - **Mitigação:**
     - Usar `requestAnimationFrame` para cálculos de pinch
     - Throttling de eventos de movimento
     - Debounce em eventos não críticos
     - Cache de cálculos repetidos

3. **Compatibilidade entre Browsers:**
   - **Problema:** Comportamento diferente entre Chrome, Safari, Firefox
   - **Mitigação:**
     - Testes extensivos em múltiplos browsers
     - Feature detection
     - Polyfills quando necessário
     - Fallbacks graciosos

#### 🟡 MÉDIO RISCO

4. **Conflitos entre Camadas (Hierarquia):**
   - **Problema:** Gestos podem ser capturados pela camada errada
   - **Mitigação:**
     - Sistema de prioridades explícito
     - Verificação de posição relativa ao elemento
     - Propagação seletiva com `stopPropagation`
     - Timeout de decisão para gestos ambíguos
     - Configuração explícita de gestos globais vs locais

5. **Performance em Hierarquia Complexa:**
   - **Problema:** Verificar múltiplas camadas em cada evento pode causar lag
   - **Mitigação:**
     - Cache de queries de elementos
     - Spatial indexing para encontrar camadas rapidamente
     - Otimização de `getBoundingClientRect()` calls
     - Limitar profundidade de verificação
     - Early exit quando camada apropriada é encontrada

6. **Gestos de 2 Dedicados em Camadas Diferentes:**
   - **Problema:** Pinch pode começar com dedos em elementos diferentes
   - **Mitigação:**
     - Detecção de ancestral comum
     - Gestos globais processados no ancestral
     - Fallback para gesto mais específico quando não há ancestral comum
     - Timeout para decidir qual camada processa

7. **Precisão de Detecção:**
   - **Problema:** Diferenciar scroll de swipe pode ser impreciso
   - **Mitigação:**
     - Thresholds configuráveis por uso
     - Calibração baseada em feedback do usuário
     - Múltiplos indicadores (velocidade, distância, tempo)
     - Modo de debug para ajuste fino

8. **Gestos Simultâneos:**
   - **Problema:** Usuário pode iniciar múltiplos gestos acidentalmente
   - **Mitigação:**
     - Máquina de estados rígida
     - Cancelamento automático de gestos conflitantes
     - Timeout para gestos não finalizados

6. **Breaking Changes:**
   - **Problema:** Mudanças podem quebrar uso existente
   - **Mitigação:**
     - Manter API existente
     - Props opcionais para novas funcionalidades
     - Modo de compatibilidade
     - Migração gradual com warnings

#### 🟢 BAIXO RISCO

7. **Complexidade de Código:**
   - **Problema:** Código pode ficar complexo demais
   - **Mitigação:**
     - Separação em módulos pequenos
     - Documentação extensa
     - Testes unitários
     - Code review cuidadoso

### 5.2 Desafios de UX

1. **Feedback Visual:**
   - Como indicar que um swipe está sendo detectado?
   - Feedback durante pinch?
   - Indicadores de direção?

2. **Configurabilidade:**
   - Muitas opções podem confundir desenvolvedores
   - Valores padrão devem funcionar bem na maioria dos casos

3. **Acessibilidade:**
   - Gestos complexos podem ser difíceis para usuários com limitações motoras
   - Manter alternativas via teclado/mouse

---

## 6. Esforço Estimado

### 6.1 Fase 1: Refatoração Base (3-5 dias)

- Separar lógica em módulos
- Implementar padrão Strategy básico
- Criar estrutura de arquivos
- Manter compatibilidade com código existente
- Testes básicos

### 6.2 Fase 2: Gestos de 1 Dedo (4-6 dias)

- Implementar SwipeDetector
- Implementar ScrollDetection
- Cálculos de velocidade e direção
- Diferenciar scroll de swipe
- Testes unitários

### 6.3 Fase 3: Gestos de 2 Dedicados (4-6 dias)

- Implementar PinchDetector
- Implementar TwoFingerSwipeDetector
- Gerenciamento de múltiplos toques
- Testes unitários

### 6.4 Fase 4: Integração e Testes (3-5 dias)

- Integrar todos os detectores
- Testes de integração
- Testes em múltiplos dispositivos/browsers
- Ajustes de performance
- Documentação

### 6.5 Fase 5: Gerenciamento de Hierarquia (5-7 dias)

- Implementar GestureLayerManager
- Implementar sistema de registro de camadas
- Implementar roteamento de eventos
- Implementar resolução de conflitos
- Implementar gestos globais vs locais
- Testes de integração com múltiplas camadas
- Otimizações de performance para hierarquia

### 6.6 Fase 6: Integração e Testes (3-5 dias)

- Integrar todos os detectores
- Integrar sistema de hierarquia
- Testes de integração completos
- Testes em múltiplos dispositivos/browsers
- Testes de casos de uso complexos (PDF viewer)
- Ajustes de performance
- Documentação

### 6.7 Fase 7: Refinamento (2-3 dias)

- Ajustes finos de threshold
- Otimizações de performance
- Melhorias de UX
- Ajustes de hierarquia baseados em testes
- Documentação final

**Total Estimado: 24-34 dias úteis (5-7 semanas)**

**Nota:** O gerenciamento de hierarquia adiciona 5-7 dias ao cronograma original devido à complexidade de:
- Resolução de conflitos entre camadas
- Otimização de performance em hierarquias profundas
- Testes extensivos de casos de uso aninhados

---

## 7. Padrões de Projeto Recomendados

### 7.1 Strategy Pattern ✅

**Aplicação:** Cada tipo de gesto usa uma estratégia de detecção diferente.

**Benefícios:**
- Fácil adicionar novos gestos
- Código modular e testável
- Separação clara de responsabilidades

### 7.2 State Machine Pattern ✅

**Aplicação:** Gerencia estados do reconhecimento de gestos.

**Benefícios:**
- Comportamento previsível
- Evita estados inválidos
- Fácil debug

### 7.3 Observer Pattern ✅

**Aplicação:** Sistema de eventos para notificar gestos.

**Benefícios:**
- Desacoplamento
- Múltiplos listeners
- Flexibilidade

### 7.4 Factory Pattern ✅

**Aplicação:** Criação de detectores baseado no contexto.

**Benefícios:**
- Encapsula lógica de criação
- Fácil extensão
- Centraliza configuração

### 7.5 Singleton Pattern (Opcional)

**Aplicação:** GestureDetector pode ser singleton para evitar múltiplas instâncias.

**Consideração:** Em Svelte, melhor usar instância por componente para isolamento.

### 7.6 Chain of Responsibility ✅

**Aplicação:** Resolução de camadas - cada camada decide se processa ou passa adiante.

**Benefícios:**
- Decisão dinâmica de qual camada processa
- Fácil adicionar novas camadas
- Desacoplamento entre camadas
- Priorização flexível

### 7.7 Composite Pattern ✅

**Aplicação:** Gerenciamento de hierarquia de GestureButtons aninhados.

**Benefícios:**
- Trata elementos individuais e grupos uniformemente
- Facilita navegação pela hierarquia
- Permite operações em toda árvore
- Estrutura recursiva natural

### 7.8 Event Delegation Pattern ✅

**Aplicação:** Centralizar gerenciamento de eventos na camada raiz, delegando para filhos.

**Benefícios:**
- Performance: menos event listeners
- Centralização de lógica de roteamento
- Fácil rastreamento de gestos em múltiplas camadas
- Redução de overhead de eventos

---

## 8. Princípios de Clean Code

### 8.1 Single Responsibility Principle

- **GestureDetector**: Apenas coordena detecção
- **SwipeDetector**: Apenas detecta swipe
- **PinchDetector**: Apenas detecta pinch
- Cada classe tem uma única razão para mudar

### 8.2 Open/Closed Principle

- Abstrair com `BaseStrategy`
- Novos gestos estendem `BaseStrategy`
- Não modificar código existente ao adicionar gestos

### 8.3 Dependency Inversion

- Componente depende de abstrações (interfaces)
- Estratégias são injetáveis
- Facilita testes e mock

### 8.4 DRY (Don't Repeat Yourself)

- Utilitários compartilhados em `utils/`
- Cálculos matemáticos centralizados
- Evitar duplicação de lógica de toque

### 8.5 Nomenclatura Clara

- Nomes descritivos: `calculateSwipeVelocity` vs `calc`
- Verbos para funções: `detect`, `calculate`, `isValid`
- Substantivos para classes: `SwipeDetector`, `GestureConfig`

### 8.6 Funções Pequenas e Focadas

- Cada função faz uma coisa
- Funções curtas (< 20 linhas idealmente)
- Fácil testar e entender

### 8.7 Comentários Significativos

- Comentar "por quê", não "o quê"
- Documentar algoritmos complexos
- JSDoc para APIs públicas

---

## 9. Considerações de Performance

### 9.1 Otimizações Necessárias

1. **Throttling de TouchMove:**
   ```javascript
   let lastMoveTime = 0;
   const THROTTLE_MS = 16; // ~60fps
   
   function handleTouchMove(event) {
     const now = performance.now();
     if (now - lastMoveTime < THROTTLE_MS) return;
     lastMoveTime = now;
     // processar movimento
   }
   ```

2. **Debounce em Eventos Finais:**
   ```javascript
   function debounce(func, wait) {
     let timeout;
     return function(...args) {
       clearTimeout(timeout);
       timeout = setTimeout(() => func.apply(this, args), wait);
     };
   }
   ```

3. **RequestAnimationFrame para Pinch:**
   ```javascript
   let animationFrame = null;
   
   function handlePinchMove(event) {
     if (animationFrame) return;
     animationFrame = requestAnimationFrame(() => {
       processPinch(event);
       animationFrame = null;
     });
   }
   ```

4. **Cache de Cálculos:**
   ```javascript
   const cachedDistance = calculateDistance(touch1, touch2);
   // Reusar se toques não mudaram
   ```

### 9.2 Memory Management

- Limpar event listeners em `onDestroy`
- Cancelar timers e animation frames
- Liberar referências a elementos DOM
- Evitar memory leaks com closures

---

## 10. Testabilidade

### 10.1 Estratégia de Testes

1. **Unit Tests:**
   - Cada strategy isoladamente
   - Utilitários matemáticos
   - Máquina de estados

2. **Integration Tests:**
   - Fluxo completo de detecção
   - Interação entre strategies
   - Eventos emitidos

3. **E2E Tests:**
   - Comportamento em dispositivos reais
   - Compatibilidade entre browsers
   - Performance

### 10.2 Mocks e Stubs

- Mock de TouchEvent
- Stub de timers (usar `jest.useFakeTimers()`)
- Simular múltiplos toques

---

## 11. Compatibilidade e Fallbacks

### 11.1 Feature Detection

```javascript
const supportsTouch = 'ontouchstart' in window || 
                      navigator.maxTouchPoints > 0;
const supportsPointer = 'PointerEvent' in window;

if (supportsTouch) {
  // Usar Touch Events
} else if (supportsPointer) {
  // Usar Pointer Events como fallback
} else {
  // Fallback para mouse events
}
```

### 11.2 Graceful Degradation

- Se pinch não suportado, desabilitar
- Se swipe não detectado, usar tap
- Sempre manter funcionalidade básica (click)

---

## 12. Documentação Necessária

### 12.1 Documentação Técnica

- JSDoc/TSDoc para todas as classes públicas
- Diagramas de fluxo
- Exemplos de uso
- Guia de configuração

### 12.2 Documentação de Usuário

- Props disponíveis
- Eventos emitidos
- Exemplos de código
- Migração do código antigo

---

## 12. Gerenciamento de Hierarquia - Análise Detalhada

### 12.1 Viabilidade do Gerenciamento de Camadas

✅ **VIABILIDADE ALTA - COM DESAFIOS**

O GestureButton **é capaz** de gerenciar camadas de gestos, mas requer arquitetura cuidadosa:

**Aspectos Favoráveis:**
1. ✅ DOM Event Bubbling/Capture permite controle de propagação
2. ✅ `event.target` e `event.currentTarget` identificam origem precisa
3. ✅ Svelte Context API facilita compartilhamento de estado hierárquico
4. ✅ Registro de camadas permite mapeamento completo da hierarquia
5. ✅ Configuração por componente permite flexibilidade

**Desafios Técnicos:**
1. ⚠️ Decisão em tempo real de qual camada processa (pode causar delay)
2. ⚠️ Gestos de 2 dedos podem começar em elementos diferentes
3. ⚠️ Performance ao verificar hierarquia em cada `touchmove`
4. ⚠️ Complexidade de configuração para desenvolvedores

### 12.2 Estratégia de Implementação para Hierarquia

#### 12.2.1 Sistema de Registro de Camadas

```typescript
class LayerRegistry {
  private layers: Map<string, GestureLayer> = new Map();
  private spatialIndex: SpatialIndex; // Para busca rápida por coordenadas
  
  register(layer: GestureLayer): void {
    this.layers.set(layer.id, layer);
    this.spatialIndex.add(layer);
  }
  
  findByPoint(x: number, y: number): GestureLayer[] {
    // Usa spatial index para busca O(log n) em vez de O(n)
    return this.spatialIndex.query(x, y);
  }
}
```

#### 12.2.2 Roteamento de Eventos Hierárquico

**Prioridade de Processamento:**
1. **Camada mais profunda primeiro** (bottom-up)
2. **Verificar gestos locais** antes de gestos globais
3. **Parar propagação** se camada processou e não deve propagar
4. **Fallback para gestos globais** se nenhuma camada local processou

**Fluxo de Decisão:**
```
touchstart (2 dedos)
  ├─> Encontrar camadas que contêm ambos os toques
  ├─> Se ambos na mesma camada filha
  │   └─> Processar nessa camada (swipe 2 dedos)
  ├─> Se em camadas diferentes
  │   ├─> Encontrar ancestral comum
  │   └─> Verificar se ancestral tem gesto global (pinch)
  │       └─> Processar no ancestral
  └─> Se não houver ancestral comum ou gesto global
      └─> Ignorar gesto
```

#### 12.2.3 Exemplo de Uso no Leitor de PDF

```svelte
<!-- Canvas pai -->
<div bind:this={canvasEl} class="pdf-canvas">
  <GestureButton
    gestures={['pinch']}
    globalGestures={['pinch']}
    on:pinch={handlePinchZoom}
  >
    <!-- Conteúdo do canvas -->
    
    <!-- Zona de navegação esquerda (filho) -->
    <div class="navigation-zone left">
      <GestureButton
        gestures={['tap', 'longpress', 'swipe-left', 'swipe-right', 'two-finger-swipe-left', 'two-finger-swipe-right']}
        allowParentGestures={true}  <!-- Permite pinch passar -->
        on:tap={prevPage}
        on:longpress={goToFirstPage}
        on:swipe-left={prevPage}
        on:swipe-right={nextPage}
        on:two-finger-swipe-left={prevPDF}
        on:two-finger-swipe-right={nextPDF}
      >
        <div class="touch-zone"></div>
      </GestureButton>
    </div>
    
    <!-- Zona de navegação direita (filho) -->
    <div class="navigation-zone right">
      <GestureButton
        gestures={['tap', 'longpress', 'swipe-left', 'swipe-right', 'two-finger-swipe-left', 'two-finger-swipe-right']}
        allowParentGestures={true}
        on:tap={nextPage}
        on:longpress={goToLastPage}
        on:swipe-left={prevPage}
        on:swipe-right={nextPage}
        on:two-finger-swipe-left={prevPDF}
        on:two-finger-swipe-right={nextPDF}
      >
        <div class="touch-zone"></div>
      </GestureButton>
    </div>
  </GestureButton>
</div>
```

### 12.3 Casos de Uso e Cenários

#### 12.3.1 Cenário 1: Pinch no Canvas com Toque em Zona Filha

**Comportamento Esperado:**
- ✅ Pinch deve funcionar mesmo se um dedo começar na zona de navegação
- ✅ Pinch é processado no canvas pai (gesto global)
- ✅ Zona de navegação não interfere no pinch

**Implementação:**
```javascript
// Durante touchstart, verificar se 2 toques estão em elementos diferentes
if (touches.length === 2) {
  const layer1 = findLayerByPoint(touches[0].x, touches[0].y);
  const layer2 = findLayerByPoint(touches[1].x, touches[1].y);
  
  // Se diferentes, verificar ancestral comum com gesto global
  if (layer1 !== layer2) {
    const commonAncestor = findCommonAncestor(layer1, layer2);
    if (commonAncestor?.config.globalGestures?.includes('pinch')) {
      // Processar pinch no ancestral
      return commonAncestor.handlePinch(event);
    }
  }
}
```

#### 12.3.2 Cenário 2: Swipe na Zona Filha

**Comportamento Esperado:**
- ✅ Swipe na zona de navegação deve processar localmente
- ✅ Não deve interferir com gestos do canvas pai
- ✅ Canvas pai não deve processar swipe iniciado na zona filha

**Implementação:**
```javascript
// Durante touchstart, verificar camada mais profunda
const deepestLayer = findLayersByPoint(x, y).pop();

if (deepestLayer?.config.gestures.includes('swipe')) {
  // Processar localmente
  deepestLayer.handleSwipe(event);
  event.stopPropagation(); // Impedir que pai processe
}
```

#### 12.3.3 Cenário 3: Swipe de 2 Dedicados na Zona Filha

**Comportamento Esperado:**
- ✅ Swipe de 2 dedos deve processar na zona (mudar PDF)
- ✅ Pinch do pai não deve interferir
- ✅ Ambos os dedos devem estar na mesma zona

**Implementação:**
```javascript
if (touches.length === 2) {
  const layer1 = findLayerByPoint(touches[0].x, touches[0].y);
  const layer2 = findLayerByPoint(touches[1].x, touches[1].y);
  
  // Se ambos na mesma camada filha E camada suporta swipe 2 dedos
  if (layer1 === layer2 && 
      layer1.config.gestures.includes('two-finger-swipe')) {
    return layer1.handleTwoFingerSwipe(event);
  }
}
```

### 12.4 Recomendações Específicas para Hierarquia

1. **Performance:**
   - Usar Spatial Index (R-tree ou quadtree) para busca rápida de camadas
   - Cache de `getBoundingClientRect()` durante um gesto
   - Limitar profundidade de verificação (ex: máximo 3 níveis)

2. **Configuração:**
   - Propriedades explícitas para gestos globais vs locais
   - Prioridades numéricas para resolução de conflitos
   - Modo de debug para visualizar hierarquia

3. **Testabilidade:**
   - Mock de hierarquia DOM para testes
   - Testes unitários para cada cenário de camadas
   - Testes de integração com estruturas reais

4. **Documentação:**
   - Exemplos claros de configuração aninhada
   - Diagramas de hierarquia
   - Guia de troubleshooting para conflitos

---

## 13. Conclusão

### 13.1 Viabilidade

✅ **VIABILIDADE ALTA**

A expansão do GestureButton é tecnicamente viável com:
- APIs nativas adequadas
- Cálculos matemáticos simples
- Svelte facilitando organização
- Padrões de projeto estabelecidos

✅ **GERENCIAMENTO DE HIERARQUIA: VIABILIDADE ALTA - COM DESAFIOS**

O GestureButton **é capaz** de gerenciar camadas de gestos, porém:
- Requer arquitetura cuidadosa com registro de camadas
- Necessita otimizações de performance (spatial indexing)
- Configuração pode ser complexa para casos avançados
- Testes extensivos necessários para cenários aninhados

### 13.2 Resposta à Pergunta: "O GestureButton é capaz de gerenciar camadas de gestos?"

**SIM**, o GestureButton pode gerenciar camadas de gestos, mas requer:

1. **Sistema de Registro de Camadas:**
   - Cada GestureButton se registra em um LayerManager
   - Mapeamento de elementos para camadas
   - Hierarquia mantida via referências pai-filho

2. **Roteamento Inteligente de Eventos:**
   - Verificação bottom-up (filho primeiro, depois pai)
   - Suporte a gestos globais (como pinch no canvas)
   - Parada de propagação quando apropriado

3. **Configuração Explícita:**
   - Props para definir gestos permitidos por camada
   - Flags para gestos globais vs locais
   - Prioridades para resolução de conflitos

4. **Otimizações de Performance:**
   - Spatial indexing para busca rápida
   - Cache de cálculos durante um gesto
   - Limitação de profundidade de verificação

**Conclusão:** A funcionalidade é viável e permitirá casos de uso complexos como o leitor de PDF com gestos hierárquicos.

### 13.3 Recomendações

1. **Implementação Gradual:**
   - Começar com refatoração
   - Adicionar gestos básicos primeiro (swipe de 1 dedo)
   - Implementar hierarquia após gestos básicos funcionarem
   - Testar extensivamente em cada fase

2. **Priorização:**
   - Fase 1: Refatoração e swipe de 1 dedo (maior impacto)
   - Fase 2: Pinch e swipe de 2 dedos
   - Fase 3: Sistema de hierarquia (camadas)
   - Fase 4: Refinamentos e otimizações

3. **Manter Compatibilidade:**
   - Não quebrar código existente
   - Props opcionais para novas funcionalidades
   - Valores padrão sensatos que não requerem configuração

4. **Foco em Qualidade:**
   - Testes desde o início, especialmente para hierarquia
   - Code review rigoroso
   - Documentação paralela com exemplos de hierarquia
   - Performance profiling durante desenvolvimento

5. **Hierarquia Específica:**
   - Começar com casos simples (2 níveis)
   - Adicionar spatial indexing desde o início
   - Testes extensivos de casos de uso reais (PDF viewer)
   - Modo de debug para visualizar hierarquia

### 13.4 Próximos Passos

1. **Aprovação da Análise** (incluindo gerenciamento de hierarquia)
2. **Definição de Prioridades** (hierarquia pode ser fase separada ou integrada)
3. **Decisão de Escopo** (incluir hierarquia desde início ou adicionar depois)
4. **Criação de Branch de Desenvolvimento**
5. **Início da Fase 1: Refatoração Base**
6. **Planejamento de Testes de Hierarquia** (casos de uso específicos)

### 13.5 Considerações Finais sobre Hierarquia

**Vantagens da Implementação:**
- ✅ Permite casos de uso complexos (PDF viewer)
- ✅ Flexibilidade para estruturas aninhadas
- ✅ Separação clara de responsabilidades entre camadas
- ✅ Reutilização de componentes em diferentes contextos

**Desafios a Considerar:**
- ⚠️ Complexidade adicional de código (~30% mais código)
- ⚠️ Overhead de performance (mitigável com otimizações)
- ⚠️ Curva de aprendizado para desenvolvedores
- ⚠️ Necessidade de testes mais extensivos

**Recomendação:** Implementar hierarquia em uma fase separada após gestos básicos funcionarem, permitindo validação incremental e ajustes baseados em feedback.

---

## 14. Referências Técnicas

- [MDN - Touch Events](https://developer.mozilla.org/en-US/docs/Web/API/Touch_events)
- [MDN - Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [Svelte Documentation](https://svelte.dev/docs)
- [Gesture Recognition Patterns](https://web.dev/building-a-gesture-driven-interface/)
- [Clean Code by Robert C. Martin](https://www.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882)

---

**Documento criado em:** 2024  
**Autor:** Análise Técnica  
**Versão:** 2.0

**Changelog:**
- v2.0: Adicionada análise completa de Gerenciamento de Hierarquia (Divs Aninhadas)
  - Seção 12: Análise detalhada de hierarquia
  - Novos padrões de projeto (Composite, Chain of Responsibility, Event Delegation)
  - Algoritmos específicos para resolução de camadas
  - Exemplos de uso para leitor de PDF
  - Atualização de esforço estimado (24-34 dias)
- v1.0: Análise inicial de expansão de gestos

