(() => {
  // Guard against duplicate download listeners on repeated popup launches
  if (!window.hasMediaListenerRun) {
    window.hasMediaListenerRun = true;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "triggerTabDownload") {
        try {
          const a = document.createElement("a");
          a.style.display = "none";
          a.download = request.filename;

          if (request.directUrl) {
            // Single-file download: the browser already has this cached.
            // A plain <a href=url download=filename> click is all that's needed —
            // identical to what the browser does for "Save Image As".
            a.href = request.directUrl;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => document.body.removeChild(a), 100);
          } else if (request.dataUrl) {
            // ZIP / base64 data URL path (used for bulk ZIP downloads)
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
      }
    });
  }

  if (window.hasMediaScraperRun) {
    return sendPayload();
  }
  window.hasMediaScraperRun = true;

  // ---------------------------------------------------------------------------
  // Core scan: collect URLs directly from the DOM — no canvas, no pixel reads.
  // This is fast, CORS-safe, and catches everything the browser already has.
  // ---------------------------------------------------------------------------

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
    if (/\.(mp3|ogg|wav|flac|aac|opus|m4a)(\b|$)/.test(lower)) return "audio";
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

  function sendPayload() {
    const seen = new Set();
    const assets = [];

    function add(url, tagName, mimeHint) {
      if (!url) return;
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      if (seen.has(url)) return;
      seen.add(url);

      const { filename: rawFilename, pathDirectory } = getFilenameAndDir(url);
      const type = guessType(url, tagName, mimeHint);
      const filename = ensureExtension(rawFilename, type);

      assets.push({
        filename,
        pathDirectory,
        originalUrl: url,
        // No dataUrl here — we pull it lazily only when the user hits download
        type,
      });
    }

    // <img src> and srcset
    document.querySelectorAll("img").forEach((img) => {
      add(img.src, "img");
      // srcset may contain higher-res variants not in src
      if (img.srcset) {
        img.srcset.split(",").forEach((part) => {
          const candidate = part.trim().split(/\s+/)[0];
          if (candidate) add(candidate, "img");
        });
      }
      // data-src lazy-load patterns
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
      // currentSrc may differ from src when adaptive
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

    // <a href> pointing directly at media files (common on image boards, file hosts)
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

    chrome.runtime.sendMessage({ action: "mediaUpdated", assets });
  }

  // Re-scan on DOM mutations (lazy-loaded content, infinite scroll, etc.)
  // Use a debounce so a burst of mutations only fires one scan
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendPayload, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  sendPayload();
})();
