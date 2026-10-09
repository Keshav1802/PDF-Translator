# Privacy Policy for PDF Translator

**Last Updated:** October 9, 2026  
**Developer:** Keshav  
**Contact:** keshav.dev.contact@gmail.com  

---

## 1. Overview
PDF Translator ("the Extension") is committed to respecting and protecting user privacy. The extension operates with a **zero-telemetry, privacy-first architecture**: all PDF parsing, layout calculation, and document rendering take place locally inside your browser. We do not operate remote tracking servers, do not collect personal identities, and do not sell or monetize user data.

---

## 2. Information We Do NOT Collect
We do **not** collect, store, sell, or transmit any of the following:
- **Personal Identification Information (PII):** We do not collect names, email addresses, phone numbers, physical addresses, or account credentials.
- **Browsing History:** We do not track, log, or inspect your browsing activity or search history.
- **Financial or Payment Information:** We do not handle credit cards, transactions, or banking details.
- **Location Data:** We do not collect or monitor your GPS, IP-based geographic location, or device telemetry.
- **Analytics or Telemetry:** No third-party analytics SDKs (e.g., Google Analytics, Mixpanel, Firebase) are embedded in this extension.

---

## 3. How the Extension Works and Data Handling

### A. Document Processing (Local In-Memory)
When you open a PDF file with the Extension:
- Mozilla's open-source **PDF.js** library renders the vector graphics, canvases, and text coordinates strictly inside your browser's local memory.
- No PDF files or document contents are ever uploaded to any server operated by the developer.

### B. Translation Transmission
- To translate document text, text segments from the active PDF are transmitted over encrypted HTTPS directly to the translation API selected by the user (such as Google Translate or your user-configured Gemini API).
- This text is transmitted solely for the real-time translation request and is not stored, logged, or retained by the extension.
- If you provide your own Google Gemini API key for scanned OCR translation, that API key is saved solely within your local device's `chrome.storage.local`.

### C. Local Storage (`chrome.storage.local`)
The Extension uses your browser's local storage only to persist your interface preferences:
- Selected target language (e.g., English, Spanish, German).
- Preferred viewing mode (Split-view or Seamless Overlay).
- User-provided API keys (if configured).

This data never leaves your device and can be cleared at any time by uninstalling the extension or clearing extension data in your browser settings.

---

## 4. Permissions Disclosure & Justification

| Permission | Purpose |
| :--- | :--- |
| **`storage`** | Saves your preferred language and layout settings locally on your machine. |
| **`activeTab`** | Allows the extension to check if the current tab is displaying a PDF when clicked. |
| **`contextMenus`** | Enables the right-click "Translate this PDF" shortcut on web links. |
| **`tabs`** | Opens the translation viewer in a new tab and queries the active tab's URL to verify PDF format. |
| **`host_permissions` (`<all_urls>`)** | Allows fetching user-selected remote PDF documents across web sources and reaching translation API endpoints. |

---

## 5. Third-Party Services
The Extension may interact with the following third-party APIs based on user action:
- **Google Translate API / Google Gemini API:** Governed by Google's Privacy Policy at [https://policies.google.com/privacy](https://policies.google.com/privacy).

---

## 6. Security
All communications between your browser and translation endpoints use industry-standard Transport Layer Security (HTTPS/TLS). The extension does not load remote executable scripts, adhering strictly to Manifest V3 security requirements.

---

## 7. Changes to This Policy
If any feature changes require updates to this Privacy Policy, the revised document will be updated with a new revision date.

---

## 8. Contact Us
If you have any questions or feedback regarding this Privacy Policy, please contact:  
**Email:** keshav.dev.contact@gmail.com  
**Project:** PDF Translator Browser Extension  
