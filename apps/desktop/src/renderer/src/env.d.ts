/// <reference types="vite/client" />

import type { OperatorApi } from '../../preload/index.js';

declare global {
  interface Window {
    /** Exposed by the preload script. The renderer's entire view of the host. */
    operator: OperatorApi;
  }
}

// `<webview>` needs no declaration here: React's DOM types already ship
// `WebViewHTMLAttributes` for exactly this element. The ref is cast at the call
// site, because React types the instance as `HTMLWebViewElement` while Electron
// gives it the much richer `WebviewTag` interface.

export {};
