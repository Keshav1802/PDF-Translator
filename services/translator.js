/**
 * Translation Service for PDF Translator Extension
 * Delegates translation requests to background service worker to guarantee zero CORS issues
 */

// Pre-compiled regex patterns for optimal performance across whole-document translations
const RE_EMAIL = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi;
const RE_URL = /(?:https?:\/\/|ftp:\/\/)[^\s]+|(?:www\.)[a-zA-Z0-9.-]+(?:\/[^\s]*)?/gi;
const RE_STANDALONE_DOMAIN = /\b[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi;
const RE_URL_HYPHEN_END = /(?:https?:\/\/|www\.)[a-zA-Z0-9.\-_]+-?/gi;
const RE_DELIMITERS = /[\s;,|•\-.:<>()"'«»\/]+/g;

class TranslationService {
  constructor() {
    this.cache = new Map();
  }

  async getSettings() {
    return new Promise((resolve) => {
      const api = typeof chrome !== 'undefined' ? chrome : browser;
      if (api && api.storage && api.storage.sync) {
        api.storage.sync.get({
          targetLang: 'en',
          sourceLang: 'auto',
          provider: 'free_google',
          geminiApiKey: '',
          geminiModel: 'gemini-1.5-flash'
        }, resolve);
      } else {
        resolve({
          targetLang: 'en',
          sourceLang: 'auto',
          provider: 'free_google',
          geminiApiKey: '',
          geminiModel: 'gemini-1.5-flash'
        });
      }
    });
  }

  /**
   * Universal check if text is solely made of emails, URLs, domain fragments, and formatting punctuation.
   * Pure entity blocks must NEVER be translated to prevent any modification or mangling.
   */
  isPureEntityText(text) {
    if (!text) return false;
    let t = text.trim();
    // Remove universal emails (any domain)
    t = t.replace(RE_EMAIL, '');
    // Remove full URLs
    t = t.replace(RE_URL, '');
    // Remove standalone domains or domain fragments (e.g. 'zentrale.de')
    t = t.replace(RE_STANDALONE_DOMAIN, '');
    // Remove URL fragments ending with '-' (e.g. 'www.minijob-')
    t = t.replace(RE_URL_HYPHEN_END, '');
    // Remove delimiters and formatting punctuation
    t = t.replace(RE_DELIMITERS, '');
    return t.length === 0;
  }

  /**
   * Mask emails, URLs, and split-link fragments with inert tokens before translation.
   * Judges any valid email domain dynamically (not only rptu.de).
   */
  maskEntities(text, placeholderList, isSplitLinkStart = false, splitStartFragment = '') {
    if (!text) return text;
    let masked = text;

    // If this line starts with a split-link continuation from preceding line (e.g. 'zentrale.de')
    if (isSplitLinkStart && splitStartFragment && masked.startsWith(splitStartFragment)) {
      const key = `XYZURL${placeholderList.length}XYZ`;
      placeholderList.push({ key, original: splitStartFragment });
      masked = key + masked.substring(splitStartFragment.length);
    }

    // 1. Mask universal email addresses (judges ANY valid email domain)
    masked = masked.replace(RE_EMAIL, (match) => {
      const key = `XYZMAIL${placeholderList.length}XYZ`;
      placeholderList.push({ key, original: match });
      return key;
    });

    // 2. Mask full URLs and web addresses
    masked = masked.replace(RE_URL, (match) => {
      const punctMatch = match.match(/[.,;:)]+$/);
      const punct = punctMatch ? punctMatch[0] : '';
      const clean = match.slice(0, match.length - punct.length);
      const key = `XYZURL${placeholderList.length}XYZ`;
      placeholderList.push({ key, original: clean });
      return key + punct;
    });

    // 3. Mask hyphenated split link endings (e.g. 'www.minijob-')
    masked = masked.replace(/(?:https?:\/\/|www\.)[a-zA-Z0-9.\-_]+-/gi, (match) => {
      const key = `XYZURL${placeholderList.length}XYZ`;
      placeholderList.push({ key, original: match });
      return key;
    });

    return masked;
  }

  /**
   * Restore masked entities from tokens back to their exact original text
   */
  unmaskEntities(text, placeholderList) {
    if (!placeholderList || placeholderList.length === 0 || !text) return text;
    let unmasked = text;
    for (const item of placeholderList) {
      // Regex handles any potential whitespace introduced by translation engines (e.g. 'XYZMAIL 0 XYZ')
      const numPart = item.key.replace(/\D/g, '');
      const re = new RegExp(`(?:XYZMAIL|XYZURL)\\s*${numPart}\\s*XYZ`, 'gi');
      unmasked = unmasked.replace(re, item.original);
      // Fallback exact replace
      unmasked = unmasked.split(item.key).join(item.original);
    }
    return unmasked;
  }

  /**
   * Translate an array of text lines/sentences
   */
  async translateBatch(texts, targetLang = 'en', sourceLang = 'auto') {
    if (!texts || texts.length === 0) {
      return { translations: [], detectedLang: sourceLang };
    }

    const settings = await this.getSettings();
    const effectiveTargetLang = targetLang || settings.targetLang || 'en';
    const effectiveSourceLang = sourceLang || settings.sourceLang || 'auto';

    const results = new Array(texts.length);
    const toTranslateIndices = [];
    const toTranslateTexts = [];
    const placeholderMap = new Map(); // originalIdx -> placeholderList

    // Pre-detect split links across adjacent lines (e.g. 'www.minijob-' on line k and 'zentrale.de' on line k+1)
    const splitStarts = new Map();
    for (let k = 0; k < texts.length - 1; k++) {
      const line1 = (texts[k] || '').trim();
      const line2 = (texts[k + 1] || '').trim();
      const endMatch = line1.match(/((?:https?:\/\/|www\.)[a-zA-Z0-9.\-_~:/?#\[\]@!$&'()*+,;=-]*-?)$/i);
      const startMatch = line2.match(/^([a-zA-Z0-9.\-_~:/?#\[\]@!$&'()*+,;=-]+\.[a-zA-Z]{2,}(?:\/[^\s,;()]*)?|\/[a-zA-Z0-9.\-_~:/?#\[\]@!$&'()*+,;=-]+)/i);
      if (endMatch && startMatch) {
        splitStarts.set(k + 1, startMatch[1]);
      }
    }

    for (let i = 0; i < texts.length; i++) {
      const rawText = texts[i];
      const trimmed = (rawText || '').trim();

      // If text is purely numbers, punctuation, dots or whitespace
      if (!trimmed || /^[\d\s\p{P}]+$/u.test(trimmed)) {
        results[i] = rawText;
        continue;
      }

      // If text is purely emails, URLs, or link fragments -> NEVER translate, keep 100% intact!
      if (this.isPureEntityText(trimmed)) {
        results[i] = rawText;
        continue;
      }

      const cacheKey = `${effectiveSourceLang}:${effectiveTargetLang}:${trimmed}`;
      if (this.cache.has(cacheKey)) {
        results[i] = this.cache.get(cacheKey);
      } else {
        const placeholders = [];
        const isSplitStart = splitStarts.has(i);
        const splitFrag = splitStarts.get(i) || '';
        const maskedText = this.maskEntities(trimmed, placeholders, isSplitStart, splitFrag);

        toTranslateIndices.push(i);
        toTranslateTexts.push(maskedText);
        placeholderMap.set(i, placeholders);
      }
    }

    if (toTranslateTexts.length === 0) {
      return { translations: results, detectedLang: effectiveSourceLang };
    }

    let detectedLang = effectiveSourceLang;

    // Use Gemini if configured and chosen
    if (settings.provider === 'gemini' && settings.geminiApiKey) {
      try {
        const geminiRes = await this.translateWithGemini(
          toTranslateTexts,
          effectiveTargetLang,
          effectiveSourceLang,
          settings.geminiApiKey,
          settings.geminiModel
        );
        for (let j = 0; j < toTranslateIndices.length; j++) {
          const originalIdx = toTranslateIndices[j];
          const placeholders = placeholderMap.get(originalIdx) || [];
          let translatedVal = geminiRes.translations[j] || toTranslateTexts[j];
          translatedVal = this.unmaskEntities(translatedVal, placeholders);
          results[originalIdx] = translatedVal;
          this.cache.set(`${effectiveSourceLang}:${effectiveTargetLang}:${(texts[originalIdx] || '').trim()}`, translatedVal);
        }
        return { translations: results, detectedLang: geminiRes.detectedLang || effectiveSourceLang };
      } catch (err) {
        console.warn('Gemini translation failed, falling back to background Google Translate:', err);
      }
    }

    // Call background service worker (Bypasses CORS restrictions completely)
    try {
      const bgResult = await this.callBackgroundTranslate(toTranslateTexts, effectiveTargetLang, effectiveSourceLang);
      if (bgResult && bgResult.translations) {
        if (bgResult.detectedLang) detectedLang = bgResult.detectedLang;

        for (let k = 0; k < toTranslateIndices.length; k++) {
          const originalIdx = toTranslateIndices[k];
          const placeholders = placeholderMap.get(originalIdx) || [];
          let translatedVal = bgResult.translations[k] || toTranslateTexts[k];
          translatedVal = this.unmaskEntities(translatedVal, placeholders);
          results[originalIdx] = translatedVal;
          this.cache.set(`${effectiveSourceLang}:${effectiveTargetLang}:${(texts[originalIdx] || '').trim()}`, translatedVal);
        }
      }
    } catch (bgErr) {
      console.error('Background translation call failed, using direct fallback:', bgErr);
      // Fallback if background script is unreachable
      for (let k = 0; k < toTranslateIndices.length; k++) {
        const originalIdx = toTranslateIndices[k];
        const placeholders = placeholderMap.get(originalIdx) || [];
        let fallbackVal = toTranslateTexts[k];
        fallbackVal = this.unmaskEntities(fallbackVal, placeholders);
        results[originalIdx] = fallbackVal;
      }
    }

    // Fill remaining items
    for (let i = 0; i < results.length; i++) {
      if (results[i] === undefined) {
        results[i] = texts[i];
      }
    }

    return { translations: results, detectedLang };
  }

  /**
   * Send message to background script to fetch translation without CORS
   */
  callBackgroundTranslate(texts, targetLang, sourceLang) {
    return new Promise((resolve, reject) => {
      const api = typeof chrome !== 'undefined' ? chrome : browser;
      if (api && api.runtime && api.runtime.sendMessage) {
        api.runtime.sendMessage(
          {
            action: 'TRANSLATE_BATCH',
            texts,
            targetLang,
            sourceLang
          },
          (response) => {
            if (api.runtime.lastError) {
              return reject(new Error(api.runtime.lastError.message));
            }
            if (response && response.success) {
              resolve(response.data);
            } else {
              reject(new Error(response?.error || 'Unknown translation error'));
            }
          }
        );
      } else {
        reject(new Error('Extension runtime not available'));
      }
    });
  }

  /**
   * Gemini 1.5 Flash translation
   */
  async translateWithGemini(texts, targetLang, sourceLang, apiKey, modelName = 'gemini-1.5-flash') {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    const prompt = `You are a high-precision professional document translation engine.
Translate the following JSON array of strings into '${targetLang}' (source language is '${sourceLang}').
Guidelines:
1. Maintain exact semantic meaning, technical terms, and document tone.
2. Maintain numbers, formulas, punctuation, and formatting dots intact.
3. Return ONLY a valid JSON array of translated strings with exactly ${texts.length} items.

Input:
${JSON.stringify(texts)}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      throw new Error(`Gemini API error: ${resp.status}`);
    }

    const data = await resp.json();
    const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) throw new Error('No candidate content received from Gemini');

    let parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) {
      parsed = Object.values(parsed)[0];
    }

    return {
      translations: Array.isArray(parsed) ? parsed : texts,
      detectedLang: sourceLang
    };
  }

  /**
   * Multimodal AI Vision Page Translation via Gemini 1.5 Flash
   * Translates entire scanned page image into target language formatted Markdown/Text
   */
  async translatePageImageWithGemini(imageBase64, targetLang = 'en', sourceLang = 'auto', apiKey, modelName = 'gemini-1.5-flash') {
    if (!apiKey) {
      throw new Error('NO_API_KEY');
    }

    const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const prompt = `You are a high-precision document translation engine.
Transcribe and translate all text, headings, dialogs, captions, and tables visible in this scanned document page into '${targetLang}' (source language is '${sourceLang}').
Guidelines:
1. Maintain the natural reading flow and layout structure of the page.
2. Group content clearly with headings (###), paragraphs, dialog lines, and markdown tables.
3. Keep all numbers, formulas, dates, and punctuation accurate.
4. Output cleanly formatted Markdown.`;

    const body = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: cleanBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.15
      }
    };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      let errDetails = '';
      try {
        const errJson = await resp.json();
        errDetails = errJson.error?.message || errJson.error?.status || '';
      } catch (e) {}

      const isQuota = resp.status === 429 ||
                      errDetails.includes('RESOURCE_EXHAUSTED') ||
                      errDetails.toLowerCase().includes('quota') ||
                      errDetails.toLowerCase().includes('rate limit');

      const err = new Error(isQuota ? 'GEMINI_QUOTA_EXHAUSTED' : `Gemini Vision error: ${resp.status} ${errDetails}`);
      err.status = resp.status;
      err.isQuotaExhausted = isQuota;
      throw err;
    }

    const data = await resp.json();
    const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) throw new Error('No translation content received from Gemini Vision');

    return {
      translatedMarkdown: candidate.trim(),
      sourceLang,
      targetLang
    };
  }

  /**
   * Free OCR Fallback: Extracts text via background OCR and translates via Google Translate
   */
  async translatePageImageWithFreeOcr(imageBase64, targetLang = 'en', sourceLang = 'auto') {
    return new Promise((resolve, reject) => {
      const api = typeof chrome !== 'undefined' ? chrome : browser;
      if (!api || !api.runtime || !api.runtime.sendMessage) {
        return reject(new Error('Extension runtime not available'));
      }

      api.runtime.sendMessage(
        {
          action: 'PERFORM_OCR',
          base64Image: imageBase64,
          language: sourceLang
        },
        async (response) => {
          if (api.runtime.lastError) {
            return reject(new Error(api.runtime.lastError.message));
          }
          if (!response || !response.success) {
            return reject(new Error(response?.error || 'OCR recognition failed'));
          }

          const rawText = (response.parsedText || '').trim();
          if (!rawText) {
            return resolve({
              translatedMarkdown: '*(No legible text detected on this scanned page)*',
              originalText: ''
            });
          }

          const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          try {
            const trRes = await this.translateBatch(lines, targetLang, sourceLang);
            const translatedMarkdown = trRes.translations.join('\n\n');
            resolve({
              translatedMarkdown,
              originalText: rawText,
              sourceLang: trRes.detectedLang || sourceLang,
              targetLang
            });
          } catch (trErr) {
            reject(trErr);
          }
        }
      );
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TranslationService;
} else if (typeof window !== 'undefined') {
  window.TranslationService = TranslationService;
}
