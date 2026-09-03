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
    return { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2, caixa };
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
    }
  };
}
