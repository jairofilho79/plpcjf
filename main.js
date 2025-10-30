// Load louvores data from manifest
let louvores = [];

(async function loadLouvores() {
  try {
    const response = await fetch('/louvores-manifest.json');
    if (response.ok) {
      louvores = await response.json();
      console.log(`Loaded ${louvores.length} louvores from manifest`);
    } else {
      console.error('Failed to load louvores manifest:', response.status);
      // Fallback: try to use cached louvores.js if available
      if (typeof window.louvores !== 'undefined') {
        louvores = window.louvores;
        console.log('Using fallback louvores.js');
      }
    }
  } catch (error) {
    console.error('Error loading louvores:', error);
    // Fallback: try to use cached louvores.js if available
    if (typeof window.louvores !== 'undefined') {
      louvores = window.louvores;
      console.log('Using fallback louvores.js');
    }
  }
})();

const handleInputValidation = (event) => {
  const searchInput = document.getElementById("searchInput");
  const searchButton = document.getElementById("searchButton");
  const searchButtonDisabled = document.getElementById("searchButtonDisabled");
  if (event.key === 'Enter' && searchInput.value.trim() !== "") {
    handleSearch();
    searchInput.blur(); // Remove focus from the input field
  }
  if (searchInput.value.trim() !== "") {
    searchButton.style.display = "block";
    searchButtonDisabled.style.display = "none";
  } else {
    searchButton.style.display = "none";
    searchButtonDisabled.style.display = "block";
  }
}

const clearSearch = () => {
  const searchInput = document.getElementById("searchInput");
  searchInput.value = "";
  searchInput.focus();
  handleInputValidation({ key: '' });
}

const handleSearch = () => {
  if (louvores.length === 0) {
    setTimeout(handleSearch, 100); // Retry if louvores not loaded yet
    return;
  }
  const search = document.getElementById("searchInput").value.trim();
  if(!isNaN(Number(search))) {
    makeHTMLSearchResponse(louvores.filter(louvor => Number(louvor.numero) === Number(search)));
    return
  }
  const searchT = normalizeSearchString(search);
  makeHTMLSearchResponse(louvores.filter(louvor => {
    const titulo = normalizeSearchString(louvor.nome);
    return titulo.includes(searchT);
  }));
}

const normalizeSearchString = (str) => {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, '');
}

const makeHTMLSearchResponse = (louvores) => {
  const searchResults = document.getElementById("searchResults");
  searchResults.style.display = "flex";
  searchResults.style.flexDirection = "column";
  searchResults.style.alignItems = "center";
  searchResults.style.marginTop = "20px";
  searchResults.innerHTML = "";
  if (louvores.length === 0) {
    searchResults.innerHTML = "<p>Nenhum resultado encontrado.</p>";
    return;
  }
  louvores.forEach(louvor => {
    const louvorItem = document.createElement("div");
    louvorItem.className = "louvor-item";
    louvorItem.style.marginBottom = "15px";
    louvorItem.appendChild(makeHTMLSearchCardResponse(louvor));
    searchResults.appendChild(louvorItem);
  });
}

const makeHTMLSearchCardResponse = (louvor) => {
  const card = document.createElement("div");
  card.className = "louvor-card";
  
  // Determine target attribute based on PDF viewer mode
  const targetAttr = pdfViewerMode === 'newtab' ? 'target="_blank"' : '';
  const relPath = getPdfRelPath(louvor);
  
  // Check if this louvor is already in the carousel
  const isInCarousel = carouselLouvores.some(item => 
    item.numero === louvor.numero && 
    item.nome === louvor.nome && 
    item.classificacao === louvor.classificacao
  );
  
  card.innerHTML = `
    <a href="${relPath}" ${targetAttr} class="louvor-info" style="text-decoration: none; color: inherit;">
      <div style="
        font-size: clamp(1rem, 2vw, 1.5rem);
        font-weight: 500;
        text-align: center;
        margin-bottom: 1rem;
      ">
        <strong>#${enumMapper(louvor['numero']) || 'N/A'}</strong> - ${louvor['nome'] || 'Sem título'}
      </div>
      <div style="
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 0.5rem;
        text-align: center;
      ">
        <div style="
          font-size: clamp(0.8rem, 1.5vw, 1rem);
          color: #555;
        ">
          ${enumMapper(louvor['classificacao']) || 'Sem classificação'}
        </div>
        <div style="
          font-size: clamp(0.8rem, 1.5vw, 1rem);
          color: #666;
        ">
          ${louvor['categoria'] || 'Sem categoria'}
        </div>
      </div>
    </a>
    <button class="add-to-carousel-btn" onclick="addToCarousel(${JSON.stringify(louvor).replace(/"/g, '&quot;')})" ${isInCarousel ? 'disabled' : ''}>
      ${isInCarousel ? '✓' : '+'}
    </button>
  `;
  
  // Attach click handler to honor pdfViewerMode for share/save
  const link = card.querySelector('a.louvor-info');
  link.addEventListener('click', async (e) => {
    const pdfPath = getPdfRelPath(louvor);
    if (pdfViewerMode === 'share' || pdfViewerMode === 'save') {
      e.preventDefault();
      try {
        const blob = await fetchPdfAsBlob(pdfPath);
        if (pdfViewerMode === 'share') {
          await sharePdf(blob, louvor.pdf, louvor.nome);
        } else {
          await savePdf(blob, louvor.pdf);
        }
      } catch (err) {
        console.error('Erro ao processar PDF:', err);
        window.open(pdfPath, '_blank');
      }
      return;
    }
    if (pdfViewerMode === 'online') {
      e.preventDefault();
      const readerUrl = buildOnlineReaderUrl(pdfPath);
      window.location.href = readerUrl;
      return;
    }
    if (pdfViewerMode === 'newtab') {
      e.preventDefault();
      await openPdfNewTabOfflineFirst(`/${pdfPath}`, `${pdfMapper(louvor.classificacao).replace('/', '')}-${louvor.numero}.pdf`);
      return;
    }
  });
  return card;
}

const numeroEnum = {
  0: "CC"
}

const pdfMapper = (v) => {
  const dic = {
    'ColAdultos': 'ColAdultos/',
    'ColCIAs': 'ColCIAs/',
    'Adicionados': 'Adicionados/',
  }

  if(dic[v]) return dic[v];
  return 'Avulsos/'
}

// Retorna caminho relativo sem barra inicial, ex: "assets/ColAdultos/arquivo.pdf"
function getPdfRelPath(louvor) {
  try {
    const raw = louvor && (louvor.pdfId || louvor['pdfId']);
    if (raw && typeof raw === 'string') {
      let decoded = '';
      try {
        decoded = atob(raw).trim();
      } catch (_) {
        decoded = '';
      }
      if (decoded) {
        // normaliza removendo barras iniciais
        let path = decoded.replace(/^\/+/, '');
        // assegura prefixo assets/
        if (path.toLowerCase().startsWith('assets/')) {
          return path;
        }
        if (/\.pdf$/i.test(path) && path.includes('/')) {
          return `assets/${path}`;
        }
      }
    }
  } catch (_) {}
  // fallback atual
  return `assets/${pdfMapper(louvor.classificacao)}${louvor.pdf}`;
}

const classificacaoEnum = {
  'ColAdultos': "Coletânea de Partituras Adultos",
  'ColCIAs': "Coletânea de Partituras CIAs",
  'A': "Avulso PES",
  'DpLICM': "Departamento de Louvor ICM",
  'EL042025': "Encontro de Louvor 04/25",
  'GLGV': "Grupo de Louvor Gov. Valadares",
  'GLMUberlandia': "Grupo de Louvor do Maanaim de Uberlândia",
  'ACIA': 'Avulso CIAs',
  'PESCol': 'Novo Arranjo PES',
}

const enumMapper = (v) => {
  if(numeroEnum[v]) return numeroEnum[v];
  if(classificacaoEnum[v]) return classificacaoEnum[v];
  return v;
}

// PDF Viewer functionality
let pdfViewerMode = 'newtab'; // Default to new tab

const handlePdfViewerChange = (event) => {
  pdfViewerMode = event.target.value;
  localStorage.setItem('pdfViewerMode', pdfViewerMode);
}

// Initialize PDF viewer mode from localStorage
(() => {
  const savedMode = localStorage.getItem('pdfViewerMode');
  if (savedMode) {
    pdfViewerMode = savedMode === 'default' ? 'online' : savedMode;
    document.getElementById('pdfViewerSelect').value = savedMode;
  }
})()

// Carousel functionality
let carouselLouvores = [];

const addToCarousel = (louvor) => {
  // Check if already exists
  if (carouselLouvores.some(item => 
    item.numero === louvor.numero && 
    item.nome === louvor.nome && 
    item.classificacao === louvor.classificacao
  )) {
    return;
  }
  
  carouselLouvores.push(louvor);
  updateCarouselDisplay();
  updateCardButtons();
  saveCarouselToStorage();
}

const removeFromCarousel = (numero, nome, classificacao) => {
  carouselLouvores = carouselLouvores.filter(item => 
    !(item.numero === numero && item.nome === nome && item.classificacao === classificacao)
  );
  updateCarouselDisplay();
  updateCardButtons();
  saveCarouselToStorage();
}

const clearCarousel = () => {
  carouselLouvores = [];
  updateCarouselDisplay();
  updateCardButtons();
  clearCarouselFromStorage();
}

const updateCarouselDisplay = () => {
  const chipCarousel = document.getElementById('chipCarousel');
  const chipsContainer = document.getElementById('chipsContainer');
  
  if (carouselLouvores.length === 0) {
    chipCarousel.style.display = 'none';
    return;
  }
  
  chipCarousel.style.display = 'block';
  chipsContainer.innerHTML = '';
  
  carouselLouvores.forEach(louvor => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `
      <span>#${enumMapper(louvor.numero) || 'N/A'} - ${louvor.nome || 'Sem título'}</span>
      <button class="chip-close" onclick="removeFromCarousel('${louvor.numero}', '${louvor.nome}', '${louvor.classificacao}')" title="Remover">×</button>
    `;
    
    // Add click handler to open PDF
    chip.addEventListener('click', (e) => {
      if (e.target.classList.contains('chip-close')) return;
      openPdfFromChip(louvor);
    });
    
    chipsContainer.appendChild(chip);
  });
}

const updateCardButtons = () => {
  // Update all card buttons to reflect current carousel state
  const cards = document.querySelectorAll('.louvor-card');
  cards.forEach(card => {
    const button = card.querySelector('.add-to-carousel-btn');
    if (button) {
      try {
        const onclickAttr = button.getAttribute('onclick');
        const match = onclickAttr.match(/addToCarousel\((.*)\)/);
        if (match) {
          const louvorData = JSON.parse(match[1].replace(/&quot;/g, '"'));
          const isInCarousel = carouselLouvores.some(item => 
            item.numero === louvorData.numero && 
            item.nome === louvorData.nome && 
            item.classificacao === louvorData.classificacao
          );
          button.disabled = isInCarousel;
          button.textContent = isInCarousel ? '✓' : '+';
        }
      } catch (e) {
        console.warn('Error updating card button:', e);
      }
    }
  });
}

const openPdfFromChip = (louvor) => {
  const pdfPath = getPdfRelPath(louvor);
  
  if (pdfViewerMode === 'newtab') {
    openPdfNewTabOfflineFirst(`/${pdfPath}`, `${pdfMapper(louvor.classificacao).replace('/', '')}-${louvor.numero}.pdf`);
    return;
  }
  if (pdfViewerMode === 'online') {
    const readerUrl = buildOnlineReaderUrl(pdfPath);
    window.location.href = readerUrl;
    return;
  }
  if (pdfViewerMode === 'share') {
    fetchPdfAsBlob(pdfPath)
      .then(blob => sharePdf(blob, louvor.pdf, louvor.nome))
      .catch(() => window.open(pdfPath, '_blank'));
    return;
  }
  if (pdfViewerMode === 'save') {
    fetchPdfAsBlob(pdfPath)
      .then(blob => savePdf(blob, louvor.pdf))
      .catch(() => {
        const a = document.createElement('a');
        a.href = pdfPath; a.download = louvor.pdf; a.click();
      });
    return;
  }
  // default: mesma aba
  window.location.href = pdfPath;
}

// ====== Persistência do Carousel ======
const CAROUSEL_STORAGE_KEY = 'carouselLouvores';

function saveCarouselToStorage() {
  try {
    localStorage.setItem(CAROUSEL_STORAGE_KEY, JSON.stringify(carouselLouvores));
  } catch (e) {
    console.warn('Não foi possível salvar o carousel no localStorage:', e);
  }
}

function loadCarouselFromStorage() {
  try {
    const raw = localStorage.getItem(CAROUSEL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    console.warn('Não foi possível ler o carousel do localStorage:', e);
  }
  return [];
}

function clearCarouselFromStorage() {
  try {
    localStorage.removeItem(CAROUSEL_STORAGE_KEY);
  } catch (e) {
    console.warn('Não foi possível limpar o carousel do localStorage:', e);
  }
}

// Restaura o carousel ao carregar a página
(() => {
  const restored = loadCarouselFromStorage();
  if (restored.length > 0) {
    carouselLouvores = restored;
    updateCarouselDisplay();
    // updateCardButtons será útil após render de resultados, mas chamar aqui é inofensivo
    updateCardButtons();
  }
})();

// ====== Utils: PDF fetch/share/save ======
async function fetchPdfAsBlob(pdfPath) {
  const res = await fetch(pdfPath);
  if (!res.ok) throw new Error('Falha ao baixar PDF');
  return await res.blob();
}

// Open PDF using normal URL; Service Worker will serve from cache when available
async function openPdfNewTabOfflineFirst(relPath, filename = 'file.pdf') {
  try {
    const localUrl = new URL(relPath, window.location.origin).href;
    window.open(localUrl, '_blank', 'noopener');
    return true;
  } catch (_) {
    window.open(relPath, '_blank', 'noopener');
    return false;
  }
}

function buildOnlineReaderUrl(pdfPath) {
  const absolutePdfUrl = new URL(pdfPath, window.location.origin).href;
  const encoded = encodeURIComponent(absolutePdfUrl);
  return `https://coletaneadigitalicm.github.io/leitor-pdf/?url=${encoded}`;
}

async function sharePdf(blob, filename, title) {
  try {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title });
      return;
    }
  } catch (_) {
    // segue para fallback
  }
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

async function savePdf(blob, filename) {
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }
  } catch (_) {
    // segue para fallback
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}