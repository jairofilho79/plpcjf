# PLPC - Pesquisador de Louvores

Aplicação PWA para pesquisa e visualização offline de partituras de louvores, desenvolvida com SvelteKit + Tailwind CSS e hospedada no Cloudflare Pages.

## 🚀 Stack Tecnológico

- **Frontend**: SvelteKit, Tailwind CSS, Lucide Icons
- **Backend**: Cloudflare Pages Functions, Cloudflare Workers
- **Storage**: Cloudflare R2
- **PWA**: Workbox, Service Workers
- **Deploy**: Cloudflare Pages

## 🎨 Tema Visual "Coletânea Digital"

A aplicação utiliza uma paleta de cores sóbria e elegante:

- **Fundo estrutural**: `#4B2D2B` (marrom escuro)
- **Cards**: `#FFF8E1` / `#f8f9fa`
- **Títulos**: `#6A2F2F`
- **Destaques**: `#D4AF37` (dourado)
- **Placeholders**: `#F0E68C`

## 📋 Funcionalidades

- ✅ Busca de louvores por número ou texto
- ✅ Filtros por categoria (Partitura, Cifra, etc.)
- ✅ Carousel de louvores selecionados
- ✅ Modos de visualização PDF (online, nova aba, compartilhar, salvar)
- ✅ Suporte offline com Service Worker
- ✅ PWA instalável
- ✅ Design responsivo (mobile, tablet, desktop)
- ✅ Upload de novos louvores (autenticado via JWT)

## 🛠️ Setup Local

### Pré-requisitos

- Node.js 18+ e npm
- Conta Cloudflare (para acesso a R2)

### Instalação

```bash
# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .dev.vars
# Editar .dev.vars com suas credenciais

# Desenvolvimento local
npm run dev

# Build para produção
npm run build

# Preview da build local
npm run preview
```

### Configuração de Secrets

```bash
# Configurar JWT_SECRET no Cloudflare
wrangler secret put JWT_SECRET --env production
```

## 📁 Estrutura de Diretórios

```
src/
├── lib/
│   ├── components/        # Componentes Svelte reutilizáveis
│   ├── stores/            # Stores Svelte (louvores, filtros, carousel)
│   └── utils/             # Funções utilitárias
├── routes/
│   ├── api/               # Endpoints API
│   ├── +layout.svelte     # Layout global
│   └── +page.svelte       # Página principal
├── service-worker/
│   └── sw.js              # Service Worker customizado
└── app.css                # Estilos globais + Tailwind

static/                    # Assets estáticos
├── manifest.json          # PWA manifest
├── icon-192.png          # Ícones PWA
└── icon-512.png
```

## 🔧 Deploy

### Cloudflare Pages

```bash
# Deploy manual
npm run deploy

# Ou configure CI/CD no GitHub Actions
# (veja .github/workflows/deploy.yml)
```

### Configuração no Cloudflare Dashboard

1. Acesse o Cloudflare Dashboard
2. Vá em **Pages** > **Create a project**
3. Conecte seu repositório Git
4. Configure:
   - Build command: `npm run build`
   - Build output directory: `.svelte-kit/cloudflare`
   - Environment variables (se necessário)

## 🔐 Autenticação

A API de upload utiliza JWT para autenticação:

```javascript
// Exemplo de uso da API de upload
const response = await fetch('/api/upload-louvor', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${jwtToken}`
  },
  body: JSON.stringify({
    file: 'base64EncodedPdf',
    metadata: {
      nome: 'Nome do Louvor',
      classificacao: 'ColAdultos',
      numero: '123',
      categoria: 'Partitura'
    }
  })
});
```

## 📱 PWA

A aplicação é uma Progressive Web App (PWA) instalável:

- **Offline**: Todos os PDFs podem ser baixados para uso offline
- **Atualizações**: Banner automático para novas versões
- **Install Prompt**: Disponível no navegador (Add to Home Screen)

### Modo Offline Especial

Clique no header "PLPC" 7 vezes em 10 segundos para ativar o modo de sincronização completa de PDFs.

## 🌐 R2 Bucket

Os PDFs são armazenados em um bucket Cloudflare R2:

- **Bucket name**: `pls-louvores`
- **Manifest**: `louvores-manifest.json` (lista de todos os louvores)
- **Estrutura**: `/assets/[classificacao]/[filename].pdf`

## 🧪 Testes

```bash
# Executar testes (quando implementados)
npm test

# Executar lint
npm run check
```

## 📄 Licença

Este projeto é privado e de uso interno.

## 👥 Contribuindo

1. Faça fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

## 📞 Suporte

Para dúvidas ou problemas, entre em contato com a equipe de desenvolvimento.

