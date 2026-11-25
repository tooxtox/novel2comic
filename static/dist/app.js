"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // static/src/modules/state.ts
  var state = {
    // ===== 业务状态 =====
    currentSegments: { pages: [] },
    generatedImages: {},
    isGenerating: false,
    characters: [],
    batchPaused: false,
    batchStopRequested: false,
    fullPageImages: {},
    combinedPageImages: {},
    fullPageCleanImages: {},
    fullPageBubbles: {},
    progressInterval: null,
    currentWritingId: (typeof localStorage !== "undefined" ? localStorage.getItem("writing_id") : null) || null,
    // ===== 漫画转小说 =====
    comicUploadedImages: [],
    comicNovelResult: null,
    // ===== Tab / 模式 =====
    tabs: ["input", "aiwrite", "characters", "segments", "gallery", "history", "comic2novel"],
    currentTab: "input",
    CONCURRENT_LIMIT: 3,
    MAX_RETRIES: 3,
    // ===== 风格 / 模式开关 =====
    selectedPresetIds: /* @__PURE__ */ new Set(),
    customStyleTags: [],
    comicMode: "bw",
    bubbleRenderMode: "pil",
    // ===== 气泡类型枚举 =====
    BUBBLE_TYPES: ["dialogue", "thought", "shout", "whisper", "burst", "narration", "box", "caption"],
    BUBBLE_TYPE_LABELS: {
      dialogue: "\u25CB dialogue",
      thought: "\u25CC thought",
      shout: "\u203B shout",
      whisper: "\xB7 whisper",
      burst: "\u26A1 burst",
      narration: "\u25AD narration",
      box: "\u25A2 box",
      caption: "\u25B2 caption"
    },
    // ===== 内部 flag / 缓存 =====
    _historySub: "comic",
    _plotOptions: [],
    _polishScope: "aiwrite",
    _polishStyles: [],
    _polishOriginal: "",
    _polishResult: "",
    _textSyncing: false,
    _bubbleEditorReposition: null,
    _deviceResizeTimer: null,
    // ===== 作品元信息 (init 在 workMetaInit 中读 localStorage) =====
    workMeta: { title: "", savedAt: "", dirty: false },
    // ===== PRIMARY_ACTIONS: 占位, 由 workspace 模块填充函数引用 =====
    primaryActions: {}
  };
  var STYLE_PRESETS = [
    // ===== 日漫 =====
    { id: "acg", label: "\u65E5\u5F0FACG", category: "\u65E5\u6F2B", tags: "japanese anime style, ACG anime aesthetic, clean cel shading, smooth lineart, expressive anime eyes, bishounen and moe character design" },
    { id: "shonen", label: "\u70ED\u8840\u5C11\u5E74", category: "\u65E5\u6F2B", tags: "shonen manga style, dynamic action lines, intense expressions, speed lines" },
    { id: "shojo", label: "\u5C11\u5973\u6F2B\u753B", category: "\u65E5\u6F2B", tags: "shojo manga style, soft lines, sparkles, romantic, delicate features" },
    { id: "seinen", label: "\u9752\u5E74\u5411", category: "\u65E5\u6F2B", tags: "seinen manga style, realistic proportions, detailed anatomy, mature" },
    { id: "chibi", label: "Q\u7248", category: "\u65E5\u6F2B", tags: "chibi style, super deformed, 2-head body proportion, cute, simplified" },
    { id: "gag", label: "\u641E\u7B11", category: "\u65E5\u6F2B", tags: "gag manga style, exaggerated expressions, comedic, simple lines" },
    { id: "horror", label: "\u6050\u6016", category: "\u65E5\u6F2B", tags: "horror manga style, grotesque, unsettling, dark atmosphere, psychological" },
    // ===== 美漫 =====
    { id: "american_comic", label: "\u7ECF\u5178\u7F8E\u6F2B", category: "\u7F8E\u6F2B", tags: "american comic book style, bold outlines, halftone dots, vibrant inking, superhero proportions" },
    { id: "graphic_novel", label: "\u56FE\u50CF\u5C0F\u8BF4", category: "\u7F8E\u6F2B", tags: "graphic novel style, detailed rendering, cinematic panels, mature storytelling" },
    { id: "noir", label: "\u9ED1\u8272\u7535\u5F71", category: "\u7F8E\u6F2B", tags: "noir style, high contrast, deep shadows, dramatic lighting, film noir" },
    { id: "cartoon", label: "\u7F8E\u5F0F\u5361\u901A", category: "\u7F8E\u6F2B", tags: "american cartoon style, bold outlines, exaggerated shapes, playful" },
    // ===== 韩漫 =====
    { id: "webtoon", label: "Webtoon", category: "\u97E9\u6F2B", tags: "korean webtoon style, vertical scroll format, clean lines, vibrant colors, modern" },
    { id: "manhwa", label: "\u4F20\u7EDF\u97E9\u6F2B", category: "\u97E9\u6F2B", tags: "manhwa style, korean comic, detailed eyes, smooth lineart, modern aesthetic" },
    { id: "korean_drama", label: "\u97E9\u5267\u98CE", category: "\u97E9\u6F2B", tags: "korean drama inspired manhwa, realistic faces, fashion forward, romantic" },
    // ===== 国漫 =====
    { id: "ink", label: "\u6C34\u58A8\u98CE", category: "\u56FD\u6F2B", tags: "sumi-e ink style, brush strokes, traditional Chinese ink painting, flowing" },
    { id: "guofeng", label: "\u56FD\u98CE", category: "\u56FD\u6F2B", tags: "chinese guofeng style, traditional hanfu, oriental aesthetics, elegant" },
    { id: "wuxia", label: "\u6B66\u4FA0", category: "\u56FD\u6F2B", tags: "wuxia manhua style, martial arts, flowing robes, dynamic action, chinese fantasy" },
    { id: "xianxia", label: "\u4ED9\u4FA0", category: "\u56FD\u6F2B", tags: "xianxia style, immortal cultivation, ethereal, mystical clouds, oriental fantasy" },
    // ===== 其他 =====
    { id: "cyberpunk", label: "\u8D5B\u535A\u670B\u514B", category: "\u5176\u4ED6", tags: "cyberpunk style, neon lights, futuristic, tech noir, dystopian" },
    { id: "realistic", label: "\u5199\u5B9E", category: "\u5176\u4ED6", tags: "realistic style, photographic quality, detailed textures, lifelike" },
    { id: "watercolor", label: "\u6C34\u5F69", category: "\u5176\u4ED6", tags: "watercolor style, soft washes, flowing pigments, artistic" },
    { id: "sketch", label: "\u7D20\u63CF", category: "\u5176\u4ED6", tags: "pencil sketch style, graphite, cross hatching, rough lines" },
    { id: "minimalist", label: "\u6781\u7B80", category: "\u5176\u4ED6", tags: "minimalist style, simple lines, negative space, clean composition" }
  ];
  var STYLE_CATEGORIES = ["\u65E5\u6F2B", "\u7F8E\u6F2B", "\u97E9\u6F2B", "\u56FD\u6F2B", "\u5176\u4ED6"];
  function workMetaInit() {
    try {
      state.workMeta.title = localStorage.getItem("manga_work_title") || "";
      state.workMeta.savedAt = localStorage.getItem("manga_work_saved_at") || "";
    } catch (e) {
    }
  }

  // static/src/modules/ui.ts
  function motionReduced() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function playStagger(container, selector) {
    if (!container)
      return;
    const nodes = selector ? container.querySelectorAll(selector) : container.children;
    if (!nodes || nodes.length === 0)
      return;
    if (motionReduced() || typeof IntersectionObserver === "undefined")
      return;
    if (container._staggerDone)
      return;
    container._staggerDone = true;
    const io = new IntersectionObserver((entries, obs) => {
      let batch = 0;
      entries.forEach((entry) => {
        if (!entry.isIntersecting)
          return;
        obs.unobserve(entry.target);
        entry.target.style.setProperty("--i", String(batch++));
        entry.target.classList.remove("stagger-ready");
        entry.target.classList.add("stagger-item");
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.01 });
    Array.from(nodes).forEach((el) => {
      if (el.classList.contains("stagger-item"))
        return;
      el.classList.add("stagger-ready");
      io.observe(el);
    });
    setTimeout(() => {
      Array.from(nodes).forEach((el) => {
        if (!el.classList.contains("stagger-ready"))
          return;
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) {
          el.classList.remove("stagger-ready");
          el.classList.add("stagger-item");
        }
      });
    }, 3e3);
  }
  function popIn(el) {
    if (!el || motionReduced())
      return;
    el.classList.add("stagger-item");
  }
  function escapeHtml(s) {
    if (!s)
      return "";
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(s).replace(/[&<>"']/g, (c) => map[c] || c);
  }
  function formatDateTime(iso) {
    if (!iso)
      return "-";
    try {
      const d = new Date(iso);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (e) {
      return iso;
    }
  }
  function emptyState(icon, title, hint, action) {
    const fullSpan = !action || action.fullSpan ? " col-span-full" : "";
    const btn = action ? `<button onclick="${action.onclick}" class="btn-primary px-5 py-2 text-sm font-medium">${action.label}</button>` : "";
    return `<div class="empty-state${fullSpan}">
        <span class="es-halftone" aria-hidden="true"></span>
        <div class="es-icon" data-icon="${icon}"></div>
        <p class="es-title">${title}</p>
        <p class="es-hint">${hint}</p>
        ${btn}
    </div>`;
  }
  function detectBrowserDevice() {
    const ua = navigator.userAgent || "";
    const uaData = navigator.userAgentData;
    const hasTouch = "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
    const isAndroid = /Android/i.test(ua);
    const isIPhone = /iPhone|iPod/i.test(ua);
    const isIPad = /iPad/i.test(ua) || /Macintosh/i.test(ua) && hasTouch && navigator.platform === "MacIntel";
    const isMobileUA = /Mobi/i.test(ua) || isIPhone || isAndroid || /Windows Phone|IEMobile/i.test(ua) || uaData && uaData.mobile === true;
    let device = "desktop";
    if (isIPad)
      device = "tablet";
    else if (isMobileUA)
      device = "mobile";
    else if (hasTouch && window.innerWidth < 1024)
      device = "tablet";
    let browser = "other";
    if (/MicroMessenger/i.test(ua))
      browser = "wechat";
    else if (/QQ/i.test(ua) || /MQQBrowser/i.test(ua))
      browser = "qq";
    else if (/DingTalk|Dingding/i.test(ua))
      browser = "dingtalk";
    else if (/Edg/i.test(ua))
      browser = "edge";
    else if (/Firefox/i.test(ua))
      browser = "firefox";
    else if (/UCBrowser/i.test(ua))
      browser = "uc";
    else if (/Chrome/i.test(ua))
      browser = "chrome";
    else if (/Safari/i.test(ua))
      browser = "safari";
    const info = { device, browser, isMobile: device === "mobile", isTouch: hasTouch, isWechat: browser === "wechat", ua };
    window.APP_DEVICE = info;
    const root = document.documentElement;
    root.dataset.device = device;
    root.dataset.browser = browser;
    const body = document.body;
    body.classList.remove("device-mobile", "device-tablet", "device-desktop", "touch-device", "browser-wechat");
    body.classList.add("device-" + device);
    if (hasTouch)
      body.classList.add("touch-device");
    if (browser === "wechat")
      body.classList.add("browser-wechat");
    const w = window;
    if (typeof w.maybeShowInAppBanner === "function")
      w.maybeShowInAppBanner(info);
    return info;
  }
  function maybeShowInAppBanner(info) {
    const banner = document.getElementById("inapp-browser-banner");
    if (!banner)
      return;
    const isInApp = (info.browser === "wechat" || info.browser === "qq") && info.device !== "desktop";
    let dismissed = null;
    try {
      dismissed = localStorage.getItem("inapp_banner_dismissed");
    } catch (e) {
    }
    if (!isInApp || dismissed === info.browser) {
      banner.classList.add("hidden");
      return;
    }
    const textEl = document.getElementById("inapp-browser-text");
    if (textEl) {
      textEl.textContent = info.browser === "wechat" ? "\u5FAE\u4FE1\u5185\u6253\u5F00\u529F\u80FD\u53D7\u9650\uFF0C\u5EFA\u8BAE\u70B9\u51FB\u53F3\u4E0A\u89D2\u300C\xB7\xB7\xB7\u300D\uFF0C\u9009\u62E9\u300C\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u300D" : "QQ \u5185\u6253\u5F00\u529F\u80FD\u53D7\u9650\uFF0C\u5EFA\u8BAE\u70B9\u51FB\u53F3\u4E0A\u89D2\u300C\xB7\xB7\xB7\u300D\uFF0C\u9009\u62E9\u300C\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u300D";
    }
    banner.classList.remove("hidden");
  }

  // static/src/modules/tabs.ts
  function switchTab(tabName) {
    if (tabName === state.currentTab)
      return;
    const dir = state.tabs.indexOf(tabName) >= state.tabs.indexOf(state.currentTab) ? "right" : "left";
    const fromTab = state.currentTab;
    state.tabs.forEach((t2) => {
      const topTab = document.getElementById(`tab-${t2}`);
      if (topTab) {
        const active = t2 === tabName;
        topTab.className = active ? "tab-active" : "tab-inactive";
        topTab.setAttribute("aria-selected", active ? "true" : "false");
      }
      const mtab = document.getElementById(`mtab-${t2}`);
      if (mtab)
        mTabClass(mtab, t2 === tabName);
    });
    const t = window.__t2cTransitions;
    if (t) {
      t.swapPanel(`panel-${fromTab}`, `panel-${tabName}`, dir).then(() => {
        state.currentTab = tabName;
        staggerPanel(document.getElementById(`panel-${tabName}`));
        refreshInks();
        const w = window;
        if (typeof w.updateWorkspaceUI === "function")
          w.updateWorkspaceUI();
        if (tabName === "history") {
          if (typeof w.refreshCurrentHistoryList === "function")
            w.refreshCurrentHistoryList();
        }
      });
    } else {
      const oldPanel = document.getElementById(`panel-${fromTab}`);
      if (oldPanel)
        oldPanel.classList.add("hidden");
      const panel = document.getElementById(`panel-${tabName}`);
      if (!panel)
        return;
      panel.classList.remove("hidden");
      panel.classList.remove("fade-in", "panel-in-left", "panel-in-right");
      void panel.offsetWidth;
      panel.classList.add(dir === "right" ? "panel-in-right" : "panel-in-left");
      state.currentTab = tabName;
      staggerPanel(panel);
      refreshInks();
      const w = window;
      if (typeof w.updateWorkspaceUI === "function")
        w.updateWorkspaceUI();
      if (tabName === "history") {
        if (typeof w.refreshCurrentHistoryList === "function")
          w.refreshCurrentHistoryList();
      }
    }
  }
  function mTabClass(el, isActive) {
    el.className = isActive ? "mtab-active mtab-spring" : "mtab-inactive";
  }
  function goStep(tab) {
    switchTab(tab);
  }
  function moveInk(boxId, activeEl, inkId) {
    const box = document.getElementById(boxId);
    const ink = document.getElementById(inkId);
    if (!box || !ink || !activeEl)
      return;
    const boxRect = box.getBoundingClientRect();
    const itemRect = activeEl.getBoundingClientRect();
    if (!itemRect.width)
      return;
    ink.style.width = itemRect.width + "px";
    ink.style.transform = `translateX(${itemRect.left - boxRect.left}px)`;
    ink.classList.add("is-ready");
  }
  function refreshInks() {
    moveInk("main-tabs", document.getElementById(`tab-${state.currentTab}`), "tab-ink");
    moveInk("mtab-grid", document.getElementById(`mtab-${state.currentTab}`), "mtab-pill");
    const subId = state._historySub === "writing" ? "hist-sub-writing" : "hist-sub-comic";
    moveInk("hist-subtabs", document.getElementById(subId), "hist-ink");
  }
  function staggerPanel(panel) {
    if (!panel || motionReduced())
      return;
    Array.from(panel.children).forEach((el, i) => {
      const delay = Math.min(i * 35, 210);
      el.style.transition = "opacity .38s var(--ease-out-expo), transform .38s var(--ease-out-expo)";
      el.style.transitionDelay = delay + "ms";
      el.style.opacity = "0";
      el.style.transform = "translateY(10px)";
      requestAnimationFrame(() => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
      setTimeout(() => {
        el.style.transition = "";
        el.style.transitionDelay = "";
        el.style.opacity = "";
        el.style.transform = "";
      }, 760 + delay);
    });
  }

  // static/src/modules/toast.ts
  function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    if (!toast)
      return;
    const icons = { success: "check-circle", error: "warning", info: "lightbulb" };
    const iconName = icons[type] || icons.info;
    toast.innerHTML = `<div class="toast-inner"><span class="toast-icon" data-icon="${iconName}"></span><span class="toast-text"></span></div><span class="toast-timer"></span>`;
    const w = window;
    if (typeof w.hydrateIcons === "function")
      w.hydrateIcons(toast);
    const textEl = toast.querySelector(".toast-text");
    if (textEl)
      textEl.textContent = message;
    toast.style.background = type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#111112";
    toast.style.transform = "translateY(0)";
    toast.style.opacity = "1";
    toast.classList.remove("toast-pop", "shake", "toast-loading");
    void toast.offsetWidth;
    toast.classList.add(type === "error" ? "shake" : "toast-pop");
    const t = toast;
    if (t._hideTimer) {
      clearTimeout(t._hideTimer);
      t._hideTimer = null;
    }
    if (toast.dataset.persistent === "1")
      return;
    toast.classList.remove("is-counting");
    void toast.offsetWidth;
    toast.classList.add("is-counting");
    t._hideTimer = setTimeout(() => {
      toast.classList.remove("is-counting");
      toast.style.transform = "translateY(20px)";
      toast.style.opacity = "0";
      t._hideTimer = null;
    }, 3e3);
  }
  function showLoadingToast(message) {
    const toast = document.getElementById("toast");
    if (!toast)
      return "toast";
    toast.innerHTML = '<div class="toast-inner"><span class="loading-spinner" style="width:15px;height:15px;border-width:2px;border-color:rgba(255,255,255,0.28);border-top-color:#ffffff;"></span><span class="toast-text"></span></div>';
    const textEl = toast.querySelector(".toast-text");
    if (textEl)
      textEl.textContent = message;
    toast.style.background = "#111112";
    toast.style.transform = "translateY(0)";
    toast.style.opacity = "1";
    toast.classList.remove("toast-pop", "shake", "is-counting");
    void toast.offsetWidth;
    toast.classList.add("toast-loading");
    toast.dataset.persistent = "1";
    return "toast";
  }
  function dismissLoadingToast(id) {
    if (id !== "toast")
      return;
    const toast = document.getElementById("toast");
    if (!toast)
      return;
    const t = toast;
    if (t._hideTimer) {
      clearTimeout(t._hideTimer);
      t._hideTimer = null;
    }
    toast.dataset.persistent = "";
    toast.classList.remove("toast-loading");
    toast.style.transform = "translateY(20px)";
    toast.style.opacity = "0";
  }

  // static/src/modules/api.ts
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta && meta.getAttribute("content") || "";
  }
  var _nativeFetch = window.fetch.bind(window);
  window.fetch = function(input, init = {}) {
    try {
      const url = typeof input === "string" ? input : input && input.url || "";
      const method = String(init && init.method || input && input.method || "GET").toUpperCase();
      const isMutation = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
      if (isMutation && typeof url === "string" && url.startsWith("/api/")) {
        const token = getCsrfToken();
        if (token) {
          const headers = new Headers(init && init.headers || input && input.headers || {});
          if (!headers.has("X-CSRF-Token"))
            headers.set("X-CSRF-Token", token);
          init = __spreadProps(__spreadValues({}, init || {}), { headers });
        }
      }
    } catch (e) {
    }
    return _nativeFetch(input, init);
  };
  async function fetchWithRetry(url, options = {}, maxRetries = state.MAX_RETRIES) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok && attempt < maxRetries) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response;
      } catch (e) {
        lastError = e;
        if (attempt < maxRetries) {
          const delay = Math.min(1e3 * Math.pow(2, attempt) + Math.random() * 1e3, 15e3);
          console.log(`Retry ${attempt + 1}/${maxRetries} for ${url} after ${Math.round(delay)}ms`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }
  function lockButton(btn, labelEl, busyText) {
    if (!btn)
      return () => {
      };
    const originalText = labelEl ? labelEl.textContent : null;
    const wasDisabled = btn.disabled;
    btn.disabled = true;
    btn.classList.add("opacity-60", "cursor-not-allowed");
    if (labelEl && busyText)
      labelEl.textContent = busyText;
    return function unlock() {
      btn.disabled = wasDisabled;
      btn.classList.remove("opacity-60", "cursor-not-allowed");
      if (labelEl && originalText !== null)
        labelEl.textContent = originalText;
    };
  }
  async function recoverSession() {
    try {
      const segResponse = await fetchWithRetry("/api/results/segments", { credentials: "include" }, 1);
      const segResult = await segResponse.json();
      if (segResult.success && segResult.data) {
        state.currentSegments = segResult.data;
        console.log("Recovered segments from server");
      }
      const charResponse = await fetchWithRetry("/api/results/characters", { credentials: "include" }, 1);
      const charResult = await charResponse.json();
      if (charResult.success && charResult.data && charResult.data.characters) {
        state.characters = charResult.data.characters;
        console.log("Recovered characters from server");
      }
      const imgResponse = await fetchWithRetry("/api/results/images", { credentials: "include" }, 1);
      const imgResult = await imgResponse.json();
      if (imgResult.success && imgResult.data && imgResult.data.images) {
        for (const item of imgResult.data.images) {
          if (item.key) {
            state.generatedImages[item.key] = item.local_url;
          }
        }
        console.log(`Recovered ${imgResult.data.images.length} images from server`);
      }
      const fpResponse = await fetchWithRetry("/api/results/full_pages", { credentials: "include" }, 1);
      const fpResult = await fpResponse.json();
      if (fpResult.success && fpResult.data && fpResult.data.pages) {
        for (const item of fpResult.data.pages) {
          if (item.key !== void 0) {
            state.fullPageImages[item.key] = item.local_url;
            if (item.clean_url)
              state.fullPageCleanImages[item.key] = item.clean_url;
            if (item.bubbles)
              state.fullPageBubbles[item.key] = item.bubbles;
          }
        }
        console.log(`Recovered ${fpResult.data.pages.length} full pages from server`);
      }
      try {
        const cpResponse = await fetchWithRetry("/api/results/combined_pages", { credentials: "include" }, 1);
        const cpResult = await cpResponse.json();
        if (cpResult.success && cpResult.data && cpResult.data.pages) {
          for (const item of cpResult.data.pages) {
            if (item.key !== void 0) {
              state.combinedPageImages[item.key] = item.local_url;
            }
          }
          console.log(`Recovered ${cpResult.data.pages.length} combined pages from server`);
        }
      } catch (e) {
        console.log("Combined pages recovery skipped:", e.message);
      }
      const c2nResponse = await fetchWithRetry("/api/results/comic2novel", { credentials: "include" }, 1);
      const c2nResult = await c2nResponse.json();
      if (c2nResult.success && c2nResult.data && c2nResult.data.novel_text) {
        state.comicNovelResult = c2nResult.data;
        const w2 = window;
        if (typeof w2.renderComicNovelResult === "function")
          w2.renderComicNovelResult();
        console.log("Recovered comic-to-novel result from server");
      }
      const w = window;
      if (state.currentSegments.pages && state.currentSegments.pages.length > 0) {
        if (typeof w.renderSegments === "function")
          w.renderSegments();
        if (typeof w.renderGallery === "function")
          w.renderGallery();
      }
      if (state.characters.length > 0) {
        if (typeof w.renderCharacters === "function")
          w.renderCharacters();
      }
    } catch (e) {
      console.log("Session recovery skipped:", e.message);
    }
  }
  async function syncResults() {
    try {
      await fetchWithRetry("/api/sync/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          segments: state.currentSegments,
          characters: { characters: state.characters },
          generatedImages: state.generatedImages,
          fullPageImages: state.fullPageImages,
          combinedPageImages: state.combinedPageImages,
          fullPageCleanImages: state.fullPageCleanImages,
          fullPageBubbles: state.fullPageBubbles,
          comic2novel: state.comicNovelResult
        })
      }, 1);
    } catch (e) {
      console.log("Sync results failed:", e.message);
    }
  }
  async function handleLogout() {
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
      window.location.href = "/app";
    } catch (e) {
      window.location.href = "/app";
    }
  }
  async function checkAuth() {
    try {
      const response = await fetch("/api/check-auth", { credentials: "include" });
      const result = await response.json();
      if (!result.logged_in) {
        window.location.href = "/app";
      }
    } catch (e) {
      window.location.href = "/app";
    }
  }

  // static/src/modules/progress.ts
  function createProgressBar(containerId) {
    const container = document.getElementById(containerId);
    if (!container)
      return null;
    const progressHtml = `
        <div class="progress-container mt-3">
            <div class="progress-bar" id="${containerId}-bar"></div>
        </div>
        <div class="text-sm text-gray-600 mt-1" id="${containerId}-text">0%</div>
    `;
    container.innerHTML = progressHtml;
    return `${containerId}-bar`;
  }
  function startFakeProgress(progressBarId, textId, minTime = 12e4) {
    clearInterval(state.progressInterval);
    const startTime = Date.now();
    const k = 3;
    const activeBar = document.getElementById(progressBarId);
    if (activeBar)
      activeBar.classList.add("is-active");
    state.progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const t = elapsed / minTime;
      const logProgress = 90 * (1 - Math.exp(-k * t));
      const jitter = (Math.random() - 0.5) * 0.5;
      const progress = Math.min(90, Math.max(0, logProgress + jitter));
      const bar = document.getElementById(progressBarId);
      const text = document.getElementById(textId);
      if (bar)
        bar.style.transform = `scaleX(${Math.min(1, Math.max(0, progress / 100))})`;
      if (text)
        text.textContent = `${Math.floor(progress)}%`;
    }, 200);
  }
  function finishProgress(progressBarId, textId) {
    clearInterval(state.progressInterval);
    const bar = document.getElementById(progressBarId);
    const text = document.getElementById(textId);
    if (bar) {
      bar.style.transform = "scaleX(1)";
      bar.classList.remove("is-active", "is-done");
      void bar.offsetWidth;
      bar.classList.add("is-done");
    }
    if (text)
      text.textContent = "100% - \u5B8C\u6210";
  }
  function registerTaskProgress(containerId) {
    const task_id = "task_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const progressBarId = `${containerId}-bar`;
    const textId = `${containerId}-text`;
    createProgressBar(containerId);
    return {
      task_id,
      startFallback: (minTime = 12e4) => {
        startFakeProgress(progressBarId, textId, minTime);
      },
      // 强制完成 (HTTP 请求返回时调用)
      finish: () => {
        clearInterval(state.progressInterval);
        finishProgress(progressBarId, textId);
      }
    };
  }

  // static/src/modules/a11y.ts
  var FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "textarea:not([disabled])",
    'input:not([disabled]):not([type="hidden"])',
    "select:not([disabled])",
    '[tabindex]:not([tabindex="-1"])'
  ].join(",");
  function getFocusableElements(modalEl) {
    return Array.from(modalEl.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
  }
  function trapFocus(modalEl) {
    const handler = (e) => {
      if (e.key !== "Tab")
        return;
      const focusables = getFocusableElements(modalEl);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !modalEl.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !modalEl.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    modalEl._trapHandler = handler;
    modalEl.addEventListener("keydown", handler);
  }
  function untrapFocus(modalEl) {
    if (modalEl && modalEl._trapHandler) {
      modalEl.removeEventListener("keydown", modalEl._trapHandler);
      modalEl._trapHandler = null;
    }
  }
  function openModalA11y(modalId) {
    const modalEl = document.getElementById(modalId);
    if (!modalEl)
      return;
    modalEl._previouslyFocused = document.activeElement;
    const t = window.__t2cTransitions;
    if (t) {
      t.openModal(modalId);
    } else {
      modalEl.classList.remove("modal-closing", "hidden");
    }
    trapFocus(modalEl);
    const focusables = getFocusableElements(modalEl);
    if (focusables.length > 0) {
      setTimeout(() => focusables[0].focus(), 50);
    }
  }
  function closeModalA11y(modalId) {
    const modalEl = document.getElementById(modalId);
    if (!modalEl)
      return;
    untrapFocus(modalEl);
    const prev = modalEl._previouslyFocused;
    if (prev && typeof prev.focus === "function") {
      prev.focus();
    }
    modalEl._previouslyFocused = null;
  }

  // static/src/modules/modals.ts
  function animateCloseModal(modalId, onClose) {
    const modal = document.getElementById(modalId);
    if (!modal || modal.classList.contains("hidden"))
      return;
    if (motionReduced()) {
      modal.classList.add("hidden");
      if (onClose)
        onClose();
      return;
    }
    if (modal._closing)
      return;
    modal._closing = true;
    modal.classList.add("modal-closing");
    setTimeout(() => {
      modal.classList.add("hidden");
      modal.classList.remove("modal-closing");
      modal._closing = false;
      if (onClose)
        onClose();
    }, 150);
  }
  function openModal(src) {
    const modal = document.getElementById("image-modal");
    const img = document.getElementById("modal-image");
    if (!modal || !img)
      return;
    img.src = src;
    img.classList.remove("zoom-in");
    void img.offsetWidth;
    img.classList.add("zoom-in");
    const t = window.__t2cTransitions;
    if (t) {
      t.openModal("image-modal");
    } else {
      modal.classList.remove("modal-closing", "hidden");
    }
  }
  function closeModal() {
    closeModalA11y("image-modal");
    animateCloseModal("image-modal");
  }
  function openConfigModal() {
    openModalA11y("config-modal");
  }
  function closeConfigModal() {
    closeModalA11y("config-modal");
    animateCloseModal("config-modal");
  }

  // static/src/modules/workspace.ts
  function countUp(el, value) {
    if (!el)
      return;
    const from = parseInt(el.dataset.value || "0", 10) || 0;
    if (from === value)
      return;
    el.dataset.value = String(value);
    if (motionReduced() || Math.abs(value - from) < 8) {
      el.textContent = String(value);
      return;
    }
    const start = performance.now();
    const dur = 520;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(from + (value - from) * eased));
      if (p < 1)
        requestAnimationFrame(tick);
      else
        el.textContent = String(value);
    };
    requestAnimationFrame(tick);
    el.classList.remove("is-bump");
    void el.offsetWidth;
    el.classList.add("is-bump");
  }
  function _setCountChip(id, text, positive) {
    const el = document.getElementById(id);
    if (!el)
      return;
    if (el.textContent !== text) {
      el.textContent = text;
      el.classList.remove("is-bump");
      void el.offsetWidth;
      el.classList.add("is-bump");
    }
    el.classList.toggle("is-zero", !positive);
  }
  function _setStatusChip(id, textId, ok, label) {
    const chip = document.getElementById(id);
    const text = document.getElementById(textId);
    if (!chip)
      return;
    chip.classList.toggle("is-ok", !!ok);
    chip.classList.toggle("is-bad", !ok);
    if (text)
      text.textContent = ok ? `${label}\u5DF2\u5C31\u7EEA` : `${label}\u672A\u914D\u7F6E`;
  }
  function scheduleWorkspaceUI() {
    if (scheduleWorkspaceUI._pending)
      return;
    scheduleWorkspaceUI._pending = true;
    requestAnimationFrame(() => {
      scheduleWorkspaceUI._pending = false;
      updateWorkspaceUI();
    });
  }
  function updateWorkspaceUI() {
    const textEl = document.getElementById("novel-text");
    const chars = textEl ? (textEl.value || "").length : 0;
    const charCount = state.characters.length;
    const pages = (state.currentSegments.pages || []).length;
    const segCount = (state.currentSegments.pages || []).reduce((n, p) => n + (p.segments || []).length, 0);
    const fullPages = Object.keys(state.fullPageImages).length;
    countUp(document.getElementById("stat-chars"), chars);
    countUp(document.getElementById("stat-chars-count"), charCount);
    countUp(document.getElementById("stat-segments"), segCount);
    countUp(document.getElementById("stat-pages"), fullPages);
    _setCountChip("input-count-chip", `${chars} \u5B57`, chars > 0);
    _setCountChip("chars-count-chip", `${charCount} \u4E2A\u89D2\u8272`, charCount > 0);
    _setCountChip("seg-count-chip", `${pages} \u9875 / ${segCount} \u683C`, segCount > 0);
    _setCountChip("gallery-count-chip", `${fullPages} \u5F20`, fullPages > 0);
    const wbCounts = document.getElementById("wb-counts");
    if (wbCounts) {
      wbCounts.textContent = `${chars} \u5B57 / ${charCount} \u89D2\u8272 / ${segCount} \u5206\u955C / ${fullPages} \u6574\u9875`;
    }
    let cfg = {};
    try {
      cfg = JSON.parse(localStorage.getItem("manga_config") || "{}");
    } catch (e) {
      cfg = {};
    }
    _setStatusChip("chip-llm", "chip-llm-text", !!(cfg.llm_api_url && cfg.llm_api_key), "\u6587\u672C\u63A5\u53E3");
    _setStatusChip("chip-img", "chip-img-text", !!(cfg.img_api_url && cfg.img_api_key), "\u56FE\u50CF\u63A5\u53E3");
    const workChip = document.getElementById("chip-work");
    if (workChip) {
      workChip.classList.toggle("is-ok", !!state.workMeta.title);
      workChip.classList.toggle("is-bad", !state.workMeta.title);
      const t = document.getElementById("chip-work-text");
      if (t)
        t.textContent = state.workMeta.title ? `\u4F5C\u54C1\uFF1A${state.workMeta.title}` : "\u5C1A\u672A\u547D\u540D\u4F5C\u54C1";
    }
    const modeText = document.getElementById("chip-mode-text");
    if (modeText) {
      modeText.textContent = `${state.comicMode === "color" ? "\u5F69\u8272" : "\u9ED1\u767D"} \xB7 ${state.bubbleRenderMode === "pil" ? "\u672C\u5730\u6C14\u6CE1" : "\u6A21\u578B\u753B\u6C14\u6CE1"}`;
    }
    ["chip-llm", "chip-img"].forEach((id) => {
      const chip = document.getElementById(id);
      if (chip)
        chip.classList.toggle("is-busy", !!state.isGenerating);
    });
    const steps = [
      { key: "input", done: chars > 0, hint: chars ? `${chars} \u5B57` : "\u7C98\u8D34\u6B63\u6587" },
      { key: "characters", done: charCount > 0, hint: charCount ? `${charCount} \u4E2A\u89D2\u8272` : "\u51FA\u4EBA\u8BBE\u56FE" },
      { key: "segments", done: pages > 0, hint: pages ? `${pages} \u9875 / ${segCount} \u683C` : "\u5207\u9875\u5206\u683C" },
      { key: "gallery", done: fullPages > 0, hint: fullPages ? `${fullPages} \u5F20\u6574\u9875` : "\u53E0\u6C14\u6CE1" }
    ];
    let activeIdx = steps.findIndex((s) => !s.done);
    const allDone = activeIdx === -1;
    if (allDone)
      activeIdx = steps.length - 1;
    steps.forEach((s, i) => {
      const stepEl = document.querySelector(`.step[data-step="${s.key}"]`);
      if (stepEl) {
        stepEl.classList.toggle("is-done", s.done);
        stepEl.classList.toggle("is-active", i === activeIdx && !allDone);
      }
      const dot = document.getElementById(`step-dot-${s.key}`);
      if (dot)
        dot.textContent = s.done ? "\u2713" : String(i + 1);
      const hint = document.getElementById(`step-hint-${s.key}`);
      if (hint)
        hint.textContent = s.hint;
    });
    const fill = document.getElementById("step-fill");
    if (fill)
      fill.style.setProperty("--p", String(steps.filter((s) => s.done).length / steps.length));
    const summary = document.getElementById("step-summary");
    if (summary) {
      if (allDone)
        summary.textContent = "\u6D41\u7A0B\u5DF2\u8D70\u5B8C\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u52A0\u9875\u6216\u5BFC\u51FA";
      else if (chars === 0)
        summary.textContent = "\u7C98\u8D34\u5C0F\u8BF4\u6B63\u6587\u5F00\u59CB";
      else if (charCount === 0)
        summary.textContent = "\u4E0B\u4E00\u6B65\uFF1A\u5206\u6790\u89D2\u8272\uFF08\u4E5F\u53EF\u8DF3\u8FC7\uFF09";
      else if (pages === 0)
        summary.textContent = "\u4E0B\u4E00\u6B65\uFF1A\u751F\u6210\u5206\u955C";
      else
        summary.textContent = "\u4E0B\u4E00\u6B65\uFF1A\u6574\u9875\u751F\u6210";
    }
    const wbSteps = document.getElementById("wb-steps");
    if (wbSteps) {
      if (!wbSteps.dataset.ready) {
        wbSteps.innerHTML = steps.map(
          (s, i) => (i ? '<span class="wb-connector"></span>' : "") + '<span class="wb-dot"></span>'
        ).join("");
        wbSteps.dataset.ready = "1";
      }
      const dots = wbSteps.querySelectorAll(".wb-dot");
      const connectors = wbSteps.querySelectorAll(".wb-connector");
      dots.forEach((dot, i) => {
        dot.classList.toggle("is-done", steps[i].done);
        dot.classList.toggle("is-current", i === activeIdx && !allDone);
        dot.classList.toggle("is-busy", i === activeIdx && !!state.isGenerating);
      });
      connectors.forEach((c, i) => {
        c.classList.toggle("is-done", steps[i].done && steps[i + 1].done);
      });
    }
    const action = state.primaryActions[state.currentTab];
    const actionLabel = document.getElementById("wb-action-label");
    if (action && actionLabel)
      actionLabel.textContent = action.label;
    renderWorkMeta();
  }
  function runPrimaryAction() {
    const action = state.primaryActions[state.currentTab];
    if (!action)
      return;
    try {
      action.run();
    } catch (e) {
      showToast("\u64CD\u4F5C\u5931\u8D25: " + (e.message || e), "error");
    }
  }
  function renderWorkMeta() {
    const titleEl = document.getElementById("wb-title");
    const saveEl = document.getElementById("wb-save");
    if (titleEl)
      titleEl.textContent = state.workMeta.title || "\u672A\u547D\u540D\u4F5C\u54C1";
    if (saveEl) {
      saveEl.textContent = state.workMeta.dirty ? "\u6709\u6539\u52A8\u672A\u4FDD\u5B58" : state.workMeta.savedAt ? `\u5DF2\u4FDD\u5B58 ${state.workMeta.savedAt}` : "\u5C1A\u672A\u4FDD\u5B58";
      saveEl.style.color = state.workMeta.dirty ? "#b45309" : "";
    }
  }
  function markDirty() {
    if (state.workMeta.dirty)
      return;
    state.workMeta.dirty = true;
    renderWorkMeta();
  }
  function markSaved(title) {
    state.workMeta.dirty = false;
    if (title)
      state.workMeta.title = title;
    state.workMeta.savedAt = (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    try {
      localStorage.setItem("manga_work_title", state.workMeta.title || "");
      localStorage.setItem("manga_work_saved_at", state.workMeta.savedAt);
    } catch (e) {
    }
    renderWorkMeta();
    const wbSave = document.getElementById("wb-save");
    if (wbSave && window.__t2cTransitions) {
      wbSave.style.color = "#15803d";
      window.__t2cTransitions.celebrateSave(wbSave);
      setTimeout(() => {
        wbSave.style.color = "";
      }, 1100);
    }
  }
  async function quickSave() {
    try {
      await window.saveCurrentState();
      markSaved();
      updateWorkspaceUI();
      showToast("\u5DF2\u4FDD\u5B58\u5F53\u524D\u8FDB\u5EA6", "success");
    } catch (e) {
      showToast("\u4FDD\u5B58\u5931\u8D25: " + (e.message || e), "error");
    }
  }
  function bootIntro() {
    const items = document.querySelectorAll("[data-boot]");
    if (motionReduced() || !items.length) {
      document.documentElement.classList.remove("boot-armed");
      window.__appBooted = true;
      return;
    }
    items.forEach((el, i) => {
      el.style.transitionDelay = Math.min(i * 60, 360) + "ms";
      el.classList.add("is-in");
    });
    setTimeout(() => {
      document.documentElement.classList.remove("boot-armed");
      items.forEach((el) => {
        el.style.transitionDelay = "";
      });
    }, 1e3);
    const w = window;
    if (typeof w.staggerPanel === "function") {
      w.staggerPanel(document.getElementById(`panel-${state.currentTab}`));
    }
    window.__appBooted = true;
  }
  function renderStylePresets() {
    const container = document.getElementById("style-tag-presets");
    if (!container)
      return;
    container.innerHTML = "";
    STYLE_CATEGORIES.forEach((category) => {
      const presetsInCategory = STYLE_PRESETS.filter((p) => p.category === category);
      if (presetsInCategory.length === 0)
        return;
      const groupDiv = document.createElement("div");
      groupDiv.className = "mb-3";
      const title = document.createElement("div");
      title.className = "text-xs font-extrabold text-[#4e4e54] mb-2 flex items-center gap-1.5";
      const categoryCode = {
        "\u65E5\u6F2B": "JP",
        "\u7F8E\u6F2B": "US",
        "\u97E9\u6F2B": "KR",
        "\u56FD\u6F2B": "CN",
        "\u5176\u4ED6": "EX"
      };
      title.innerHTML = `<span class="mono px-1.5 py-0.5 text-[10px] bg-[#111112] text-white">${categoryCode[category] || "ST"}</span><span>${category}</span>`;
      groupDiv.appendChild(title);
      const btnGroup = document.createElement("div");
      btnGroup.className = "flex flex-wrap gap-2";
      presetsInCategory.forEach((preset) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.id = preset.id;
        const isSelected = state.selectedPresetIds.has(preset.id);
        btn.className = isSelected ? "px-3 py-1.5 text-xs md:text-sm font-bold border-2 border-[#111112] bg-[#111112] text-white shadow-[2px_2px_0_#c23623] transition-all" : "px-3 py-1.5 text-xs md:text-sm font-medium border-2 border-[#d4d1c7] bg-white text-[#111112] hover:border-[#111112] transition-all";
        btn.textContent = preset.label;
        btn.onclick = () => togglePresetStyle(preset.id);
        btnGroup.appendChild(btn);
      });
      groupDiv.appendChild(btnGroup);
      container.appendChild(groupDiv);
    });
    playStagger(container);
  }
  function renderCustomStyleTags() {
    const container = document.getElementById("custom-style-tags");
    if (!container)
      return;
    container.innerHTML = "";
    state.customStyleTags.forEach((tag, idx) => {
      const chip = document.createElement("span");
      chip.className = "inline-flex items-center gap-1 px-2 py-1 text-sm border-2 border-black bg-gray-100";
      chip.innerHTML = `<span>${escapeHtml(tag)}</span><button type="button" onclick="removeCustomStyleTag(${idx})" class="text-gray-500 hover:text-black font-bold">\xD7</button>`;
      container.appendChild(chip);
    });
  }
  function togglePresetStyle(id) {
    if (state.selectedPresetIds.has(id)) {
      state.selectedPresetIds.delete(id);
    } else {
      state.selectedPresetIds.add(id);
    }
    renderStylePresets();
    updateStyleSummary();
  }
  function addCustomStyleTag() {
    const input = document.getElementById("custom-style-input");
    if (!input)
      return;
    const value = input.value.trim();
    if (!value)
      return;
    if (state.customStyleTags.includes(value)) {
      showToast("\u8BE5\u98CE\u683C\u5DF2\u5B58\u5728", "error");
      return;
    }
    state.customStyleTags.push(value);
    input.value = "";
    renderCustomStyleTags();
    updateStyleSummary();
  }
  function removeCustomStyleTag(idx) {
    state.customStyleTags.splice(idx, 1);
    renderCustomStyleTags();
    updateStyleSummary();
  }
  function toggleStylePanel() {
    const content = document.getElementById("style-panel-content");
    const icon = document.getElementById("style-toggle-icon");
    if (!content)
      return;
    if (content.classList.contains("hidden")) {
      content.classList.remove("hidden");
      if (icon)
        icon.textContent = "\u25B2";
    } else {
      content.classList.add("hidden");
      if (icon)
        icon.textContent = "\u25BC";
    }
  }
  function clearAllStyles() {
    state.selectedPresetIds.clear();
    state.customStyleTags = [];
    renderStylePresets();
    renderCustomStyleTags();
    updateStyleSummary();
    showToast("\u5DF2\u6E05\u7A7A\u6240\u6709\u98CE\u683C", "info");
  }
  function updateStyleSummary() {
    const summaryEl = document.getElementById("style-summary");
    if (!summaryEl)
      return;
    const presetCount = state.selectedPresetIds.size;
    const customCount = state.customStyleTags.length;
    const total = presetCount + customCount;
    if (total === 0) {
      summaryEl.textContent = `(\u672A\u9009\u62E9\u98CE\u683C, \u5C06\u4F7F\u7528\u9ED8\u8BA4${state.comicMode === "color" ? "\u5F69\u8272" : "\u9ED1\u767D"}\u6F2B\u753B\u98CE\u683C)`;
    } else {
      const presetLabels = STYLE_PRESETS.filter((p) => state.selectedPresetIds.has(p.id)).map((p) => p.label);
      const allLabels = [...presetLabels, ...state.customStyleTags];
      summaryEl.textContent = `\u5DF2\u9009 ${total} \u9879: ${allLabels.join(", ")}`;
    }
  }
  function getStyleTagsString() {
    const parts = [];
    STYLE_PRESETS.forEach((p) => {
      if (state.selectedPresetIds.has(p.id))
        parts.push(p.tags);
    });
    parts.push(...state.customStyleTags);
    return parts.join(", ");
  }
  function syncBubbleMini(selectEl) {
    const mini = selectEl && selectEl.parentElement ? selectEl.parentElement.querySelector(".bubble-mini") : null;
    if (!selectEl || !mini)
      return;
    mini.dataset.type = selectEl.value;
    mini.classList.remove("is-changed");
    void mini.offsetWidth;
    mini.classList.add("is-changed");
    setTimeout(() => mini.classList.remove("is-changed"), 340);
  }
  function applyRadioGroupToDom(groupName, currentValue) {
    document.querySelectorAll(`input[name="${groupName}"]`).forEach((radio) => {
      radio.checked = radio.value === currentValue;
      const label = radio.closest("label");
      if (!label)
        return;
      const selected = radio.checked;
      label.classList.toggle("bg-black", selected);
      label.classList.toggle("text-white", selected);
      label.classList.toggle("border-black", selected);
      label.classList.toggle("border-gray-300", !selected);
      label.classList.toggle("hover:border-black", !selected);
      const sub = label.querySelector("span.block.text-xs");
      if (sub) {
        sub.classList.toggle("text-gray-500", !selected);
        sub.classList.toggle("opacity-70", selected);
      }
    });
  }
  function getComicModeFromDom() {
    const el = document.querySelector('input[name="comic-mode"]:checked');
    return el && el.value === "color" ? "color" : "bw";
  }
  function applyComicModeToDom() {
    applyRadioGroupToDom("comic-mode", state.comicMode);
  }
  function onComicModeChange() {
    state.comicMode = getComicModeFromDom();
    applyComicModeToDom();
    updateStyleSummary();
    scheduleWorkspaceUI();
  }
  function getBubbleRenderModeFromDom() {
    const el = document.querySelector('input[name="bubble-render-mode"]:checked');
    return el && el.value === "api" ? "api" : "pil";
  }
  function _refreshBubbleEditButtons() {
    document.querySelectorAll(".edit-bubble-btn").forEach((btn) => {
      const idx = +btn.dataset.pageIdx;
      const visible = state.bubbleRenderMode === "pil" && state.fullPageCleanImages[idx] && state.fullPageBubbles[idx] && state.fullPageBubbles[idx].length > 0;
      btn.classList.toggle("hidden", !visible);
    });
  }
  function applyBubbleRenderModeToDom() {
    applyRadioGroupToDom("bubble-render-mode", state.bubbleRenderMode);
    _refreshBubbleEditButtons();
  }
  function onBubbleRenderModeChange() {
    state.bubbleRenderMode = getBubbleRenderModeFromDom();
    applyBubbleRenderModeToDom();
    scheduleWorkspaceUI();
    if (state.bubbleRenderMode === "api") {
      showToast('\u5DF2\u5207\u6362\u5230"\u7531\u56FE\u50CFAPI\u7ED8\u5236\u6C14\u6CE1"\u6A21\u5F0F, \u8DF3\u8FC7\u672C\u5730PIL, \u4E0D\u53EF\u7F16\u8F91\u6C14\u6CE1\u4F4D\u7F6E', "info");
    } else {
      showToast('\u5DF2\u5207\u6362\u5230"\u672C\u5730PIL\u53E0\u52A0"\u6A21\u5F0F', "info");
    }
  }
  function applyPreset(preset) {
    if (preset === "volc") {
      document.getElementById("llm-api-url").value = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
      document.getElementById("llm-api-key").value = "";
      document.getElementById("llm-model").value = "MiniMax-M3-250227";
      document.getElementById("img-api-url").value = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
      document.getElementById("img-api-key").value = "";
      document.getElementById("img-model").value = "doubao-seedream-3-0-t2i-250415";
      showToast("\u706B\u5C71\u5F15\u64CE v3 \u9884\u8BBE\u5DF2\u5E94\u7528\uFF0C\u8BF7\u586B\u5199 API Key\uFF01", "success");
    } else if (preset === "openai") {
      document.getElementById("llm-api-url").value = "https://api.openai.com/v1/chat/completions";
      document.getElementById("img-api-url").value = "https://api.openai.com/v1/images/generations";
      document.getElementById("llm-model").value = "gpt-4";
      showToast("OpenAI \u9884\u8BBE\u5DF2\u5E94\u7528\uFF01", "success");
    }
  }
  function clearConfig() {
    document.getElementById("llm-api-url").value = "";
    document.getElementById("llm-api-key").value = "";
    document.getElementById("llm-model").value = "";
    document.getElementById("img-api-url").value = "";
    document.getElementById("img-api-key").value = "";
    document.getElementById("img-model").value = "";
    localStorage.removeItem("manga_config");
    const llmRes = document.getElementById("test-llm-result");
    if (llmRes)
      llmRes.innerHTML = "";
    const imgRes = document.getElementById("test-image-result");
    if (imgRes)
      imgRes.innerHTML = "";
    showToast("\u914D\u7F6E\u5DF2\u6E05\u7A7A\uFF01", "success");
  }
  async function testLLM() {
    const btn = document.getElementById("test-llm-btn");
    const spinner = document.getElementById("test-llm-spinner");
    const resultDiv = document.getElementById("test-llm-result");
    btn.disabled = true;
    spinner == null ? void 0 : spinner.classList.remove("hidden");
    if (resultDiv)
      resultDiv.innerHTML = "";
    createProgressBar("test-llm-progress");
    startFakeProgress("test-llm-progress-bar", "test-llm-progress-text", 2e3);
    try {
      const response = await fetchWithRetry("/api/test-llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          api_url: document.getElementById("llm-api-url").value,
          api_key: document.getElementById("llm-api-key").value,
          model: document.getElementById("llm-model").value
        })
      });
      const result = await response.json();
      finishProgress("test-llm-progress-bar", "test-llm-progress-text");
      if (result.success) {
        if (resultDiv)
          resultDiv.innerHTML = `<div class="p-3 bg-green-50 border border-green-200 text-green-700 rounded"><span data-icon="check-circle" class="inline-block align-middle mr-1" style="color:#16a34a;width:14px;height:14px;"></span> ${result.message}</div>`;
        showToast("LLM API\u6D4B\u8BD5\u6210\u529F\uFF01", "success");
      } else {
        if (resultDiv)
          resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded"><span data-icon="x-circle" class="inline-block align-middle mr-1" style="color:#dc2626;width:14px;height:14px;"></span> ${result.error}</div>`;
        showToast("LLM API\u6D4B\u8BD5\u5931\u8D25", "error");
      }
    } catch (e) {
      finishProgress("test-llm-progress-bar", "test-llm-progress-text");
      if (resultDiv)
        resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded"><span data-icon="x-circle" class="inline-block align-middle mr-1" style="color:#dc2626;width:14px;height:14px;"></span> \u8BF7\u6C42\u5931\u8D25\uFF1A${e.message}</div>`;
      showToast("LLM API\u6D4B\u8BD5\u5931\u8D25", "error");
    } finally {
      btn.disabled = false;
      spinner == null ? void 0 : spinner.classList.add("hidden");
    }
  }
  async function testImage() {
    const btn = document.getElementById("test-image-btn");
    const spinner = document.getElementById("test-image-spinner");
    const resultDiv = document.getElementById("test-image-result");
    btn.disabled = true;
    spinner == null ? void 0 : spinner.classList.remove("hidden");
    if (resultDiv)
      resultDiv.innerHTML = "";
    createProgressBar("test-image-progress");
    startFakeProgress("test-image-progress-bar", "test-image-progress-text", 2e3);
    try {
      const response = await fetchWithRetry("/api/test-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          api_url: document.getElementById("img-api-url").value,
          api_key: document.getElementById("img-api-key").value,
          model: document.getElementById("img-model").value
        })
      });
      const result = await response.json();
      finishProgress("test-image-progress-bar", "test-image-progress-text");
      if (result.success) {
        if (resultDiv)
          resultDiv.innerHTML = `<div class="p-3 bg-green-50 border border-green-200 text-green-700 rounded"><span data-icon="check-circle" class="inline-block align-middle mr-1" style="color:#16a34a;width:14px;height:14px;"></span> ${result.message}</div>`;
        showToast("Image API\u6D4B\u8BD5\u6210\u529F\uFF01", "success");
      } else {
        if (resultDiv)
          resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded"><span data-icon="x-circle" class="inline-block align-middle mr-1" style="color:#dc2626;width:14px;height:14px;"></span> ${result.error}</div>`;
        showToast("Image API\u6D4B\u8BD5\u5931\u8D25", "error");
      }
    } catch (e) {
      finishProgress("test-image-progress-bar", "test-image-progress-text");
      if (resultDiv)
        resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded"><span data-icon="x-circle" class="inline-block align-middle mr-1" style="color:#dc2626;width:14px;height:14px;"></span> \u8BF7\u6C42\u5931\u8D25\uFF1A${e.message}</div>`;
      showToast("Image API\u6D4B\u8BD5\u5931\u8D25", "error");
    } finally {
      btn.disabled = false;
      spinner == null ? void 0 : spinner.classList.add("hidden");
    }
  }
  async function saveConfig() {
    const config = {
      llm_api_url: document.getElementById("llm-api-url").value,
      llm_api_key: document.getElementById("llm-api-key").value,
      llm_model: document.getElementById("llm-model").value,
      img_api_url: document.getElementById("img-api-url").value,
      img_api_key: document.getElementById("img-api-key").value,
      img_model: document.getElementById("img-model").value,
      segments_per_page: (() => {
        const v = parseInt(document.getElementById("segments-per-page").value);
        return isNaN(v) ? 0 : v;
      })(),
      negative_prompt: document.getElementById("negative-prompt").value,
      reference_strength: (() => {
        var _a;
        const v = parseFloat(((_a = document.getElementById("reference-strength")) == null ? void 0 : _a.value) || "");
        return isNaN(v) ? 0.6 : Math.max(0, Math.min(1, v));
      })(),
      style_preset_ids: Array.from(state.selectedPresetIds),
      custom_style_tags: state.customStyleTags.slice(),
      comic_mode: getComicModeFromDom(),
      bubble_render_mode: getBubbleRenderModeFromDom()
    };
    localStorage.setItem("manga_config", JSON.stringify(config));
    try {
      await fetch("/api/save-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(config)
      });
    } catch (e) {
    }
    showToast("\u914D\u7F6E\u5DF2\u4FDD\u5B58", "success");
  }
  async function loadConfig() {
    try {
      const response = await fetch("/api/load-config", { credentials: "include" });
      if (response.ok) {
        const serverConfig = await response.json();
        if (serverConfig && Object.keys(serverConfig).length > 0) {
          localStorage.setItem("manga_config", JSON.stringify(serverConfig));
          applyConfigToForm(serverConfig);
          return;
        }
      }
    } catch (e) {
    }
    const saved = localStorage.getItem("manga_config");
    if (saved) {
      applyConfigToForm(JSON.parse(saved));
    }
  }
  function applyConfigToForm(config) {
    var _a;
    document.getElementById("llm-api-url").value = config.llm_api_url || "";
    document.getElementById("llm-api-key").value = config.llm_api_key || "";
    document.getElementById("llm-model").value = config.llm_model || "";
    document.getElementById("img-api-url").value = config.img_api_url || "";
    document.getElementById("img-api-key").value = config.img_api_key || "";
    document.getElementById("img-model").value = config.img_model || "";
    const spp = config.segments_per_page !== void 0 ? config.segments_per_page : 0;
    document.getElementById("segments-per-page").value = String(spp);
    document.getElementById("negative-prompt").value = config.negative_prompt || "";
    const rsEl = document.getElementById("reference-strength");
    if (rsEl) {
      rsEl.value = String((_a = config.reference_strength) != null ? _a : 0.6);
      const rsLabel = document.getElementById("reference-strength-value");
      if (rsLabel)
        rsLabel.textContent = parseFloat(rsEl.value).toFixed(2);
    }
    const presetIds = config.style_preset_ids && config.style_preset_ids.length > 0 ? config.style_preset_ids : ["acg"];
    state.selectedPresetIds = new Set(presetIds);
    state.customStyleTags = (config.custom_style_tags || []).slice();
    state.comicMode = config.comic_mode === "color" ? "color" : "bw";
    applyComicModeToDom();
    state.bubbleRenderMode = config.bubble_render_mode === "api" ? "api" : "pil";
    applyBubbleRenderModeToDom();
    renderStylePresets();
    renderCustomStyleTags();
    updateStyleSummary();
  }
  function updateCharCount() {
    const text = document.getElementById("novel-text").value;
    const cc = document.getElementById("char-count");
    if (cc)
      cc.textContent = String(text.length);
    markDirty();
    scheduleWorkspaceUI();
  }
  function updateAiwriteCharCount() {
    const t = document.getElementById("aiwrite-text");
    const el = document.getElementById("aiwrite-char-count");
    if (t && el)
      el.textContent = String(t.value.length);
  }
  function mirrorNovelText() {
    if (state._textSyncing)
      return;
    const s = document.getElementById("novel-text");
    const d = document.getElementById("aiwrite-text");
    if (!s || !d || s.value === d.value)
      return;
    state._textSyncing = true;
    d.value = s.value;
    state._textSyncing = false;
    updateAiwriteCharCount();
  }
  function mirrorAiwriteText() {
    if (state._textSyncing)
      return;
    const s = document.getElementById("aiwrite-text");
    const d = document.getElementById("novel-text");
    if (!s || !d || s.value === d.value)
      return;
    state._textSyncing = true;
    d.value = s.value;
    state._textSyncing = false;
    updateCharCount();
  }
  function awId(scope, key) {
    const map = scope === "input" ? {
      text: "novel-text",
      plotOptions: "inp-plot-options",
      direction: "inp-continue-direction",
      length: "inp-continue-length",
      genOptionsBtn: "inp-gen-options-btn",
      genOptionsLabel: "inp-gen-options-label",
      genOptionsSpinner: "inp-gen-options-spinner",
      continueBtn: "inp-continue-btn",
      continueLabel: "inp-continue-label",
      continueSpinner: "inp-continue-spinner",
      polishStyles: "inp-polish-styles",
      polishStyle: "inp-polish-style",
      genStylesBtn: "inp-gen-styles-btn",
      genStylesLabel: "inp-gen-styles-label",
      genStylesSpinner: "inp-gen-styles-spinner",
      polishBtn: "inp-polish-btn",
      polishLabel: "inp-polish-label",
      polishSpinner: "inp-polish-spinner",
      progress: "inp-polish-progress"
    } : {
      text: "aiwrite-text",
      plotOptions: "plot-options",
      direction: "continue-direction",
      length: "continue-length",
      genOptionsBtn: "gen-options-btn",
      genOptionsLabel: "gen-options-label",
      genOptionsSpinner: "gen-options-spinner",
      continueBtn: "continue-novel-btn",
      continueLabel: "continue-novel-label",
      continueSpinner: "continue-novel-spinner",
      polishStyles: "polish-styles",
      polishStyle: "polish-style",
      genStylesBtn: "gen-styles-btn",
      genStylesLabel: "gen-styles-label",
      genStylesSpinner: "gen-styles-spinner",
      polishBtn: "polish-novel-btn",
      polishLabel: "polish-novel-label",
      polishSpinner: "polish-novel-spinner",
      progress: "polish-progress"
    };
    return map[key];
  }
  function awEl(scope, key) {
    const id = awId(scope, key);
    return id ? document.getElementById(id) : null;
  }
  function awReadText(scope) {
    const el = awEl(scope, "text");
    return el ? el.value : "";
  }
  function awApplyText(scope, newValue) {
    if (scope === "input") {
      document.getElementById("novel-text").value = newValue;
      mirrorNovelText();
      updateCharCount();
    } else {
      document.getElementById("aiwrite-text").value = newValue;
      mirrorAiwriteText();
      updateAiwriteCharCount();
    }
  }
  function toggleInpAIWrite() {
    const content = document.getElementById("inp-aw-content");
    const icon = document.getElementById("inp-aw-toggle-icon");
    if (!content)
      return;
    const hidden = content.classList.toggle("hidden");
    if (icon)
      icon.textContent = hidden ? "\u25BC" : "\u25B2";
  }
  async function genPlotOptions(scope = "aiwrite") {
    const text = awReadText(scope).trim();
    if (!text) {
      showToast("\u8BF7\u5148\u8F93\u5165\u5C0F\u8BF4\u5185\u5BB9", "error");
      return;
    }
    const config = JSON.parse(localStorage.getItem("manga_config") || "{}");
    if (!config.llm_api_url) {
      showToast("\u8BF7\u5148\u914D\u7F6E\u5927\u8BED\u8A00\u6A21\u578BAPI", "error");
      openConfigModal();
      return;
    }
    const btn = awEl(scope, "genOptionsBtn");
    const labelEl = awEl(scope, "genOptionsLabel");
    const spinner = awEl(scope, "genOptionsSpinner");
    spinner == null ? void 0 : spinner.classList.remove("hidden");
    const unlock = lockButton(btn, labelEl, "\u6784\u601D\u4E2D\u2026");
    const toastId = showLoadingToast("\u6B63\u5728\u6784\u601D\u5267\u60C5\u53D1\u5C55\u65B9\u5411\u2026");
    try {
      const response = await fetchWithRetry("/api/plot-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text,
          api_url: config.llm_api_url,
          api_key: config.llm_api_key || "",
          model: config.llm_model || ""
        })
      });
      const result = await response.json();
      dismissLoadingToast(toastId);
      if (result.success && Array.isArray(result.options) && result.options.length > 0) {
        state._plotOptions = result.options;
        renderPlotOptions(scope);
        showToast("\u5DF2\u751F\u6210\u5267\u60C5\u65B9\u5411\uFF0C\u70B9\u51FB\u9009\u62E9\u4E00\u4E2A", "success");
      } else {
        showToast(result.error || "\u5267\u60C5\u65B9\u5411\u751F\u6210\u5931\u8D25", "error");
      }
    } catch (e) {
      dismissLoadingToast(toastId);
      showToast("\u751F\u6210\u5931\u8D25: " + e.message, "error");
    } finally {
      spinner == null ? void 0 : spinner.classList.add("hidden");
      unlock();
    }
  }
  function renderPlotOptions(scope = "aiwrite") {
    const container = awEl(scope, "plotOptions");
    if (!container)
      return;
    container.innerHTML = "";
    state._plotOptions.forEach((opt, idx) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "plot-option-card text-left p-3 border-2 border-gray-300 hover:border-black hover:bg-gray-50 transition-colors text-sm flex items-start gap-2";
      card.innerHTML = `<span class="font-bold text-xs text-gray-400 mt-0.5">${idx + 1}</span><span>${escapeHtml(opt)}</span>`;
      card.onclick = () => selectPlotOption(idx, scope);
      container.appendChild(card);
    });
    playStagger(container);
  }
  function selectPlotOption(idx, scope = "aiwrite") {
    const opt = state._plotOptions[idx];
    if (!opt)
      return;
    const dirInput = awEl(scope, "direction");
    if (dirInput)
      dirInput.value = opt;
    const plotId = awId(scope, "plotOptions");
    if (!plotId)
      return;
    document.querySelectorAll(`#${plotId} .plot-option-card`).forEach((el, i) => {
      el.classList.toggle("border-black", i === idx);
      el.classList.toggle("bg-gray-100", i === idx);
      el.classList.toggle("border-gray-300", i !== idx);
    });
  }
  async function continueNovel(scope = "aiwrite") {
    var _a, _b;
    const text = awReadText(scope).trim();
    if (!text) {
      showToast("\u8BF7\u5148\u8F93\u5165\u5C0F\u8BF4\u5185\u5BB9", "error");
      return;
    }
    const config = JSON.parse(localStorage.getItem("manga_config") || "{}");
    if (!config.llm_api_url) {
      showToast("\u8BF7\u5148\u914D\u7F6E\u5927\u8BED\u8A00\u6A21\u578BAPI", "error");
      openConfigModal();
      return;
    }
    const length = parseInt(((_a = awEl(scope, "length")) == null ? void 0 : _a.value) || "800", 10);
    const direction = (((_b = awEl(scope, "direction")) == null ? void 0 : _b.value) || "").trim();
    const btn = awEl(scope, "continueBtn");
    const labelEl = awEl(scope, "continueLabel");
    const spinner = awEl(scope, "continueSpinner");
    spinner == null ? void 0 : spinner.classList.remove("hidden");
    const unlock = lockButton(btn, labelEl, "\u7EED\u5199\u4E2D\u2026");
    const toastId = showLoadingToast("AI \u7EED\u5199\u4E2D\uFF0C\u7EA6\u9700 30-60 \u79D2\u2026");
    try {
      const response = await fetchWithRetry("/api/continue-novel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text,
          api_url: config.llm_api_url,
          api_key: config.llm_api_key || "",
          model: config.llm_model || "",
          length,
          direction
        })
      });
      const result = await response.json();
      dismissLoadingToast(toastId);
      if (result.success && result.continuation) {
        awApplyText(scope, awReadText(scope).trimEnd() + "\n\n" + result.continuation);
        const ta = awEl(scope, "text");
        if (ta)
          ta.scrollTop = ta.scrollHeight;
        const total = awReadText(scope).length;
        const n = result.length || result.continuation.length;
        const extra = [];
        if (result.compressed)
          extra.push("\u539F\u6587\u8FC7\u957F\u5DF2\u7528\u6A21\u578B\u538B\u7F29\u524D\u60C5\u4E0A\u4E0B\u6587");
        if (total > 4e3)
          extra.push("\u5206\u955C\u53EF\u80FD\u53EA\u53D6\u5934\u5C3E\u54042000\u5B57");
        const note = extra.length ? "\uFF0C" + extra.join("\uFF0C") : "";
        showToast(`\u5DF2\u7EED\u5199 ${n} \u5B57\uFF08\u5F53\u524D\u5171 ${total} \u5B57\uFF09${note}`, "success");
        state._plotOptions = [];
        renderPlotOptions(scope);
        const w = window;
        if (typeof w.autoSaveWriting === "function")
          w.autoSaveWriting();
      } else {
        showToast(result.error || "\u7EED\u5199\u5931\u8D25", "error");
      }
    } catch (e) {
      dismissLoadingToast(toastId);
      showToast("\u7EED\u5199\u5931\u8D25: " + e.message, "error");
    } finally {
      spinner == null ? void 0 : spinner.classList.add("hidden");
      unlock();
    }
  }
  async function genPolishStyles(scope = "aiwrite") {
    const text = awReadText(scope).trim();
    if (!text) {
      showToast("\u8BF7\u5148\u8F93\u5165\u5C0F\u8BF4\u5185\u5BB9", "error");
      return;
    }
    const config = JSON.parse(localStorage.getItem("manga_config") || "{}");
    if (!config.llm_api_url) {
      showToast("\u8BF7\u5148\u914D\u7F6E\u5927\u8BED\u8A00\u6A21\u578BAPI", "error");
      openConfigModal();
      return;
    }
    const btn = awEl(scope, "genStylesBtn");
    const labelEl = awEl(scope, "genStylesLabel");
    const spinner = awEl(scope, "genStylesSpinner");
    spinner == null ? void 0 : spinner.classList.remove("hidden");
    const unlock = lockButton(btn, labelEl, "\u6784\u601D\u4E2D\u2026");
    const toastId = showLoadingToast("\u6B63\u5728\u6784\u601D\u6DA6\u8272\u98CE\u683C\u2026");
    try {
      const response = await fetchWithRetry("/api/polish-styles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text,
          api_url: config.llm_api_url,
          api_key: config.llm_api_key || "",
          model: config.llm_model || ""
        })
      });
      const result = await response.json();
      dismissLoadingToast(toastId);
      if (result.success && Array.isArray(result.styles) && result.styles.length > 0) {
        state._polishStyles = result.styles;
        renderPolishStyles(scope);
        showToast("\u5DF2\u751F\u6210\u6DA6\u8272\u98CE\u683C\uFF0C\u70B9\u51FB\u9009\u62E9\u4E00\u4E2A", "success");
      } else {
        showToast(result.error || "\u6DA6\u8272\u98CE\u683C\u751F\u6210\u5931\u8D25", "error");
      }
    } catch (e) {
      dismissLoadingToast(toastId);
      showToast("\u751F\u6210\u5931\u8D25: " + e.message, "error");
    } finally {
      spinner == null ? void 0 : spinner.classList.add("hidden");
      unlock();
    }
  }
  function renderPolishStyles(scope = "aiwrite") {
    const container = awEl(scope, "polishStyles");
    if (!container)
      return;
    container.innerHTML = "";
    state._polishStyles.forEach((style, idx) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "polish-style-card text-left p-3 border-2 border-gray-300 hover:border-black hover:bg-gray-50 transition-colors text-sm";
      card.innerHTML = `<div class="font-bold mb-0.5">${escapeHtml(style.name)}</div><div class="text-xs text-gray-500">${escapeHtml(style.instruction)}</div>`;
      card.onclick = () => selectPolishStyle(idx, scope);
      container.appendChild(card);
    });
    playStagger(container);
  }
  function selectPolishStyle(idx, scope = "aiwrite") {
    const style = state._polishStyles[idx];
    if (!style)
      return;
    const input = awEl(scope, "polishStyle");
    if (input)
      input.value = style.instruction;
    const polishId = awId(scope, "polishStyles");
    if (!polishId)
      return;
    document.querySelectorAll(`#${polishId} .polish-style-card`).forEach((el, i) => {
      el.classList.toggle("border-black", i === idx);
      el.classList.toggle("bg-gray-100", i === idx);
      el.classList.toggle("border-gray-300", i !== idx);
    });
  }
  async function polishNovel(scope = "aiwrite") {
    var _a;
    const text = awReadText(scope).trim();
    if (!text) {
      showToast("\u8BF7\u5148\u8F93\u5165\u5C0F\u8BF4\u5185\u5BB9", "error");
      return;
    }
    const config = JSON.parse(localStorage.getItem("manga_config") || "{}");
    if (!config.llm_api_url) {
      showToast("\u8BF7\u5148\u914D\u7F6E\u5927\u8BED\u8A00\u6A21\u578BAPI", "error");
      openConfigModal();
      return;
    }
    state._polishOriginal = awReadText(scope);
    state._polishScope = scope;
    if (text.length > 8e3) {
      showToast("\u5185\u5BB9\u8F83\u957F\uFF0C\u6DA6\u8272\u53EF\u80FD\u9700\u8981 1-3 \u5206\u949F", "info");
    }
    const style = (((_a = awEl(scope, "polishStyle")) == null ? void 0 : _a.value) || "").trim();
    const btn = awEl(scope, "polishBtn");
    const labelEl = awEl(scope, "polishLabel");
    const spinner = awEl(scope, "polishSpinner");
    spinner == null ? void 0 : spinner.classList.remove("hidden");
    const unlock = lockButton(btn, labelEl, "\u6DA6\u8272\u4E2D\u2026");
    const progressId = awId(scope, "progress") || "polish-progress";
    const task = registerTaskProgress(progressId);
    task.startFallback(24e4);
    try {
      const response = await fetchWithRetry("/api/polish-novel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text,
          api_url: config.llm_api_url,
          api_key: config.llm_api_key || "",
          model: config.llm_model || "",
          style,
          task_id: task.task_id
        })
      });
      const result = await response.json();
      task.finish();
      if (result.success && result.polished) {
        state._polishResult = result.polished;
        openPolishCompare();
      } else {
        showToast(result.error || "\u6DA6\u8272\u5931\u8D25", "error");
      }
    } catch (e) {
      task.finish();
      showToast("\u6DA6\u8272\u5931\u8D25: " + e.message, "error");
    } finally {
      spinner == null ? void 0 : spinner.classList.add("hidden");
      unlock();
    }
  }
  function openPolishCompare() {
    const modal = document.getElementById("polish-compare-modal");
    if (!modal)
      return;
    const origEl = document.getElementById("polish-original");
    if (origEl)
      origEl.textContent = state._polishOriginal;
    const resEl = document.getElementById("polish-result");
    if (resEl)
      resEl.textContent = state._polishResult;
    const t = window.__t2cTransitions;
    if (t) {
      t.openModal("polish-compare-modal");
    } else {
      modal.classList.remove("modal-closing", "hidden");
    }
  }
  function cancelPolishCompare() {
    const w = window;
    if (typeof w.closeModalA11y === "function")
      w.closeModalA11y("polish-compare-modal");
    if (typeof w.animateCloseModal === "function")
      w.animateCloseModal("polish-compare-modal");
  }
  function confirmPolishReplace() {
    const scope = state._polishScope || "aiwrite";
    if (awReadText(scope) !== state._polishOriginal && !confirm("\u539F\u6587\u5728\u6DA6\u8272\u671F\u95F4\u88AB\u4FEE\u6539\u8FC7\uFF0C\u786E\u5B9A\u7528\u6DA6\u8272\u7A3F\u8986\u76D6\u5417\uFF1F")) {
      return;
    }
    awApplyText(scope, state._polishResult);
    cancelPolishCompare();
    const total = awReadText(scope).length;
    showToast(`\u6DA6\u8272\u5B8C\u6210\u5E76\u5DF2\u66FF\u6362\uFF08\u5F53\u524D\u5171 ${total} \u5B57\uFF09`, "success");
    state._polishStyles = [];
    renderPolishStyles(scope);
    const w = window;
    if (typeof w.autoSaveWriting === "function")
      w.autoSaveWriting();
  }
  function initWorkspace() {
    workMetaInit();
    const novelEl = document.getElementById("novel-text");
    if (novelEl) {
      novelEl.addEventListener("input", () => {
        updateCharCount();
        mirrorNovelText();
      });
    }
    const aiwriteEl = document.getElementById("aiwrite-text");
    if (aiwriteEl) {
      aiwriteEl.addEventListener("input", () => {
        updateAiwriteCharCount();
        mirrorAiwriteText();
      });
    }
    renderStylePresets();
    renderCustomStyleTags();
    applyComicModeToDom();
    applyBubbleRenderModeToDom();
    if (!localStorage.getItem("manga_config")) {
      state.selectedPresetIds = /* @__PURE__ */ new Set(["acg"]);
    }
    renderStylePresets();
    updateStyleSummary();
    updateCharCount();
    mirrorNovelText();
  }

  // static/src/modules/dragdrop.ts
  function bindDropZone(input, zone) {
    if (zone.dataset.ddBound === "1")
      return;
    zone.dataset.ddBound = "1";
    ["dragenter", "dragover"].forEach((ev) => {
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add("is-drag-over");
      });
    });
    ["dragleave", "drop"].forEach((ev) => {
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove("is-drag-over");
      });
    });
    zone.addEventListener("drop", (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length)
        return;
      try {
        const dt = new DataTransfer();
        Array.from(files).forEach((f) => dt.items.add(f));
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        showToast("\u5DF2\u63A5\u6536 " + files.length + " \u4E2A\u6587\u4EF6", "success");
      } catch (err) {
        showToast("\u62D6\u62FD\u4E0A\u4F20\u5931\u8D25: " + err.message, "error");
      }
    });
  }
  function setupDragDropUpload() {
    const charInputs = document.querySelectorAll('[id^="char-upload-"]');
    charInputs.forEach((node) => {
      const input = node;
      const zone = input.closest(".upload-zone, label, div") || input.parentElement;
      if (zone)
        bindDropZone(input, zone);
    });
    const comicInput = document.getElementById("comic-file-input");
    const comicZone = document.getElementById("comic-upload-zone");
    if (comicInput && comicZone) {
      bindDropZone(comicInput, comicZone);
    }
  }

  // static/src/modules/characters.ts
  async function analyzeCharacters() {
    const text = document.getElementById("novel-text").value.trim();
    if (!text) {
      showToast("\u8BF7\u5148\u8F93\u5165\u5C0F\u8BF4\u5185\u5BB9", "error");
      switchTab("input");
      return;
    }
    const config = JSON.parse(localStorage.getItem("manga_config") || "{}");
    if (!config.llm_api_url) {
      showToast("\u8BF7\u5148\u914D\u7F6EAPI", "error");
      openConfigModal();
      return;
    }
    const spinner = document.getElementById("analyze-spinner");
    spinner == null ? void 0 : spinner.classList.remove("hidden");
    const unlock = lockButton(
      document.getElementById("analyze-characters-btn"),
      document.getElementById("analyze-characters-label"),
      "\u89D2\u8272\u5206\u6790\u4E2D\u2026"
    );
    const task = registerTaskProgress("analyze-progress");
    task.startFallback(12e4);
    try {
      const response = await fetchWithRetry("/api/generate-characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text,
          api_url: config.llm_api_url,
          api_key: config.llm_api_key,
          model: config.llm_model,
          task_id: task.task_id
        })
      });
      const result = await response.json();
      task.finish();
      if (result.success) {
        const newChars = result.data.characters || [];
        const merged = [];
        const matchedOldIdx = /* @__PURE__ */ new Set();
        for (const nc of newChars) {
          const ncName = (nc.name || "").trim();
          const oldIdx = state.characters.findIndex((oc) => (oc.name || "").trim() === ncName);
          if (oldIdx !== -1) {
            matchedOldIdx.add(oldIdx);
            const old = state.characters[oldIdx];
            merged.push(__spreadProps(__spreadValues(__spreadValues({}, old), nc), {
              // 新的描述/名字等
              image_url: old.image_url || nc.image_url || "",
              char_prompt: old.char_prompt || nc.char_prompt || ""
            }));
          } else {
            merged.push(__spreadProps(__spreadValues({}, nc), { char_prompt: nc.char_prompt || "" }));
          }
        }
        for (let i = 0; i < state.characters.length; i++) {
          if (!matchedOldIdx.has(i)) {
            merged.push(state.characters[i]);
          }
        }
        state.characters = merged;
        renderCharacters();
        syncResults();
        const keptCount = merged.length - newChars.length;
        const msg = keptCount > 0 ? `\u5206\u6790 ${newChars.length} \u4E2A\u89D2\u8272, \u4FDD\u7559\u65E7\u89D2\u8272 ${keptCount} \u4E2A` : `\u6210\u529F\u5206\u6790 ${state.characters.length} \u4E2A\u89D2\u8272`;
        showToast(msg, "success");
      } else {
        showToast(result.error || "\u5206\u6790\u5931\u8D25", "error");
      }
    } catch (e) {
      task.finish();
      showToast("\u8BF7\u6C42\u5931\u8D25: " + e.message, "error");
    } finally {
      spinner == null ? void 0 : spinner.classList.add("hidden");
      unlock();
    }
  }
  function clearCharacters() {
    if (state.characters.length === 0) {
      showToast("\u89D2\u8272\u5217\u8868\u5DF2\u4E3A\u7A7A", "info");
      return;
    }
    if (!confirm(`\u786E\u8BA4\u6E05\u7A7A\u6240\u6709 ${state.characters.length} \u4E2A\u89D2\u8272\u5417?

\u6B64\u64CD\u4F5C\u4F1A\u540C\u65F6\u6E05\u9664\u5206\u955C\u4E2D\u5BF9\u89D2\u8272\u7684\u5F15\u7528, \u65E0\u6CD5\u64A4\u9500\u3002`))
      return;
    state.characters = [];
    if (state.currentSegments && state.currentSegments.pages) {
      state.currentSegments.pages.forEach((page) => {
        (page.segments || []).forEach((seg) => {
          seg.selected_characters = [];
        });
      });
    }
    renderCharacters();
    const w = window;
    if (typeof w.renderSegments === "function")
      w.renderSegments();
    syncResults();
    showToast("\u5DF2\u6E05\u7A7A\u6240\u6709\u89D2\u8272", "success");
  }
  function renderCharacters() {
    const container = document.getElementById("characters-container");
    if (!container)
      return;
    const t = window.__t2cTransitions;
    if (t)
      t.resetStagger(container);
    if (state.characters.length === 0) {
      container.innerHTML = `<div class="col-span-full empty-state">
            <span class="es-halftone" aria-hidden="true"></span>
            <div class="es-icon" data-icon="masks"></div>
            <p class="es-title">\u8FD8\u6CA1\u6709\u89D2\u8272</p>
            <p class="es-hint">\u70B9\u4E0B\u9762\u7684\u6309\u94AE\uFF0C\u6A21\u578B\u4F1A\u4ECE\u5C0F\u8BF4\u7684\u524D 8000 \u5B57\u91CC\u6311\u51FA\u4E3B\u8981\u51FA\u573A\u89D2\u8272\uFF0C\u5E76\u7ED9\u51FA\u5916\u8C8C\u4E0E\u6027\u683C\u63CF\u8FF0\u3002</p>
            <button onclick="analyzeCharacters()" class="btn-primary px-5 py-2 text-sm font-medium">\u4ECE\u5C0F\u8BF4\u5206\u6790\u89D2\u8272</button>
        </div>`;
      return;
    }
    container.innerHTML = state.characters.map((char, idx) => {
      const safeImageUrl = escapeHtml(char.image_url || "");
      return `
        <div class="bg-white p-4 manga-border panel-shadow upload-zone flex flex-col">
            <div class="flex justify-between items-start gap-2 mb-2">
                <h3 class="text-base md:text-lg font-black truncate">${escapeHtml(char.name)}</h3>
                <button onclick="togglePromptEditor(${idx})" class="text-xs font-semibold border border-[#d4d1c7] hover:border-[#111112] px-2 py-0.5 bg-[#f7f6f2] hover:bg-white transition-colors inline-flex items-center gap-1 shrink-0" title="\u7F16\u8F91\u4EBA\u8BBE\u56FE\u751F\u6210\u63D0\u793A\u8BCD" id="prompt-toggle-${idx}"><span data-icon="pencil" class="ico-12"></span> Prompt</button>
            </div>
            <p class="text-xs md:text-sm text-[#4e4e54] leading-relaxed mb-3">${escapeHtml(char.description)}</p>
            ${char.image_url ? `
            <div class="mb-3 border-2 border-[#111112] relative group bg-[#f7f6f2] overflow-hidden">
                <img src="${safeImageUrl}" class="w-full h-52 object-cover cursor-pointer transition-transform duration-300 group-hover:scale-[1.02]" onclick="openModal('${safeImageUrl}')">
                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                    <button onclick="event.stopPropagation(); uploadCharacterImage(${idx})" class="bg-white border-2 border-[#111112] text-xs font-bold px-2.5 py-1 hover:bg-[#faeae6] inline-flex items-center gap-1" title="\u624B\u52A8\u4E0A\u4F20/\u66F4\u6362\u56FE\u7247"><span data-icon="upload" class="ico-12"></span> \u6362\u56FE</button>
                </div>
            </div>
            ` : `
            <div class="mb-3 border-2 border-dashed border-[#d4d1c7] bg-[#f7f6f2] py-6 px-3 text-center text-xs text-[#7d7d84]">
                \u53EF\u70B9\u51FB\u4E0B\u65B9\u751F\u6210\uFF0C\u6216\u76F4\u63A5\u62D6\u62FD\u4EBA\u8BBE\u56FE\u5230\u5361\u7247\u4E0A\u4F20
            </div>
            `}
            <div id="prompt-editor-${idx}" class="hidden mb-3">
                <label class="block text-xs font-bold text-[#4e4e54] mb-1">\u56FE\u50CF\u751F\u6210\u63D0\u793A\u8BCD\uFF08\u7559\u7A7A\u5219\u81EA\u52A8\u751F\u6210\uFF09</label>
                <textarea id="char-prompt-${idx}" rows="3" class="w-full text-xs input-ink p-2 font-mono" oninput="saveCharPrompt(${idx}, this.value)" onblur="saveCharPrompt(${idx}, this.value)">${escapeHtml(char.char_prompt || "")}</textarea>
                <div class="text-xs text-[#7d7d84] mt-1">
                    \u5B9E\u65F6\u540C\u6B65 \xB7 \u5F53\u524D\u63D0\u793A\u8BCD\uFF1A
                    <code class="text-[#111112]" id="char-prompt-preview-${idx}">${escapeHtml(char.char_prompt || "(\u81EA\u52A8\u751F\u6210)")}</code>
                </div>
            </div>
            <div class="flex gap-2 mt-auto pt-1">
                <button onclick="generateCharacterImage(${idx}, this)" class="flex-1 btn-primary py-2 text-xs md:text-sm">
                    ${char.image_url ? "\u91CD\u65B0\u751F\u6210" : "\u751F\u6210\u4EBA\u8BBE\u56FE"}
                </button>
                <button onclick="uploadCharacterImage(${idx})" class="flex-1 btn-ghost py-2 text-xs md:text-sm">
                    <span data-icon="upload" class="ico-14"></span> ${char.image_url ? "\u66F4\u6362\u56FE\u7247" : "\u4E0A\u4F20\u53C2\u8003\u56FE"}
                </button>
            </div>
            <input type="file" id="char-upload-${idx}" accept="image/*" class="hidden" onchange="handleCharacterImageFile(${idx}, this)">
        </div>
    `;
    }).join("");
    setupDragDropUpload();
    const w = window;
    if (typeof w.hydrateIcons === "function")
      w.hydrateIcons(container);
    playStagger(container);
    markDirtyLocal();
    if (typeof w.scheduleWorkspaceUI === "function")
      w.scheduleWorkspaceUI();
  }
  function markDirtyLocal() {
    const w = window;
    if (typeof w.markDirty === "function")
      w.markDirty();
  }
  function togglePromptEditor(idx) {
    const editor = document.getElementById(`prompt-editor-${idx}`);
    if (editor)
      editor.classList.toggle("hidden");
  }
  function saveCharPrompt(idx, value) {
    if (!state.characters[idx])
      return;
    state.characters[idx].char_prompt = value;
    const preview = document.getElementById(`char-prompt-preview-${idx}`);
    if (preview)
      preview.textContent = value.trim() || "(\u81EA\u52A8\u751F\u6210)";
    const w = window;
    if (!w._charPromptTimers)
      w._charPromptTimers = {};
    if (w._charPromptTimers[idx])
      clearTimeout(w._charPromptTimers[idx]);
    w._charPromptTimers[idx] = setTimeout(() => {
      syncResults();
    }, 1e3);
  }
  function uploadCharacterImage(idx) {
    const input = document.getElementById(`char-upload-${idx}`);
    if (input)
      input.click();
  }
  function handleCharacterImageFile(idx, input) {
    const file = input.files && input.files[0];
    if (!file)
      return;
    input.value = "";
    if (!file.type.startsWith("image/")) {
      showToast("\u8BF7\u9009\u62E9\u56FE\u7247\u6587\u4EF6", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast("\u56FE\u7247\u8D85\u8FC7 5MB, \u8BF7\u538B\u7F29\u540E\u518D\u4E0A\u4F20", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      compressImage(dataUrl, 1024).then((compressed) => {
        applyCharacterImage(idx, compressed, false);
      }).catch((err) => {
        applyCharacterImage(idx, dataUrl, true);
      });
    };
    reader.onerror = () => {
      showToast("\u8BFB\u53D6\u56FE\u7247\u5931\u8D25", "error");
    };
    reader.readAsDataURL(file);
  }
  function applyCharacterImage(idx, dataUrl, isUncompressedFallback) {
    if (!state.characters[idx]) {
      showToast("\u89D2\u8272\u5DF2\u4E0D\u5B58\u5728\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9", "error");
      return;
    }
    const approxBytes = Math.round(dataUrl.length * 3 / 4);
    if (isUncompressedFallback && approxBytes > 500 * 1024) {
      showToast(`\u300C${state.characters[idx].name}\u300D\u56FE\u7247\u683C\u5F0F\u4E0D\u652F\u6301\uFF0C\u5DF2\u8DF3\u8FC7`, "error");
      return;
    }
    state.characters[idx].image_url = dataUrl;
    renderCharacters();
    const w = window;
    if (typeof w.renderSegments === "function")
      w.renderSegments();
    syncResults();
    if (typeof w.saveCurrentState === "function") {
      w.saveCurrentState().catch((e) => console.error("save character image failed:", e));
    }
    const tail = isUncompressedFallback ? " (\u672A\u538B\u7F29)" : "";
    showToast(`\u300C${state.characters[idx].name}\u300D\u4EBA\u8BBE\u56FE\u5DF2\u66F4\u65B0${tail}`, "success");
  }
  function compressImage(dataUrl, maxSide) {
    return new Promise((resolve, reject) => {
      const srcMatch = (dataUrl.match(/^data:image\/(\w+);/) || [])[1] || "";
      const srcType = srcMatch.toLowerCase();
      const keepAlpha = srcType === "png" || srcType === "webp" || srcType === "gif";
      const outMime = keepAlpha ? "image/png" : "image/jpeg";
      const quality = keepAlpha ? void 0 : 0.85;
      const img = new Image();
      img.onload = () => {
        try {
          let drawW = img.naturalWidth, drawH = img.naturalHeight;
          if (typeof createImageBitmap === "function") {
            fetch(dataUrl).then((r) => r.blob()).then((blob) => {
              createImageBitmap(blob, { imageOrientation: "from-image" }).then((bmp) => {
                drawW = bmp.width;
                drawH = bmp.height;
                _drawToDataUrl(bmp, drawW, drawH, maxSide, outMime, quality, resolve, reject);
              }).catch(() => {
                _drawToDataUrl(img, img.naturalWidth, img.naturalHeight, maxSide, outMime, quality, resolve, reject);
              });
            }).catch(() => {
              _drawToDataUrl(img, img.naturalWidth, img.naturalHeight, maxSide, outMime, quality, resolve, reject);
            });
          } else {
            _drawToDataUrl(img, img.naturalWidth, img.naturalHeight, maxSide, outMime, quality, resolve, reject);
          }
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error("image load failed"));
      img.src = dataUrl;
    });
  }
  function _drawToDataUrl(src, w0, h0, maxSide, outMime, quality, resolve, reject) {
    try {
      let w = w0, h = h0;
      if (Math.max(w, h) > maxSide) {
        if (w >= h) {
          h = Math.round(h * maxSide / w);
          w = maxSide;
        } else {
          w = Math.round(w * maxSide / h);
          h = maxSide;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (outMime === "image/jpeg") {
        if (ctx) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
        }
      }
      if (ctx)
        ctx.drawImage(src, 0, 0, w, h);
      resolve(canvas.toDataURL(outMime, quality));
    } catch (e) {
      reject(e);
    }
  }
  async function generateCharacterImage(idx, btn = null) {
    const char = state.characters[idx];
    const promptEl = document.getElementById(`char-prompt-${idx}`);
    if (promptEl && state.characters[idx]) {
      state.characters[idx].char_prompt = promptEl.value;
    }
    const config = JSON.parse(localStorage.getItem("manga_config") || "{}");
    if (!config.img_api_url) {
      showToast("\u8BF7\u5148\u914D\u7F6E\u56FE\u50CF\u751F\u6210API", "error");
      openConfigModal();
      return;
    }
    if (btn && btn.dataset.busy === "1")
      return;
    if (btn) {
      btn.dataset.busy = "1";
      btn.disabled = true;
      btn.classList.add("opacity-60", "cursor-not-allowed");
    }
    const toastId = showLoadingToast(`\u6B63\u5728\u4E3A\u300C${char.name}\u300D\u751F\u6210\u57FA\u7EBF\u4EBA\u8BBE\u56FE\u2026`);
    try {
      const response = await fetchWithRetry("/api/generate-character-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: char.name,
          description: char.description,
          prompt: char.char_prompt || "",
          // 用户自定义 prompt, 空 = 自动生成
          api_url: config.img_api_url,
          api_key: config.img_api_key,
          model: config.img_model,
          comic_mode: state.comicMode,
          max_attempts: 3
        })
      });
      const result = await response.json();
      if (result.success) {
        state.characters[idx].image_url = result.image_url;
        renderCharacters();
        const w = window;
        if (typeof w.renderSegments === "function")
          w.renderSegments();
        syncResults();
        if (typeof w.saveCurrentState === "function") {
          w.saveCurrentState().catch((e) => console.error("save AI char image failed:", e));
        }
        const attemptInfo = result.attempts > 1 ? ` (\u5C1D\u8BD5 ${result.attempts}/${result.max_attempts || 3} \u6B21\u62FF\u5230\u5408\u683C\u57FA\u7EBF\u56FE)` : "";
        dismissLoadingToast(toastId);
        showToast(`${char.name} \u4EBA\u8BBE\u56FE\u751F\u6210\u6210\u529F${attemptInfo}`, "success");
      } else {
        dismissLoadingToast(toastId);
        showToast(result.error || "\u751F\u6210\u5931\u8D25", "error");
      }
    } catch (e) {
      dismissLoadingToast(toastId);
      showToast("\u8BF7\u6C42\u5931\u8D25: " + e.message, "error");
    } finally {
      if (btn) {
        btn.dataset.busy = "";
        btn.disabled = false;
        btn.classList.remove("opacity-60", "cursor-not-allowed");
        renderCharacters();
      }
    }
  }

  // static/src/modules/segments.ts
  async function startSegment() {
    const text = document.getElementById("novel-text").value.trim();
    if (!text) {
      showToast("\u8BF7\u5148\u8F93\u5165\u5C0F\u8BF4\u5185\u5BB9", "error");
      return;
    }
    const config = JSON.parse(localStorage.getItem("manga_config") || "{}");
    if (!config.llm_api_url) {
      showToast("\u8BF7\u5148\u914D\u7F6E\u5927\u8BED\u8A00\u6A21\u578BAPI", "error");
      openConfigModal();
      return;
    }
    const spinner = document.getElementById("segment-spinner");
    spinner == null ? void 0 : spinner.classList.remove("hidden");
    const unlock = lockButton(
      document.getElementById("start-segment-btn"),
      document.getElementById("start-segment-label"),
      "\u5206\u955C\u751F\u6210\u4E2D\u2026"
    );
    const task = registerTaskProgress("segment-progress");
    task.startFallback(12e4);
    try {
      const response = await fetchWithRetry("/api/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text,
          api_url: config.llm_api_url,
          api_key: config.llm_api_key,
          model: config.llm_model,
          segments_per_page: config.segments_per_page !== void 0 ? config.segments_per_page : 0,
          comic_mode: state.comicMode,
          task_id: task.task_id
        })
      });
      const result = await response.json();
      task.finish();
      if (result.success) {
        try {
          await fetchWithRetry("/api/clear-cache", { method: "POST", credentials: "include" }, 1);
        } catch (e) {
          console.log("clear-cache skipped:", e.message);
        }
        state.generatedImages = {};
        state.fullPageImages = {};
        state.combinedPageImages = {};
        state.fullPageCleanImages = {};
        state.fullPageBubbles = {};
        state.characters.forEach((c) => {
          c.image_url = "";
          c.char_prompt = "";
        });
        const w = window;
        if (typeof w.renderGallery === "function")
          w.renderGallery();
        state.currentSegments = result.data;
        const newChars = Array.isArray(result.characters) ? result.characters : [];
        const hadChars = state.characters && state.characters.length > 0;
        if (newChars.length > 0) {
          if (!hadChars) {
            state.characters = newChars;
          } else {
            const existing = new Set(state.characters.map((c) => (c.name || "").trim()));
            for (const c of newChars) {
              if (c && c.name && !existing.has((c.name || "").trim())) {
                state.characters.push(c);
              }
            }
          }
          if (typeof w.renderCharacters === "function")
            w.renderCharacters();
          syncResults();
        }
        renderSegments();
        syncResults();
        const charCount = newChars.length;
        const charMsg = charCount > 0 ? `\uFF0C\u5E76\u81EA\u52A8\u63D0\u53D6 ${charCount} \u4E2A\u89D2\u8272` : "";
        showToast(`\u6210\u529F\u751F\u6210 ${state.currentSegments.pages.length} \u9875\u5206\u955C${charMsg}\uFF0C\u65E7\u56FE\u7247\u5DF2\u6E05\u9664`, "success");
        if (typeof w.saveCurrentState === "function") {
          w.saveCurrentState().catch((e) => console.log("auto save work error:", e));
        }
        if (newChars.length > 0) {
          switchTab("characters");
        } else {
          switchTab("segments");
        }
      } else {
        showToast(result.error || "\u5206\u955C\u5931\u8D25", "error");
      }
    } catch (e) {
      task.finish();
      showToast("\u8BF7\u6C42\u5931\u8D25: " + e.message, "error");
    } finally {
      spinner == null ? void 0 : spinner.classList.add("hidden");
      unlock();
    }
  }
  function renderSegments() {
    const container = document.getElementById("segments-container");
    if (!container)
      return;
    const t = window.__t2cTransitions;
    if (t)
      t.resetStagger(container);
    if (!state.currentSegments.pages || state.currentSegments.pages.length === 0) {
      container.innerHTML = emptyState(
        "note",
        "\u8FD8\u6CA1\u6709\u5206\u955C",
        "\u56DE\u5230\u300C\u5C0F\u8BF4\u8F93\u5165\u300D\u7C98\u8D34\u6B63\u6587\uFF0C\u70B9\u300C\u5F00\u59CB\u667A\u80FD\u5206\u955C\u300D\uFF0C\u6A21\u578B\u4F1A\u6309\u60C5\u8282\u5207\u9875\u5206\u683C\uFF0C\u5E76\u7ED9\u6BCF\u53E5\u5BF9\u767D\u6311\u4E00\u79CD\u8BED\u6C14\u3002",
        { onclick: "switchTab('input')", label: "\u53BB\u8F93\u5165\u5C0F\u8BF4" }
      );
      return;
    }
    container.innerHTML = state.currentSegments.pages.map((page, pageIdx) => {
      const hasFullPageImage = state.fullPageImages[pageIdx];
      const allSelectedChars = [];
      page.segments.forEach((seg) => {
        if (seg.selected_characters) {
          seg.selected_characters.forEach((cIdx) => {
            if (!allSelectedChars.includes(cIdx)) {
              allSelectedChars.push(cIdx);
            }
          });
        }
      });
      return `
        <div class="comic-page p-5 md:p-6">
            <div class="flex flex-wrap justify-between items-center gap-3 mb-4 pb-3 border-b-2 border-[#111112]">
                <h3 class="text-base md:text-lg font-black flex items-center gap-2">
                    <span class="ink-badge mono">PAGE ${String(page.page_number).padStart(2, "0")}</span>
                    <span>\u7B2C ${page.page_number} \u9875</span>
                </h3>
                <div class="flex gap-2">
                    <button onclick="generateFullPage(${pageIdx}, false, null, this)" class="btn-primary text-xs md:text-sm px-4 py-1.5">
                        <span>\u6574\u9875\u751F\u6210</span>
                        <span id="full-page-spinner-${pageIdx}" class="loading-spinner hidden" style="width:13px;height:13px;border-width:2px;"></span>
                    </button>
                </div>
            </div>
            <div id="fullpage-progress-${pageIdx}" class="mb-3"></div>
            ${hasFullPageImage ? `
            <div class="mb-6 border-2 border-[#111112] p-2 bg-[#f7f6f2]">
                <div class="text-xs font-bold text-[#15803d] mb-2 flex items-center gap-1.5"><span data-icon="check-circle" class="ico-14"></span>\u672C\u9875\u5DF2\u751F\u6210\u6574\u9875\u6F2B\u753B\uFF08\u70B9\u51FB\u5927\u56FE\u9884\u89C8\uFF09</div>
                <img src="${hasFullPageImage}" class="w-full cursor-pointer border border-[#d4d1c7]" onclick="openModal('${hasFullPageImage}')">
            </div>
            ` : ""}
            <div class="text-xs text-[#4e4e54] bg-[#f7f6f2] border border-[#e6e3da] px-3 py-1.5 mb-4">
                <span class="font-bold text-[#111112]">\u672C\u9875\u51FA\u573A\u89D2\u8272\uFF1A</span>${allSelectedChars.length > 0 ? allSelectedChars.map((cIdx) => {
        var _a;
        return escapeHtml(((_a = state.characters[cIdx]) == null ? void 0 : _a.name) || cIdx);
      }).join("\u3001") : "\uFF08\u672A\u6307\u5B9A\u89D2\u8272\uFF0C\u751F\u6210\u65F6\u5C06\u81EA\u52A8\u53C2\u8003\u5168\u90E8\u89D2\u8272\uFF09"}
            </div>
            <div class="grid md:grid-cols-2 gap-4">
                ${page.segments.map((seg, segIdx) => {
        const key = `${pageIdx}-${segIdx}`;
        const selectedChars = seg.selected_characters || [];
        const camOpts = ["\u4FEF\u89C6", "\u4EF0\u89C6", "\u5E73\u89C6", "\u659C\u89C6", "\u4E3B\u89C2\u89C6\u89D2"];
        const compOpts = ["\u4E09\u5206\u6CD5", "\u5BF9\u79F0", "\u4E2D\u5FC3\u5BF9\u79F0", "\u6846\u67B6\u5F0F", "\u5F15\u5BFC\u7EBF"];
        const moodOpts = ["\u7D27\u5F20", "\u7D2B\u84DD", "\u7D2B\u7EA2", "\u66A7\u6627", "\u60B2\u4F24", "\u6E29\u99A8", "\u538B\u6291", "\u6050\u6016"];
        const scaleOpts = ["\u5927\u8FDC\u666F", "\u8FDC\u666F", "\u5168\u666F", "\u4E2D\u666F", "\u8FD1\u666F", "\u7279\u5199", "\u5927\u7279\u5199"];
        const lightOpts = ["\u786C\u5149", "\u80CC\u5149", "\u9876\u5149", "\u8367\u5149\u706F", "\u5149\u6591", "\u67D4\u5149", "\u4FA7\u5149", "\u526A\u5F71"];
        const typeOpts = ["\u9759\u6001", "\u52A8\u6001", "\u56DE\u5FC6", "\u68A6\u5883"];
        const optHtml = (opts, cur) => `<option value=''>(\u65E0)</option>` + opts.map((o) => `<option ${o === cur ? "selected" : ""}>${o}</option>`).join("");
        return `
                    <div class="segment-box p-4 relative" id="segment-${key}">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-xs font-bold bg-black text-white px-2 py-1">\u5206\u955C ${seg.segment_number}</span>
                            <span class="text-xs text-gray-500">${seg.shot_type || "\u672A\u6307\u5B9A"}</span>
                        </div>
                        <div class="mb-2">
                            <label class="text-xs text-gray-500 font-medium">\u51FA\u573A\u89D2\u8272 (\u53C2\u8003\u56FE)</label>
                            <div class="flex flex-wrap gap-2 mt-1">
                                ${state.characters.length === 0 ? `
                                    <span class="text-xs text-gray-400">\u8BF7\u5148\u5230"\u89D2\u8272\u7BA1\u7406"\u751F\u6210\u89D2\u8272</span>
                                ` : state.characters.map((char, charIdx) => {
          const hasImage = !!(char.image_url || "").trim();
          const hasText = !!(char.char_prompt || "").trim() || !!(char.description || "").trim();
          const refState = hasImage ? "image" : hasText ? "text" : "none";
          const dimClass = refState === "none" ? "opacity-40" : "";
          const title = refState === "image" ? "\u5DF2\u4E0A\u4F20\u4EBA\u8BBE\u56FE, \u89D2\u8272\u5C06\u4EE5\u56FE\u4E3A\u51C6\u751F\u6210" : refState === "text" ? "\u65E0\u56FE\u4F46\u6709\u6587\u5B57\u63CF\u8FF0, \u5C06\u6309\u6587\u5B57\u63D0\u793A\u8BCD\u751F\u6210 (\u6548\u679C\u8F83\u5F31)" : "\u65E2\u65E0\u56FE\u4E5F\u65E0\u63CF\u8FF0, \u4E0D\u80FD\u4F5C\u4E3A\u53C2\u8003";
          return `
                                    <label class="flex items-center gap-1 text-xs bg-gray-100 px-2 py-1 rounded cursor-pointer hover:bg-gray-200 ${dimClass}" title="${title}">
                                        <input type="checkbox"
                                            ${selectedChars.includes(charIdx) ? "checked" : ""}
                                            ${refState === "none" ? "disabled" : ""}
                                            onchange="toggleCharacter(${pageIdx}, ${segIdx}, ${charIdx})"
                                            class="mr-1">
                                        ${escapeHtml(char.name)}${refState === "image" ? " \u25A3" : refState === "text" ? " \u{1F4DD}" : " (\u65E0)"}
                                    </label>
                                `;
        }).join("")}
                            </div>
                        </div>
                        <div class="mb-2">
                            <label class="text-xs text-gray-500 font-medium">\u573A\u666F\u63CF\u8FF0</label>
                            <textarea
                                onchange="updateSegment(${pageIdx}, ${segIdx}, 'scene_description', this.value)"
                                class="w-full p-2 border border-gray-300 text-sm mt-1 resize-none focus:border-black outline-none"
                                rows="2">${seg.scene_description || ""}</textarea>
                        </div>
                        <div class="mb-2">
                            <label class="text-xs text-gray-500 font-medium">\u5BF9\u8BDD/\u65C1\u767D (\u7C7B\u578B\u51B3\u5B9A\u6C14\u6CE1\u5F62\u72B6)</label>
                            <textarea
                                onchange="updateSegment(${pageIdx}, ${segIdx}, 'dialogue', this.value)"
                                class="w-full p-2 border border-gray-300 text-sm mt-1 resize-none focus:border-black outline-none"
                                rows="1">${seg.dialogue || ""}</textarea>
                            <div class="mt-1 flex items-center gap-2">
                                <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'dialogue_type', this.value); syncBubbleMini(this)"
                                    class="text-xs border border-gray-300 focus:border-black outline-none p-1 bg-white"
                                    title="\u6C14\u6CE1\u5F62\u72B6(LLM \u5206\u955C\u89C4\u5212\u65F6\u4F1A\u4E3B\u52A8\u9009, \u53EF\u624B\u52A8\u8986\u76D6)">
                                    <option value="dialogue" ${!seg.dialogue_type || seg.dialogue_type === "dialogue" ? "selected" : ""}>\u25CB \u5BF9\u8BDD\u6C14\u6CE1 (\u5706\u89D2\u77E9\u5F62)</option>
                                    <option value="thought" ${seg.dialogue_type === "thought" ? "selected" : ""}>\u25CC \u5FC3\u7406\u6D3B\u52A8 (\u4E91\u5F62)</option>
                                    <option value="shout" ${seg.dialogue_type === "shout" ? "selected" : ""}>\u203B \u5927\u558A (\u952F\u9F7F/\u7206\u70B8)</option>
                                    <option value="whisper" ${seg.dialogue_type === "whisper" ? "selected" : ""}>\xB7 \u8033\u8BED (\u865A\u7EBF\u5706\u89D2)</option>
                                    <option value="burst" ${seg.dialogue_type === "burst" ? "selected" : ""}>\u26A1 \u7206\u53D1 (\u8F90\u5C04\u5C04\u7EBF)</option>
                                    <option value="narration" ${seg.dialogue_type === "narration" ? "selected" : ""}>\u25AD \u65C1\u767D\u53D9\u8FF0 (\u77E9\u5F62)</option>
                                    <option value="box" ${seg.dialogue_type === "box" ? "selected" : ""}>\u25A2 \u65B9\u6846 (\u65E0\u5C3E\u77E9\u5F62)</option>
                                    <option value="caption" ${seg.dialogue_type === "caption" ? "selected" : ""}>\u25B2 \u62DF\u58F0\u8BCD (\u9ED1\u5E95\u767D\u5B57)</option>
                                </select>
                                <span class="bubble-mini" data-type="${(seg.dialogue_type || "dialogue").toLowerCase()}" title="\u6C14\u6CE1\u5F62\u72B6\u9884\u89C8"></span>
                                <span class="text-[10px] text-gray-400">\u5F62\u72B6\u9884\u89C8</span>
                            </div>
                        </div>
                        <details class="mb-2" ${seg.camera_angle || seg.composition || seg.mood || seg.shot_scale || seg.lighting || seg.of_type ? "open" : ""}>
                            <summary class="text-xs text-gray-500 font-medium cursor-pointer select-none">\u955C\u5934\u8BED\u8A00 (\u4EFB\u52A12) ${seg.camera_angle || seg.composition || seg.mood || seg.shot_scale || seg.lighting || seg.of_type ? '<span class="text-green-600">\u25CF</span>' : ""}</summary>
                            <div class="grid grid-cols-2 gap-2 mt-2">
                                <div>
                                    <label class="text-[10px] text-gray-500">\u89C6\u89D2</label>
                                    <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'camera_angle', this.value)" class="w-full p-1 text-xs border border-gray-300 focus:border-black outline-none">${optHtml(camOpts, seg.camera_angle || "")}</select>
                                </div>
                                <div>
                                    <label class="text-[10px] text-gray-500">\u6784\u56FE</label>
                                    <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'composition', this.value)" class="w-full p-1 text-xs border border-gray-300 focus:border-black outline-none">${optHtml(compOpts, seg.composition || "")}</select>
                                </div>
                                <div>
                                    <label class="text-[10px] text-gray-500">\u60C5\u7EEA</label>
                                    <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'mood', this.value)" class="w-full p-1 text-xs border border-gray-300 focus:border-black outline-none">${optHtml(moodOpts, seg.mood || "")}</select>
                                </div>
                                <div>
                                    <label class="text-[10px] text-gray-500">\u666F\u522B</label>
                                    <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'shot_scale', this.value)" class="w-full p-1 text-xs border border-gray-300 focus:border-black outline-none">${optHtml(scaleOpts, seg.shot_scale || "")}</select>
                                </div>
                                <div>
                                    <label class="text-[10px] text-gray-500">\u5149\u7167</label>
                                    <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'lighting', this.value)" class="w-full p-1 text-xs border border-gray-300 focus:border-black outline-none">${optHtml(lightOpts, seg.lighting || "")}</select>
                                </div>
                                <div>
                                    <label class="text-[10px] text-gray-500">\u573A\u666F\u7C7B\u578B</label>
                                    <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'of_type', this.value)" class="w-full p-1 text-xs border border-gray-300 focus:border-black outline-none">${optHtml(typeOpts, seg.of_type || "")}</select>
                                </div>
                            </div>
                        </details>
                        <div class="mb-3">
                            <label class="text-xs text-gray-500 font-medium">\u7ED8\u56FE\u63D0\u793A\u8BCD (\u5DF2\u542B\u955C\u5934\u8BED\u8A00\u5347\u7EA7)</label>
                            <textarea
                                onchange="updateSegment(${pageIdx}, ${segIdx}, 'style_prompt', this.value)"
                                class="w-full p-2 border border-gray-300 text-sm mt-1 resize-none focus:border-black outline-none font-mono text-xs"
                                rows="2">${seg.style_prompt || "black and white manga style, detailed ink drawing"}</textarea>
                        </div>
                    </div>
                    `;
      }).join("")}
            </div>
        </div>
    `;
    }).join("");
    playStagger(container, ".comic-page");
    const w = window;
    if (typeof w.scheduleWorkspaceUI === "function")
      w.scheduleWorkspaceUI();
  }
  function updateSegment(pageIdx, segIdx, field, value) {
    state.currentSegments.pages[pageIdx].segments[segIdx][field] = value;
  }
  function toggleCharacter(pageIdx, segIdx, charIdx) {
    if (!state.currentSegments.pages[pageIdx].segments[segIdx].selected_characters) {
      state.currentSegments.pages[pageIdx].segments[segIdx].selected_characters = [];
    }
    const selected = state.currentSegments.pages[pageIdx].segments[segIdx].selected_characters;
    const idx = selected.indexOf(charIdx);
    if (idx > -1) {
      selected.splice(idx, 1);
    } else {
      selected.push(charIdx);
    }
    renderSegments();
  }
  async function generateFullPage(pageIdx, skipLock = false, previousPageImage = null, btn = null) {
    var _a;
    if (!skipLock && state.isGenerating) {
      showToast("\u8BF7\u7B49\u5F85\u5F53\u524D\u751F\u6210\u5B8C\u6210", "error");
      return;
    }
    const config = JSON.parse(localStorage.getItem("manga_config") || "{}");
    if (!config.img_api_url) {
      showToast("\u8BF7\u5148\u914D\u7F6E\u56FE\u50CF\u751F\u6210API", "error");
      openConfigModal();
      return;
    }
    if (!skipLock)
      state.isGenerating = true;
    const w = window;
    if (typeof w.scheduleWorkspaceUI === "function")
      w.scheduleWorkspaceUI();
    const spinner = document.getElementById(`full-page-spinner-${pageIdx}`);
    if (spinner)
      spinner.classList.remove("hidden");
    const targetBtn = btn || document.querySelector(`#panel-segments button[onclick*="generateFullPage(${pageIdx}"]`);
    const labelEl = targetBtn ? targetBtn.querySelector('span:not([id*="spinner"])') : null;
    const unlock = lockButton(targetBtn, labelEl, "\u6574\u9875\u751F\u6210\u4E2D\u2026");
    const page = state.currentSegments.pages[pageIdx];
    if (!previousPageImage && pageIdx > 0) {
      previousPageImage = state.fullPageImages[pageIdx - 1] || null;
      if (previousPageImage) {
        console.log(`[generateFullPage] Auto-using previous page ${pageIdx} image as reference: ${previousPageImage}`);
      }
    }
    const pageSel = /* @__PURE__ */ new Set();
    (page.segments || []).forEach((seg) => {
      (seg.selected_characters || []).forEach((i) => {
        if (Number.isInteger(i))
          pageSel.add(i);
      });
    });
    const idxList = pageSel.size > 0 ? [...pageSel] : state.characters.map((_, i) => i);
    const characterReferences = idxList.map((i) => {
      const char = state.characters[i];
      if (!char)
        return null;
      const ref = {
        name: char.name,
        description: char.description,
        char_prompt: char.char_prompt || ""
      };
      if (char.image_url)
        ref.image_url = char.image_url;
      return ref;
    }).filter(Boolean);
    let task = null;
    if (!skipLock) {
      task = registerTaskProgress(`fullpage-progress-${pageIdx}`);
      task.startFallback(9e4);
    }
    try {
      const response = await fetchWithRetry("/api/generate-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          page,
          page_num: page.page_number,
          api_url: config.img_api_url,
          api_key: config.img_api_key,
          model: config.img_model,
          negative_prompt: config.negative_prompt,
          style_tags: window.getStyleTagsString ? window.getStyleTagsString() : "",
          comic_mode: state.comicMode,
          bubble_render_mode: state.bubbleRenderMode,
          character_references: characterReferences,
          references: characterReferences,
          // 兼容新字段名
          reference_strength: (_a = config.reference_strength) != null ? _a : 0.6,
          previous_page_image: previousPageImage,
          page_idx: pageIdx,
          task_id: task ? task.task_id : ""
        })
      });
      const result = await response.json();
      if (task)
        task.finish();
      if (result.success) {
        let finalImageUrl = result.image_url;
        state.fullPageImages[pageIdx] = finalImageUrl;
        if (result.clean_image_url)
          state.fullPageCleanImages[pageIdx] = result.clean_image_url;
        if (result.bubbles)
          state.fullPageBubbles[pageIdx] = result.bubbles;
        renderSegments();
        if (typeof w.renderGallery === "function")
          w.renderGallery();
        syncResults();
        if (typeof w.saveCurrentState === "function") {
          w.saveCurrentState().catch((e) => console.warn("save work after page gen failed:", e));
        }
        showToast(`\u7B2C ${page.page_number} \u9875\u6574\u9875\u751F\u6210\u6210\u529F`, "success");
      } else {
        showToast(result.error || "\u751F\u6210\u5931\u8D25", "error");
      }
    } catch (e) {
      if (task)
        task.finish();
      showToast("\u8BF7\u6C42\u5931\u8D25: " + e.message, "error");
    } finally {
      if (!skipLock)
        state.isGenerating = false;
      if (typeof w.scheduleWorkspaceUI === "function")
        w.scheduleWorkspaceUI();
      if (spinner)
        spinner.classList.add("hidden");
      unlock();
    }
  }
  function toggleBatchPause() {
    state.batchPaused = !state.batchPaused;
    const label = document.getElementById("batch-pause-label");
    const btn = document.getElementById("batch-pause-btn");
    if (state.batchPaused) {
      if (label)
        label.textContent = "\u25B6\uFE0F \u7EE7\u7EED";
      if (btn) {
        btn.classList.replace("border-yellow-500", "border-green-500");
        btn.classList.replace("bg-yellow-50", "bg-green-50");
        btn.classList.replace("text-yellow-700", "text-green-700");
      }
      showToast("\u5DF2\u6682\u505C, \u70B9\u51FB\u7EE7\u7EED\u6062\u590D", "info");
    } else {
      if (label)
        label.textContent = "\u6682\u505C";
      if (btn) {
        btn.classList.replace("border-green-500", "border-yellow-500");
        btn.classList.replace("bg-green-50", "bg-yellow-50");
        btn.classList.replace("text-green-700", "text-yellow-700");
      }
      showToast("\u7EE7\u7EED\u751F\u6210", "info");
    }
  }
  async function _checkBatchPause() {
    while (state.batchPaused && state.isGenerating && !state.batchStopRequested) {
      await new Promise((r) => setTimeout(r, 200));
    }
    return state.isGenerating && !state.batchStopRequested;
  }
  function stopBatchGenerate() {
    if (!state.isGenerating) {
      showToast("\u5F53\u524D\u6CA1\u6709\u6B63\u5728\u8FDB\u884C\u7684\u751F\u6210\u4EFB\u52A1", "info");
      return;
    }
    if (!confirm("\u786E\u5B9A\u8981\u505C\u6B62\u5F53\u524D\u6279\u91CF\u751F\u6210\u5417? \u5DF2\u751F\u6210\u7684\u9875\u9762\u4F1A\u4FDD\u7559\u3002"))
      return;
    state.batchStopRequested = true;
    state.batchPaused = false;
    showToast("\u6B63\u5728\u505C\u6B62\u751F\u6210, \u8BF7\u7A0D\u5019...", "info");
    const stopBtn = document.getElementById("batch-stop-btn");
    if (stopBtn)
      stopBtn.classList.add("hidden");
  }
  async function regenerateAllFullPages() {
    if (state.isGenerating) {
      showToast("\u8BF7\u7B49\u5F85\u5F53\u524D\u751F\u6210\u5B8C\u6210", "error");
      return;
    }
    if (state.currentSegments.pages.length === 0) {
      showToast("\u8BF7\u5148\u751F\u6210\u5206\u955C", "error");
      return;
    }
    if (Object.keys(state.fullPageImages).length > 0) {
      if (!confirm(`\u5C06\u6E05\u7A7A\u5DF2\u751F\u6210\u7684 ${Object.keys(state.fullPageImages).length} \u5F20\u6574\u9875\u56FE\u7247\u5E76\u4ECE\u5934\u751F\u6210, \u786E\u5B9A\u5417?

\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002`))
        return;
    }
    state.fullPageImages = {};
    state.fullPageCleanImages = {};
    state.fullPageBubbles = {};
    state.generatedImages = {};
    renderSegments();
    const w = window;
    if (typeof w.renderGallery === "function")
      w.renderGallery();
    syncResults();
    await generateAllFullPages();
  }
  async function generateAllFullPages() {
    if (state.isGenerating) {
      showToast("\u8BF7\u7B49\u5F85\u5F53\u524D\u751F\u6210\u5B8C\u6210", "error");
      return;
    }
    const spinner = document.getElementById("batch-full-spinner");
    spinner == null ? void 0 : spinner.classList.remove("hidden");
    state.isGenerating = true;
    const w = window;
    if (typeof w.scheduleWorkspaceUI === "function")
      w.scheduleWorkspaceUI();
    state.batchStopRequested = false;
    const unlock = lockButton(
      document.getElementById("batch-full-btn"),
      document.getElementById("batch-full-label"),
      "\u6279\u91CF\u6574\u9875\u751F\u6210\u4E2D\u2026"
    );
    const pagesToGenerate = [];
    for (let p = 0; p < state.currentSegments.pages.length; p++) {
      if (!state.fullPageImages[p]) {
        pagesToGenerate.push(p);
      }
    }
    const task = registerTaskProgress("batch-progress");
    task.startFallback(12e4);
    const pauseBtn = document.getElementById("batch-pause-btn");
    const stopBtn = document.getElementById("batch-stop-btn");
    if (pauseBtn) {
      state.batchPaused = false;
      const pauseLabel = document.getElementById("batch-pause-label");
      if (pauseLabel)
        pauseLabel.textContent = "\u6682\u505C";
      pauseBtn.classList.remove("hidden");
    }
    if (stopBtn)
      stopBtn.classList.remove("hidden");
    let lastPageImage = null;
    let i = 0;
    let stoppedByUser = false;
    for (i = 0; i < pagesToGenerate.length; i++) {
      const shouldContinue = await _checkBatchPause();
      if (!shouldContinue) {
        stoppedByUser = state.batchStopRequested;
        break;
      }
      const p = pagesToGenerate[i];
      await generateFullPage(p, true, lastPageImage);
      await new Promise((r) => setTimeout(r, 800));
      lastPageImage = state.fullPageImages[p] || null;
    }
    if (pauseBtn)
      pauseBtn.classList.add("hidden");
    if (stopBtn)
      stopBtn.classList.add("hidden");
    state.batchPaused = false;
    state.batchStopRequested = false;
    task.finish();
    state.isGenerating = false;
    if (typeof w.scheduleWorkspaceUI === "function")
      w.scheduleWorkspaceUI();
    spinner == null ? void 0 : spinner.classList.add("hidden");
    unlock();
    const allDone = i >= pagesToGenerate.length && !stoppedByUser;
    if (stoppedByUser) {
      showToast("\u6279\u91CF\u6574\u9875\u751F\u6210\u5DF2\u505C\u6B62", "info");
    } else if (i < pagesToGenerate.length) {
      showToast("\u6279\u91CF\u6574\u9875\u751F\u6210\u5DF2\u6682\u505C", "info");
    } else {
      showToast("\u6279\u91CF\u6574\u9875\u751F\u6210\u5B8C\u6210", "success");
    }
    if (Object.keys(state.fullPageImages).length > 0) {
      await autoSaveWorkWithLLMTitle(allDone);
    }
    switchTab("gallery");
  }
  async function autoSaveWorkWithLLMTitle(allDone) {
    var _a;
    try {
      const novelText = ((_a = document.getElementById("novel-text")) == null ? void 0 : _a.value) || "";
      const config = JSON.parse(localStorage.getItem("manga_config") || "{}");
      let title = "";
      if (config.llm_api_url && novelText) {
        try {
          const resp = await fetchWithRetry("/api/generate-title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              text: novelText,
              api_url: config.llm_api_url,
              api_key: config.llm_api_key || "",
              model: config.llm_model || ""
            })
          });
          const result = await resp.json();
          if (result.success || result.title) {
            title = result.title;
          }
        } catch (e) {
          console.warn("LLM \u751F\u6210\u6807\u9898\u5931\u8D25, \u4F7F\u7528\u9ED8\u8BA4\u6807\u9898:", e);
        }
      }
      if (!title) {
        title = `\u6F2B\u753B\u4F5C\u54C1 ${(/* @__PURE__ */ new Date()).toLocaleString()}`;
      }
      const w = window;
      if (typeof w.saveCurrentState === "function") {
        await w.saveCurrentState();
      }
      try {
        const renameResp = await fetchWithRetry("/api/work/rename-current", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title })
        });
        const renameResult = await renameResp.json();
        if (renameResult.success) {
          showToast(allDone ? `\u6F2B\u753B\u751F\u6210\u5B8C\u6BD5, \u5DF2\u81EA\u52A8\u4FDD\u5B58\u4E3A\u300C${title}\u300D` : `\u5DF2\u505C\u6B62, \u5DF2\u4FDD\u5B58\u4E3A\u300C${title}\u300D`, "success");
          if (typeof w.loadHistoryList === "function")
            w.loadHistoryList();
        } else {
          showToast("\u5DF2\u4FDD\u5B58\u4F5C\u54C1, \u4F46\u91CD\u547D\u540D\u5931\u8D25: " + (renameResult.error || ""), "info");
        }
      } catch (e) {
        console.error("rename-current failed:", e);
        showToast("\u5DF2\u4FDD\u5B58\u4F5C\u54C1, \u4F46\u81EA\u52A8\u547D\u540D\u5931\u8D25", "info");
      }
    } catch (e) {
      console.error("autoSaveWorkWithLLMTitle failed:", e);
    }
  }

  // static/src/modules/gallery.ts
  function renderGallery() {
    const container = document.getElementById("gallery-container");
    if (!container)
      return;
    const t = window.__t2cTransitions;
    if (t)
      t.resetStagger(container);
    const hasFullPages = Object.keys(state.fullPageImages).length > 0;
    if (!hasFullPages) {
      container.innerHTML = emptyState(
        "palette",
        "\u8FD8\u6CA1\u6709\u6210\u54C1\u56FE",
        "\u5728\u300C\u5206\u955C\u7BA1\u7406\u300D\u91CC\u5BF9\u67D0\u4E00\u9875\u70B9\u300C\u6574\u9875\u751F\u6210\u300D\uFF0C\u6216\u76F4\u63A5\u300C\u6279\u91CF\u6574\u9875\u751F\u6210\u300D\u628A\u6240\u6709\u9875\u4E00\u6B21\u8DD1\u5B8C\u3002",
        { onclick: "switchTab('segments')", label: "\u53BB\u751F\u6210\u6574\u9875" }
      );
      return;
    }
    let html = "";
    if (hasFullPages) {
      html += `
        <div class="mb-8">
            <h2 class="text-xl font-bold mb-4 flex items-center gap-2">
                <span class="bg-black text-white px-2 py-1 text-sm flex items-center gap-1"><span data-icon="check" style="width:14px;height:14px;"></span>\u6574\u9875\u751F\u6210</span>
            </h2>
            <div class="space-y-6">
                ${state.currentSegments.pages.map((page, pageIdx) => {
        const img = state.fullPageImages[pageIdx];
        if (!img)
          return "";
        const canEdit = state.bubbleRenderMode === "pil" && state.fullPageCleanImages[pageIdx] && state.fullPageBubbles[pageIdx] && state.fullPageBubbles[pageIdx].length > 0;
        return `
                    <div class="comic-page p-4 md:p-5">
                        <div class="flex items-center justify-between gap-2 mb-3 pb-2.5 border-b-2 border-[#111112]">
                            <h3 class="text-base md:text-lg font-black flex items-center gap-2">
                                <span class="ink-badge mono">PAGE ${String(page.page_number).padStart(2, "0")}</span>
                                <span>\u7B2C ${page.page_number} \u9875</span>
                            </h3>
                            <span class="text-xs text-[#7d7d84]">\u70B9\u51FB\u6F2B\u753B\u53EF\u5168\u5C4F\u653E\u5927</span>
                        </div>
                        <div class="border-2 border-[#111112] bg-[#f7f6f2]">
                            <img src="${img}" class="w-full cursor-pointer block" onclick="openModal('${img}')">
                        </div>
                        ${canEdit ? `
                        <div class="mt-3.5 flex justify-end">
                            <button data-page-idx="${pageIdx}" onclick="openBubbleEditor(${pageIdx})" class="edit-bubble-btn btn-ghost px-4 py-2 text-xs md:text-sm"><span data-icon="pencil" class="ico-14"></span> \u62D6\u62FD\u7F16\u8F91\u6C14\u6CE1\u4F4D\u7F6E</button>
                        </div>
                        ` : ""}
                    </div>
                    `;
      }).join("")}
            </div>
        </div>`;
    }
    container.innerHTML = html;
    playStagger(container, ".comic-page");
    const w = window;
    if (typeof w.markDirty === "function")
      w.markDirty();
    if (typeof w.scheduleWorkspaceUI === "function")
      w.scheduleWorkspaceUI();
  }
  function exportScript() {
    const data = {
      pages: state.currentSegments.pages.map((page, pageIdx) => __spreadProps(__spreadValues({}, page), {
        segments: page.segments.map((seg, segIdx) => __spreadProps(__spreadValues({}, seg), {
          image_url: state.generatedImages[`${pageIdx}-${segIdx}`] || null
        }))
      }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `manga_script_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("\u811A\u672C\u5DF2\u5BFC\u51FA", "success");
  }
  async function downloadAll() {
    const allImages = [];
    Object.entries(state.fullPageImages).forEach(([pageIdx, url]) => {
      if (url) {
        allImages.push({ url, filename: `comic_page_full_${parseInt(pageIdx) + 1}.png`, type: "\u6574\u9875" });
      }
    });
    Object.entries(state.generatedImages).forEach(([key, url]) => {
      if (url) {
        const [pageIdx, segIdx] = key.split("-");
        allImages.push({ url, filename: `manga_p${parseInt(pageIdx) + 1}_s${parseInt(segIdx) + 1}.png`, type: "\u5206\u955C" });
      }
    });
    if (allImages.length === 0) {
      showToast("\u6CA1\u6709\u53EF\u4E0B\u8F7D\u7684\u56FE\u7247", "error");
      return;
    }
    showToast(`\u5F00\u59CB\u4E0B\u8F7D ${allImages.length} \u5F20\u56FE\u7247...`, "info");
    let successCount = 0;
    let failCount = 0;
    for (const img of allImages) {
      try {
        const response = await fetch("/api/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ url: img.url, filename: img.filename })
        });
        if (response.ok) {
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = img.filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
          successCount++;
          await new Promise((r) => setTimeout(r, 300));
        } else {
          failCount++;
        }
      } catch (e) {
        console.error("Download error:", e);
        failCount++;
      }
    }
    if (failCount === 0) {
      showToast(`\u6210\u529F\u4E0B\u8F7D ${successCount} \u5F20\u56FE\u7247`, "success");
    } else {
      showToast(`\u4E0B\u8F7D\u5B8C\u6210: ${successCount} \u6210\u529F, ${failCount} \u5931\u8D25`, "info");
    }
  }

  // static/src/modules/history.ts
  async function loadHistoryList() {
    const container = document.getElementById("history-list");
    const countEl = document.getElementById("history-count");
    const usernameEl = document.getElementById("history-username");
    if (!container)
      return;
    container.innerHTML = '<div class="col-span-full text-center text-gray-400 py-12"><span class="loading-spinner inline-block align-middle mr-2" style="width:14px;height:14px;border-width:2px;"></span>\u52A0\u8F7D\u4E2D...</div>';
    try {
      const response = await fetchWithRetry("/api/history", { credentials: "include" });
      const result = await response.json();
      if (!result.success)
        throw new Error(result.error || "\u52A0\u8F7D\u5931\u8D25");
      if (usernameEl)
        usernameEl.textContent = result.username || "-";
      if (countEl)
        countEl.textContent = String((result.works || []).length);
      if (!result.works || result.works.length === 0) {
        container.innerHTML = emptyState(
          "books",
          "\u8FD8\u6CA1\u6709\u5386\u53F2\u4F5C\u54C1",
          "\u751F\u6210\u6F2B\u753B\u540E\u70B9\u300C\u4FDD\u5B58\u5F53\u524D\u300D\uFF0C\u4F5C\u54C1\u4F1A\u6C38\u4E45\u7559\u5728\u672C\u673A\uFF1B\u6362\u7535\u8111\u65F6\u6574\u4E2A static/users \u76EE\u5F55\u62F7\u8D70\u5373\u53EF\u3002",
          { onclick: "saveCurrentToHistory()", label: "\u4FDD\u5B58\u5F53\u524D\u4F5C\u54C1", fullSpan: true }
        );
        return;
      }
      container.innerHTML = "";
      for (const work of result.works) {
        const card = document.createElement("div");
        card.className = "manga-border bg-gray-50 p-4 flex flex-col";
        card.innerHTML = `<div class="aspect-video skeleton mb-3 flex items-center justify-center text-gray-400 text-sm">\u52A0\u8F7D\u4E2D...</div>`;
        container.appendChild(card);
        popIn(card);
        try {
          const detailResp = await fetchWithRetry(`/api/history/${work.work_id}`, { credentials: "include" });
          const detail = await detailResp.json();
          if (detail.success) {
            const firstImg = (detail.images || [])[0];
            const title = work.title || "\u672A\u547D\u540D";
            const created = formatDateTime(work.created_at);
            const updated = formatDateTime(work.updated_at);
            const imgCount = (detail.images || []).length;
            const isPublic = !!(detail.meta && detail.meta.is_public);
            const visBtn = isPublic ? `border-2 border-black bg-black text-white hover:bg-gray-800` : `border-2 border-gray-300 hover:border-black text-gray-500`;
            card.innerHTML = `
                        <div class="aspect-video bg-gray-200 mb-3 flex items-center justify-center overflow-hidden">
                            ${firstImg ? `<img src="${firstImg}" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'text-gray-400 text-sm\\'>\u65E0\u9884\u89C8</div>'">` : '<div class="text-gray-400 text-sm">\u65E0\u56FE\u7247</div>'}
                        </div>
                        <h3 class="font-bold text-base mb-1 truncate" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                        <p class="text-xs text-gray-500 mb-1"><span data-icon="clock" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>\u521B\u5EFA: ${created}</p>
                        <p class="text-xs text-gray-500 mb-3"><span data-icon="note" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>\u66F4\u65B0: ${updated}</p>
                        <p class="text-xs text-gray-500 mb-3"><span data-icon="image" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>${imgCount} \u5F20\u56FE\u7247</p>
                        <div class="flex gap-2 mt-auto">
                            <button onclick="loadHistoryWork('${work.work_id}')" class="flex-1 border-2 border-black bg-black text-white px-2 py-1.5 text-xs font-medium hover:bg-gray-800 transition-colors flex items-center justify-center gap-1"><span data-icon="folder-open" style="width:12px;height:12px;"></span>\u52A0\u8F7D</button>
                            <button onclick="toggleWorkVisibility('${work.work_id}')" class="${visBtn} px-2 py-1.5 text-xs transition-colors flex items-center justify-center gap-1" title="${isPublic ? "\u516C\u5F00\u4E2D, \u70B9\u51FB\u6539\u4E3A\u79C1\u5BC6" : "\u79C1\u5BC6, \u70B9\u51FB\u8BBE\u4E3A\u516C\u5F00"}" aria-pressed="${isPublic}"><span data-icon="${isPublic ? "globe" : "lock"}" style="width:12px;height:12px;"></span>${isPublic ? "\u516C\u5F00" : "\u79C1\u5BC6"}</button>
                            <button onclick="renameHistoryWork('${work.work_id}','${escapeHtml(title)}')" class="border-2 border-gray-300 hover:border-black px-2 py-1.5 text-xs transition-colors" title="\u91CD\u547D\u540D"><span data-icon="pencil" style="width:12px;height:12px;"></span></button>
                            <button onclick="deleteHistoryWork('${work.work_id}')" class="border-2 border-gray-300 hover:border-red-500 hover:text-red-500 px-2 py-1.5 text-xs transition-colors" title="\u5220\u9664"><span data-icon="trash" style="width:12px;height:12px;"></span></button>
                        </div>
                    `;
            const w2 = window;
            if (typeof w2.hydrateIcons === "function")
              w2.hydrateIcons(card);
          } else {
            card.innerHTML = '<div class="text-red-500 text-sm p-4">\u52A0\u8F7D\u5931\u8D25</div>';
          }
        } catch (e) {
          card.innerHTML = `<div class="text-red-500 text-sm p-4">${escapeHtml(String(e.message || e))}</div>`;
        }
      }
      const w = window;
      if (typeof w.hydrateIcons === "function")
        w.hydrateIcons(container);
    } catch (e) {
      container.innerHTML = `<div class="col-span-full text-center text-red-400 py-12">\u52A0\u8F7D\u5931\u8D25: ${escapeHtml(String(e.message || e))}</div>`;
    }
  }
  async function startNewWork(title) {
    try {
      const response = await fetchWithRetry("/api/work/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title })
      });
      const result = await response.json();
      if (!result.success)
        throw new Error(result.error || "\u521B\u5EFA\u5931\u8D25");
      return result;
    } catch (e) {
      showToast("\u521B\u5EFA\u4F5C\u54C1\u5931\u8D25: " + e.message, "error");
      throw e;
    }
  }
  async function toggleWorkVisibility(workId) {
    try {
      const response = await fetchWithRetry(`/api/history/${encodeURIComponent(workId)}/visibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({})
        // 不传 is_public = 取反
      });
      const result = await response.json();
      if (!result.success)
        throw new Error(result.error || "\u8BBE\u7F6E\u5931\u8D25");
      showToast(result.is_public ? "\u5DF2\u8BBE\u4E3A\u516C\u5F00\uFF0C\u5176\u4ED6\u4EBA\u53EF\u4EE5\u641C\u5230" : "\u5DF2\u8BBE\u4E3A\u79C1\u5BC6", "success");
      await loadHistoryList();
    } catch (e) {
      showToast("\u5207\u6362\u5931\u8D25: " + (e.message || e), "error");
    }
  }
  async function saveCurrentState() {
    var _a;
    try {
      const response = await fetchWithRetry("/api/work/save-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          novel_text: ((_a = document.getElementById("novel-text")) == null ? void 0 : _a.value) || "",
          segments: state.currentSegments,
          characters: state.characters,
          generated_images: state.generatedImages,
          full_page_images: state.fullPageImages,
          combined_page_images: state.combinedPageImages,
          full_page_clean_images: state.fullPageCleanImages,
          full_page_bubbles: state.fullPageBubbles
        })
      });
      const result = await response.json();
      if (!result.success)
        throw new Error(result.error || "\u4FDD\u5B58\u5931\u8D25");
      const w = window;
      if (typeof w.markSaved === "function")
        w.markSaved();
    } catch (e) {
      console.error("saveCurrentState:", e);
      throw e;
    }
  }
  async function saveCurrentToHistory() {
    const title = prompt("\u4E3A\u8FD9\u90E8\u4F5C\u54C1\u8D77\u4E2A\u540D\u5B57:", `\u4F5C\u54C1 ${(/* @__PURE__ */ new Date()).toLocaleString()}`);
    if (title === null)
      return;
    try {
      const created = await startNewWork(title.trim() || void 0);
      await saveCurrentState();
      const w = window;
      if (typeof w.markSaved === "function")
        w.markSaved(created && created.title || title.trim() || "\u672A\u547D\u540D\u4F5C\u54C1");
      showToast("\u5DF2\u4FDD\u5B58\u5230\u5386\u53F2\u8BB0\u5F55", "success");
      loadHistoryList();
    } catch (e) {
    }
  }
  async function loadHistoryWork(workId) {
    if (!confirm("\u52A0\u8F7D\u5386\u53F2\u4F5C\u54C1\u5C06\u8986\u76D6\u5F53\u524D\u5185\u5BB9\uFF0C\u786E\u5B9A\u7EE7\u7EED\uFF1F"))
      return;
    try {
      await fetchWithRetry(`/api/history/${workId}/load`, {
        method: "POST",
        credentials: "include"
      });
      const detailResp = await fetchWithRetry(`/api/history/${workId}`, { credentials: "include" });
      const detail = await detailResp.json();
      if (!detail.success)
        throw new Error(detail.error || "\u52A0\u8F7D\u5931\u8D25");
      const st = detail.state || {};
      if (st.novel_text !== void 0) {
        const el = document.getElementById("novel-text");
        if (el) {
          el.value = st.novel_text;
          const w2 = window;
          if (typeof w2.updateCharCount === "function")
            w2.updateCharCount();
          if (typeof w2.mirrorNovelText === "function")
            w2.mirrorNovelText();
        }
      }
      state.currentSegments = st.segments || { pages: [] };
      state.characters = st.characters || [];
      state.generatedImages = {};
      const gis = st.generated_images || {};
      for (const k in gis)
        state.generatedImages[k] = gis[k];
      state.fullPageImages = {};
      const fps = st.full_page_images || {};
      for (const k in fps)
        state.fullPageImages[k] = fps[k];
      state.combinedPageImages = {};
      const cps = st.combined_page_images || {};
      for (const k in cps)
        state.combinedPageImages[k] = cps[k];
      state.fullPageCleanImages = {};
      const fpcs = st.full_page_clean_images || {};
      for (const k in fpcs)
        state.fullPageCleanImages[k] = fpcs[k];
      state.fullPageBubbles = {};
      const fpb = st.full_page_bubbles || {};
      for (const k in fpb)
        state.fullPageBubbles[k] = fpb[k];
      const meta = st._meta || {};
      const segNow = (state.currentSegments.pages || []).reduce((s, p) => s + (p.segments || []).length, 0);
      const expected = [
        ["\u5206\u955C", meta.segment_count, segNow],
        ["\u89D2\u8272", meta.character_count, state.characters.length]
      ];
      const mismatches = expected.filter((row) => typeof row[1] === "number" && row[1] !== row[2]);
      if (mismatches.length > 0) {
        console.info("loadHistoryWork integrity (informational):", { meta, mismatches });
      }
      const w = window;
      if (typeof w.renderCharacters === "function")
        w.renderCharacters();
      if (typeof w.renderSegments === "function")
        w.renderSegments();
      if (typeof w.renderGallery === "function")
        w.renderGallery();
      showToast(`\u4F5C\u54C1\u5DF2\u52A0\u8F7D (${segNow} \u5206\u955C, ${state.characters.length} \u89D2\u8272, ${Object.keys(state.generatedImages).length} \u5DF2\u751F\u6210\u56FE)`, "success");
      syncResults().catch((e) => {
        console.warn("loadHistoryWork syncResults after load failed:", e);
      });
      const charDiag = state.characters.map((c, i) => ({
        idx: i,
        name: c.name,
        has_image: !!(c.image_url || "").trim(),
        image_url: c.image_url
      }));
      console.log("loadHistoryWork characters image status:", charDiag);
      const missingCharImg = charDiag.filter((c) => !c.has_image).length;
      if (missingCharImg > 0) {
        showToast(`\u5DF2\u52A0\u8F7D, ${missingCharImg} \u4E2A\u89D2\u8272\u7F3A\u4EBA\u8BBE\u56FE (\u8BF7\u68C0\u67E5\u4F5C\u54C1\u76EE\u5F55 images/)`, "error");
      }
      switchTab("gallery");
    } catch (e) {
      console.error("loadHistoryWork:", e);
      showToast("\u52A0\u8F7D\u5931\u8D25: " + (e.message || e), "error");
    }
  }
  async function deleteHistoryWork(workId) {
    if (!confirm("\u786E\u5B9A\u5220\u9664\u8FD9\u90E8\u4F5C\u54C1\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\uFF08\u56FE\u7247\u548C\u6587\u5B57\u90FD\u5C06\u6E05\u9664\uFF09\u3002"))
      return;
    try {
      const response = await fetchWithRetry(`/api/history/${workId}`, {
        method: "DELETE",
        credentials: "include"
      });
      const result = await response.json();
      if (result.success) {
        showToast("\u5DF2\u5220\u9664", "success");
        loadHistoryList();
      } else {
        showToast("\u5220\u9664\u5931\u8D25: " + (result.error || ""), "error");
      }
    } catch (e) {
      showToast("\u5220\u9664\u5931\u8D25: " + e.message, "error");
    }
  }
  async function renameHistoryWork(workId, oldTitle) {
    const newTitle = prompt("\u4FEE\u6539\u4F5C\u54C1\u540D:", oldTitle);
    if (newTitle === null || newTitle.trim() === "" || newTitle === oldTitle)
      return;
    try {
      const response = await fetchWithRetry(`/api/history/${workId}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: newTitle.trim() })
      });
      const result = await response.json();
      if (result.success) {
        showToast("\u5DF2\u91CD\u547D\u540D", "success");
        loadHistoryList();
      } else {
        showToast("\u91CD\u547D\u540D\u5931\u8D25: " + (result.error || ""), "error");
      }
    } catch (e) {
      showToast("\u91CD\u547D\u540D\u5931\u8D25: " + e.message, "error");
    }
  }
  function switchHistorySub(sub) {
    state._historySub = sub;
    const comicBtn = document.getElementById("hist-sub-comic");
    const writingBtn = document.getElementById("hist-sub-writing");
    const comicWrap = document.getElementById("history-comic-wrap");
    const writingWrap = document.getElementById("history-writing-wrap");
    const saveBtn = document.getElementById("history-save-current-btn");
    const countLabel = document.getElementById("history-count-label");
    const activeCls = "pb-2.5 px-1 text-sm md:text-base font-extrabold text-[#111112] border-b-[3px] border-transparent flex items-center gap-1.5";
    const inactiveCls = "pb-2.5 px-1 text-sm md:text-base font-medium text-[#7d7d84] border-b-[3px] border-transparent hover:text-[#111112] flex items-center gap-1.5";
    if (sub === "writing") {
      if (comicBtn)
        comicBtn.className = inactiveCls;
      if (writingBtn)
        writingBtn.className = activeCls;
      if (comicWrap)
        comicWrap.classList.add("hidden");
      if (writingWrap)
        writingWrap.classList.remove("hidden");
      if (saveBtn)
        saveBtn.classList.add("hidden");
      if (countLabel)
        countLabel.textContent = "\u7BC7\u5199\u4F5C";
      loadWritingHistoryList();
    } else {
      if (writingBtn)
        writingBtn.className = inactiveCls;
      if (comicBtn)
        comicBtn.className = activeCls;
      if (writingWrap)
        writingWrap.classList.add("hidden");
      if (comicWrap)
        comicWrap.classList.remove("hidden");
      if (saveBtn)
        saveBtn.classList.remove("hidden");
      if (countLabel)
        countLabel.textContent = "\u90E8\u6F2B\u753B";
      loadHistoryList();
    }
    refreshInks();
  }
  function refreshCurrentHistoryList() {
    if (state._historySub === "writing")
      loadWritingHistoryList();
    else
      loadHistoryList();
  }
  async function loadWritingHistoryList() {
    const container = document.getElementById("history-writing-list");
    const countEl = document.getElementById("history-count");
    if (!container)
      return;
    container.innerHTML = '<div class="col-span-full text-center text-gray-400 py-12"><span class="loading-spinner inline-block align-middle mr-2" style="width:14px;height:14px;border-width:2px;"></span>\u52A0\u8F7D\u4E2D...</div>';
    try {
      const response = await fetchWithRetry("/api/writings", { credentials: "include" });
      const result = await response.json();
      if (!result.success)
        throw new Error(result.error || "\u52A0\u8F7D\u5931\u8D25");
      const works = result.works || [];
      if (countEl)
        countEl.textContent = String(works.length);
      if (works.length === 0) {
        container.innerHTML = emptyState(
          "pen",
          "\u8FD8\u6CA1\u6709\u5199\u4F5C\u8BB0\u5F55",
          "\u5728\u300C\u5C0F\u8BF4\u8F93\u5165\u300D\u6216\u300CAI \u5199\u4F5C\u300D\u91CC\u7EED\u5199\u3001\u6DA6\u8272\u4E4B\u540E\u4F1A\u81EA\u52A8\u5B58\u5230\u8FD9\u91CC\uFF0C\u53EF\u4EE5\u968F\u65F6\u7FFB\u56DE\u6765\u63A5\u7740\u6539\u3002",
          { onclick: "switchTab('aiwrite')", label: "\u53BB\u5199\u4E00\u6BB5", fullSpan: true }
        );
        return;
      }
      container.innerHTML = "";
      for (const w of works) {
        const card = document.createElement("div");
        card.className = "manga-border bg-gray-50 p-4 flex flex-col";
        const title = w.title || "\u672A\u547D\u540D";
        const created = formatDateTime(w.created_at);
        const updated = formatDateTime(w.updated_at);
        const chars = w.content_len || 0;
        card.innerHTML = `
                <div class="mb-2 w-10 h-10 bg-black text-white flex items-center justify-center" data-icon="pen" style="width:40px;height:40px;"></div>
                <h3 class="font-bold text-base mb-1 truncate" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                <p class="text-xs text-gray-500 mb-1"><span data-icon="clock" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>\u521B\u5EFA: ${created}</p>
                <p class="text-xs text-gray-500 mb-1"><span data-icon="note" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>\u66F4\u65B0: ${updated}</p>
                <p class="text-xs text-gray-500 mb-3"><span data-icon="document" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>${chars} \u5B57</p>
                <div class="flex gap-2 mt-auto">
                    <button onclick="loadWritingWork('${w.writing_id}')" class="flex-1 border-2 border-black bg-black text-white px-2 py-1.5 text-xs font-medium hover:bg-gray-800 transition-colors flex items-center justify-center gap-1"><span data-icon="folder-open" style="width:12px;height:12px;"></span>\u52A0\u8F7D</button>
                    <button onclick="renameWritingWork('${w.writing_id}','${escapeHtml(title)}')" class="border-2 border-gray-300 hover:border-black px-2 py-1.5 text-xs transition-colors" title="\u91CD\u547D\u540D"><span data-icon="pencil" style="width:12px;height:12px;"></span></button>
                    <button onclick="deleteWritingWork('${w.writing_id}')" class="border-2 border-gray-300 hover:border-red-500 hover:text-red-500 px-2 py-1.5 text-xs transition-colors" title="\u5220\u9664"><span data-icon="trash" style="width:12px;height:12px;"></span></button>
                </div>
            `;
        container.appendChild(card);
        const win2 = window;
        if (typeof win2.hydrateIcons === "function")
          win2.hydrateIcons(card);
        popIn(card);
      }
      const win = window;
      if (typeof win.hydrateIcons === "function")
        win.hydrateIcons(container);
    } catch (e) {
      container.innerHTML = `<div class="col-span-full text-center text-red-400 py-12">\u52A0\u8F7D\u5931\u8D25: ${escapeHtml(String(e.message || e))}</div>`;
    }
  }
  async function loadWritingWork(id) {
    try {
      const response = await fetchWithRetry(`/api/writing/${id}`, { credentials: "include" });
      const result = await response.json();
      if (!result.success)
        throw new Error(result.error || "\u52A0\u8F7D\u5931\u8D25");
      const content = result.data.content || "";
      document.getElementById("novel-text").value = content;
      const w = window;
      if (typeof w.updateCharCount === "function")
        w.updateCharCount();
      if (typeof w.mirrorNovelText === "function")
        w.mirrorNovelText();
      state.currentWritingId = result.data.writing_id;
      localStorage.setItem("writing_id", state.currentWritingId);
      showToast(`\u5DF2\u52A0\u8F7D\u5199\u4F5C\u300C${result.data.title || "\u672A\u547D\u540D"}\u300D`, "success");
      switchTab("input");
    } catch (e) {
      showToast("\u52A0\u8F7D\u5931\u8D25: " + e.message, "error");
    }
  }
  async function renameWritingWork(id, currentTitle) {
    const newTitle = prompt("\u91CD\u547D\u540D\u5199\u4F5C:", currentTitle || "");
    if (newTitle === null)
      return;
    const t = newTitle.trim();
    if (!t || t === currentTitle)
      return;
    try {
      const response = await fetchWithRetry(`/api/writing/${id}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: t })
      });
      const result = await response.json();
      if (!result.success)
        throw new Error(result.error || "\u91CD\u547D\u540D\u5931\u8D25");
      showToast("\u5DF2\u91CD\u547D\u540D", "success");
      loadWritingHistoryList();
    } catch (e) {
      showToast("\u91CD\u547D\u540D\u5931\u8D25: " + e.message, "error");
    }
  }
  async function deleteWritingWork(id) {
    if (!confirm("\u786E\u5B9A\u5220\u9664\u8FD9\u7BC7\u5199\u4F5C\u8BB0\u5F55\u5417\uFF1F"))
      return;
    try {
      const response = await fetchWithRetry(`/api/writing/${id}`, {
        method: "DELETE",
        credentials: "include"
      });
      const result = await response.json();
      if (!result.success)
        throw new Error(result.error || "\u5220\u9664\u5931\u8D25");
      if (state.currentWritingId === id) {
        state.currentWritingId = null;
        localStorage.removeItem("writing_id");
      }
      showToast("\u5DF2\u5220\u9664", "success");
      loadWritingHistoryList();
    } catch (e) {
      showToast("\u5220\u9664\u5931\u8D25: " + e.message, "error");
    }
  }
  async function autoSaveWriting() {
    var _a;
    const content = ((_a = document.getElementById("novel-text")) == null ? void 0 : _a.value) || "";
    if (!content.trim())
      return;
    const config = JSON.parse(localStorage.getItem("manga_config") || "{}");
    let title;
    if (!state.currentWritingId && config.llm_api_url) {
      try {
        const resp = await fetchWithRetry("/api/generate-title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            text: content.slice(0, 2e3),
            api_url: config.llm_api_url,
            api_key: config.llm_api_key || "",
            model: config.llm_model || ""
          })
        });
        const r = await resp.json();
        title = r.title || "";
      } catch (e) {
        console.warn("autoSaveWriting title gen skipped:", e);
      }
    }
    try {
      const resp = await fetchWithRetry("/api/writing/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ writing_id: state.currentWritingId || void 0, title, content })
      });
      const result = await resp.json();
      if (result.success) {
        state.currentWritingId = result.writing_id;
        localStorage.setItem("writing_id", state.currentWritingId);
      }
    } catch (e) {
      console.warn("autoSaveWriting failed:", e);
    }
  }
  async function saveCurrentWriting() {
    var _a;
    const content = ((_a = document.getElementById("novel-text")) == null ? void 0 : _a.value) || "";
    if (!content.trim()) {
      showToast("\u8BF7\u5148\u8F93\u5165\u5C0F\u8BF4\u5185\u5BB9", "error");
      return;
    }
    await autoSaveWriting();
    showToast("\u5DF2\u4FDD\u5B58\u5230\u5199\u4F5C\u5386\u53F2", "success");
  }

  // static/src/modules/discover.ts
  var DEBOUNCE_MS = 300;
  var _searchTimer;
  function escapeAttr(s) {
    return escapeHtml(String(s == null ? "" : s)).replace(/'/g, "&#39;");
  }
  function onDiscoverInput() {
    if (_searchTimer)
      window.clearTimeout(_searchTimer);
    _searchTimer = window.setTimeout(() => {
      runDiscoverSearch();
    }, DEBOUNCE_MS);
  }
  async function runDiscoverSearch() {
    const input = document.getElementById("discover-q");
    const list = document.getElementById("discover-list");
    const meta = document.getElementById("discover-meta");
    if (!list)
      return;
    const q = (input && input.value ? input.value : "").trim();
    if (!q) {
      if (meta)
        meta.textContent = "\u8F93\u5165\u8D26\u53F7\u540D\u6216\u4F5C\u54C1\u6807\u9898\uFF0C\u641C\u7D22\u5176\u4ED6\u4EBA\u516C\u5F00\u7684\u4F5C\u54C1";
      list.innerHTML = emptyState(
        "search",
        "\u641C\u7D22\u5176\u4ED6\u4EBA\u7684\u516C\u5F00\u4F5C\u54C1",
        "\u4F5C\u54C1\u9ED8\u8BA4\u662F\u79C1\u5BC6\u7684\u3002\u4F5C\u8005\u5728\u5386\u53F2\u8BB0\u5F55\u91CC\u70B9\u300C\u516C\u5F00\u300D\u540E\uFF0C\u624D\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002"
      );
      return;
    }
    list.innerHTML = '<div class="col-span-full text-center text-gray-400 py-12"><span class="loading-spinner inline-block align-middle mr-2" style="width:14px;height:14px;border-width:2px;"></span>\u641C\u7D22\u4E2D...</div>';
    try {
      const response = await fetchWithRetry(
        `/api/discover?q=${encodeURIComponent(q)}`,
        { credentials: "include" }
      );
      const result = await response.json();
      if (!result.success)
        throw new Error(result.error || "\u641C\u7D22\u5931\u8D25");
      const works = result.works || [];
      const accounts = result.accounts || [];
      if (meta) {
        if (works.length === 0) {
          meta.textContent = `\u6CA1\u6709\u627E\u5230\u4E0E\u300C${q}\u300D\u5339\u914D\u7684\u516C\u5F00\u4F5C\u54C1`;
        } else {
          const acctPart = accounts.length ? ` \xB7 \u547D\u4E2D\u8D26\u53F7 ${accounts.join("\u3001")}` : "";
          const more = result.truncated ? "\uFF08\u4EC5\u663E\u793A\u524D\u4E00\u6279\uFF0C\u8FD8\u6709\u66F4\u591A\uFF09" : "";
          meta.textContent = `\u627E\u5230 ${result.total} \u90E8\u516C\u5F00\u4F5C\u54C1${acctPart}${more}`;
        }
      }
      if (works.length === 0) {
        list.innerHTML = emptyState(
          "search",
          "\u6CA1\u6709\u5339\u914D\u7684\u516C\u5F00\u4F5C\u54C1",
          "\u6362\u4E2A\u5173\u952E\u8BCD\u8BD5\u8BD5\uFF0C\u6216\u8005\u786E\u8BA4\u5BF9\u65B9\u662F\u5426\u5DF2\u7ECF\u628A\u4F5C\u54C1\u8BBE\u4E3A\u300C\u516C\u5F00\u300D\u3002"
        );
        return;
      }
      list.innerHTML = works.map((w2) => `
            <div class="manga-border bg-gray-50 p-4 flex flex-col">
                <div class="aspect-video bg-gray-200 mb-3 flex items-center justify-center overflow-hidden" data-cover-owner="${escapeAttr(w2.owner)}" data-cover-work="${escapeAttr(w2.work_id)}">
                    <span class="loading-spinner inline-block" style="width:14px;height:14px;border-width:2px;"></span>
                </div>
                <h3 class="font-bold text-base mb-1 truncate" title="${escapeAttr(w2.title)}">${escapeHtml(w2.title || "\u672A\u547D\u540D")}</h3>
                <p class="text-xs text-gray-500 mb-1"><span data-icon="user" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>${escapeHtml(w2.owner)}</p>
                <p class="text-xs text-gray-500 mb-3"><span data-icon="clock" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>${formatDateTime(w2.updated_at)}</p>
                <div class="flex gap-2 mt-auto">
                    <button onclick="viewPublicWork('${escapeAttr(w2.owner)}','${escapeAttr(w2.work_id)}')" class="flex-1 border-2 border-black bg-black text-white px-2 py-1.5 text-xs font-medium hover:bg-gray-800 transition-colors flex items-center justify-center gap-1"><span data-icon="book-open" style="width:12px;height:12px;"></span>\u67E5\u770B</button>
                    <button onclick="forkPublicWork('${escapeAttr(w2.owner)}','${escapeAttr(w2.work_id)}')" class="border-2 border-gray-300 hover:border-black px-2 py-1.5 text-xs transition-colors flex items-center justify-center gap-1" title="\u53E6\u5B58\u4E3A\u6211\u7684\u4F5C\u54C1"><span data-icon="copy" style="width:12px;height:12px;"></span>\u53E6\u5B58</button>
                </div>
            </div>
        `).join("");
      const w = window;
      if (typeof w.hydrateIcons === "function")
        w.hydrateIcons(list);
      Array.from(list.children).forEach((c) => popIn(c));
      works.forEach((w2, i) => {
        window.setTimeout(() => {
          loadCover(w2.owner, w2.work_id);
        }, i * 120);
      });
    } catch (e) {
      list.innerHTML = `<div class="col-span-full text-center text-red-400 py-12">\u641C\u7D22\u5931\u8D25: ${escapeHtml(String(e.message || e))}</div>`;
    }
  }
  async function loadCover(owner, workId) {
    const holder = document.querySelector(
      `[data-cover-owner="${CSS.escape(owner)}"][data-cover-work="${CSS.escape(workId)}"]`
    );
    if (!holder)
      return;
    try {
      const response = await fetchWithRetry(
        `/api/public/work/${encodeURIComponent(owner)}/${encodeURIComponent(workId)}`,
        { credentials: "include" }
      );
      const result = await response.json();
      if (!result.success)
        return;
      const cover = result.work.cover;
      holder.innerHTML = cover ? `<img src="${escapeAttr(cover)}" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;text-gray-400 text-sm&quot;>\u65E0\u9884\u89C8</div>'">` : '<div class="text-gray-400 text-sm">\u65E0\u56FE\u7247</div>';
    } catch (e) {
      holder.innerHTML = '<div class="text-gray-400 text-sm">\u65E0\u9884\u89C8</div>';
    }
  }
  async function viewPublicWork(owner, workId) {
    const overlay = document.getElementById("public-work-modal");
    const body = document.getElementById("public-work-body");
    if (!overlay || !body)
      return;
    overlay.classList.remove("hidden");
    body.innerHTML = '<div class="text-center text-gray-400 py-12">\u52A0\u8F7D\u4E2D...</div>';
    try {
      const response = await fetchWithRetry(
        `/api/public/work/${encodeURIComponent(owner)}/${encodeURIComponent(workId)}`,
        { credentials: "include" }
      );
      const result = await response.json();
      if (!result.success) {
        body.innerHTML = `<div class="text-red-500 text-sm p-6">${escapeHtml(result.error || "\u4F5C\u54C1\u4E0D\u5B58\u5728\u6216\u672A\u516C\u5F00")}</div>`;
        return;
      }
      const w = result.work;
      window.__pwWorkId = w.work_id;
      const titleEl = document.querySelector("#public-work-title .public-work-title-text");
      if (titleEl)
        titleEl.textContent = w.title || "\u672A\u547D\u540D";
      const ownerEl = document.getElementById("public-work-owner");
      if (ownerEl)
        ownerEl.textContent = w.owner;
      if (!w.images || w.images.length === 0) {
        body.innerHTML = '<div class="text-gray-400 text-sm p-6">\u8FD9\u90E8\u4F5C\u54C1\u8FD8\u6CA1\u6709\u56FE\u7247</div>';
        return;
      }
      body.innerHTML = `
            <p class="text-xs text-gray-500 mb-3">${w.image_count} \u5F20\u56FE\u7247 \xB7 \u66F4\u65B0\u4E8E ${formatDateTime(w.updated_at)}</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                ${w.images.map((u) => `
                    <button onclick="openModal('${escapeAttr(u)}')" class="border-2 border-black bg-gray-50 p-1 hover:bg-gray-100 transition-colors">
                        <img src="${escapeAttr(u)}" class="w-full object-contain" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;text-gray-400 text-sm p-4&quot;>\u52A0\u8F7D\u5931\u8D25</div>'">
                    </button>
                `).join("")}
            </div>
        `;
    } catch (e) {
      body.innerHTML = `<div class="text-red-500 text-sm p-6">\u52A0\u8F7D\u5931\u8D25: ${escapeHtml(String(e.message || e))}</div>`;
    }
  }
  function closePublicWork() {
    const overlay = document.getElementById("public-work-modal");
    if (overlay)
      overlay.classList.add("hidden");
  }
  async function forkPublicWork(owner, workId) {
    try {
      const response = await fetchWithRetry(
        `/api/public/work/${encodeURIComponent(owner)}/${encodeURIComponent(workId)}/fork`,
        { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" }
      );
      const result = await response.json();
      if (!result.success)
        throw new Error(result.error || "\u53E6\u5B58\u5931\u8D25");
      showToast(`\u5DF2\u53E6\u5B58\u4E3A\u300C${result.title}\u300D\uFF08\u79C1\u5BC6\uFF09`, "success");
      closePublicWork();
      loadHistoryList();
    } catch (e) {
      showToast("\u53E6\u5B58\u5931\u8D25: " + (e.message || e), "error");
    }
  }

  // static/src/modules/comic2novel.ts
  function handleComicUpload(event) {
    const target = event.target;
    const files = target.files;
    if (!files || files.length === 0)
      return;
    const previewContainer = document.getElementById("comic-preview-container");
    const thumbsContainer = document.getElementById("comic-preview-thumbs");
    const fileCount = document.getElementById("comic-file-count");
    let loaded = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = function(e) {
        state.comicUploadedImages.push({
          name: file.name,
          data: e.target.result,
          pageIndex: state.comicUploadedImages.length
        });
        loaded++;
        if (loaded === files.length) {
          renderComicPreviews();
          previewContainer == null ? void 0 : previewContainer.classList.remove("hidden");
          if (fileCount)
            fileCount.textContent = String(state.comicUploadedImages.length);
          showToast(`\u5DF2\u52A0\u8F7D ${state.comicUploadedImages.length} \u5F20\u56FE\u7247`, "success");
        }
      };
      reader.readAsDataURL(file);
    }
  }
  function renderComicPreviews() {
    const container = document.getElementById("comic-preview-thumbs");
    if (!container)
      return;
    container.innerHTML = state.comicUploadedImages.map((img, idx) => `
        <div class="flex-shrink-0 w-32 border-2 border-gray-300 p-1 relative group">
            <img src="${img.data}" class="w-full h-24 object-cover">
            <div class="text-xs text-center text-gray-500 mt-1">\u7B2C${idx + 1}\u9875</div>
            <button onclick="removeComicImage(${idx})" class="absolute -top-2 -right-2 bg-red-600 text-white w-5 h-5 rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">\u2715</button>
        </div>
    `).join("");
  }
  function removeComicImage(idx) {
    var _a, _b;
    state.comicUploadedImages.splice(idx, 1);
    if (state.comicUploadedImages.length === 0) {
      (_a = document.getElementById("comic-preview-container")) == null ? void 0 : _a.classList.add("hidden");
      (_b = document.getElementById("comic2novel-output")) == null ? void 0 : _b.classList.add("hidden");
    } else {
      renderComicPreviews();
      const fc = document.getElementById("comic-file-count");
      if (fc)
        fc.textContent = String(state.comicUploadedImages.length);
    }
  }
  function clearComicUpload() {
    var _a, _b;
    state.comicUploadedImages = [];
    (_a = document.getElementById("comic-preview-container")) == null ? void 0 : _a.classList.add("hidden");
    (_b = document.getElementById("comic2novel-output")) == null ? void 0 : _b.classList.add("hidden");
    const fi = document.getElementById("comic-file-input");
    if (fi)
      fi.value = "";
    showToast("\u5DF2\u6E05\u7A7A\u6240\u6709\u56FE\u7247", "info");
  }
  async function startComicToNovel() {
    var _a;
    if (state.comicUploadedImages.length === 0) {
      showToast("\u8BF7\u5148\u4E0A\u4F20\u6F2B\u753B\u56FE\u7247", "error");
      return;
    }
    const config = JSON.parse(localStorage.getItem("manga_config") || "{}");
    if (!config.llm_api_url) {
      showToast("\u8BF7\u5148\u5728API\u914D\u7F6E\u4E2D\u586B\u5199LLM\u63A5\u53E3\u5730\u5740", "error");
      openConfigModal();
      return;
    }
    const visionModel = ((_a = document.getElementById("vision-model")) == null ? void 0 : _a.value) || "gpt-4o";
    const btn = document.getElementById("comic2novel-btn");
    const spinner = document.getElementById("comic2novel-spinner");
    if (btn)
      btn.disabled = true;
    spinner == null ? void 0 : spinner.classList.remove("hidden");
    const task = registerTaskProgress("comic2novel-progress");
    task.startFallback(12e4);
    try {
      const response = await fetchWithRetry("/api/comic-to-novel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          images: state.comicUploadedImages.map((img) => img.data),
          api_url: config.llm_api_url,
          api_key: config.llm_api_key,
          model: visionModel,
          task_id: task.task_id
        })
      }, 2);
      const result = await response.json();
      task.finish();
      if (result.success) {
        state.comicNovelResult = result.data;
        renderComicNovelResult();
        showToast("\u5C0F\u8BF4\u751F\u6210\u6210\u529F\uFF01", "success");
        syncResults();
      } else {
        showToast(result.error || "\u8F6C\u6362\u5931\u8D25", "error");
      }
    } catch (e) {
      task.finish();
      showToast("\u8BF7\u6C42\u5931\u8D25: " + e.message, "error");
    } finally {
      if (btn)
        btn.disabled = false;
      spinner == null ? void 0 : spinner.classList.add("hidden");
    }
  }
  function renderComicNovelResult() {
    const outputDiv = document.getElementById("comic2novel-output");
    const textDiv = document.getElementById("comic2novel-text");
    if (!outputDiv || !textDiv || !state.comicNovelResult)
      return;
    outputDiv.classList.remove("hidden");
    textDiv.textContent = state.comicNovelResult.novel_text || "\uFF08\u672A\u751F\u6210\u6587\u672C\uFF09";
    outputDiv.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function copyNovelText() {
    if (!state.comicNovelResult || !state.comicNovelResult.novel_text) {
      showToast("\u6CA1\u6709\u53EF\u590D\u5236\u7684\u5185\u5BB9", "error");
      return;
    }
    navigator.clipboard.writeText(state.comicNovelResult.novel_text).then(() => {
      showToast("\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F", "success");
    }).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = state.comicNovelResult.novel_text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      showToast("\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F", "success");
    });
  }
  function downloadNovelText() {
    if (!state.comicNovelResult || !state.comicNovelResult.novel_text) {
      showToast("\u6CA1\u6709\u53EF\u4E0B\u8F7D\u7684\u5185\u5BB9", "error");
      return;
    }
    const blob = new Blob([state.comicNovelResult.novel_text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comic_to_novel_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("\u4E0B\u8F7D\u6210\u529F", "success");
  }

  // static/src/modules/bubbles.ts
  function openBubbleEditor(pageIdx) {
    if (state.bubbleRenderMode !== "pil") {
      showToast('\u5F53\u524D\u4E3A"\u7531\u56FE\u50CFAPI\u7ED8\u5236\u6C14\u6CE1"\u6A21\u5F0F, \u6CA1\u6709\u6C14\u6CE1\u5750\u6807\u53EF\u7F16\u8F91', "info");
      return;
    }
    const cleanUrl = state.fullPageCleanImages[pageIdx];
    const stored = state.fullPageBubbles[pageIdx];
    if (!cleanUrl || !stored || stored.length === 0) {
      showToast("\u8BE5\u9875\u9762\u6CA1\u6709\u53EF\u7F16\u8F91\u7684\u6C14\u6CE1\uFF08\u53EF\u80FD\u662F\u65E7\u6570\u636E\u672A\u4FDD\u7559\u5E72\u51C0\u56FE\uFF09", "error");
      return;
    }
    const editBubbles = stored.map((b) => __spreadValues({}, b));
    const old = document.getElementById("bubble-editor-modal");
    if (old)
      old.remove();
    const modal = document.createElement("div");
    modal.id = "bubble-editor-modal";
    modal.className = "fixed inset-0 z-50 flex flex-col";
    modal.innerHTML = `
        <div class="modal-backdrop absolute inset-0 bg-black bg-opacity-70"></div>
        <div class="modal-card relative flex flex-col h-full max-w-6xl mx-auto w-full bg-white manga-border">
            <div class="flex items-center justify-between p-4 border-b-2 border-[#111112] bg-[#f7f6f2]">
                <h2 class="text-base md:text-lg font-black flex items-center gap-2"><span data-icon="pencil" class="ico-18" style="color: var(--spot);"></span><span>\u62D6\u52A8\u6C14\u6CE1\u8C03\u6574\u4F4D\u7F6E\uFF08\u53EF\u70B9\u51FB\u53F3\u4E0A\u89D2\u5207\u6362\u6C14\u6CE1\u5F62\u72B6\uFF09</span></h2>
                <div class="flex gap-2">
                    <button id="bubble-editor-cancel" class="btn-ghost px-4 py-1.5 text-sm">\u53D6\u6D88</button>
                    <button id="bubble-editor-save" class="btn-accent px-5 py-1.5 text-sm">\u4FDD\u5B58\u5E76\u91CD\u65B0\u6E32\u67D3</button>
                </div>
            </div>
            <div class="flex-1 overflow-auto bg-gray-200 p-4 flex justify-center">
                <div id="bubble-editor-img-wrap" class="relative inline-block">
                    <img id="bubble-editor-img" src="${cleanUrl}" class="block" style="max-width: 100%; max-height: calc(100dvh - 140px); object-fit: contain;">
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    const imgEl = document.getElementById("bubble-editor-img");
    const wrapEl = document.getElementById("bubble-editor-img-wrap");
    function getScale() {
      return {
        x: imgEl.clientWidth / imgEl.naturalWidth,
        y: imgEl.clientHeight / imgEl.naturalHeight
      };
    }
    function positionBubbles() {
      wrapEl.querySelectorAll(".bubble-edit-item").forEach((el) => el.remove());
      const scale = getScale();
      if (!scale.x || !scale.y)
        return;
      editBubbles.forEach((bub, i) => {
        const div = document.createElement("div");
        div.className = "bubble-edit-item absolute cursor-move select-none";
        div.style.left = bub.x * scale.x + "px";
        div.style.top = bub.y * scale.y + "px";
        div.style.width = bub.w * scale.x + "px";
        div.style.height = bub.h * scale.y + "px";
        div.style.display = "flex";
        div.style.alignItems = "center";
        div.style.justifyContent = "center";
        div.style.padding = "4px";
        div.style.textAlign = "center";
        div.style.fontSize = "12px";
        div.style.overflow = "hidden";
        div.style.lineHeight = "1.2";
        div.style.fontWeight = "500";
        const dtype = (bub.dialogue_type || "dialogue").toLowerCase();
        div.dataset.type = dtype;
        div.dataset.idx = String(i);
        const sel = document.createElement("select");
        sel.className = "bubble-type-select";
        sel.title = "\u5207\u6362\u6C14\u6CE1\u7C7B\u578B";
        sel.addEventListener("mousedown", (e) => e.stopPropagation());
        sel.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
        for (const t of state.BUBBLE_TYPES) {
          const opt = document.createElement("option");
          opt.value = t;
          opt.textContent = _bubbleTypeLabel(t);
          if (t === dtype)
            opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener("change", function() {
          const newType = this.value;
          bub.dialogue_type = newType;
          div.dataset.type = newType;
        });
        div.appendChild(sel);
        const txt = document.createElement("span");
        txt.className = "bubble-edit-text";
        txt.style.position = "relative";
        txt.style.zIndex = "1";
        txt.style.padding = "0 38px 0 4px";
        txt.textContent = bub.dialogue;
        div.appendChild(txt);
        wrapEl.appendChild(div);
        makeDraggable(div, imgEl, bub);
      });
    }
    function _bubbleTypeLabel(dtype) {
      return state.BUBBLE_TYPE_LABELS[dtype] || "\u25CB " + dtype;
    }
    function makeDraggable(el, imgEl2, bub) {
      function getPoint(e) {
        if (e.touches && e.touches[0])
          return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return { x: e.clientX, y: e.clientY };
      }
      let startX, startY, origLeft, origTop;
      function onDown(e) {
        const pt = getPoint(e);
        startX = pt.x;
        startY = pt.y;
        origLeft = parseFloat(el.style.left);
        origTop = parseFloat(el.style.top);
        el.style.zIndex = "10";
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.addEventListener("touchmove", onMove, { passive: false });
        document.addEventListener("touchend", onUp);
        e.preventDefault();
      }
      function onMove(e) {
        const pt = getPoint(e);
        let newLeft = origLeft + (pt.x - startX);
        let newTop = origTop + (pt.y - startY);
        newLeft = Math.max(0, Math.min(newLeft, imgEl2.clientWidth - el.offsetWidth));
        newTop = Math.max(0, Math.min(newTop, imgEl2.clientHeight - el.offsetHeight));
        el.style.left = newLeft + "px";
        el.style.top = newTop + "px";
        e.preventDefault();
      }
      function onUp() {
        const sc = getScale();
        bub.x = Math.round(parseFloat(el.style.left) / sc.x);
        bub.y = Math.round(parseFloat(el.style.top) / sc.y);
        el.style.zIndex = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.removeEventListener("touchmove", onMove);
        document.removeEventListener("touchend", onUp);
      }
      el.addEventListener("mousedown", onDown);
      el.addEventListener("touchstart", onDown, { passive: false });
    }
    function closeModalEditor() {
      state._bubbleEditorReposition = null;
      if (motionReduced()) {
        modal.remove();
        return;
      }
      modal.classList.add("modal-closing");
      setTimeout(() => modal.remove(), 180);
    }
    if (imgEl.complete && imgEl.naturalWidth) {
      state._bubbleEditorReposition = positionBubbles;
      positionBubbles();
    } else {
      imgEl.onload = function() {
        state._bubbleEditorReposition = positionBubbles;
        positionBubbles();
      };
    }
    const cancelBtn = document.getElementById("bubble-editor-cancel");
    if (cancelBtn)
      cancelBtn.onclick = closeModalEditor;
    const saveBtn = document.getElementById("bubble-editor-save");
    if (saveBtn) {
      saveBtn.onclick = async function() {
        saveBtn.disabled = true;
        saveBtn.textContent = "\u4FDD\u5B58\u4E2D...";
        try {
          await saveBubblePositions(pageIdx, editBubbles);
          closeModalEditor();
        } catch (e) {
          saveBtn.disabled = false;
          saveBtn.textContent = "\u4FDD\u5B58\u5E76\u91CD\u65B0\u6E32\u67D3";
          showToast("\u4FDD\u5B58\u5931\u8D25: " + (e.message || e), "error");
        }
      };
    }
  }
  async function saveBubblePositions(pageIdx, bubbles) {
    const resp = await fetch("/api/reposition-bubbles", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clean_image_url: state.fullPageCleanImages[pageIdx],
        output_image_url: state.fullPageImages[pageIdx].split("?")[0],
        bubbles
      })
    });
    const result = await resp.json();
    if (!result.success)
      throw new Error(result.error || "\u4FDD\u5B58\u5931\u8D25");
    state.fullPageBubbles[pageIdx] = bubbles;
    const baseUrl = state.fullPageImages[pageIdx].split("?")[0];
    state.fullPageImages[pageIdx] = baseUrl + "?t=" + Date.now();
    const w = window;
    if (typeof w.renderGallery === "function")
      w.renderGallery();
    syncResults();
    showToast("\u6C14\u6CE1\u4F4D\u7F6E\u5DF2\u4FDD\u5B58", "success");
  }
  function setupBubbleResize() {
    window.addEventListener("resize", function() {
      if (state._bubbleEditorReposition && document.getElementById("bubble-editor-modal")) {
        state._bubbleEditorReposition();
      }
    });
  }

  // static/src/modules/keyboard.ts
  function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      var _a, _b, _c, _d;
      const isInputFocused = ["INPUT", "TEXTAREA", "SELECT"].includes(((_a = document.activeElement) == null ? void 0 : _a.tagName) || "");
      const isContentEditable = (_b = document.activeElement) == null ? void 0 : _b.isContentEditable;
      const inEditor = isInputFocused || isContentEditable;
      if (e.key === "Escape") {
        const cm = document.getElementById("config-modal");
        if (cm && !cm.classList.contains("hidden")) {
          const w = window;
          if (typeof w.closeConfigModal === "function") {
            w.closeConfigModal();
            e.preventDefault();
            return;
          }
        }
        const im = document.getElementById("image-modal");
        if (im && !im.classList.contains("hidden")) {
          const w = window;
          if (typeof w.closeModal === "function") {
            w.closeModal();
            e.preventDefault();
            return;
          }
        }
        const pm = document.getElementById("polish-compare-modal");
        if (pm && !pm.classList.contains("hidden")) {
          const w = window;
          if (typeof w.cancelPolishCompare === "function") {
            w.cancelPolishCompare();
            e.preventDefault();
            return;
          }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        const w = window;
        if (typeof w.markSaved === "function") {
          const t = ((_c = document.getElementById("work-title")) == null ? void 0 : _c.value) || ((_d = state.workMeta) == null ? void 0 : _d.title) || "";
          w.markSaved(t);
          showToast("\u5DF2\u4FDD\u5B58\u8349\u7A3F", "success");
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (inEditor)
          return;
        e.preventDefault();
        const w = window;
        if (typeof w.runPrimaryAction === "function")
          w.runPrimaryAction();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
        e.preventDefault();
        const idx = state.tabs.indexOf(state.currentTab);
        const next = e.shiftKey ? (idx - 1 + state.tabs.length) % state.tabs.length : (idx + 1) % state.tabs.length;
        switchTab(state.tabs[next]);
      }
    });
    document.addEventListener("click", (e) => {
      const btn = e.target.closest ? e.target.closest(".btn-primary") : null;
      if (!btn)
        return;
      if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        return;
      const rect = btn.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ink-ripple";
      ripple.style.left = e.clientX - rect.left + "px";
      ripple.style.top = e.clientY - rect.top + "px";
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    });
  }

  // static/src/modules/pwa.ts
  function registerSW() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("/static/sw.js").catch((err) => console.warn("[PWA] SW register failed:", err));
    }
  }

  // static/src/modules/icons.ts
  var ICON_PATHS = {
    // ---- 状态/动作 ----
    "check": '<polyline points="20 6 9 17 4 12"/>',
    "check-circle": '<circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/>',
    "x": '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    "x-circle": '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    "pencil": '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    "pen": '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>',
    "trash": '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    "refresh": '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15A9 9 0 0 1 5.64 18.36L1 14"/>',
    "play": '<polygon points="5 3 19 12 5 21 5 3"/>',
    "pause": '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    "stop": '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" fill="currentColor"/>',
    "loader": '<circle cx="12" cy="12" r="10" stroke-dasharray="60 20" stroke-linecap="round"/>',
    // 旋转用 CSS
    "clock": '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    "hourglass": '<path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M17 2v4.172a2 2 0 0 1-.586 1.414L12 12l-4.414-4.414A2 2 0 0 1 7 6.172V2"/>',
    "upload": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    "download": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    "save": '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    // ---- 文档/内容 ----
    "note": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
    "document": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    "book-open": '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    "books": '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    "scroll": '<path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4"/><path d="M19 3H8a2 2 0 0 0-2 2v14"/>',
    // ---- 创作/AI ----
    "palette": '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
    "sparkles": '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/><path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>',
    "bolt": '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    "lightbulb": '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.5.4 1 1 1 1.7v.6h6v-.6c0-.7.5-1.3 1-1.7A7 7 0 0 0 12 2z"/>',
    "message": '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    "thought": '<path d="M9.5 14.5A3.5 3.5 0 0 0 12 18a3.5 3.5 0 0 0 2.5-1c.5-.7.5-1.5 0-2.2-.5-.7-1.5-1.3-2.5-1.3"/><path d="M2 13a8 8 0 0 1 8-7 8 8 0 0 1 8 7c0 2-1 4-3 5l-1 3-1-3c-1 .5-2 1-3 1a8 8 0 0 1-8-7z"/>',
    "shout": '<path d="M3 12L12 3l9 9-9 9z" stroke-linejoin="round"/><path d="M12 7v10M7 12h10"/>',
    "shh": '<circle cx="12" cy="12" r="10"/><path d="M9 9l6 6M15 9l-6 6"/>',
    "volume": '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    "whisper": '<path d="M3 12a9 9 0 0 1 18 0v3a2 2 0 0 1-2 2h-2v-7h4M3 12v3a2 2 0 0 0 2 2h2v-7H3"/>',
    "masks": '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/><path d="M16.6 18.8a3 3 0 1 0-2.4-5.4"/>',
    // ---- 媒体/影像 ----
    "film": '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
    "clapperboard": '<path d="M20 20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8l4-6h12z"/><path d="M2 8h20"/><path d="M8 2l-4 6M16 2l-4 6M22 8l-4-6"/>',
    "camera": '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    "image": '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    // ---- 社交/发现 (公开私密 + 搜索) ----
    "search": '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    "user": '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    "lock": '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    "globe": '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    "copy": '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    // ---- 文件夹/组织 ----
    "folder": '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    "folder-open": '<path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
    // ---- 系统 ----
    "settings": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    "phone": '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    "compass": '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    "warning": '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    "play-circle": '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
    "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
    "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
    "arrow-up": '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    "arrow-down": '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
    // ---- 品牌/特殊 ----
    "volcano": (
      // 自绘火山 (替换 🌋)
      '<path d="M3 22h18"/><path d="M9 6l3-4 3 4v3l2 2v6h-4l-1-1h-1l-1 1H7v-6l2-2z"/><path d="M12 2v2M8 4l1 1M16 4l-1 1"/>'
    ),
    "online-dot": '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="4" fill="white" stroke="none"/>'
  };
  var ICON_DEFAULTS = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  };
  function renderIcon(name, opts = {}) {
    const path = ICON_PATHS[name];
    if (!path)
      return "";
    const attrs = __spreadProps(__spreadValues(__spreadValues({}, ICON_DEFAULTS), opts), {
      width: opts.size || opts.width || 18,
      height: opts.size || opts.height || 18
    });
    let html = `<svg xmlns="http://www.w3.org/2000/svg"`;
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className")
        continue;
      if (v === void 0 || v === null)
        continue;
      html += ` ${k}="${v}"`;
    }
    if (attrs.className)
      html += ` class="${attrs.className}"`;
    html += ` aria-hidden="true">${path}</svg>`;
    return html;
  }
  function hydrateIcons(opts = {}) {
    document.querySelectorAll("[data-icon]").forEach((el) => {
      const name = el.getAttribute("data-icon");
      if (!name || !ICON_PATHS[name])
        return;
      const cls = el.getAttribute("class") || "";
      const sz = parseFloat(getComputedStyle(el).fontSize) || 18;
      el.innerHTML = renderIcon(name, { size: sz, className: cls });
    });
  }
  window.ICON_PATHS = ICON_PATHS;
  window.renderIcon = renderIcon;
  window.hydrateIcons = hydrateIcons;
  function startObserver() {
    hydrateIcons();
    const observer = new MutationObserver((mutations) => {
      var _a, _b;
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (!(node instanceof Element))
            continue;
          if ((_a = node.matches) == null ? void 0 : _a.call(node, "[data-icon]")) {
            hydrateIcons();
          } else {
            const nested = (_b = node.querySelectorAll) == null ? void 0 : _b.call(node, "[data-icon]");
            if (nested == null ? void 0 : nested.length)
              hydrateIcons();
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }

  // static/src/modules/transitions.ts
  (function(global) {
    "use strict";
    if (global.__t2cTransitions)
      return;
    const REDUCE_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function reflow(el) {
      void el.offsetWidth;
    }
    function onAnimEnd(el, name) {
      return new Promise((resolve) => {
        if (REDUCE_MOTION)
          return resolve();
        const handler = (e) => {
          if (e.target !== el)
            return;
          if (name && e.animationName !== name)
            return;
          el.removeEventListener("animationend", handler);
          resolve();
        };
        el.addEventListener("animationend", handler);
        setTimeout(() => {
          el.removeEventListener("animationend", handler);
          resolve();
        }, 800);
      });
    }
    async function swapPanel(fromId, toId, dir = "right") {
      const fromEl = fromId ? document.getElementById(fromId) : null;
      const toEl = toId ? document.getElementById(toId) : null;
      if (!toEl)
        return;
      if (REDUCE_MOTION) {
        if (fromEl)
          fromEl.classList.add("hidden");
        toEl.classList.remove("hidden");
        return;
      }
      if (fromEl && !fromEl.classList.contains("hidden")) {
        fromEl.classList.remove("panel-in-left", "panel-in-right");
        fromEl.classList.add("panel-out");
        await onAnimEnd(fromEl, "panelOut");
        fromEl.classList.add("hidden");
        fromEl.classList.remove("panel-out");
      }
      toEl.classList.remove("hidden", "panel-in-left", "panel-in-right");
      reflow(toEl);
      toEl.classList.add(dir === "right" ? "panel-in-right" : "panel-in-left");
      cascadeChildren(toEl);
    }
    function cascadeChildren(container, selector = ":scope > *", className = "view-fade") {
      if (!container)
        return;
      const kids = container.querySelectorAll(selector);
      kids.forEach((el, i) => {
        if (i > 12)
          return;
        el.classList.remove(className);
        el.style.setProperty("--i", String(i));
        reflow(el);
        el.classList.add(className);
      });
    }
    function openModal2(modalId) {
      const el = document.getElementById(modalId);
      if (!el)
        return;
      if (REDUCE_MOTION) {
        el.classList.remove("hidden", "modal-closing");
        return;
      }
      el.classList.remove("hidden", "modal-closing");
      el.classList.add("modal-opening");
      reflow(el);
      setTimeout(() => el.classList.remove("modal-opening"), 350);
    }
    function closeModal2(modalId, onAfterClose) {
      const el = document.getElementById(modalId);
      if (!el)
        return;
      if (REDUCE_MOTION) {
        el.classList.add("hidden", "modal-closing");
        if (onAfterClose)
          onAfterClose();
        return;
      }
      if (el._closing)
        return;
      el._closing = true;
      el.classList.add("modal-closing");
      setTimeout(() => {
        el.classList.add("hidden");
        el.classList.remove("modal-closing");
        el._closing = false;
        if (onAfterClose)
          onAfterClose();
      }, 160);
    }
    function celebrateSave(el) {
      if (!el || REDUCE_MOTION)
        return;
      el.classList.remove("celebrate-save");
      reflow(el);
      el.classList.add("celebrate-save");
      setTimeout(() => el.classList.remove("celebrate-save"), 600);
    }
    function staggerIn(container, selector) {
      if (!container)
        return;
      if (REDUCE_MOTION) {
        container.querySelectorAll(selector || ":scope > *").forEach((el) => {
          el.classList.remove("stagger-ready");
          el.classList.remove("stagger-item");
        });
        return;
      }
      const kids = selector ? container.querySelectorAll(selector) : container.children;
      Array.from(kids).forEach((el, i) => {
        el.style.setProperty("--i", String(i));
        el.classList.remove("stagger-ready", "stagger-item");
        reflow(el);
        el.classList.add("stagger-item");
      });
    }
    function resetStagger(container) {
      if (container)
        delete container._staggerDone;
    }
    let _viewObserver = null;
    function ensureViewObserver() {
      if (_viewObserver)
        return _viewObserver;
      if (!("IntersectionObserver" in window))
        return null;
      _viewObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting)
            return;
          const el = entry.target;
          _viewObserver.unobserve(el);
          if (el._viewFaded)
            return;
          el._viewFaded = true;
          el.style.opacity = "";
          el.style.transform = "";
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
      return _viewObserver;
    }
    function viewFadeOn(els) {
      if (REDUCE_MOTION)
        return;
      const obs = ensureViewObserver();
      if (!obs) {
        els.forEach((el) => el.classList.add("view-fade"));
        return;
      }
      els.forEach((el, i) => {
        el.style.setProperty("--i", String(Math.min(i, 12)));
        el.classList.add("view-fade");
        el.style.opacity = "0";
        el.style.transform = "translate3d(0, 12px, 0)";
        obs.observe(el);
      });
    }
    function bumpNumber(el) {
      if (!el || REDUCE_MOTION)
        return;
      el.classList.remove("is-bump");
      reflow(el);
      el.classList.add("is-bump");
    }
    global.__t2cTransitions = {
      reflow,
      onAnimEnd,
      swapPanel,
      cascadeChildren,
      openModal: openModal2,
      closeModal: closeModal2,
      celebrateSave,
      staggerIn,
      resetStagger,
      viewFadeOn,
      bumpNumber,
      reduceMotion: REDUCE_MOTION
    };
  })(window);

  // static/src/main.ts
  state.primaryActions = {
    input: { label: "\u5F00\u59CB\u667A\u80FD\u5206\u955C", run: () => startSegment() },
    aiwrite: { label: "\u751F\u6210\u5267\u60C5\u9009\u9879", run: () => genPlotOptions() },
    characters: { label: "\u4ECE\u5C0F\u8BF4\u5206\u6790\u89D2\u8272", run: () => analyzeCharacters() },
    segments: { label: "\u6279\u91CF\u6574\u9875\u751F\u6210", run: () => generateAllFullPages() },
    gallery: { label: "\u4E0B\u8F7D\u5168\u90E8\u56FE\u7247", run: () => downloadAll() },
    history: { label: "\u4FDD\u5B58\u5F53\u524D\u8FDB\u5EA6", run: () => quickSave() },
    comic2novel: { label: "\u9009\u62E9\u6F2B\u753B\u56FE\u7247", run: () => {
      const el = document.getElementById("comic-file-input");
      if (el)
        el.click();
    } }
  };
  function exposeToWindow() {
    const w = window;
    w.switchTab = switchTab;
    w.goStep = goStep;
    w.refreshInks = refreshInks;
    w.openModal = openModal;
    w.closeModal = closeModal;
    w.openConfigModal = openConfigModal;
    w.closeConfigModal = closeConfigModal;
    w.animateCloseModal = animateCloseModal;
    w.openModalA11y = openModalA11y;
    w.closeModalA11y = closeModalA11y;
    w.updateWorkspaceUI = updateWorkspaceUI;
    w.scheduleWorkspaceUI = scheduleWorkspaceUI;
    w.markDirty = markDirty;
    w.markSaved = markSaved;
    w.renderWorkMeta = renderWorkMeta;
    w.runPrimaryAction = runPrimaryAction;
    w.bootIntro = bootIntro;
    w.quickSave = quickSave;
    w.renderStylePresets = renderStylePresets;
    w.renderCustomStyleTags = renderCustomStyleTags;
    w.togglePresetStyle = togglePresetStyle;
    w.addCustomStyleTag = addCustomStyleTag;
    w.removeCustomStyleTag = removeCustomStyleTag;
    w.toggleStylePanel = toggleStylePanel;
    w.clearAllStyles = clearAllStyles;
    w.updateStyleSummary = updateStyleSummary;
    w.getStyleTagsString = getStyleTagsString;
    w.syncBubbleMini = syncBubbleMini;
    w.applyComicModeToDom = applyComicModeToDom;
    w.applyBubbleRenderModeToDom = applyBubbleRenderModeToDom;
    w.onComicModeChange = onComicModeChange;
    w.onBubbleRenderModeChange = onBubbleRenderModeChange;
    w.applyPreset = applyPreset;
    w.clearConfig = clearConfig;
    w.testLLM = testLLM;
    w.testImage = testImage;
    w.saveConfig = saveConfig;
    w.loadConfig = loadConfig;
    w.applyConfigToForm = applyConfigToForm;
    w.updateCharCount = updateCharCount;
    w.updateAiwriteCharCount = updateAiwriteCharCount;
    w.mirrorNovelText = mirrorNovelText;
    w.mirrorAiwriteText = mirrorAiwriteText;
    w.toggleInpAIWrite = toggleInpAIWrite;
    w.genPlotOptions = genPlotOptions;
    w.continueNovel = continueNovel;
    w.genPolishStyles = genPolishStyles;
    w.polishNovel = polishNovel;
    w.renderPlotOptions = renderPlotOptions;
    w.renderPolishStyles = renderPolishStyles;
    w.openPolishCompare = openPolishCompare;
    w.cancelPolishCompare = cancelPolishCompare;
    w.confirmPolishReplace = confirmPolishReplace;
    w.analyzeCharacters = analyzeCharacters;
    w.clearCharacters = clearCharacters;
    w.renderCharacters = renderCharacters;
    w.togglePromptEditor = togglePromptEditor;
    w.saveCharPrompt = saveCharPrompt;
    w.uploadCharacterImage = uploadCharacterImage;
    w.handleCharacterImageFile = handleCharacterImageFile;
    w.generateCharacterImage = generateCharacterImage;
    w.compressImage = compressImage;
    w.startSegment = startSegment;
    w.renderSegments = renderSegments;
    w.updateSegment = updateSegment;
    w.toggleCharacter = toggleCharacter;
    w.generateFullPage = generateFullPage;
    w.generateAllFullPages = generateAllFullPages;
    w.regenerateAllFullPages = regenerateAllFullPages;
    w.toggleBatchPause = toggleBatchPause;
    w.stopBatchGenerate = stopBatchGenerate;
    w.renderGallery = renderGallery;
    w.exportScript = exportScript;
    w.downloadAll = downloadAll;
    w.loadHistoryList = loadHistoryList;
    w.loadWritingHistoryList = loadWritingHistoryList;
    w.saveCurrentState = saveCurrentState;
    w.saveCurrentToHistory = saveCurrentToHistory;
    w.loadHistoryWork = loadHistoryWork;
    w.deleteHistoryWork = deleteHistoryWork;
    w.renameHistoryWork = renameHistoryWork;
    w.switchHistorySub = switchHistorySub;
    w.refreshCurrentHistoryList = refreshCurrentHistoryList;
    w.toggleWorkVisibility = toggleWorkVisibility;
    w.runDiscoverSearch = runDiscoverSearch;
    w.onDiscoverInput = onDiscoverInput;
    w.viewPublicWork = viewPublicWork;
    w.closePublicWork = closePublicWork;
    w.forkPublicWork = forkPublicWork;
    w.loadWritingWork = loadWritingWork;
    w.renameWritingWork = renameWritingWork;
    w.deleteWritingWork = deleteWritingWork;
    w.autoSaveWriting = autoSaveWriting;
    w.saveCurrentWriting = saveCurrentWriting;
    w.handleComicUpload = handleComicUpload;
    w.removeComicImage = removeComicImage;
    w.clearComicUpload = clearComicUpload;
    w.startComicToNovel = startComicToNovel;
    w.renderComicNovelResult = renderComicNovelResult;
    w.copyNovelText = copyNovelText;
    w.downloadNovelText = downloadNovelText;
    w.openBubbleEditor = openBubbleEditor;
    w.saveBubblePositions = saveBubblePositions;
    w.showToast = showToast;
    w.showLoadingToast = showLoadingToast;
    w.dismissLoadingToast = dismissLoadingToast;
    w.escapeHtml = escapeHtml;
    w.formatDateTime = formatDateTime;
    w.emptyState = emptyState;
    w.handleLogout = handleLogout;
    w.checkAuth = checkAuth;
    w.fetchWithRetry = fetchWithRetry;
    w.lockButton = lockButton;
    w.syncResults = syncResults;
    w.recoverSession = recoverSession;
    w.detectBrowserDevice = detectBrowserDevice;
    w.maybeShowInAppBanner = maybeShowInAppBanner;
    w.staggerPanel = staggerPanel;
  }
  function boot() {
    exposeToWindow();
    setupKeyboardShortcuts();
    initWorkspace();
    setupDragDropUpload();
    registerSW();
    setupBubbleResize();
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape")
        return;
      const w = window;
      const cm = document.getElementById("config-modal");
      if (cm && !cm.classList.contains("hidden") && typeof w.closeConfigModal === "function")
        w.closeConfigModal();
      if (typeof w.cancelPolishCompare === "function")
        w.cancelPolishCompare();
    });
    const sentinel = document.getElementById("workflow");
    const bar = document.getElementById("workspace-bar");
    if (sentinel && bar && typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
          bar.classList.toggle("is-visible", show);
        });
      }, { threshold: 0 });
      io.observe(sentinel);
    }
    detectBrowserDevice();
    window.addEventListener("resize", () => {
      clearTimeout(state._deviceResizeTimer);
      state._deviceResizeTimer = setTimeout(detectBrowserDevice, 200);
    });
    const bannerClose = document.getElementById("inapp-browser-close");
    if (bannerClose) {
      bannerClose.addEventListener("click", function() {
        const info = window.APP_DEVICE || {};
        if (info.browser) {
          try {
            localStorage.setItem("inapp_banner_dismissed", info.browser);
          } catch (e) {
          }
        }
        const banner = document.getElementById("inapp-browser-banner");
        if (banner)
          banner.classList.add("hidden");
      });
    }
    Promise.resolve(loadConfig()).then(
      () => scheduleWorkspaceUI(),
      () => scheduleWorkspaceUI()
    );
    bootIntro();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(refreshInks).catch(() => {
      });
    }
    let _inkResizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(_inkResizeTimer);
      _inkResizeTimer = setTimeout(refreshInks, 120);
    });
    renderWorkMeta();
    refreshInks();
    updateWorkspaceUI();
    recoverSession();
    checkAuth();
  }
  exposeToWindow();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
//# sourceMappingURL=app.js.map
