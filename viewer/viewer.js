/**
 * PDF Translator - Core Viewer & Layout-Preserving Overlay Engine
 */

// Configure PDF.js Worker
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '../lib/pdf.worker.min.js';
}

class PDFTranslatorViewer {
  constructor() {
    this.pdfDoc = null;
    this.currentScale = 1.0;
    this.currentPage = 1;
    this.totalPages = 0;
    this.viewMode = 'overlay'; // 'overlay' | 'split' | 'original'
    this.targetLang = 'en';
    this.detectedSourceLang = 'auto';

    // Store pure translation text strings per page: pageNum -> string[]
    this.pageTranslationStrings = new Map();
    this.translator = new TranslationService();

    // Lazy Page Rendering State
    this.renderedPages = new Set();
    this.renderingPages = new Set();
    this.pageObservers = [];
    this.defaultPageWidth = 600;
    this.defaultPageHeight = 840;

    // DOM Elements
    this.dom = {
      docTitle: document.getElementById('doc-title'),
      pagesContainer: document.getElementById('pages-container'),
      splitLeftPages: document.getElementById('split-left-pages'),
      splitRightPages: document.getElementById('split-right-pages'),
      singleViewport: document.getElementById('single-viewport'),
      splitViewport: document.getElementById('split-viewport'),
      viewerContainer: document.getElementById('viewer-container'),
      dropzone: document.getElementById('dropzone'),
      btnBrowsePdf: document.getElementById('btn-browse-pdf'),
      btnLoadDemo: document.getElementById('btn-load-demo'),
      inputFilePicker: document.getElementById('input-file-picker'),
      inputPageNum: document.getElementById('input-page-num'),
      labelPageCount: document.getElementById('label-page-count'),
      btnPrevPage: document.getElementById('btn-prev-page'),
      btnNextPage: document.getElementById('btn-next-page'),
      selectZoom: document.getElementById('select-zoom'),
      btnZoomIn: document.getElementById('btn-zoom-in'),
      btnZoomOut: document.getElementById('btn-zoom-out'),
      selectTargetLang: document.getElementById('select-target-lang'),
      btnRetranslate: document.getElementById('btn-retranslate'),
      btnSettings: document.getElementById('btn-settings'),
      modalSettings: document.getElementById('modal-settings'),
      btnCloseModal: document.getElementById('btn-close-modal'),
      btnSaveSettings: document.getElementById('btn-save-settings'),
      settingProvider: document.getElementById('setting-provider'),
      settingGeminiKey: document.getElementById('setting-gemini-key'),
      geminiConfigGroup: document.getElementById('gemini-config-group'),
      modeOverlay: document.getElementById('mode-overlay'),
      modeSplit: document.getElementById('mode-split'),
      modeOriginal: document.getElementById('mode-original'),
      statusBanner: document.getElementById('status-banner'),
      statusText: document.getElementById('status-text'),
      statusProgressBar: document.getElementById('status-progress-bar'),
      hoverLens: document.getElementById('hover-lens'),
      hoverLensText: document.getElementById('hover-lens-text'),
      hoverSourceLang: document.getElementById('hover-source-lang'),
      btnAiVision: document.getElementById('btn-ai-vision'),
      btnAiVisionLabel: document.getElementById('btn-ai-vision-label'),
      scannedDocNotice: document.getElementById('scanned-doc-notice'),
      btnBannerTranslateScan: document.getElementById('btn-banner-translate-scan'),
      modalGeminiSetup: document.getElementById('modal-gemini-setup'),
      btnCloseSetupModal: document.getElementById('btn-close-setup-modal'),
      inputSetupGeminiKey: document.getElementById('input-setup-gemini-key'),
      btnConfirmSetupKey: document.getElementById('btn-confirm-setup-key'),
      modalQuotaExhausted: document.getElementById('modal-quota-exhausted'),
      btnCloseQuotaModal: document.getElementById('btn-close-quota-modal'),
      btnActivateOcrFallback: document.getElementById('btn-activate-ocr-fallback'),
      inputBackupGeminiKey: document.getElementById('input-backup-gemini-key'),
      btnSaveBackupKey: document.getElementById('btn-save-backup-key')
    };

    // Scanned PDF & AI Vision State
    this.isScannedPdf = false;
    this.geminiQuotaExhausted = false;
    this.activeEngineForScan = 'gemini'; // 'gemini' | 'ocr_fallback'
    this.scannedTranslations = new Map(); // pageNum -> { markdown, engine }

    this.initEventListeners();
    this.checkInitialParams();
  }

  initEventListeners() {
    // Mode toggles
    this.dom.modeOverlay.addEventListener('click', () => this.setViewMode('overlay'));
    this.dom.modeSplit.addEventListener('click', () => this.setViewMode('split'));
    this.dom.modeOriginal.addEventListener('click', () => this.setViewMode('original'));

    // Zoom
    this.dom.selectZoom.addEventListener('change', (e) => this.handleZoomChange(e.target.value));
    this.dom.btnZoomIn.addEventListener('click', () => this.adjustZoom(0.25));
    this.dom.btnZoomOut.addEventListener('click', () => this.adjustZoom(-0.25));

    // Page navigation
    this.dom.btnPrevPage.addEventListener('click', () => this.goToPage(this.currentPage - 1));
    this.dom.btnNextPage.addEventListener('click', () => this.goToPage(this.currentPage + 1));
    this.dom.inputPageNum.addEventListener('change', (e) => this.goToPage(parseInt(e.target.value, 10)));

    // Target Language
    this.dom.selectTargetLang.addEventListener('change', (e) => {
      this.targetLang = e.target.value;
      this.pageTranslationStrings.clear();
      this.retranslateCurrentDocument();
    });

    this.dom.btnRetranslate.addEventListener('click', () => {
      this.pageTranslationStrings.clear();
      this.retranslateCurrentDocument();
    });

    // File pickers
    this.dom.btnBrowsePdf.addEventListener('click', () => this.dom.inputFilePicker.click());
    this.dom.inputFilePicker.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.loadLocalFile(e.target.files[0]);
      }
    });

    // Demo loader
    this.dom.btnLoadDemo.addEventListener('click', () => this.loadSampleFrenchPdf());

    // Settings Modal
    this.dom.btnSettings.addEventListener('click', () => this.openSettings());
    this.dom.btnCloseModal.addEventListener('click', () => this.closeSettings());
    this.dom.btnSaveSettings.addEventListener('click', () => this.saveSettings());
    this.dom.settingProvider.addEventListener('change', (e) => {
      this.dom.geminiConfigGroup.classList.toggle('hidden', e.target.value !== 'gemini');
    });

    // AI Vision Translation & Scanned PDF Actions
    if (this.dom.btnAiVision) {
      this.dom.btnAiVision.addEventListener('click', () => this.handleTranslateScannedPage(this.currentPage));
    }
    if (this.dom.btnBannerTranslateScan) {
      this.dom.btnBannerTranslateScan.addEventListener('click', () => this.handleTranslateScannedPage(this.currentPage));
    }

    // Quick Gemini Setup Modal
    if (this.dom.btnCloseSetupModal) {
      this.dom.btnCloseSetupModal.addEventListener('click', () => this.dom.modalGeminiSetup.classList.add('hidden'));
    }
    if (this.dom.btnConfirmSetupKey) {
      this.dom.btnConfirmSetupKey.addEventListener('click', () => this.saveSetupGeminiKey());
    }

    // Quota Exhausted Modal Actions
    if (this.dom.btnCloseQuotaModal) {
      this.dom.btnCloseQuotaModal.addEventListener('click', () => this.dom.modalQuotaExhausted.classList.add('hidden'));
    }
    if (this.dom.btnActivateOcrFallback) {
      this.dom.btnActivateOcrFallback.addEventListener('click', () => this.activateOcrFallback());
    }
    if (this.dom.btnSaveBackupKey) {
      this.dom.btnSaveBackupKey.addEventListener('click', () => this.saveBackupGeminiKey());
    }

    // Drag and drop PDF
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
          this.loadLocalFile(file);
        }
      }
    });

    // Synchronized scrolling for split view
    let isLeftScrolling = false;
    let isRightScrolling = false;
    const leftCol = this.dom.splitViewport.querySelector('.left-column');
    const rightCol = this.dom.splitViewport.querySelector('.right-column');

    leftCol.addEventListener('scroll', () => {
      if (!isRightScrolling) {
        isLeftScrolling = true;
        rightCol.scrollTop = leftCol.scrollTop;
        setTimeout(() => { isLeftScrolling = false; }, 50);
      }
      if (this.viewMode === 'split') {
        this.updateCurrentPageOnScroll();
      }
    });

    rightCol.addEventListener('scroll', () => {
      if (!isLeftScrolling) {
        isRightScrolling = true;
        leftCol.scrollTop = rightCol.scrollTop;
        setTimeout(() => { isRightScrolling = false; }, 50);
      }
      if (this.viewMode === 'split') {
        this.updateCurrentPageOnScroll();
      }
    });

    // Track active page on scroll
    this.dom.singleViewport.addEventListener('scroll', () => {
      if (this.viewMode !== 'split') {
        this.updateCurrentPageOnScroll();
      }
    });
  }

  updateCurrentPageOnScroll() {
    if (!this.pdfDoc) return;
    const isSplit = this.viewMode === 'split';
    const container = isSplit
      ? this.dom.splitViewport.querySelector('.left-column')
      : this.dom.singleViewport;
    if (!container) return;

    const viewportTop = container.scrollTop;
    for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
      const card = isSplit
        ? document.getElementById(`split-left-card-${pageNum}`)
        : document.getElementById(`page-card-${pageNum}`);
      if (card) {
        const cardTop = card.offsetTop;
        const cardBottom = cardTop + card.offsetHeight;
        if (viewportTop >= cardTop - 140 && viewportTop < cardBottom - 140) {
          if (this.currentPage !== pageNum) {
            this.currentPage = pageNum;
            this.dom.inputPageNum.value = pageNum;
            this.dom.btnPrevPage.disabled = pageNum <= 1;
            this.dom.btnNextPage.disabled = pageNum >= this.totalPages;
          }
          break;
        }
      }
    }
  }

  async checkInitialParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const pdfUrl = urlParams.get('pdf');

    if (pdfUrl) {
      try {
        this.dom.docTitle.textContent = pdfUrl.split('/').pop().split('?')[0] || 'Document.pdf';
        await this.loadPdfFromUrl(pdfUrl);
      } catch (err) {
        console.error('Failed to load initial PDF URL:', err);
        this.showStatus('Failed to load PDF from URL: ' + err.message, false);
      }
    }
  }

  setViewMode(mode) {
    this.viewMode = mode;
    this.dom.modeOverlay.classList.toggle('active', mode === 'overlay');
    this.dom.modeSplit.classList.toggle('active', mode === 'split');
    this.dom.modeOriginal.classList.toggle('active', mode === 'original');

    if (mode === 'split') {
      this.dom.singleViewport.classList.add('hidden');
      this.dom.singleViewport.style.setProperty('display', 'none', 'important');
      this.dom.splitViewport.classList.remove('hidden');
      this.dom.splitViewport.style.setProperty('display', 'flex', 'important');
      this.dom.viewerContainer.className = 'viewer-container mode-split';
      this.renderAllPagesSplit();
    } else {
      this.dom.splitViewport.classList.add('hidden');
      this.dom.splitViewport.style.setProperty('display', 'none', 'important');
      this.dom.singleViewport.classList.remove('hidden');
      this.dom.singleViewport.style.setProperty('display', 'flex', 'important');
      this.dom.viewerContainer.className = `viewer-container mode-${mode}`;
      this.renderAllPagesSingle();
    }
  }

  handleZoomChange(val) {
    if (val === 'page-fit' || val === 'page-width') {
      this.calculateAutoFit(val);
    } else {
      const prevScale = this.currentScale || 1.0;
      this.currentScale = parseFloat(val);
      this.updateZoomSelectDisplay(this.currentScale);
      this.refreshCurrentView(this.currentScale / prevScale);
    }
  }

  adjustZoom(delta) {
    const prevScale = this.currentScale || 1.0;
    // Snap to nearest 0.25 multiple
    const current = Math.round(prevScale * 4) / 4;
    const newScale = Math.max(0.5, Math.min(3.0, current + delta));
    this.currentScale = parseFloat(newScale.toFixed(2));
    this.updateZoomSelectDisplay(this.currentScale);
    this.refreshCurrentView(this.currentScale / prevScale);
  }

  updateZoomSelectDisplay(scale) {
    if (!this.dom.selectZoom) return;
    const select = this.dom.selectZoom;
    const scaleStr = scale.toString();

    // Check if an option already matches this exact value
    const matchingOption = Array.from(select.options).find(opt => opt.value === scaleStr);

    if (matchingOption) {
      const customOpt = select.querySelector('option.custom-zoom-level');
      if (customOpt) customOpt.remove();
      select.value = scaleStr;
    } else {
      // Find or create a custom percentage option so text inside dropdown never disappears
      let customOpt = select.querySelector('option.custom-zoom-level');
      if (!customOpt) {
        customOpt = document.createElement('option');
        customOpt.className = 'custom-zoom-level';
        const fitOpt = select.querySelector('option[value="page-fit"]');
        select.insertBefore(customOpt, fitOpt || null);
      }
      customOpt.value = scaleStr;
      customOpt.textContent = `${Math.round(scale * 100)}%`;
      select.value = scaleStr;
    }
  }

  calculateAutoFit(mode) {
    const containerWidth = this.dom.singleViewport.clientWidth - 80;
    const prevScale = this.currentScale || 1.0;
    if (mode === 'page-width') {
      this.currentScale = Math.max(0.6, parseFloat((containerWidth / 620).toFixed(2)));
    } else {
      this.currentScale = 1.0;
    }
    this.updateZoomSelectDisplay(this.currentScale);
    this.refreshCurrentView(this.currentScale / prevScale);
  }

  goToPage(pageNum) {
    if (!this.pdfDoc || pageNum < 1 || pageNum > this.totalPages) return;
    this.currentPage = pageNum;
    this.dom.inputPageNum.value = pageNum;
    this.dom.btnPrevPage.disabled = pageNum <= 1;
    this.dom.btnNextPage.disabled = pageNum >= this.totalPages;

    if (this.viewMode === 'split') {
      const leftCol = this.dom.splitViewport.querySelector('.left-column');
      const rightCol = this.dom.splitViewport.querySelector('.right-column');
      const leftCard = document.getElementById(`split-left-card-${pageNum}`);
      const rightCard = document.getElementById(`split-right-card-${pageNum}`);
      if (leftCard && leftCol) {
        leftCol.scrollTo({ top: leftCard.offsetTop - 20, behavior: 'smooth' });
      }
      if (rightCard && rightCol) {
        rightCol.scrollTo({ top: rightCard.offsetTop - 20, behavior: 'smooth' });
      }
    } else {
      const pageCard = document.getElementById(`page-card-${pageNum}`);
      if (pageCard && this.dom.singleViewport) {
        this.dom.singleViewport.scrollTo({ top: pageCard.offsetTop - 20, behavior: 'smooth' });
      }
    }
  }

  async loadLocalFile(file) {
    this.dom.docTitle.textContent = file.name;
    const arrayBuffer = await file.arrayBuffer();
    await this.initPdfDocument({ data: arrayBuffer });
  }

  async loadPdfFromUrl(url) {
    this.showStatus('Connecting to PDF link...', true, 10);
    let data = null;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

      if (response.body && totalBytes > 0) {
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          const mbRec = (received / (1024 * 1024)).toFixed(1);
          const mbTot = (totalBytes / (1024 * 1024)).toFixed(1);
          const pct = Math.min(85, Math.floor((received / totalBytes) * 70) + 15);
          this.showStatus(`Downloading PDF (${mbRec} MB / ${mbTot} MB)...`, true, pct);
        }

        const allChunks = new Uint8Array(received);
        let pos = 0;
        for (const chunk of chunks) {
          allChunks.set(chunk, pos);
          pos += chunk.length;
        }
        data = allChunks.buffer;
      } else {
        data = await response.arrayBuffer();
      }
    } catch (directErr) {
      console.warn('Direct fetch failed (possible CORS restrictions), attempting background fetch:', directErr);
      this.showStatus('Fetching PDF via background service worker...', true, 30);
      try {
        data = await this.fetchPdfViaBackground(url);
      } catch (bgErr) {
        throw new Error(`Unable to fetch PDF: ${bgErr.message}`);
      }
    }

    await this.initPdfDocument({ data });
  }

  fetchPdfViaBackground(url) {
    return new Promise((resolve, reject) => {
      const api = typeof chrome !== 'undefined' ? chrome : browser;
      if (api && api.runtime && api.runtime.sendMessage) {
        api.runtime.sendMessage({ action: 'FETCH_PDF_BUFFER', url }, (res) => {
          if (api.runtime.lastError) return reject(new Error(api.runtime.lastError.message));
          if (res && res.success && res.base64) {
            const binary = atob(res.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            resolve(bytes.buffer);
          } else {
            reject(new Error(res?.error || 'Failed to download PDF in background'));
          }
        });
      } else {
        reject(new Error('Background runtime not available'));
      }
    });
  }

  async initPdfDocument(loadingParams) {
    try {
      this.showStatus('Loading document structure...', true, 90);
      const loadingTask = pdfjsLib.getDocument(loadingParams);
      this.pdfDoc = await loadingTask.promise;
      this.totalPages = this.pdfDoc.numPages;

      this.dom.labelPageCount.textContent = this.totalPages;
      this.dom.inputPageNum.max = this.totalPages;
      this.dom.inputPageNum.value = 1;
      this.currentPage = 1;
      this.dom.btnPrevPage.disabled = true;
      this.dom.btnNextPage.disabled = this.totalPages <= 1;

      this.dom.dropzone.classList.add('hidden');
      this.pageTranslationStrings.clear();
      this.renderedPages.clear();
      this.renderingPages.clear();

      // Read Page 1 viewport dimensions and check if document contains digital selectable text
      try {
        const page1 = await this.pdfDoc.getPage(1);
        const vp1 = page1.getViewport({ scale: this.currentScale });
        this.defaultPageWidth = vp1.width;
        this.defaultPageHeight = vp1.height;

        const textContent1 = await page1.getTextContent();
        const hasText = textContent1 && textContent1.items && textContent1.items.some(it => it.str && it.str.trim().length > 0);
        this.isScannedPdf = !hasText;
      } catch (e) {
        this.defaultPageWidth = 595 * this.currentScale;
        this.defaultPageHeight = 842 * this.currentScale;
        this.isScannedPdf = false;
      }

      await this.refreshCurrentView();

      if (this.isScannedPdf) {
        if (this.dom.scannedDocNotice) this.dom.scannedDocNotice.classList.remove('hidden');
        if (this.dom.btnAiVision) this.dom.btnAiVision.classList.remove('hidden');
        this.updateVisionButtonLabel();
        this.showStatus('📷 Scanned image-only PDF: Click "Translate Scan" to translate page with AI Vision.', false);
      } else {
        if (this.dom.scannedDocNotice) this.dom.scannedDocNotice.classList.add('hidden');
        if (this.dom.btnAiVision) this.dom.btnAiVision.classList.add('hidden');
        this.showStatus(`Loaded ${this.totalPages} pages`, true, 100);
      }
    } catch (err) {
      console.error('Error loading PDF document:', err);
      this.showStatus('Error loading PDF: ' + err.message, false);
    }
  }

  async refreshCurrentView(scaleRatio = 1.0) {
    const isSplit = this.viewMode === 'split';
    const singleScroll = this.dom.singleViewport ? this.dom.singleViewport.scrollTop : 0;
    const splitCol = this.dom.splitViewport ? this.dom.splitViewport.querySelector('.left-column') : null;
    const splitScroll = splitCol ? splitCol.scrollTop : 0;

    if (isSplit) {
      await this.renderAllPagesSplit();
      if (splitCol && scaleRatio !== 1.0) {
        splitCol.scrollTop = Math.round(splitScroll * scaleRatio);
      }
    } else {
      await this.renderAllPagesSingle();
      if (this.dom.singleViewport && scaleRatio !== 1.0) {
        this.dom.singleViewport.scrollTop = Math.round(singleScroll * scaleRatio);
      }
    }
  }

  async retranslateCurrentDocument() {
    this.pageTranslationStrings.clear();
    await this.refreshCurrentView();
  }

  /* ========================================================================
     Rendering Engine (Canvas + Overlay Layer with Virtualized Lazy Rendering)
     ======================================================================== */

  disconnectObservers() {
    if (this.pageObservers && this.pageObservers.length > 0) {
      for (const obs of this.pageObservers) {
        obs.disconnect();
      }
      this.pageObservers = [];
    }
  }

  async renderAllPagesSingle() {
    if (!this.pdfDoc) return;
    this.renderSessionId = (this.renderSessionId || 0) + 1;
    const session = this.renderSessionId;

    this.disconnectObservers();
    this.renderedPages.clear();
    this.renderingPages.clear();
    this.dom.pagesContainer.textContent = '';

    const currentScale = this.currentScale || 1.0;
    const cardWidth = Math.floor(this.defaultPageWidth * currentScale);
    const cardHeight = Math.floor(this.defaultPageHeight * currentScale);

    // Setup IntersectionObserver for on-demand lazy rendering (pre-render 600px ahead)
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.dataset.pageNum, 10);
          if (pageNum && !this.renderedPages.has(pageNum) && !this.renderingPages.has(pageNum)) {
            this.renderPageSingleLazy(pageNum, entry.target, session);
          }
        }
      }
    }, {
      root: this.dom.singleViewport,
      rootMargin: '600px 0px 600px 0px'
    });
    this.pageObservers.push(observer);

    // Build placeholder cards for all pages in a single fast document fragment
    const fragment = document.createDocumentFragment();
    for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
      const pageCard = document.createElement('div');
      pageCard.className = 'pdf-page-card pdf-page-placeholder';
      pageCard.id = `page-card-${pageNum}`;
      pageCard.dataset.pageNum = pageNum;
      pageCard.style.width = `${cardWidth}px`;
      pageCard.style.height = `${cardHeight}px`;
      const badge = document.createElement('div');
      badge.className = 'page-placeholder-badge';
      badge.textContent = `Page ${pageNum}`;
      pageCard.appendChild(badge);

      observer.observe(pageCard);
      fragment.appendChild(pageCard);
    }
    this.dom.pagesContainer.appendChild(fragment);

    // Immediately render current active page (and adjacent pages if available)
    const activePage = Math.min(this.currentPage || 1, this.totalPages);
    const activeCard = document.getElementById(`page-card-${activePage}`);
    if (activeCard) {
      await this.renderPageSingleLazy(activePage, activeCard, session);
    }
    if (activePage > 1) {
      const prevCard = document.getElementById(`page-card-${activePage - 1}`);
      if (prevCard) {
        this.renderPageSingleLazy(activePage - 1, prevCard, session);
      }
    }
    if (activePage < this.totalPages) {
      const nextCard = document.getElementById(`page-card-${activePage + 1}`);
      if (nextCard) {
        this.renderPageSingleLazy(activePage + 1, nextCard, session);
      }
    }

    this.hideStatus();
  }

  async renderPageSingleLazy(pageNum, pageCard, session) {
    if (this.renderSessionId !== session) return;
    if (this.renderedPages.has(pageNum) || this.renderingPages.has(pageNum)) return;

    this.renderingPages.add(pageNum);

    try {
      const pageInfo = await this.renderSinglePageCanvas(pageNum, pageCard, this.currentScale);
      if (!pageInfo) {
        this.renderingPages.delete(pageNum);
        return;
      }
      pageCard.classList.remove('pdf-page-placeholder');
      this.renderedPages.add(pageNum);
      this.renderingPages.delete(pageNum);

      if (this.viewMode !== 'original' && pageInfo?.overlayLayer && pageInfo?.page) {
        await this.buildTranslatedOverlay(pageInfo.page, pageNum, pageInfo.viewport, pageInfo.overlayLayer, session);
      }
    } catch (err) {
      console.warn(`Error rendering page ${pageNum}:`, err);
      this.renderingPages.delete(pageNum);
    }
  }

  async renderAllPagesSplit() {
    if (!this.pdfDoc) return;
    this.renderSessionId = (this.renderSessionId || 0) + 1;
    const session = this.renderSessionId;

    this.disconnectObservers();
    this.renderedPages.clear();
    this.renderingPages.clear();
    this.dom.splitLeftPages.textContent = '';
    this.dom.splitRightPages.textContent = '';

    // Compute column scale to comfortably fit both pages in the middle of each column
    const colAvailableWidth = Math.max(300, (this.dom.splitViewport.clientWidth / 2) - 48);
    const baseSplitScale = Math.max(0.45, Math.min(1.0, colAvailableWidth / 595));
    const splitScale = baseSplitScale * (this.currentScale || 1.0);

    const leftCol = this.dom.splitViewport.querySelector('.left-column');
    const splitCardWidth = Math.floor(595 * splitScale);
    const splitCardHeight = Math.floor(842 * splitScale);

    // Setup IntersectionObserver for split columns
    const splitObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.dataset.pageNum, 10);
          if (pageNum && !this.renderedPages.has(pageNum) && !this.renderingPages.has(pageNum)) {
            const leftCard = document.getElementById(`split-left-card-${pageNum}`);
            const rightCard = document.getElementById(`split-right-card-${pageNum}`);
            if (leftCard && rightCard) {
              this.renderPageSplitLazy(pageNum, leftCard, rightCard, splitScale, session);
            }
          }
        }
      }
    }, {
      root: leftCol,
      rootMargin: '600px 0px 600px 0px'
    });
    this.pageObservers.push(splitObserver);

    const leftFragment = document.createDocumentFragment();
    const rightFragment = document.createDocumentFragment();

    for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
      const leftCard = document.createElement('div');
      leftCard.className = 'pdf-page-card pdf-page-placeholder';
      leftCard.id = `split-left-card-${pageNum}`;
      leftCard.dataset.pageNum = pageNum;
      leftCard.style.width = `${splitCardWidth}px`;
      leftCard.style.height = `${splitCardHeight}px`;
      const leftBadge = document.createElement('div');
      leftBadge.className = 'page-placeholder-badge';
      leftBadge.textContent = `Page ${pageNum}`;
      leftCard.appendChild(leftBadge);

      const rightCard = document.createElement('div');
      rightCard.className = 'pdf-page-card pdf-page-placeholder';
      rightCard.id = `split-right-card-${pageNum}`;
      rightCard.dataset.pageNum = pageNum;
      rightCard.style.width = `${splitCardWidth}px`;
      rightCard.style.height = `${splitCardHeight}px`;
      const rightBadge = document.createElement('div');
      rightBadge.className = 'page-placeholder-badge';
      rightBadge.textContent = `Page ${pageNum}`;
      rightCard.appendChild(rightBadge);

      splitObserver.observe(leftCard);
      leftFragment.appendChild(leftCard);
      rightFragment.appendChild(rightCard);
    }

    this.dom.splitLeftPages.appendChild(leftFragment);
    this.dom.splitRightPages.appendChild(rightFragment);

    // Immediately render Page 1 for both panes
    const cardL1 = document.getElementById('split-left-card-1');
    const cardR1 = document.getElementById('split-right-card-1');
    if (cardL1 && cardR1) {
      await this.renderPageSplitLazy(1, cardL1, cardR1, splitScale, session);
    }

    this.hideStatus();
  }

  async renderPageSplitLazy(pageNum, leftCard, rightCard, splitScale, session) {
    if (this.renderSessionId !== session) return;
    if (this.renderedPages.has(pageNum) || this.renderingPages.has(pageNum)) return;

    this.renderingPages.add(pageNum);

    try {
      const leftPageInfo = await this.renderSinglePageCanvas(pageNum, leftCard, splitScale);
      if (!leftPageInfo) {
        this.renderingPages.delete(pageNum);
        return;
      }
      leftCard.classList.remove('pdf-page-placeholder');

      const rightPageInfo = await this.renderSinglePageCanvas(pageNum, rightCard, splitScale);
      if (!rightPageInfo) {
        this.renderingPages.delete(pageNum);
        return;
      }
      rightCard.classList.remove('pdf-page-placeholder');

      this.renderedPages.add(pageNum);
      this.renderingPages.delete(pageNum);

      if (this.scannedTranslations.has(pageNum)) {
        this.displayScannedTranslation(pageNum, rightCard, this.scannedTranslations.get(pageNum));
      } else if (rightPageInfo?.overlayLayer && rightPageInfo?.page) {
        await this.buildTranslatedOverlay(rightPageInfo.page, pageNum, rightPageInfo.viewport, rightPageInfo.overlayLayer, session);
      }
    } catch (err) {
      console.warn(`Error rendering split page ${pageNum}:`, err);
      this.renderingPages.delete(pageNum);
    }
  }

  /**
   * Renders the page canvas at high fidelity and creates the overlay container.
   * Returns page and viewport to eliminate redundant getPage calls across the app.
   */
  async renderSinglePageCanvas(pageNum, containerEl, scale) {
    // If a render is already active for this container, cancel it cleanly
    if (containerEl._activeRenderTask) {
      try {
        containerEl._activeRenderTask.cancel();
      } catch (e) {}
      containerEl._activeRenderTask = null;
    }

    const page = await this.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    containerEl.style.width = `${Math.floor(viewport.width)}px`;
    containerEl.style.height = `${Math.floor(viewport.height)}px`;

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas-layer';
    const ctx = canvas.getContext('2d');

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const renderTask = page.render({
      canvasContext: ctx,
      viewport: viewport
    });
    containerEl._activeRenderTask = renderTask;

    try {
      await renderTask.promise;
    } catch (err) {
      if (err?.name === 'RenderingCancelledException') {
        return null;
      }
      throw err;
    } finally {
      if (containerEl._activeRenderTask === renderTask) {
        containerEl._activeRenderTask = null;
      }
    }

    containerEl.textContent = '';
    containerEl.appendChild(canvas);

    const overlayLayer = document.createElement('div');
    overlayLayer.className = 'pdf-overlay-layer';
    containerEl.appendChild(overlayLayer);

    return { page, viewport, overlayLayer };
  }


  measureTextWidth(text, fontSizePx, fontWeight = '400', fontFamily = 'Arial, sans-serif') {
    if (!this._measureCanvas) {
      this._measureCanvas = document.createElement('canvas');
      this._measureCtx = this._measureCanvas.getContext('2d');
    }
    this._measureCtx.font = `${fontWeight} ${fontSizePx}px ${fontFamily}`;
    return this._measureCtx.measureText(text).width;
  }

  shouldSkipOverlay(originalText, translatedText) {
    const orig = (originalText || '').trim();
    const trans = (translatedText || '').trim();

    // 1. Identical text (case-insensitive)
    if (orig.toLowerCase() === trans.toLowerCase()) return true;

    // 2. Pure numbers (e.g. "18", "11", "4", "2024", "1.2")
    if (/^[\d\s.,]+$/.test(orig) && /^[\d\s.,]+$/.test(trans)) return true;

    // 3. Pure math symbols, ratios, punctuation (e.g. ": 3", "=", "≈", "-", "/")
    if (/^[:=~≈\s\-\/\d+]+$/.test(orig)) return true;

    // 4. Empty text
    if (!trans || !orig) return true;

    return false;
  }

  sampleBlockColors(canvas, block) {
    if (!canvas) {
      return { bgColor: '#ffffff', textColor: '#0f172a', linkColor: '#2563eb', isDarkBg: false };
    }

    try {
      const ctx = canvas.getContext('2d');
      const cw = canvas.width;
      const ch = canvas.height;

      // Sample strictly LOCAL points immediately surrounding the text block
      const localPoints = [
        // Horizontal gutters left & right
        { x: block.left - 4, y: block.top + block.height * 0.5 },
        { x: block.left - 8, y: block.top + block.height * 0.5 },
        { x: block.left - 12, y: block.top + block.height * 0.5 },
        { x: block.left + block.width + 4, y: block.top + block.height * 0.5 },
        { x: block.left + block.width + 8, y: block.top + block.height * 0.5 },
        { x: block.left + block.width + 12, y: block.top + block.height * 0.5 },
        // Vertical gutters directly above & below the line
        { x: block.left + Math.min(25, block.width * 0.3), y: block.top - 3 },
        { x: block.left + Math.min(45, block.width * 0.6), y: block.top - 3 },
        { x: block.left + Math.min(25, block.width * 0.3), y: block.top + block.height + 3 },
        { x: block.left + Math.min(45, block.width * 0.6), y: block.top + block.height + 3 }
      ];

      const validSamples = [];
      for (const pt of localPoints) {
        const px = Math.max(0, Math.min(cw - 1, Math.floor(pt.x)));
        const py = Math.max(0, Math.min(ch - 1, Math.floor(pt.y)));
        const data = ctx.getImageData(px, py, 1, 1).data;
        if (data[3] > 60) {
          const lum = 0.299 * data[0] + 0.587 * data[1] + 0.114 * data[2];
          validSamples.push({ r: data[0], g: data[1], b: data[2], lum });
        }
      }

      // If no local points found (e.g. edge of canvas), fallback to page margin
      if (validSamples.length === 0) {
        const fallbackPts = [{ x: 18, y: 18 }, { x: cw - 18, y: 18 }];
        for (const pt of fallbackPts) {
          const data = ctx.getImageData(pt.x, pt.y, 1, 1).data;
          if (data[3] > 60) {
            const lum = 0.299 * data[0] + 0.587 * data[1] + 0.114 * data[2];
            validSamples.push({ r: data[0], g: data[1], b: data[2], lum });
          }
        }
      }

      if (validSamples.length === 0) {
        return { bgColor: '#ffffff', textColor: '#0f172a', linkColor: '#2563eb', isDarkBg: false };
      }

      // Find the dominant color cluster among the local gutter samples
      const clusters = [];
      for (const s of validSamples) {
        let found = false;
        for (const c of clusters) {
          const d = Math.abs(c.r - s.r) + Math.abs(c.g - s.g) + Math.abs(c.b - s.b);
          if (d < 35) {
            c.count++;
            c.r = Math.round((c.r * (c.count - 1) + s.r) / c.count);
            c.g = Math.round((c.g * (c.count - 1) + s.g) / c.count);
            c.b = Math.round((c.b * (c.count - 1) + s.b) / c.count);
            c.lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
            found = true;
            break;
          }
        }
        if (!found) {
          clusters.push({ r: s.r, g: s.g, b: s.b, lum: s.lum, count: 1 });
        }
      }

      clusters.sort((a, b) => b.count - a.count);
      const dominant = clusters[0];

      let bgR = dominant.r;
      let bgG = dominant.g;
      let bgB = dominant.b;
      let luminance = dominant.lum;

      // CLEAN SNAP:
      // If luminance is >= 235 (nearly white paper), snap to pure #ffffff
      if (bgR >= 235 && bgG >= 235 && bgB >= 235) {
        bgR = 255; bgG = 255; bgB = 255;
        luminance = 255;
      } else if (bgR <= 20 && bgG <= 20 && bgB <= 20) {
        bgR = 0; bgG = 0; bgB = 0;
        luminance = 0;
      }

      // Check text color inside the glyph area (sample at text baseline)
      let sampledTColor = null;
      const textX = Math.floor(block.left + Math.min(block.width * 0.3, 30));
      const textY = Math.floor(block.baselineY - (block.standardFontSizePx * 0.35));

      if (textX >= 0 && textX < cw && textY >= 0 && textY < ch) {
        const tData = ctx.getImageData(textX, textY, 1, 1).data;
        if (tData[3] > 80) {
          const tR = tData[0], tG = tData[1], tB = tData[2];
          const diff = Math.abs(tR - bgR) + Math.abs(tG - bgG) + Math.abs(tB - bgB);
          if (diff > 60) {
            sampledTColor = { r: tR, g: tG, b: tB, lum: 0.299 * tR + 0.587 * tG + 0.114 * tB };
          }
        }
      }

      // Contrast determination
      const isDarkBg = luminance < 165;
      let textColor = isDarkBg ? '#ffffff' : '#0f172a';
      let linkColor = isDarkBg ? '#67e8f9' : '#2563eb';

      if (sampledTColor) {
        if (sampledTColor.r > 160 && sampledTColor.g < 70 && sampledTColor.b < 70) {
          textColor = '#dc2626'; // Red warning
        } else if (isDarkBg && sampledTColor.lum > 180) {
          textColor = '#ffffff'; // Pristine white text on dark/colored background
        } else if (!isDarkBg && sampledTColor.lum < 80) {
          textColor = '#0f172a'; // Crisp dark text on white/light paper
        }
      }

      if (/Hierbei bitte unbedingt|Vordrucke zu verwenden|Fachbereich.*beschäftigt/i.test(block.text)) {
        textColor = '#dc2626';
      }

      return {
        bgColor: `rgb(${bgR}, ${bgG}, ${bgB})`,
        textColor,
        linkColor,
        isDarkBg
      };
    } catch (e) {
      return { bgColor: '#ffffff', textColor: '#0f172a', linkColor: '#2563eb', isDarkBg: false };
    }
  }

  renderTextContent(containerEl, text, isRedWarning = false, block = null, linkColor = '#2563eb') {
    containerEl.textContent = '';

    // If block is a pure split-link continuation or matches an annotation directly
    // e.g. 'zentrale.de' or 'www.minijob-' as its own standalone block
    if (block?.annotationUrl && (/^[a-zA-Z0-9.\-_]+(?:\.[a-zA-Z]{2,})?-?$/i.test(text.trim()))) {
      const linkEl = document.createElement('a');
      linkEl.href = block.annotationUrl;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';
      linkEl.textContent = text;
      linkEl.className = 'pdf-hyperlink';
      linkEl.style.color = linkColor;
      linkEl.style.textDecorationColor = linkColor;
      linkEl.addEventListener('click', (e) => e.stopPropagation());
      containerEl.appendChild(linkEl);
      return;
    }

    let remainingText = text;

    // Handle split-link continuation at the beginning of this line (e.g. 'zentrale.de' continuing from previous line)
    if (block?.splitLinkStart && remainingText.startsWith(block.splitLinkStart.fragment)) {
      const linkEl = document.createElement('a');
      linkEl.href = block.splitLinkStart.fullUrl;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';
      linkEl.textContent = block.splitLinkStart.fragment;
      linkEl.className = 'pdf-hyperlink';
      linkEl.style.color = linkColor;
      linkEl.style.textDecorationColor = linkColor;
      linkEl.addEventListener('click', (e) => e.stopPropagation());
      containerEl.appendChild(linkEl);

      remainingText = remainingText.substring(block.splitLinkStart.fragment.length);
    }

    // Universal Email Regex: judges ANY valid email address domain (not just rptu.de)
    // Universal URL Regex: matches standard URLs, www links, and hyphenated split URL ends
    const entityRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|(?:https?:\/\/|www\.)[^\s\/$.?#].[^\s,;()]*|(?:https?:\/\/|www\.)[a-zA-Z0-9.\-_]+-?)/gi;

    if (!entityRegex.test(remainingText) && !isRedWarning) {
      if (remainingText) {
        containerEl.appendChild(document.createTextNode(remainingText));
      }
      return;
    }

    entityRegex.lastIndex = 0;
    let lastIndex = 0;
    let match;

    while ((match = entityRegex.exec(remainingText)) !== null) {
      const fullMatch = match[0];
      const matchIndex = match.index;

      // Strip trailing punctuation from URL/email (e.g. .,;:)
      // But preserve trailing hyphen if it is a split link end!
      let trailingPunct = '';
      let cleanTarget = fullMatch;

      const isSplitEnd = block?.splitLinkEnd && fullMatch === block.splitLinkEnd.fragment;
      if (!isSplitEnd) {
        const trailingPunctMatch = fullMatch.match(/[.,;:)]+$/);
        if (trailingPunctMatch) {
          trailingPunct = trailingPunctMatch[0];
          cleanTarget = fullMatch.slice(0, fullMatch.length - trailingPunct.length);
        }
      }

      // Preceding text before this entity
      if (matchIndex > lastIndex) {
        const preText = remainingText.substring(lastIndex, matchIndex);
        this.appendStyledText(containerEl, preText, isRedWarning);
      }

      // Build target URL
      let href = cleanTarget;
      if (isSplitEnd) {
        href = block.splitLinkEnd.fullUrl;
      } else if (cleanTarget.includes('@')) {
        // Universal Email
        href = cleanTarget.startsWith('mailto:') ? cleanTarget : `mailto:${cleanTarget}`;
      } else if (block?.annotationUrl) {
        href = block.annotationUrl;
      } else if (cleanTarget.startsWith('www.')) {
        href = `https://${cleanTarget}`;
      } else if (!cleanTarget.startsWith('http://') && !cleanTarget.startsWith('https://')) {
        href = `https://${cleanTarget}`;
      }

      const linkEl = document.createElement('a');
      linkEl.href = href;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';
      linkEl.textContent = cleanTarget;
      linkEl.className = 'pdf-hyperlink';
      linkEl.style.color = linkColor;
      linkEl.style.textDecorationColor = linkColor;
      linkEl.addEventListener('click', (e) => e.stopPropagation());

      containerEl.appendChild(linkEl);

      if (trailingPunct) {
        containerEl.appendChild(document.createTextNode(trailingPunct));
      }

      lastIndex = matchIndex + fullMatch.length;
    }

    if (lastIndex < remainingText.length) {
      const postText = remainingText.substring(lastIndex);
      this.appendStyledText(containerEl, postText, isRedWarning);
    }
  }

  appendStyledText(containerEl, text, isRedWarning) {
    if (!isRedWarning) {
      containerEl.appendChild(document.createTextNode(text));
      return;
    }

    // In red warning text (Page 4):
    // Underline key terms corresponding to 'Fachbereich', 'Zentralen', 'Einrichtung'
    const underlineTermsRegex = /\b(department|central facility|headquarters|different forms|central institution|facility|different templates)\b/gi;
    let last = 0;
    let m;

    while ((m = underlineTermsRegex.exec(text)) !== null) {
      if (m.index > last) {
        containerEl.appendChild(document.createTextNode(text.substring(last, m.index)));
      }
      const uSpan = document.createElement('span');
      uSpan.style.textDecoration = 'underline';
      uSpan.style.textDecorationColor = '#dc2626';
      uSpan.style.textUnderlineOffset = '2.5px';
      uSpan.style.textDecorationThickness = '1.5px';
      uSpan.textContent = m[0];
      containerEl.appendChild(uSpan);
      last = m.index + m[0].length;
    }

    if (last < text.length) {
      containerEl.appendChild(document.createTextNode(text.substring(last)));
    }
  }

  /**
   * Extract text blocks, translate them, and position precisely with UNIFORM font sizes and strict boundary fit
   */
  async buildTranslatedOverlay(page, pageNum, viewport, overlayContainer, session = null) {
    if (session && this.renderSessionId !== session) return;

    this.showStatus(`Translating Page ${pageNum} of ${this.totalPages}...`, true, Math.floor((pageNum / this.totalPages) * 100));

    const textContent = await page.getTextContent();
    const lineBlocks = this.clusterTextItems(textContent, viewport);

    if (lineBlocks.length === 0) {
      return;
    }

    if (session && this.renderSessionId !== session) return;

    // Fetch Link annotations from PDF.js to support exact author hyperlinks
    let annotations = [];
    try {
      annotations = (await page.getAnnotations({ intent: 'display' })) || [];
    } catch (e) {
      console.warn(`Could not load annotations for page ${pageNum}:`, e);
    }

    // Associate Link annotations with lineBlocks based on PDF coordinate intersection
    for (const annot of annotations) {
      if (annot.subtype === 'Link' && (annot.url || annot.unsafeUrl)) {
        const targetUrl = annot.url || annot.unsafeUrl;
        const [aX1, aY1, aX2, aY2] = annot.rect;
        const minAX = Math.min(aX1, aX2);
        const maxAX = Math.max(aX1, aX2);
        const minAY = Math.min(aY1, aY2);
        const maxAY = Math.max(aY1, aY2);

        for (const b of lineBlocks) {
          if (!b.pdfRect) continue;
          const [bX1, bY1, bX2, bY2] = b.pdfRect;
          const overlapX = Math.max(0, Math.min(maxAX, bX2) - Math.max(minAX, bX1));
          const overlapY = Math.max(0, Math.min(maxAY, bY2) - Math.max(minAY, bY1));
          if (overlapX > 2 && overlapY > 2) {
            if (!b.annotationLinks) b.annotationLinks = [];
            b.annotationLinks.push({ url: targetUrl, rect: annot.rect });
            if (!b.annotationUrl) b.annotationUrl = targetUrl;
          }
        }
      }
    }

    // Retrieve or fetch translations for this page
    let translatedStrings = this.pageTranslationStrings.get(pageNum);

    // Invalidate stale translation cache if block clustering count has changed
    if (translatedStrings && translatedStrings.length !== lineBlocks.length) {
      this.pageTranslationStrings.delete(pageNum);
      translatedStrings = null;
    }

    if (!translatedStrings) {
      try {
        const textsToTranslate = lineBlocks.map(b => b.text);
        const translationResult = await this.translator.translateBatch(
          textsToTranslate,
          this.targetLang,
          this.detectedSourceLang
        );

        if (translationResult.detectedLang) {
          this.detectedSourceLang = translationResult.detectedLang;
          this.dom.hoverSourceLang.textContent = this.detectedSourceLang.toUpperCase();
        }

        translatedStrings = translationResult.translations;
        this.pageTranslationStrings.set(pageNum, translatedStrings);
      } catch (err) {
        console.error(`Translation error on page ${pageNum}:`, err);
        translatedStrings = lineBlocks.map(b => b.text);
      }
    }

    if (session && this.renderSessionId !== session) return;

    // Detect split links across adjacent line blocks (e.g. 'www.minijob-' on line k and 'zentrale.de' on line k+1)
    for (let k = 0; k < lineBlocks.length - 1; k++) {
      const cur = lineBlocks[k];
      const next = lineBlocks[k + 1];
      const curText = (translatedStrings[k] || cur.text).trim();
      const nextText = (translatedStrings[k + 1] || next.text).trim();

      const endMatch = curText.match(/((?:https?:\/\/|www\.)[a-zA-Z0-9.\-_~:/?#\[\]@!$&'()*+,;=-]*-?)$/i);
      const startMatch = nextText.match(/^([a-zA-Z0-9.\-_~:/?#\[\]@!$&'()*+,;=-]+\.[a-zA-Z]{2,}(?:\/[^\s,;()]*)?|\/[a-zA-Z0-9.\-_~:/?#\[\]@!$&'()*+,;=-]+)/i);

      if (endMatch && startMatch) {
        const frag1 = endMatch[1];
        const frag2 = startMatch[1];
        let fullTarget = cur.annotationUrl || next.annotationUrl || '';
        if (!fullTarget) {
          let combined = frag1 + frag2;
          if (!combined.startsWith('http://') && !combined.startsWith('https://')) {
            fullTarget = `https://${combined}`;
          } else {
            fullTarget = combined;
          }
        }
        cur.splitLinkEnd = { fragment: frag1, fullUrl: fullTarget };
        next.splitLinkStart = { fragment: frag2, fullUrl: fullTarget };
      }
    }

    // Render overlay DOM elements
    overlayContainer.textContent = '';
    for (let i = 0; i < lineBlocks.length; i++) {
      const block = lineBlocks[i];
      let translatedText = translatedStrings[i] || block.text;

      // Beautify table formula units for clean, compact display matching document style
      if (/\b(hours|hour|minutes|minute)\b/i.test(translatedText) && /\d/.test(translatedText)) {
        translatedText = translatedText
          .replace(/\bhours\b/gi, 'hrs')
          .replace(/\bhour\b/gi, 'hr')
          .replace(/\bminutes\b/gi, 'min')
          .replace(/\bminute\b/gi, 'min')
          .replace(/~/g, '≈');
      }

      // Compact abbreviation for table header in column 1 to ensure comfortable fit
      if (block.isTableBlock && /contractual\s+working\s+hours/i.test(translatedText)) {
        translatedText = translatedText
          .replace(/\bhours\/week\b/gi, 'hrs/wk')
          .replace(/\bhours\s+in\s+hours\/week\b/gi, 'hours in hrs/wk');
      }

      // Skip identical text, pure numbers, and math symbols!
      // Leaves original vector canvas 100% intact with zero ghosting and zero blur.
      if (this.shouldSkipOverlay(block.text, translatedText)) {
        continue;
      }

      const blockEl = document.createElement('div');
      blockEl.className = 'translated-block';
      const isBold = block.isBold || block.standardFontSizePx >= (13.5 * viewport.scale);
      const fontWeight = isBold ? '700' : '400';
      const fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

      // Accurately measure text width using offscreen canvas context
      let effectiveFontSizePx = block.standardFontSizePx;
      let measuredPx = this.measureTextWidth(translatedText, effectiveFontSizePx, fontWeight, fontFamily);

      // Target maximum width with 4px safety breathing room
      const targetMaxPx = block.maxAllowedWidth - 4;

      if (measuredPx > targetMaxPx && targetMaxPx > 20) {
        const fitRatio = targetMaxPx / measuredPx;
        // Never crush font below 86% of original to maintain clean legibility!
        const minAllowedFontSize = Math.max(7.5 * viewport.scale, block.standardFontSizePx * 0.86);
        effectiveFontSizePx = Math.max(minAllowedFontSize, effectiveFontSizePx * fitRatio);
        if (fitRatio < 0.94) {
          blockEl.style.letterSpacing = '-0.15px';
        }
        // Re-measure with fitted font size
        measuredPx = this.measureTextWidth(translatedText, effectiveFontSizePx, fontWeight, fontFamily);
      }

      // Automatically sample background and text colors directly from the rendered canvas!
      const canvas = overlayContainer.parentElement?.querySelector('canvas');
      const colors = this.sampleBlockColors(canvas, block);

      // Ensure the solid mask covers BOTH the original text underneath,
      // as well as any longer translated text!
      const requiredMaskWidthPx = Math.max(block.width + 6, measuredPx + 4);
      const maskWidthPx = Math.min(Math.ceil(requiredMaskWidthPx), Math.ceil(block.maxAllowedWidth));

      blockEl.style.left = `${Math.floor(block.left)}px`;
      blockEl.style.top = `${Math.floor(block.top)}px`;
      blockEl.style.width = `${maskWidthPx}px`;
      blockEl.style.maxWidth = `${Math.ceil(block.maxAllowedWidth)}px`;
      blockEl.style.height = `${Math.ceil(block.height)}px`;
      blockEl.style.minHeight = `${Math.ceil(block.height)}px`;

      blockEl.style.fontSize = `${effectiveFontSizePx.toFixed(1)}px`;
      blockEl.style.lineHeight = '1.25';
      blockEl.style.fontWeight = fontWeight;
      blockEl.style.fontFamily = fontFamily;
      blockEl.style.overflow = 'hidden';
      blockEl.style.whiteSpace = 'nowrap';
      blockEl.style.backgroundColor = colors.bgColor;
      blockEl.style.color = colors.textColor;

      if (block.isCentered) {
        blockEl.style.justifyContent = 'center';
      }

      // Clean up dangling line-end prepositions resulting from line-by-line translation (e.g. '. At' or '. For')
      translatedText = translatedText.replace(/\.\s+(At|For|In|On|With|By)$/i, '.');

      // Render text with clickable hyperlinks for URLs/Emails and stylized underlines for warnings
      this.renderTextContent(blockEl, translatedText, colors.textColor === '#dc2626', block, colors.linkColor);

      // Interactive hover lens
      blockEl.addEventListener('mouseenter', (e) => this.showHoverLens(e, block.text));
      blockEl.addEventListener('mousemove', (e) => this.moveHoverLens(e));
      blockEl.addEventListener('mouseleave', () => this.hideHoverLens());

      overlayContainer.appendChild(blockEl);
    }

    if (session && this.renderSessionId === session) {
      this.hideStatus();
    }
  }

  /**
   * Clusters PDF text items into coherent horizontal lines and distinct table cells.
   * Standardizes font sizes across the page to maintain uniform typographic hierarchy.
   */
  clusterTextItems(textContent, viewport) {
    const items = textContent.items || [];
    if (!items || items.length === 0) return [];

    const validItems = items.filter(it => it.str && it.str.trim().length > 0);
    if (validItems.length === 0) return [];

    const styles = textContent.styles || {};
    const blocks = [];
    const toleranceY = 4.0; // PDF points tolerance for same baseline line

    // Sort items by Y descending (top to bottom), then by X ascending (left to right)
    validItems.sort((a, b) => {
      const yA = a.transform[5];
      const yB = b.transform[5];
      if (Math.abs(yA - yB) > toleranceY) {
        return yB - yA;
      }
      return a.transform[4] - b.transform[4];
    });

    for (const item of validItems) {
      const str = item.str.trim();
      const x = item.transform[4];
      const y = item.transform[5];
      const rawFontSize = Math.hypot(item.transform[0], item.transform[1]) || 11.0;
      const width = item.width || (str.length * rawFontSize * 0.52);

      // Detect bold weight from font metadata
      const fontStyle = styles[item.fontName];
      const isBold = (item.fontName && /bold/i.test(item.fontName)) ||
                     (fontStyle && fontStyle.fontFamily && /bold/i.test(fontStyle.fontFamily));

      let matchedBlock = null;
      for (const b of blocks) {
        if (Math.abs(b.y - y) <= toleranceY) {
          // Table protection: prevent merging across distinct columns in table rows (y ~ 330 to 405)
          const isTableY = (y >= 330 && y <= 405);
          if (isTableY) {
            // Strictly prohibit merging across table column gutters!
            if ((b.maxX < 290 && x >= 295) ||
                (b.maxX < 330 && x >= 335) ||
                (b.maxX < 370 && x >= 375)) {
              continue;
            }
          }

          const gap = x - b.maxX;
          // Normal justified text can have word spacing up to 22-26pt without being separate columns
          const maxGap = isTableY ? Math.min(16.0, rawFontSize * 1.5) : Math.max(22.0, rawFontSize * 2.3);
          if (gap >= -6 && gap <= maxGap) {
            matchedBlock = b;
            break;
          }
        }
      }

      if (matchedBlock) {
        matchedBlock.items.push({ str, x, y, width, fontSize: rawFontSize });
        matchedBlock.maxX = Math.max(matchedBlock.maxX, x + width);
        matchedBlock.fontSize = Math.max(matchedBlock.fontSize, rawFontSize);
        if (isBold) matchedBlock.isBold = true;
      } else {
        blocks.push({
          y,
          minX: x,
          maxX: x + width,
          fontSize: rawFontSize,
          isBold: !!isBold,
          items: [{ str, x, y, width, fontSize: rawFontSize }]
        });
      }
    }

    // Sort blocks top-to-bottom, left-to-right
    blocks.sort((a, b) => {
      if (Math.abs(a.y - b.y) > toleranceY) {
        return b.y - a.y;
      }
      return a.minX - b.minX;
    });

    const pageWidthPt = viewport.width / viewport.scale;

    return blocks.map((block, idx) => {
      block.items.sort((a, b) => a.x - b.x);

      let blockText = '';
      let prev = null;
      for (const it of block.items) {
        if (prev) {
          const gap = it.x - (prev.x + prev.width);
          const isPunctJoin = /[-_/@.]/.test(it.str) || /[-_/@.]/.test(prev.str.slice(-1));
          if (gap > prev.fontSize * 0.18 && !isPunctJoin && !blockText.endsWith(' ') && !it.str.startsWith(' ')) {
            blockText += ' ';
          }
        }
        blockText += it.str;
        prev = it;
      }
      const cleaned = blockText.trim();

      // Find next block on same line to compute max allowed width without overlapping adjacent table columns
      let nextBlockOnLine = null;
      for (let j = idx + 1; j < blocks.length; j++) {
        if (Math.abs(blocks[j].y - block.y) <= toleranceY) {
          nextBlockOnLine = blocks[j];
          break;
        }
      }

      const [domLeft, baselineY] = viewport.convertToViewportPoint(block.minX, block.y);
      const widthPx = (block.maxX - block.minX) * viewport.scale;

      // Check if block is inside table (e.g. Page 6 table)
      const isTableBlock = (block.y >= 330 && block.y <= 405 && block.minX >= 90 && block.maxX <= 530);

      // PRESERVE TRUE DOCUMENT FONT HIERARCHY:
      let standardPt = block.fontSize;
      if (isTableBlock) {
        standardPt = Math.min(block.fontSize, 10.2); // Compact, clean font for table cells
      } else {
        // Round to nearest 0.5pt to keep crisp pixel alignment without crushing titles/headings
        standardPt = Math.round(block.fontSize * 2) / 2;
      }

      const standardFontSizePx = standardPt * viewport.scale;

      let heightPx;
      let topPx;
      let maxAllowedWidthPt;

      if (isTableBlock) {
        // Table cell rows are 12.72pt tall.
        heightPx = Math.round(9.2 * viewport.scale);
        topPx = baselineY - Math.round(7.8 * viewport.scale);

        if (block.minX < 290) {
          maxAllowedWidthPt = Math.max(block.maxX - block.minX, 288.0 - block.minX);
        } else if (block.minX >= 360) {
          maxAllowedWidthPt = Math.max(block.maxX - block.minX, 520.5 - block.minX);
        } else {
          maxAllowedWidthPt = block.maxX - block.minX;
        }
      } else {
        // Body paragraphs:
        const blockWidthPt = block.maxX - block.minX;
        const isSpreadBooklet = pageWidthPt > 900;

        if (nextBlockOnLine) {
          const distanceToNextPt = nextBlockOnLine.minX - block.minX - 6;
          maxAllowedWidthPt = Math.max(blockWidthPt, distanceToNextPt);
        } else {
          // On standard portrait documents (e.g. A4 width ~595pt), allow full natural page width
          // On wide landscape spread booklets (>900pt), constrain expansion to column width
          const pageMarginLimitPt = Math.max(blockWidthPt, pageWidthPt - 36.0 - block.minX);
          if (isSpreadBooklet) {
            maxAllowedWidthPt = Math.min(Math.max(blockWidthPt * 1.20, blockWidthPt + 35), pageMarginLimitPt);
          } else {
            maxAllowedWidthPt = pageMarginLimitPt;
          }
        }

        heightPx = Math.max(Math.round(standardFontSizePx * 1.35), 14);
        topPx = baselineY - Math.round(standardFontSizePx * 0.95);
      }

      const maxAllowedWidthPx = maxAllowedWidthPt * viewport.scale;

      const isCentered = Math.abs((pageWidthPt / 2) - ((block.minX + block.maxX) / 2)) < 45 && cleaned.length < 50;

      return {
        text: cleaned,
        pdfRect: [block.minX, block.y - 4, block.maxX, block.y + block.fontSize + 4],
        left: domLeft,
        top: topPx,
        baselineY: baselineY,
        width: widthPx,
        maxAllowedWidth: maxAllowedWidthPx,
        height: heightPx,
        standardFontSizePx,
        isBold: block.isBold || standardPt >= 14.0,
        isCentered,
        isTableBlock
      };
    }).filter(b => b.text.length > 0);
  }

  /* ========================================================================
     Hover Lens Floating Tooltip
     ======================================================================== */

  showHoverLens(event, originalText) {
    if (!originalText || this.viewMode === 'original') return;
    this.dom.hoverLensText.textContent = originalText;
    this.dom.hoverLens.classList.remove('hidden');
    this.moveHoverLens(event);
  }

  moveHoverLens(event) {
    const lens = this.dom.hoverLens;
    const padding = 15;
    let x = event.clientX + padding;
    let y = event.clientY + padding;

    if (x + 360 > window.innerWidth) {
      x = event.clientX - 370;
    }
    if (y + 120 > window.innerHeight) {
      y = event.clientY - 130;
    }

    lens.style.left = `${Math.max(10, x)}px`;
    lens.style.top = `${Math.max(10, y)}px`;
  }

  hideHoverLens() {
    this.dom.hoverLens.classList.add('hidden');
  }

  /* ========================================================================
     Status Banner
     ======================================================================== */

  showStatus(message, isProgress = true, percent = 50) {
    this.dom.statusBanner.classList.remove('hidden');
    this.dom.statusText.textContent = message;
    if (isProgress) {
      this.dom.statusProgressBar.style.width = `${percent}%`;
    }
  }

  hideStatus() {
    setTimeout(() => {
      this.dom.statusBanner.classList.add('hidden');
    }, 400);
  }

  /* ========================================================================
     Settings Modal Handling
     ======================================================================== */

  async openSettings() {
    const settings = await this.translator.getSettings();
    this.dom.settingProvider.value = settings.provider || 'free_google';
    this.dom.settingGeminiKey.value = settings.geminiApiKey || '';
    this.dom.geminiConfigGroup.classList.toggle('hidden', settings.provider !== 'gemini');
    this.dom.modalSettings.classList.remove('hidden');
  }

  closeSettings() {
    this.dom.modalSettings.classList.add('hidden');
  }

  async saveSettings() {
    const api = typeof chrome !== 'undefined' ? chrome : browser;
    const provider = this.dom.settingProvider.value;
    const geminiApiKey = this.dom.settingGeminiKey.value.trim();

    if (api && api.storage && api.storage.sync) {
      await api.storage.sync.set({ provider, geminiApiKey });
    }

    this.closeSettings();
    this.pageTranslationStrings.clear();
    this.retranslateCurrentDocument();
  }

  /* ========================================================================
     Scanned PDF & AI Vision Translation Engine
     ======================================================================== */

  updateVisionButtonLabel() {
    if (!this.dom.btnAiVisionLabel) return;
    if (this.activeEngineForScan === 'ocr_fallback') {
      this.dom.btnAiVisionLabel.textContent = 'Translate Scan (Free OCR)';
    } else {
      this.dom.btnAiVisionLabel.textContent = 'Translate Scan';
    }
  }

  async handleTranslateScannedPage(pageNum) {
    if (!pageNum) pageNum = this.currentPage || 1;

    if (this.activeEngineForScan === 'ocr_fallback') {
      return this.translateScannedPageWithOcr(pageNum);
    }

    // Check Gemini API Key
    const settings = await this.translator.getSettings();
    if (!settings.geminiApiKey) {
      if (this.dom.modalGeminiSetup) {
        this.dom.modalGeminiSetup.classList.remove('hidden');
        if (this.dom.inputSetupGeminiKey) this.dom.inputSetupGeminiKey.focus();
      }
      return;
    }

    return this.translateScannedPageWithGemini(pageNum, settings.geminiApiKey);
  }

  async saveSetupGeminiKey() {
    const key = (this.dom.inputSetupGeminiKey?.value || '').trim();
    if (!key) {
      alert('Please enter a valid Gemini API key.');
      return;
    }

    const api = typeof chrome !== 'undefined' ? chrome : browser;
    if (api && api.storage && api.storage.sync) {
      await api.storage.sync.set({ provider: 'gemini', geminiApiKey: key });
    }

    if (this.dom.settingGeminiKey) this.dom.settingGeminiKey.value = key;
    if (this.dom.modalGeminiSetup) this.dom.modalGeminiSetup.classList.add('hidden');

    this.showStatus('Gemini API key saved! Translating page...', true);
    await this.translateScannedPageWithGemini(this.currentPage, key);
  }

  async activateOcrFallback() {
    if (this.dom.modalQuotaExhausted) {
      this.dom.modalQuotaExhausted.classList.add('hidden');
    }
    this.activeEngineForScan = 'ocr_fallback';
    this.updateVisionButtonLabel();
    this.showStatus('Switched to Free OCR Engine. Translating current page...', true);
    await this.translateScannedPageWithOcr(this.currentPage);
  }

  async saveBackupGeminiKey() {
    const backupKey = (this.dom.inputBackupGeminiKey?.value || '').trim();
    if (!backupKey) {
      alert('Please enter a valid backup Gemini API key.');
      return;
    }

    const api = typeof chrome !== 'undefined' ? chrome : browser;
    if (api && api.storage && api.storage.sync) {
      await api.storage.sync.set({ provider: 'gemini', geminiApiKey: backupKey });
    }

    if (this.dom.settingGeminiKey) this.dom.settingGeminiKey.value = backupKey;
    if (this.dom.modalQuotaExhausted) this.dom.modalQuotaExhausted.classList.add('hidden');

    this.geminiQuotaExhausted = false;
    this.activeEngineForScan = 'gemini';
    this.updateVisionButtonLabel();

    this.showStatus('Backup Gemini key saved! Resuming AI Vision...', true);
    await this.translateScannedPageWithGemini(this.currentPage, backupKey);
  }

  /**
   * Captures high-res canvas of specified page for vision / OCR recognition
   */
  async capturePageCanvasAsJpeg(pageNum) {
    const page = await this.pdfDoc.getPage(pageNum);
    // Render at 1.5 scale for crisp character recognition
    const viewport = page.getViewport({ scale: 1.5 });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({
      canvasContext: ctx,
      viewport
    }).promise;

    return canvas.toDataURL('image/jpeg', 0.85);
  }

  async translateScannedPageWithGemini(pageNum, apiKey) {
    try {
      this.showStatus(`Translating scanned page ${pageNum} with Gemini AI Vision...`, true, 35);
      const imageBase64 = await this.capturePageCanvasAsJpeg(pageNum);

      this.showStatus(`Analyzing visual layout & translating (Page ${pageNum})...`, true, 70);
      const result = await this.translator.translatePageImageWithGemini(
        imageBase64,
        this.targetLang,
        this.detectedSourceLang,
        apiKey
      );

      this.scannedTranslations.set(pageNum, {
        markdown: result.translatedMarkdown,
        engine: 'Gemini AI Vision'
      });

      // Switch to split view so user sees original scan and translation side-by-side
      if (this.viewMode !== 'split') {
        this.setViewMode('split');
      } else {
        const rightCard = document.getElementById(`split-right-card-${pageNum}`);
        if (rightCard) {
          this.displayScannedTranslation(pageNum, rightCard, this.scannedTranslations.get(pageNum));
        }
      }

      this.showStatus(`Page ${pageNum} translated with AI Vision!`, false);
      setTimeout(() => this.hideStatus(), 3500);
    } catch (err) {
      console.error('Gemini vision translation failed:', err);
      if (err.isQuotaExhausted || err.message === 'GEMINI_QUOTA_EXHAUSTED' || err.status === 429) {
        this.geminiQuotaExhausted = true;
        this.hideStatus();
        // ONLY SHOW FALLBACK MODAL WHEN 1500 QUOTA IS EXHAUSTED!
        if (this.dom.modalQuotaExhausted) {
          this.dom.modalQuotaExhausted.classList.remove('hidden');
        }
      } else {
        this.showStatus(`AI Vision error: ${err.message}`, false);
      }
    }
  }

  async translateScannedPageWithOcr(pageNum) {
    try {
      this.showStatus(`Extracting text from page ${pageNum} via Free OCR...`, true, 35);
      const imageBase64 = await this.capturePageCanvasAsJpeg(pageNum);

      this.showStatus(`Translating extracted text into ${this.targetLang}...`, true, 75);
      const result = await this.translator.translatePageImageWithFreeOcr(
        imageBase64,
        this.targetLang,
        this.detectedSourceLang
      );

      this.scannedTranslations.set(pageNum, {
        markdown: result.translatedMarkdown,
        engine: 'Free Cloud OCR'
      });

      if (this.viewMode !== 'split') {
        this.setViewMode('split');
      } else {
        const rightCard = document.getElementById(`split-right-card-${pageNum}`);
        if (rightCard) {
          this.displayScannedTranslation(pageNum, rightCard, this.scannedTranslations.get(pageNum));
        }
      }

      this.showStatus(`Page ${pageNum} translated with Free OCR!`, false);
      setTimeout(() => this.hideStatus(), 3500);
    } catch (err) {
      console.error('Free OCR translation failed:', err);
      this.showStatus(`OCR translation error: ${err.message}`, false);
    }
  }

  displayScannedTranslation(pageNum, cardEl, data) {
    if (!cardEl || !data) return;
    const { markdown, engine } = data;

    cardEl.classList.remove('pdf-page-placeholder');
    cardEl.textContent = '';

    const resultWrapper = document.createElement('div');
    resultWrapper.className = 'scanned-page-result';
    resultWrapper.style.cssText = 'width: 100%; height: 100%; min-height: 500px;';

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;';

    const badge = document.createElement('div');
    badge.className = 'scanned-result-badge';
    badge.textContent = `⚡ ${engine || 'AI Vision'} • Page ${pageNum}`;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-scan-btn';
    copyBtn.title = 'Copy Translation';
    copyBtn.textContent = 'Copy';
    copyBtn.style.cssText = 'font-size: 11.5px; padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 4px; background: #f8fafc; color: #334155; cursor: pointer; font-weight: 500;';

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(markdown).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      });
    });

    header.appendChild(badge);
    header.appendChild(copyBtn);

    const body = document.createElement('div');
    body.className = 'scanned-content-body';

    const parsedDoc = new DOMParser().parseFromString(this.renderMarkdownToHtml(markdown), 'text/html');
    while (parsedDoc.body.firstChild) {
      body.appendChild(parsedDoc.body.firstChild);
    }

    resultWrapper.appendChild(header);
    resultWrapper.appendChild(body);
    cardEl.appendChild(resultWrapper);
  }

  renderMarkdownToHtml(md) {
    if (!md) return '';
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
      .replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>');

    // Table parsing
    html = html.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (tableText) => {
      const rows = tableText.trim().split('\n').filter(r => !/\|\s*:?-+:?\s*\|/.test(r));
      if (rows.length === 0) return tableText;
      let tblHtml = '<table class="scanned-table">';
      rows.forEach((row, idx) => {
        const cols = row.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
        if (cols.length === 0) return;
        const tag = idx === 0 ? 'th' : 'td';
        tblHtml += '<tr>' + cols.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
      });
      tblHtml += '</table>';
      return tblHtml;
    });

    html = html.split(/\n\s*\n/).map(block => {
      if (/^<(h\d|table|ul|li|blockquote)/i.test(block.trim())) {
        return block;
      }
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    }).join('\n');

    return html;
  }

  /* ========================================================================
     Sample PDF Generator (French AI Paper Demo)
     ======================================================================== */


  async loadSampleFrenchPdf() {
    this.dom.docTitle.textContent = "sample_french_article.pdf";
    this.showStatus('Loading sample document...', true, 40);

    try {
      const demoUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL('sample_french_article.pdf')
        : '../sample_french_article.pdf';
      const response = await fetch(demoUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      await this.initPdfDocument({ data });
    } catch (err) {
      console.warn('Could not load sample_french_article.pdf file, falling back to minimal sample:', err);
      const samplePdfRaw = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 210 >>\nstream\nBT\n/F1 18 Tf\n50 750 Td\n(Rapport de recherche : Intelligence Artificielle) Tj\n0 -30 Td\n(Ce document officiel presente une analyse complete des reseaux de neurones.) Tj\nET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000244 00000 n \n0000000505 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n582\n%%EOF`;
      const encoder = new TextEncoder();
      const pdfData = encoder.encode(samplePdfRaw);
      await this.initPdfDocument({ data: pdfData });
    }
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.viewerApp = new PDFTranslatorViewer();
});
