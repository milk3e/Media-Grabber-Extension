(() => {
  // ===========================================================================
  // Page-persistent state (lives on the content-script isolated-world window,
  // so it survives repeated popup launches — same trick as hasMediaScraperRun).
  // Deep-scan results are kept here so a later DOM re-scan doesn't drop them.
  // ===========================================================================
  window.__mgDeepAssets = window.__mgDeepAssets || [];
  window.__mgDeepSeen = window.__mgDeepSeen || new Set();
  window.__mgEmbeddedCount = window.__mgEmbeddedCount || 0;
  window.__mgBlobCount = window.__mgBlobCount || 0;
  window.__mgDeepScanning = window.__mgDeepScanning || false;

  // Cap base64 conversions per scan so a page full of blobs can't hang the tab.
  const MAX_BLOB_CONVERSIONS = 60;

  // Matches absolute media URLs sitting inside arbitrary HTML / inline JSON.
  // Lazy body + extension anchor so it stops at the first real file extension.
  const DEEP_URL_RE =
    /https?:\/\/[^\s"'<>()\\]+?\.(?:jpe?g|png|gif|webp|svg|bmp|ico|mp4|webm|ogv|mov|avi|mkv|mp3|ogg|wav|flac|aac|opus|m4a|weba)(?:\?[^\s"'<>()\\]*)?/gi;

  // ---------------------------------------------------------------------------
  // Download listener (guard against duplicate registration on re-injection)
  // ---------------------------------------------------------------------------
  if (!window.hasMediaListenerRun) {
    window.hasMediaListenerRun = true;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "triggerTabDownload") {
        try {
          const a = document.createElement("a");
          a.style.display = "none";
          a.download = request.filename;

          if (request.directUrl) {
            // Single-file download for plain http(s) (and data:) URLs — a plain
            // <a href download> click, identical to "Save Image As".
            a.href = request.directUrl;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => document.body.removeChild(a), 100);
          } else if (request.dataUrl) {
            // base64 data: URL path (bulk ZIP + blob-sourced single downloads).
            const parts = request.dataUrl.split(",");
            const mime = parts[0].match(/:(.*?);/)[1];
            const bstr = atob(parts[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) u8arr[n] = bstr.charCodeAt(n);
            const blob = new Blob([u8arr], { type: mime });
            const blobUrl = window.URL.createObjectURL(blob);
            a.href = blobUrl;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
              document.body.removeChild(a);
              window.URL.revokeObjectURL(blobUrl);
            }, 100);
          }
        } catch (err) {
          console.error("Tab download error:", err);
        }
      } else if (request.action === "deepScan") {
        // Heavy, opt-in pass: blob: resolution, data: collection, hidden-URL scan.
        runDeepScan().then((added) => {
          chrome.runtime.sendMessage({
            action: "deepScanDone",
            added,
            total: window.__mgDeepAssets.length,
          });
        });
      }
    });
  }

  if (window.hasMediaScraperRun) {
    return sendPayload();
  }
  window.hasMediaScraperRun = true;

  // ===========================================================================
  // Shared helpers
  // ===========================================================================

  function getFilenameAndDir(urlStr) {
    try {
      const urlObj = new URL(urlStr);
      let filename =
        urlObj.pathname.substring(urlObj.pathname.lastIndexOf("/") + 1) ||
        "asset";
      filename = filename.split(/[?#]/)[0];
      const pathDirectory = urlObj.pathname.substring(
        0,
        urlObj.pathname.lastIndexOf("/") + 1
      );
      return { filename, pathDirectory };
    } catch {
      return { filename: "asset", pathDirectory: "/" };
    }
  }

  function guessType(url, tagName, mimeHint) {
    const lower = url.toLowerCase().split("?")[0];
    if (tagName === "video" || tagName === "source-video") return "video";
    if (tagName === "audio" || tagName === "source-audio") return "audio";
    if (/\.(mp4|webm|ogv|mov|avi|mkv)(\b|$)/.test(lower)) return "video";
    if (/\.(mp3|ogg|wav|flac|aac|opus|m4a|weba)(\b|$)/.test(lower)) return "audio";
    if (/\.gif(\b|$)/.test(lower)) return "gif";
    if (mimeHint && mimeHint.startsWith("video/")) return "video";
    if (mimeHint && mimeHint.startsWith("audio/")) return "audio";
    return "image";
  }

  function ensureExtension(filename, type) {
    if (filename.includes(".")) return filename;
    const defaults = { image: ".png", gif: ".gif", video: ".mp4", audio: ".mp3" };
    return filename + (defaults[type] || "");
  }

  // Mime -> file extension / coarse type, for blob: and data: assets that have
  // no path to read a name from.
  function extFromMime(mime) {
    const map = {
      "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
      "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg",
      "image/bmp": "bmp", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico",
      "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv",
      "video/quicktime": "mov", "video/x-matroska": "mkv",
      "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/ogg": "ogg",
      "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac",
      "audio/aac": "aac", "audio/mp4": "m4a", "audio/webm": "weba",
      "audio/opus": "opus",
    };
    if (map[mime]) return map[mime];
    if (mime && mime.includes("/")) {
      const tail = mime.split("/")[1].split("+")[0];
      if (tail && tail.length <= 5) return tail;
    }
    return "bin";
  }

  function typeFromMime(mime) {
    if (!mime) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (mime === "image/gif") return "gif";
    return "image";
  }

  // ===========================================================================
  // Passive scan: collect URLs directly from the DOM (fast, CORS-safe).
  // Deep-scan results (window.__mgDeepAssets) are appended at the end so they
  // ride along on every payload the popup receives.
  // ===========================================================================

  function sendPayload() {
    const seen = new Set();
    const assets = [];

    function add(url, tagName, mimeHint) {
      if (!url) return;
      // Passive pass intentionally skips data:/blob: — those are handled, on
      // demand, by the deep scan (they're expensive to materialise eagerly).
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      if (seen.has(url)) return;
      seen.add(url);

      const { filename: rawFilename, pathDirectory } = getFilenameAndDir(url);
      const type = guessType(url, tagName, mimeHint);
      const filename = ensureExtension(rawFilename, type);

      assets.push({ filename, pathDirectory, originalUrl: url, type });
    }

    // <img src> and srcset
    document.querySelectorAll("img").forEach((img) => {
      add(img.src, "img");
      if (img.srcset) {
        img.srcset.split(",").forEach((part) => {
          const candidate = part.trim().split(/\s+/)[0];
          if (candidate) add(candidate, "img");
        });
      }
      ["data-src", "data-lazy", "data-original", "data-url"].forEach((attr) => {
        const v = img.getAttribute(attr);
        if (v && !v.startsWith("data:")) add(v, "img");
      });
    });

    // <picture> / <source srcset>
    document.querySelectorAll("picture source").forEach((src) => {
      if (src.srcset) {
        src.srcset.split(",").forEach((part) => {
          const candidate = part.trim().split(/\s+/)[0];
          if (candidate) add(candidate, "img");
        });
      }
    });

    // CSS background-image on every element (cheap string scan, no re-render)
    document.querySelectorAll("*").forEach((el) => {
      try {
        const bg = getComputedStyle(el).backgroundImage;
        if (!bg || bg === "none") return;
        const matches = bg.match(/url\(["']?([^"')]+)["']?\)/g);
        if (matches) {
          matches.forEach((m) => {
            const url = m.replace(/url\(["']?/, "").replace(/["']?\)$/, "");
            add(url, "img");
          });
        }
      } catch {}
    });

    // <video src> and poster
    document.querySelectorAll("video").forEach((v) => {
      if (v.src) add(v.src, "video");
      if (v.poster) add(v.poster, "img");
      if (v.currentSrc && v.currentSrc !== v.src) add(v.currentSrc, "video");
    });

    // <audio src>
    document.querySelectorAll("audio").forEach((a) => {
      if (a.src) add(a.src, "audio");
      if (a.currentSrc && a.currentSrc !== a.src) add(a.currentSrc, "audio");
    });

    // <source> inside video/audio
    document.querySelectorAll("video source, audio source").forEach((s) => {
      const parentTag = s.parentElement
        ? s.parentElement.tagName.toLowerCase()
        : "source";
      add(s.src, `source-${parentTag}`, s.type || "");
    });

    // <a href> pointing directly at media files
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.href;
      if (!href) return;
      if (
        /\.(jpe?g|png|gif|webp|svg|bmp|mp4|webm|ogv|mov|mp3|ogg|wav|flac|aac)(\?|#|$)/i.test(
          href
        )
      ) {
        add(href, "a");
      }
    });

    // Fold in anything the deep scan already discovered (blob/data/hidden URLs).
    window.__mgDeepAssets.forEach((asset) => {
      if (!seen.has(asset.originalUrl)) {
        seen.add(asset.originalUrl);
        assets.push(asset);
      }
    });

    chrome.runtime.sendMessage({ action: "mediaUpdated", assets });
  }

  // ===========================================================================
  // Deep scan (opt-in): the expensive stuff that doesn't belong in a passive,
  // mutation-triggered loop.
  //   1. blob: URLs on media elements  -> fetched page-side, converted to base64
  //   2. data: URLs (src / poster / inline style) -> collected as-is
  //   3. hidden absolute media URLs in raw HTML / inline JSON config -> regex
  // ===========================================================================

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function registerDeep(asset) {
    // Dedup key: the blob:/data:/http URL we found it at.
    if (window.__mgDeepSeen.has(asset.originalUrl)) return false;
    window.__mgDeepSeen.add(asset.originalUrl);
    window.__mgDeepAssets.push(asset);
    return true;
  }

  function biasTypeForTag(type, tag, parentTag) {
    const t = tag === "source" ? parentTag : tag;
    if (t === "video") return "video";
    if (t === "audio") return "audio";
    return type;
  }

  function addDataUrlAsset(dataUrl, tag, parentTag) {
    const mimeMatch = dataUrl.match(/^data:([^;,]+)/);
    const mime = mimeMatch ? mimeMatch[1].toLowerCase() : "";
    const type = biasTypeForTag(typeFromMime(mime), tag, parentTag);
    const ext = extFromMime(mime);
    const filename = `embedded_${++window.__mgEmbeddedCount}.${ext}`;
    // originalUrl IS the data: URL — self-contained, downloadable & thumbnailable.
    return registerDeep({
      filename,
      pathDirectory: "(embedded data)",
      originalUrl: dataUrl,
      type,
    });
  }

  async function addBlobAsset(blobUrl, tag, parentTag) {
    if (window.__mgBlobCount >= MAX_BLOB_CONVERSIONS) return false;
    // Pre-flight dedup so we don't fetch the same blob twice.
    if (window.__mgDeepSeen.has(blobUrl)) return false;
    try {
      // Works because the content script shares the page's origin, so the
      // page's blob-URL store is reachable. (MediaSource blobs throw here and
      // are skipped — they don't reference a static, fetchable Blob.)
      const resp = await fetch(blobUrl);
      if (!resp.ok) return false;
      const blob = await resp.blob();
      const mime = (blob.type || "").toLowerCase();
      const type = biasTypeForTag(typeFromMime(mime), tag, parentTag);
      const ext = extFromMime(mime);
      const dataUrl = await blobToDataUrl(blob);
      window.__mgBlobCount++;
      const filename = `blob_${window.__mgBlobCount}.${ext}`;
      return registerDeep({
        filename,
        pathDirectory: "(in-memory blob)",
        originalUrl: blobUrl, // kept for dedup/reference only
        type,
        dataUrl, // the actual, portable payload (base64)
      });
    } catch {
      return false; // streaming MSE blob, revoked URL, cross-context, etc.
    }
  }

  function addHiddenHttpAsset(url) {
    if (window.__mgDeepSeen.has(url)) return false;
    const { filename: rawFilename, pathDirectory } = getFilenameAndDir(url);
    const type = guessType(url, "a", "");
    const filename = ensureExtension(rawFilename, type);
    return registerDeep({ filename, pathDirectory, originalUrl: url, type });
  }

  async function runDeepScan() {
    if (window.__mgDeepScanning) return 0;
    window.__mgDeepScanning = true;
    const before = window.__mgDeepAssets.length;

    try {
      const blobJobs = [];

      // ---- 1 & 2: blob:/data: URLs on real media elements -------------------
      document.querySelectorAll("img, video, audio, source").forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const parentTag =
          tag === "source" && el.parentElement
            ? el.parentElement.tagName.toLowerCase()
            : "";
        const candidates = [];
        if (el.src) candidates.push(el.src);
        if (el.currentSrc && el.currentSrc !== el.src)
          candidates.push(el.currentSrc);
        if (el.poster) candidates.push(el.poster);

        candidates.forEach((u) => {
          if (u.startsWith("data:")) addDataUrlAsset(u, tag, parentTag);
          else if (u.startsWith("blob:"))
            blobJobs.push({ url: u, tag, parentTag });
        });
      });

      // ---- 2b: data: URLs hiding in inline style background-image -----------
      document.querySelectorAll('[style*="data:"]').forEach((el) => {
        const style = el.getAttribute("style") || "";
        const re = /url\((["']?)(data:[^"')]+)\1\)/gi;
        let m;
        while ((m = re.exec(style)) !== null) addDataUrlAsset(m[2], "img", "");
      });

      // ---- 3: hidden absolute URLs in raw HTML / inline JSON config ---------
      // Normalise JSON-escaped slashes (https:\/\/...) and &amp; entities first
      // so URLs buried in player config blobs still match.
      let html = "";
      try {
        html = document.documentElement.outerHTML || "";
      } catch {}
      const htmlNorm = html.replace(/\\\//g, "/").replace(/&amp;/gi, "&");
      let mm;
      DEEP_URL_RE.lastIndex = 0;
      while ((mm = DEEP_URL_RE.exec(htmlNorm)) !== null) {
        addHiddenHttpAsset(mm[0]);
      }

      // ---- resolve blobs (sequential, capped, fault-tolerant) ---------------
      for (const job of blobJobs) {
        if (window.__mgBlobCount >= MAX_BLOB_CONVERSIONS) break;
        await addBlobAsset(job.url, job.tag, job.parentTag);
      }
    } finally {
      window.__mgDeepScanning = false;
    }

    const added = window.__mgDeepAssets.length - before;
    sendPayload(); // push merged passive + deep results to the popup
    return added;
  }

  // ---------------------------------------------------------------------------
  // Re-scan on DOM mutations (debounced). Deep results persist across these.
  // ---------------------------------------------------------------------------
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendPayload, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  sendPayload();
})();
