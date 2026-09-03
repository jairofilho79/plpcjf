/**
 * Gestos de toque, despachados pelo CDP e sempre acompanhados do indicador.
 *
 * Tudo passa por `Input.dispatchTouchEvent` e nao por `click`, porque o app
 * distingue toque de clique: `GestureButton` e as estrategias em
 * `src/lib/components/gestures/` decidem entre toque e toque longo olhando
 * para eventos de toque reais. Um `click` sintetico nunca dispara o toque
 * longo, que e metade do que estes videos existem para ensinar.
 */

const PAUSA_CURTA = 60;

function pontos(x, y) {
  return [{ x: Math.round(x), y: Math.round(y), radiusX: 14, radiusY: 14, force: 1 }];
}

export function criarGestos(page, cliente) {
  async function centro(seletor) {
    const alvo = page.locator(seletor).first();
    await alvo.waitFor({ state: 'visible', timeout: 15000 });

    // `scrollIntoViewIfNeeded` exige que o elemento fique *estavel*, e esta
    // pagina nunca fica: os `.light-beam` do cabecalho e dos cartoes animam
    // sem parar. Na primeira corrida isto pendurou um beat por 30 s inteiros
    // num elemento que ja estava visivel na tela. Com um teto curto e a falha
    // tratada como "nao precisava de rolar", o gesto segue.
    await alvo.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});

    const caixa = await alvo.boundingBox();
    if (!caixa) throw new Error(`sem caixa para "${seletor}" - esta visivel mas nao tem area`);

    // O centro do que se VE, e nao o centro do elemento.
    //
    // Um container com conteudo ampliado fica maior que o ecra: no leitor, com
    // a pagina a 165%, o `#viewerContainer` mede 1353 px de largura e o centro
    // dele cai em x=676 - fora do ecra de 820, e dentro da zona de 75% a 100%
    // que o leitor usa para "ultima pagina". O toque longo que devia esconder
    // a barra saltava para a ultima pagina, e o video mostrava isso.
    //
    // Intersetar com a janela antes de tirar o centro resolve a classe toda:
    // um toque fora do ecra nunca faz o que se espera, seja qual for o alvo.
    const janela = page.viewportSize() || { width: 820, height: 1180 };
    const x1 = Math.max(0, caixa.x);
    const y1 = Math.max(0, caixa.y);
    const x2 = Math.min(janela.width, caixa.x + caixa.width);
    const y2 = Math.min(janela.height, caixa.y + caixa.height);
    if (x2 <= x1 || y2 <= y1) {
      throw new Error(`"${seletor}" esta fora do ecra (caixa ${JSON.stringify(caixa)})`);
    }

    const visivel = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    return { x: x1 + visivel.width / 2, y: y1 + visivel.height / 2, caixa: visivel };
  }

  async function pausa(ms) {
    await page.waitForTimeout(ms);
  }

  async function tocarEm(x, y) {
    await page.evaluate(([px, py]) => window.__plpcToque(px, py), [x, y]);
    await cliente.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pontos(x, y) });
    await pausa(PAUSA_CURTA);
    await cliente.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  return {
    pausa,

    async esperar(seletor, timeout = 20000) {
      await page.locator(seletor).first().waitFor({ state: 'visible', timeout });
    },

    async existe(seletor) {
      return (await page.locator(seletor).count()) > 0;
    },

    async tocar(seletor) {
      const { x, y } = await centro(seletor);
      await tocarEm(x, y);
      await pausa(220);
    },

    /**
     * Toca no primeiro seletor da lista que exista na pagina.
     *
     * Nao e o mesmo que um seletor CSS com virgula. `.material-open,
     * .louvor-info` escolhe quem vier primeiro no DOM, e no cartao agrupado o
     * primeiro e o cabecalho `.louvor-info`, que nao tem `href` nem navega -
     * era o que fazia o leitor nunca abrir no video 1. Aqui a ORDEM DA LISTA e
     * que manda, e nao a ordem do documento.
     */
    async tocarPrimeiro(seletores) {
      for (const seletor of seletores) {
        if (await this.existe(seletor)) {
          await this.tocar(seletor);
          return seletor;
        }
      }
      throw new Error(`nenhum destes existe: ${seletores.join(', ')}`);
    },

    /**
     * O `longPressDuration` do app e 500 ms; 750 da margem folgada sem parecer
     * que o dedo ficou preso.
     */
    async toqueLongo(seletor, ms = 750) {
      const { x, y } = await centro(seletor);
      await page.evaluate(([px, py, d]) => window.__plpcLongo(px, py, d), [x, y, ms]);
      await cliente.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pontos(x, y) });
      await pausa(ms);
      await cliente.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await pausa(320);
    },

    async arrastar(seletor, dx, dy, passos = 24) {
      const { x, y } = await centro(seletor);
      await page.evaluate(([px, py]) => window.__plpcDedo(px, py), [x, y]);
      await cliente.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pontos(x, y) });
      await pausa(180); // o app precisa de reconhecer a pega antes do movimento
      for (let i = 1; i <= passos; i++) {
        const ax = x + (dx * i) / passos;
        const ay = y + (dy * i) / passos;
        await page.evaluate(([px, py]) => {
          window.__plpcDedo(px, py);
          window.__plpcRasto(px, py);
        }, [ax, ay]);
        await cliente.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pontos(ax, ay) });
        await pausa(16);
      }
      await cliente.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.evaluate(() => window.__plpcSoltarDedo());
      await pausa(320);
    },

    /** Deslize rapido para virar pagina no leitor. */
    async deslizar(seletor, direcao = 'esquerda') {
      const { caixa } = await centro(seletor);
      const y = caixa.y + caixa.height / 2;
      const dist = caixa.width * 0.66;
      const de = direcao === 'esquerda' ? caixa.x + caixa.width * 0.82 : caixa.x + caixa.width * 0.18;
      const sinal = direcao === 'esquerda' ? -1 : 1;

      await cliente.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pontos(de, y) });
      for (let i = 1; i <= 12; i++) {
        const ax = de + sinal * (dist * i) / 12;
        await page.evaluate(([px, py]) => window.__plpcRasto(px, py), [ax, y]);
        await cliente.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pontos(ax, y) });
        await pausa(14);
      }
      await cliente.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await pausa(420);
    },

    /** Dois dedos afastando-se (fator > 1) ou aproximando-se (fator < 1). */
    async pincar(seletor, fator = 1.8, passos = 18) {
      const { x, y } = await centro(seletor);
      const base = 70;
      const doisPontos = (raio) => [
        { x: Math.round(x - raio), y: Math.round(y), radiusX: 14, radiusY: 14, force: 1, id: 1 },
        { x: Math.round(x + raio), y: Math.round(y), radiusX: 14, radiusY: 14, force: 1, id: 2 }
      ];

      await cliente.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: doisPontos(base) });
      for (let i = 1; i <= passos; i++) {
        const raio = base * (1 + (fator - 1) * (i / passos));
        await page.evaluate(([cx, cy, r]) => {
          window.__plpcRasto(cx - r, cy);
          window.__plpcRasto(cx + r, cy);
        }, [x, y, raio]);
        await cliente.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: doisPontos(raio) });
        await pausa(22);
      }
      await cliente.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await pausa(420);
    },

    async escrever(seletor, texto) {
      await this.tocar(seletor);
      await page.locator(seletor).first().fill('');
      for (const c of texto) {
        await page.keyboard.type(c);
        await pausa(90); // devagar, para o espectador ler o que esta a ser escrito
      }
      await pausa(260);
    },

    async rolar(px) {
      await page.mouse.wheel(0, px);
      await pausa(420);
    },

    /**
     * Rola suavemente ate o elemento ficar no meio do ecra.
     *
     * Onde o zoom nao serve, isto serve. Nesta app quase tudo sao cartoes de
     * largura inteira, para os quais o fator de zoom honesto e 1 - e um beat
     * sem zoom e sem interacao produz uma imagem PARADA: o video 5 saiu com 19
     * quadros em 55 segundos, e os unicos pixels que mudavam eram a legenda.
     * Trazer o assunto para o meio da tela dirige a atencao e da movimento.
     *
     * `scrollIntoView` e nao `scrollIntoViewIfNeeded`: este ultimo espera o
     * elemento ficar estavel, e as animacoes desta pagina nunca param.
     */
    async trazerParaOMeio(seletor) {
      if (!(await this.existe(seletor))) return false;
      await page.locator(seletor).first().evaluate((el) =>
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      );
      await pausa(900);   // o `smooth` do navegador leva-se o seu tempo
      return true;
    }
  };
}
