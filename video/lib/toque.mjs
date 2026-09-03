/**
 * Indicador visual de toque, injetado na pagina antes de tudo.
 *
 * O toque sintetico do CDP e invisivel: sem isto, o espectador ve a tela mudar
 * sem causa nenhuma. Num tutorial que ensina toque longo em seis sitios do
 * leitor, isso e fatal - ninguem aprende um gesto que nao viu acontecer.
 *
 * Anexa ao `documentElement` e nao ao `body` de proposito: `/leitor` poe
 * `document.body.style.position = 'fixed'` (ver `src/routes/+layout.svelte`),
 * e um filho `fixed` de um pai `fixed` posiciona-se contra o pai, nao contra a
 * janela - o indicador apareceria no sitio errado exatamente na pagina onde
 * mais importa.
 */
export const SCRIPT_TOQUE = `
(() => {
  const ID = '__plpc_toque_estilo';
  function garantirEstilo() {
    if (document.getElementById(ID)) return;
    const s = document.createElement('style');
    s.id = ID;
    s.textContent = \`
      .__plpc_marca {
        position: fixed; pointer-events: none; z-index: 2147483647;
        border-radius: 50%; transform: translate(-50%, -50%);
        box-sizing: border-box;
      }
      /* O anel escuro nao e decoracao: a app tem fundo castanho escuro e
         cartoes creme, e um indicador so em ouro desaparece sobre o creme.
         Branco por dentro, castanho a fechar, ouro a irradiar - le-se nos
         dois fundos. */
      .__plpc_toque {
        width: 60px; height: 60px;
        background: rgba(255,255,255,0.55);
        border: 5px solid rgba(74,35,18,0.92);
        box-shadow: 0 0 0 4px rgba(212,175,55,0.95), 0 0 18px 6px rgba(212,175,55,0.55);
        animation: __plpc_pulso 620ms ease-out forwards;
      }
      @keyframes __plpc_pulso {
        0%   { opacity: 0; transform: translate(-50%,-50%) scale(0.4); }
        18%  { opacity: 1; transform: translate(-50%,-50%) scale(1.0); }
        70%  { opacity: 1; transform: translate(-50%,-50%) scale(1.08); }
        100% { opacity: 0; transform: translate(-50%,-50%) scale(1.6); }
      }
      .__plpc_longo {
        width: 76px; height: 76px;
        border: 5px solid rgba(74,35,18,0.45);
        background: rgba(255,255,255,0.45);
        box-shadow: 0 0 16px 5px rgba(212,175,55,0.45);
      }
      .__plpc_longo::after {
        content: ''; position: absolute; inset: -5px; border-radius: 50%;
        border: 5px solid rgba(74,35,18,0.95);
        clip-path: inset(0 0 100% 0);
        animation: __plpc_encher var(--dur,700ms) linear forwards;
      }
      @keyframes __plpc_encher {
        from { clip-path: inset(0 0 100% 0); }
        to   { clip-path: inset(0 0 0 0); }
      }
      .__plpc_rasto {
        width: 24px; height: 24px;
        background: rgba(212,175,55,0.9);
        box-shadow: 0 0 0 2px rgba(74,35,18,0.7);
        animation: __plpc_esvair 700ms ease-out forwards;
      }
      @keyframes __plpc_esvair {
        from { opacity: 0.85; transform: translate(-50%,-50%) scale(1); }
        to   { opacity: 0;    transform: translate(-50%,-50%) scale(0.4); }
      }
      .__plpc_dedo {
        width: 48px; height: 48px;
        background: rgba(255,255,255,0.5);
        border: 5px solid rgba(74,35,18,0.9);
        box-shadow: 0 0 0 4px rgba(212,175,55,0.95);
      }
    \`;
    (document.head || document.documentElement).appendChild(s);
  }

  function marca(x, y, classe, vidaMs, dur) {
    garantirEstilo();
    const d = document.createElement('div');
    d.className = '__plpc_marca ' + classe;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    if (dur) d.style.setProperty('--dur', dur + 'ms');
    document.documentElement.appendChild(d);
    setTimeout(() => d.remove(), vidaMs);
    return d;
  }

  window.__plpcToque = (x, y) => marca(x, y, '__plpc_toque', 700);
  window.__plpcLongo = (x, y, ms) => marca(x, y, '__plpc_longo', ms + 260, ms);
  window.__plpcRasto = (x, y) => marca(x, y, '__plpc_rasto', 720);

  // O dedo persistente do arrasto: um so elemento que se move, para nao
  // encher a pagina de divs durante 24 passos de interpolacao.
  window.__plpcDedo = (x, y) => {
    garantirEstilo();
    let d = document.getElementById('__plpc_dedo_ativo');
    if (!d) {
      d = document.createElement('div');
      d.id = '__plpc_dedo_ativo';
      d.className = '__plpc_marca __plpc_dedo';
      document.documentElement.appendChild(d);
    }
    d.style.left = x + 'px';
    d.style.top = y + 'px';
  };
  window.__plpcSoltarDedo = () => {
    const d = document.getElementById('__plpc_dedo_ativo');
    if (d) d.remove();
  };
})();
`;
