(() => {
  // Guard against duplicate event listeners piling up on subsequent popup launches
  if (!window.hasMediaListenerRun) {
    window.hasMediaListenerRun = true;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "triggerTabDownload") {
        try {
          const parts = request.dataUrl.split(",");
          const mime = parts[0].match(/:(.*?);/)[1];
          const bstr = atob(parts[1]);
          let n = bstr.length;
          const u8arr = new Uint8Array(n);

          while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
          }

          const blob = new Blob([u8arr], { type: mime });
          const blobUrl = window.URL.createObjectURL(blob);

          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = request.filename;
          a.style.display = "none";

          document.body.appendChild(a);
          a.click();

          setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);
          }, 100);
        } catch (err) {
          console.error("Tab download sequence intercepted an error:", err);
        }
      }
    });
  }

  // If the scraping scan has already initialized, simply refresh data extraction mappings
  if (window.hasMediaScraperRun) {
    return sendPayload();
  }
  window.hasMediaScraperRun = true;

  function extractFromBrowserCache(imgElement) {
    try {
      if (!imgElement.complete || imgElement.naturalWidth === 0) return null;

      const canvas = document.createElement("canvas");
      canvas.width = imgElement.naturalWidth;
      canvas.height = imgElement.naturalHeight;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(imgElement, 0, 0);

      const dataUrl = canvas.toDataURL("image/png");
      const stringLength = dataUrl.length - "data:image/png;base64,".length;
      const sizeInBytes = 4 * Math.ceil(stringLength / 3) * 0.56248;

      return { dataUrl, sizeInBytes };
    } catch (e) {
      return null;
    }
  }

  function sendPayload() {
    const assets = [];

    document.querySelectorAll("img").forEach((img) => {
      if (
        !img.src ||
        img.src.startsWith("data:") ||
        img.src.startsWith("blob:")
      )
        return;

      const memoryCache = extractFromBrowserCache(img);
      if (!memoryCache) return;

      const urlObj = new URL(img.src);
      let filename =
        urlObj.pathname.substring(urlObj.pathname.lastIndexOf("/") + 1) ||
        "asset.png";
      filename = filename.split(/[?#]/)[0];
      if (!filename.includes(".")) filename += ".png";

      const pathDirectory = urlObj.pathname.substring(
        0,
        urlObj.pathname.lastIndexOf("/") + 1,
      );

      assets.push({
        filename: filename,
        pathDirectory: pathDirectory,
        originalUrl: img.src, // Retain original URL structure for the popup UI previews
        dataUrl: memoryCache.dataUrl,
        sizeInBytes: memoryCache.sizeInBytes,
        type: "image",
      });
    });

    chrome.runtime.sendMessage({ action: "mediaUpdated", assets: assets });
  }

  const observer = new MutationObserver(() => sendPayload());
  observer.observe(document.body, { childList: true, subtree: true });

  sendPayload();
})();
