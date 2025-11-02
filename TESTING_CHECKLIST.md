# ✅ Checklist de Testes - PLPC SvelteKit

## 🎯 Fase Atual: TESTES

### 📋 Pré-requisitos

- [x] Dependências instaladas (`npm install`)
- [x] `static/louvores-manifest.json` presente
- [x] Ícones copiados (`static/icon-*.png`)
- [ ] `.dev.vars` criado (opcional, apenas para upload)

---

## 🧪 Testes Locais

### 1. Desenvolvimento Local

```bash
npm run dev
```

**Verificar:**
- [ ] Aplicação abre em `http://localhost:5173`
- [ ] Sem erros no console do navegador
- [ ] Sem erros no terminal
- [ ] Tailwind CSS aplicado (cores, fontes)
- [ ] Layout responsivo visível

### 2. Service Worker

**No console do navegador:**
- [ ] Mensagem: `SW registered: [ServiceWorkerRegistration]`
- [ ] SW aparece em `Application > Service Workers` (DevTools)
- [ ] Se erro 404: verificar path `/sw.js` no build

**Comandos para verificar SW:**
```javascript
// No console do navegador:
navigator.serviceWorker.getRegistration().then(r => console.log(r))
```

### 3. Manifest Loading

**Testar:**
- [ ] Abrir DevTools > Network
- [ ] Buscar `louvores-manifest.json`
- [ ] Status: 200 OK
- [ ] Dados retornados (array de louvores)
- [ ] Console mostra: `Loaded X louvores from manifest`

**Fallback test:**
- [ ] Se R2 não disponível, usar `static/louvores-manifest.json`
- [ ] Aplicação não quebra sem R2

---

## 🔍 Funcionalidades Core

### 4. Busca

**Testar busca por número:**
- [ ] Digitar número (ex: `123`)
- [ ] Pressionar Enter ou clicar "Pesquisar"
- [ ] Resultados aparecem
- [ ] Card mostra número e nome corretos

**Testar busca por texto:**
- [ ] Digitar texto (ex: "aleluia")
- [ ] Resultados filtrados aparecem
- [ ] Busca funciona com acentos removidos
- [ ] Busca case-insensitive

**Testar busca vazia:**
- [ ] Clicar "Limpar"
- [ ] Campo limpo
- [ ] Resultados ocultados

### 5. Filtros de Categoria

**Testar checkbox "Todos":**
- [ ] Clique marca/desmarca todas categorias
- [ ] Estado indeterminado quando algumas marcadas
- [ ] Persiste no localStorage

**Testar filtros individuais:**
- [ ] Desmarcar "Partitura"
- [ ] Resultados filtrados atualizados
- [ ] Persiste após recarregar página

**Testar combinação:**
- [ ] Buscar texto + filtrar categoria
- [ ] Resultados corretos (AND lógico)

### 6. Carousel (Chips)

**Testar adicionar:**
- [ ] Clicar botão "+" em um card
- [ ] Chip aparece no carousel
- [ ] Botão muda para "✓" (checkmark)
- [ ] Botão desabilitado
- [ ] Persiste no localStorage

**Testar remover:**
- [ ] Clicar "×" no chip
- [ ] Chip removido
- [ ] Botão "+" volta a funcionar
- [ ] Persiste no localStorage

**Testar abrir PDF do chip:**
- [ ] Clicar no chip (não no ×)
- [ ] PDF abre conforme modo selecionado

**Testar limpar todos:**
- [ ] Clicar "Limpar Todos"
- [ ] Todos chips removidos
- [ ] Botões "+" reabilitados

### 7. Modos de Visualização PDF

**Testar cada modo:**

1. **Online:**
   - [ ] Selecionar "Leitor Online"
   - [ ] Clicar card ou chip
   - [ ] Abre leitor externo (`coletaneadigitalicm.github.io/leitor-pdf`)
   - [ ] URL contém PDF correto

2. **Nova Aba:**
   - [ ] Selecionar "Abrir PDF em nova aba"
   - [ ] Clicar card ou chip
   - [ ] Nova aba abre
   - [ ] PDF renderiza (ou cache serve)

3. **Compartilhar:**
   - [ ] Selecionar "Compartilhar"
   - [ ] Clicar card ou chip
   - [ ] Menu de compartilhamento aparece (se suportado)
   - [ ] Fallback: abre em nova aba

4. **Salvar:**
   - [ ] Selecionar "Salvar/baixar"
   - [ ] Clicar card ou chip
   - [ ] File Picker aparece (se suportado)
   - [ ] Fallback: download direto

**Testar persistência:**
- [ ] Modo salvo no localStorage
- [ ] Mantém seleção após recarregar

---

## 📱 Responsividade

### 8. Mobile (< 768px)

- [ ] Toolbar fixa no topo
- [ ] SearchBar responsiva (padding ajustado)
- [ ] Cards empilhados verticalmente
- [ ] Chips scrolláveis horizontalmente
- [ ] Botões não quebram layout
- [ ] Texto legível (tamanho adequado)

### 9. Tablet (768px - 1024px)

- [ ] Layout intermediário funcional
- [ ] Cards podem ter 2 colunas
- [ ] Filtros bem dispostos

### 10. Desktop (> 1024px)

- [ ] Layout completo visível
- [ ] Cards em grid centralizado
- [ ] Espaçamento adequado
- [ ] Hover states funcionam

---

## 🔄 PWA e Offline

### 11. Service Worker Cache

**Testar cache offline:**
- [ ] Abrir DevTools > Application > Service Workers
- [ ] Verificar caches criados (`pls-v3`, `pls-runtime-v3`)
- [ ] Desativar rede (Network > Offline)
- [ ] Recarregar página
- [ ] Aplicação funciona offline
- [ ] Assets servidos do cache

### 12. Sincronização PDFs (Easter Egg)

**Ativar modo offline:**
- [ ] Clicar 7 vezes no header "PLPC" em 10 segundos
- [ ] Modal de progresso aparece
- [ ] Service Worker recebe mensagem `SYNC_PDFS`
- [ ] Console mostra: `[SW] Sync requested`
- [ ] PDFs começam a ser baixados em lotes

**Verificar sincronização:**
- [ ] Progress bar atualiza
- [ ] Console mostra batches sendo processados
- [ ] PDFs aparecem no cache
- [ ] Resumo final enviado

### 13. Atualizações (Update Banner)

**Simular atualização:**
- [ ] Modificar service worker
- [ ] Recarregar página
- [ ] Banner aparece no rodapé
- [ ] Clicar "Atualizar Agora"
- [ ] Página recarrega
- [ ] Nova versão ativa

---

## 🚀 Deploy e Produção

### 14. Build Local

```bash
npm run build
```

**Verificar:**
- [ ] Build completa sem erros
- [ ] Pasta `.svelte-kit/cloudflare` criada
- [ ] Assets gerados corretamente
- [ ] `sw.js` presente no build

### 15. Preview Build

```bash
npm run preview
```

**Verificar:**
- [ ] Build funciona localmente
- [ ] Sem erros no console
- [ ] Todas funcionalidades OK

### 16. Deploy Cloudflare (Produção)

**Pré-deploy:**
```bash
# Configurar secrets
wrangler secret put JWT_SECRET --env production

# Verificar R2 binding
wrangler r2 bucket list
```

**Deploy:**
```bash
npm run deploy
```

**Verificar em produção:**
- [ ] Site acessível
- [ ] Manifest carrega do R2
- [ ] PDFs servidos do R2
- [ ] Service Worker registra
- [ ] Upload funciona (se testar JWT)

---

## 🐛 Problemas Conhecidos e Soluções

### SW não registra (404)
**Causa:** Path incorreto ou build não gerou SW  
**Solução:** Verificar `vite.config.js` e build output

### Manifest não carrega
**Causa:** R2 não configurado localmente  
**Solução:** Fallback para `static/louvores-manifest.json` deve funcionar

### PDFs não abrem
**Causa:** Path incorreto ou R2 não acessível  
**Solução:** Verificar `hooks.server.js` e fallback para domínio online

### Tailwind não aplica
**Causa:** CSS não importado ou build incorreto  
**Solução:** Verificar `src/app.css` e `+layout.svelte` import

### Responsividade quebrada
**Causa:** Classes Tailwind não compiladas  
**Solução:** Verificar `tailwind.config.js` e rebuild

---

## 📊 Critérios de Sucesso

✅ **Aplicação funcional se:**
- Busca retorna resultados corretos
- Filtros aplicam corretamente
- Carousel persiste entre sessões
- PDFs abrem em todos os modos
- Service Worker registra e cache funciona
- Layout responsivo em todas as telas
- Tema visual aplicado consistentemente
- Sem erros críticos no console

---

## 🎯 Próxima Fase

Após testes locais bem-sucedidos:
1. **Build e Preview** (testar build production)
2. **Deploy Staging** (testar no Cloudflare Pages preview)
3. **Deploy Produção** (deploy final)
4. **Testes Produção** (validação em ambiente real)
5. **Documentação Final** (atualizar README com ajustes)

---

**Última atualização:** $(date)  
**Status:** Em testes  
**Aguardando:** Validação funcional completa

