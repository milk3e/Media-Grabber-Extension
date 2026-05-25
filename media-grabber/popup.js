const api = typeof browser !== "undefined" ? browser : chrome;
let processedMedia = [];
let currentTabId = null;

// ---------------------------------------------------------------------------
// Virtual list state — only render a window of items at a time to avoid
// freezing the UI with thousands of DOM nodes.
// ---------------------------------------------------------------------------
const PAGE_SIZE = 50;
let renderedCount = 0;
let currentFiltered = [];

const DEEP_SCAN_LABEL = "Deep Scan (blobs · embedded · hidden)";

document.addEventListener("DOMContentLoaded", async () => {
  const [activeTab] = await api.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab) return;
  currentTabId = activeTab.id;

  api.runtime.onMessage.addListener((message) => {
    if (message.action === "mediaUpdated") {
      processAndRender(message.assets);
    } else if (message.action === "deepScanDone") {
      onDeepScanDone(message.added);
    }
  });

  api.scripting.executeScript({
    target: { tabId: currentTabId },
    files: ["content.js"],
  });

  document
    .getElementById("filter-path")
    .addEventListener("change", filterAndRender);
  document
    .getElementById("filter-type")
    .addEventListener("change", filterAndRender);
  document
    .getElementById("download-zip")
    .addEventListener("click", downloadAllAsZip);
  document
    .getElementById("deep-scan")
    .addEventListener("click", runDeepScan);

  // Infinite-scroll loader inside the list container
  const container = document.getElementById("media-list");
  container.addEventListener("scroll", () => {
    if (
      container.scrollTop + container.clientHeight >=
      container.scrollHeight - 40
    ) {
      loadMoreItems();
    }
  });
});

// ---------------------------------------------------------------------------
// Deep scan: ask the content script to do the heavy, page-context work
// (resolve blob: URLs, collect data: URLs, regex the raw HTML for hidden
// media links). Results stream back via the normal "mediaUpdated" message.
// ---------------------------------------------------------------------------
function runDeepScan() {
  const btn = document.getElementById("deep-scan");
  btn.disabled = true;
  btn.innerText = "Scanning page…";
  api.tabs.sendMessage(currentTabId, { action: "deepScan" });
}

function onDeepScanDone(added) {
  const btn = document.getElementById("deep-scan");
  btn.disabled = false;
  btn.innerText =
    typeof added === "number"
      ? `Deep Scan — found ${added} more (run again)`
      : DEEP_SCAN_LABEL;
}

function processAndRender(assets) {
  const pathCounts = {};

  processedMedia = assets.map((item) => {
    pathCounts[item.pathDirectory] =
      (pathCounts[item.pathDirectory] || 0) + 1;
    return { ...item };
  });

  updateFilterDropdowns(pathCounts);
  filterAndRender();
}

function updateFilterDropdowns(pathCounts) {
  const pathSelect = document.getElementById("filter-path");
  const currentPath = pathSelect.value;

  pathSelect.innerHTML = '<option value="">All Folder Paths</option>';
  Object.keys(pathCounts).forEach((path) => {
    if (pathCounts[path] > 1) {
      pathSelect.innerHTML += `<option value="${path}">${path} (${pathCounts[path]})</option>`;
    }
  });

  pathSelect.value = currentPath;
}

function filterAndRender() {
  const selectedPath = document.getElementById("filter-path").value;
  const selectedType = document.getElementById("filter-type").value;

  currentFiltered = processedMedia.filter((item) => {
    if (selectedPath && item.pathDirectory !== selectedPath) return false;
    if (selectedType && item.type !== selectedType) return false;
    return true;
  });

  renderedCount = 0;
  const container = document.getElementById("media-list");
  container.innerHTML = "";

  document.getElementById("count").innerText = `(${currentFiltered.length})`;

  if (currentFiltered.length === 0) {
    container.innerHTML =
      '<div style="text-align:center;padding:20px;color:#999;">No assets found matching filters.</div>';
    return;
  }

  loadMoreItems();
}

function loadMoreItems() {
  const container = document.getElementById("media-list");
  const end = Math.min(renderedCount + PAGE_SIZE, currentFiltered.length);
  const fragment = document.createDocumentFragment();

  for (let i = renderedCount; i < end; i++) {
    fragment.appendChild(buildItemEl(currentFiltered[i]));
  }

  container.appendChild(fragment);
  renderedCount = end;
}

function buildItemEl(item) {
  const itemEl = document.createElement("div");
  itemEl.className = "media-item";

  const typeIcon =
    { image: "🖼", gif: "🎞", video: "🎬", audio: "🔊" }[item.type] || "📄";
  const isVisual = item.type === "image" || item.type === "gif";

  // For blob-sourced assets originalUrl is a page-scoped blob: URL the popup
  // can't load — use the self-contained base64 dataUrl for the thumbnail.
  const thumbSrc = item.dataUrl || item.originalUrl;

  const thumbHtml = isVisual
    ? `<div class="img-wrapper"><img src="${thumbSrc}" alt="${item.filename}" loading="lazy" /></div>`
    : `<div class="img-wrapper type-icon">${typeIcon}</div>`;

  itemEl.innerHTML = `
    ${thumbHtml}
    <div class="media-info">
      <p style="font-weight:bold;color:#222;margin-bottom:2px;">${item.filename}</p>
      <p style="margin-bottom:2px;"><span class="type-badge type-${item.type}">${item.type}</span></p>
      <p style="color:#777;font-size:10px;background:#f0f0f0;padding:2px 4px;border-radius:3px;">${item.pathDirectory}</p>
    </div>
    <button class="single-dl" title="Download">📥</button>
  `;

  itemEl.querySelector(".single-dl").addEventListener("click", (e) => {
    e.stopPropagation();
    if (item.dataUrl) {
      // blob-sourced: hand the page the base64 payload so the content script
      // can create a same-origin blob URL and trigger the download attribute
      // correctly (the only path that works for base64 payloads).
      api.tabs.sendMessage(currentTabId, {
        action: "triggerTabDownload",
        dataUrl: item.dataUrl,
        directUrl: null,
        filename: item.filename,
      });
    } else {
      // For plain http(s) and data: URLs, open in a new tab.
      // Routing through a hidden <a download> in the current page doesn't work
      // for cross-origin URLs — browsers ignore the download attribute there and
      // navigate the current tab instead. tabs.create avoids that entirely.
      api.tabs.create({ url: item.originalUrl });
    }
  });

  return itemEl;
}

async function downloadAllAsZip() {
  const dlButton = document.getElementById("download-zip");

  const targets = [...currentFiltered];
  if (targets.length === 0) return;

  dlButton.disabled = true;
  const total = targets.length;
  dlButton.innerText = `Packing (0/${total})...`;

  const zip = new JSZip();

  // Avoid silent overwrites when two assets share a name (common with the
  // generated blob_/embedded_ names, but also real files in different dirs).
  const usedNames = new Set();
  function uniqueName(name) {
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
    const dot = name.lastIndexOf(".");
    const base = dot === -1 ? name : name.slice(0, dot);
    const ext = dot === -1 ? "" : name.slice(dot);
    let i = 1;
    let candidate;
    do {
      candidate = `${base}_${i}${ext}`;
      i++;
    } while (usedNames.has(candidate));
    usedNames.add(candidate);
    return candidate;
  }

  for (let i = 0; i < total; i++) {
    const item = targets[i];

    try {
      // Prefer the self-contained payload (base64 data: URL) for blob assets;
      // fetch() handles http(s) and data: URLs alike. blob: URLs are never the
      // fetch target here — they were already converted to dataUrl page-side.
      const src = item.dataUrl || item.originalUrl;
      const resp = await fetch(src);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const arrayBuf = await blob.arrayBuffer();
      zip.file(uniqueName(item.filename), arrayBuf);
    } catch {
      // Skip assets that can't be fetched (cross-origin, expired, etc.)
    }

    dlButton.innerText = `Packing (${i + 1}/${total})...`;
    if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  dlButton.innerText = "Compiling ZIP...";
  await new Promise((r) => setTimeout(r, 0));

  const base64Zip = await zip.generateAsync({ type: "base64" });
  const dataUrl = "data:application/zip;base64," + base64Zip;

  api.tabs.sendMessage(currentTabId, {
    action: "triggerTabDownload",
    dataUrl: dataUrl,
    filename: `Media_${Date.now()}.zip`,
  });

  dlButton.innerText = "Opening File Save...";
}
