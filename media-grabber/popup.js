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

  const typeIcon = { image: "🖼", gif: "🎞", video: "🎬", audio: "🔊" }[item.type] || "📄";
  const isVisual = item.type === "image" || item.type === "gif";

  const thumbHtml = isVisual
    ? `<div class="img-wrapper"><img src="${item.originalUrl}" alt="${item.filename}" loading="lazy" /></div>`
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
    // Trigger a direct navigation download in the tab — no canvas needed
    api.tabs.sendMessage(currentTabId, {
      action: "triggerTabDownload",
      dataUrl: null,          // signal: fetch-and-download mode
      directUrl: item.originalUrl,
      filename: item.filename,
    });
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

  for (let i = 0; i < total; i++) {
    const item = targets[i];

    try {
      // Fetch the resource as a blob using the URL directly.
      // This avoids canvas/CORS issues and keeps memory flat.
      const resp = await fetch(item.originalUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const arrayBuf = await blob.arrayBuffer();
      zip.file(item.filename, arrayBuf);
    } catch {
      // Skip assets that can't be fetched (cross-origin, expired, etc.)
    }

    dlButton.innerText = `Packing (${i + 1}/${total})...`;
    // Yield to keep the UI responsive every 10 items
    if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  dlButton.innerText = "Compiling ZIP...";
  await new Promise((r) => setTimeout(r, 0));

  // Generate as base64 so the payload is fully self-contained in the message.
  // A blob URL is scoped to the popup context and dies the moment the popup
  // closes (which happens as soon as the OS save dialog steals focus), leaving
  // the download manager fetching a dead URL. A data: URL carries its own bytes
  // and survives popup teardown.
  const base64Zip = await zip.generateAsync({ type: "base64" });
  const dataUrl = "data:application/zip;base64," + base64Zip;

  // Route through the content script so the <a download> click fires in the
  // page context, which is guaranteed to outlive the popup.
  api.tabs.sendMessage(currentTabId, {
    action: "triggerTabDownload",
    dataUrl: dataUrl,
    filename: `Media_${Date.now()}.zip`,
  });

  dlButton.innerText = "Opening File Save...";

  // Never re-enable — the popup will be closed by the OS dialog stealing focus,
  // so this state doesn't need to reset. If somehow it stays open, leave it
  // showing the final state to avoid confusing a second click.
}
