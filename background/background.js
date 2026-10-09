/**
 * Background Service Worker / Script for PDF Translator
 * Compatible with Chrome MV3 and Firefox MV3
 * Handles context menus, tab creation, and CORS-free translation fetches
 */

const getBrowser = () => (typeof chrome !== 'undefined' ? chrome : browser);

// Initialize context menus
getBrowser().runtime.onInstalled.addListener(() => {
  const browserApi = getBrowser();

  browserApi.contextMenus.create({
    id: 'translate-pdf-page',
    title: '🌐 Translate this PDF with PDF Translator',
    contexts: ['page', 'frame'],
    documentUrlPatterns: ['*://*/*.pdf*', 'file://*/*.pdf*']
  });

  browserApi.contextMenus.create({
    id: 'translate-pdf-link',
    title: '🌐 Translate linked PDF with PDF Translator',
    contexts: ['link'],
    targetUrlPatterns: ['*://*/*.pdf*', 'file://*/*.pdf*']
  });
});

// Handle context menu clicks
getBrowser().contextMenus.onClicked.addListener((info, tab) => {
  let targetPdfUrl = '';

  if (info.menuItemId === 'translate-pdf-link' && info.linkUrl) {
    targetPdfUrl = info.linkUrl;
  } else if (info.menuItemId === 'translate-pdf-page' && (tab.url || info.pageUrl)) {
    targetPdfUrl = tab.url || info.pageUrl;
  }

  if (targetPdfUrl) {
    openViewerWithPdf(targetPdfUrl);
  }
});

// Handle incoming messages (including CORS-bypassing background translation)
getBrowser().runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_VIEWER') {
    openViewerWithPdf(message.pdfUrl);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'OPEN_LOCAL_VIEWER') {
    const viewerUrl = getBrowser().runtime.getURL('viewer/viewer.html');
    getBrowser().tabs.create({ url: viewerUrl });
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'FETCH_PDF_BUFFER') {
    fetchPdfBufferInBg(message.url)
      .then((base64) => sendResponse({ success: true, base64 }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'TRANSLATE_BATCH') {
    executeBackgroundTranslation(message.texts, message.targetLang, message.sourceLang)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.action === 'PERFORM_OCR') {
    executeBackgroundOcr(message.base64Image, message.language)
      .then((parsedText) => sendResponse({ success: true, parsedText }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function fetchPdfBufferInBg(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function openViewerWithPdf(pdfUrl) {
  const browserApi = getBrowser();
  const viewerUrl = browserApi.runtime.getURL(`viewer/viewer.html?pdf=${encodeURIComponent(pdfUrl)}`);
  browserApi.tabs.create({ url: viewerUrl });
}

/**
 * Background translation runner (bypasses CORS restrictions)
 * Sends whole-page batches in single requests to avoid rate-limiting (429)
 */
async function executeBackgroundTranslation(texts, targetLang = 'en', sourceLang = 'auto') {
  if (!texts || texts.length === 0) {
    return { translations: [], detectedLang: sourceLang };
  }

  const delimiter = '\n[[[TR_SEP]]]\n';
  // Send up to 60 lines per chunk (allows full pages in 1 single request)
  const chunkSize = 60;
  const results = new Array(texts.length);
  let detectedLanguage = sourceLang;

  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunk = texts.slice(i, i + chunkSize);
    const joined = chunk.join(delimiter);

    try {
      const params = new URLSearchParams();
      params.append('client', 'gtx');
      params.append('sl', sourceLang || 'auto');
      params.append('tl', targetLang || 'en');
      params.append('dt', 't');
      params.append('q', joined);

      const response = await fetch('https://translate.googleapis.com/translate_a/single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!response.ok) {
        throw new Error(`Google Translate status ${response.status}`);
      }

      const json = await response.json();
      if (json[2]) detectedLanguage = json[2];

      let combined = '';
      if (json[0] && Array.isArray(json[0])) {
        for (const item of json[0]) {
          if (item && item[0]) combined += item[0];
        }
      }

      const splitParts = combined.split(/\s*\[\[\[TR_SEP\]\]\]\s*/g).map(p => p.trim());

      if (splitParts.length === chunk.length) {
        for (let j = 0; j < chunk.length; j++) {
          results[i + j] = splitParts[j];
        }
      } else {
        // Fallback: translate chunk items individually with small pause
        for (let j = 0; j < chunk.length; j++) {
          results[i + j] = await translateSingleInBg(chunk[j], targetLang, sourceLang);
          await sleep(50);
        }
      }
    } catch (err) {
      console.warn('Batch chunk failed, attempting individual item translations:', err);
      for (let j = 0; j < chunk.length; j++) {
        try {
          results[i + j] = await translateSingleInBg(chunk[j], targetLang, sourceLang);
          await sleep(50);
        } catch (e) {
          results[i + j] = chunk[j];
        }
      }
    }

    // Gentle 100ms throttle between multi-chunks to prevent rate limiting
    if (i + chunkSize < texts.length) {
      await sleep(100);
    }
  }

  return {
    translations: results,
    detectedLang: detectedLanguage
  };
}

async function translateSingleInBg(text, targetLang, sourceLang) {
  if (!text || !text.trim() || /^[\d\s\p{P}]+$/u.test(text.trim())) {
    return text;
  }
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceLang || 'auto')}&tl=${encodeURIComponent(targetLang || 'en')}&dt=t&q=${encodeURIComponent(text)}`;
  const resp = await fetch(url);
  if (!resp.ok) return text;
  const json = await resp.json();
  let translated = '';
  if (json[0] && Array.isArray(json[0])) {
    for (const item of json[0]) {
      if (item && item[0]) translated += item[0];
    }
  }
  return translated || text;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function executeBackgroundOcr(base64Image, language = 'chs') {
  const langMap = {
    'zh-CN': 'chs', 'zh': 'chs', 'zh-TW': 'cht',
    'ja': 'jpn', 'ko': 'kor', 'fr': 'fre', 'de': 'ger',
    'es': 'spa', 'ru': 'rus', 'ar': 'ara', 'it': 'ita', 'pt': 'por'
  };
  const ocrLang = langMap[language] || 'chs';

  const formData = new URLSearchParams();
  formData.append('base64Image', base64Image);
  formData.append('language', ocrLang);
  formData.append('isOverlayRequired', 'false');
  formData.append('OCREngine', '2');
  formData.append('apikey', 'helloworld');

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString()
  });

  if (!response.ok) {
    throw new Error(`OCR service returned HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.IsErroredOnProcessing) {
    throw new Error(json.ErrorMessage?.[0] || 'OCR processing error');
  }

  const parsedText = json.ParsedResults?.[0]?.ParsedText || '';
  return parsedText;
}
