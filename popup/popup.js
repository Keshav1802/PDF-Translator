/**
 * Popup Script for PDF Translator Extension
 */

const getBrowser = () => (typeof chrome !== 'undefined' ? chrome : browser);

document.addEventListener('DOMContentLoaded', async () => {
  const browserApi = getBrowser();

  const tabStatusCard = document.getElementById('tab-status-card');
  const statusTitle = document.getElementById('status-title');
  const statusSub = document.getElementById('status-sub');
  const btnTranslateActive = document.getElementById('btn-translate-active-tab');
  const btnOpenViewer = document.getElementById('btn-open-viewer');
  const selectTargetLang = document.getElementById('popup-target-lang');

  let activePdfUrl = null;

  // Load saved target language preference
  if (browserApi.storage && browserApi.storage.sync) {
    browserApi.storage.sync.get({ targetLang: 'en' }, (items) => {
      if (items.targetLang) selectTargetLang.value = items.targetLang;
    });
  }

  // Handle target language change
  selectTargetLang.addEventListener('change', (e) => {
    if (browserApi.storage && browserApi.storage.sync) {
      browserApi.storage.sync.set({ targetLang: e.target.value });
    }
  });

  // Query active tab to check if a PDF is open
  try {
    const [activeTab] = await browserApi.tabs.query({ active: true, currentWindow: true });

    if (activeTab && activeTab.url) {
      const url = activeTab.url.toLowerCase();
      const isPdf = url.includes('.pdf') ||
                    url.startsWith('chrome-extension://') && url.includes('.pdf') ||
                    url.startsWith('file://') && url.includes('.pdf');

      if (isPdf) {
        activePdfUrl = activeTab.url;
        tabStatusCard.classList.add('pdf-found');
        
        let fileName = 'Current Tab PDF';
        try {
          const parts = activeTab.url.split('/');
          fileName = parts[parts.length - 1].split('?')[0] || fileName;
        } catch (e) {}

        statusTitle.textContent = fileName;
        statusSub.textContent = 'Ready to translate in new tab';
        btnTranslateActive.disabled = false;
      } else {
        statusTitle.textContent = 'No PDF in active tab';
        statusSub.textContent = 'Open a PDF or use viewer upload';
        btnTranslateActive.disabled = true;
      }
    }
  } catch (err) {
    console.error('Failed to query active tab:', err);
    statusTitle.textContent = 'PDF Translator Ready';
    statusSub.textContent = 'Open viewer to translate any PDF';
  }

  // Translate active PDF tab
  btnTranslateActive.addEventListener('click', () => {
    if (activePdfUrl) {
      const viewerUrl = browserApi.runtime.getURL(`viewer/viewer.html?pdf=${encodeURIComponent(activePdfUrl)}`);
      browserApi.tabs.create({ url: viewerUrl });
      window.close();
    }
  });

  // Open empty viewer
  btnOpenViewer.addEventListener('click', () => {
    const viewerUrl = browserApi.runtime.getURL('viewer/viewer.html');
    browserApi.tabs.create({ url: viewerUrl });
    window.close();
  });
});
