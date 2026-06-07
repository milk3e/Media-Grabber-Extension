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

// ---------------------------------------------------------------------------
// Multiselect filter state
// ---------------------------------------------------------------------------
let selectedTypes = new Set();   // e.g. {"image","gif"}
let selectedPaths = new Set();   // e.g. {"/assets/images/"}

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
// Deep scan
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
  processedMedia = assets.map((item) => ({ ...item }));
  rebuildFilterUI();
  filterAndRender();
}

// ---------------------------------------------------------------------------
// Build all ancestor paths from a leaf pathDirectory.
// e.g. "/foo/bar/baz/" -> ["/foo/", "/foo/bar/", "/foo/bar/baz/"]
// ---------------------------------------------------------------------------
function ancestorPaths(pathDirectory) {
  // Special virtual dirs like "(in-memory blob)" pass through as-is
  if (!pathDirectory.startsWith("/")) return [pathDirectory];
  const parts = pathDirectory.replace(/^\//, "").replace(/\/$/, "").split("/").filter(Boolean);
  const paths = [];
  for (let i = 0; i < parts.length; i++) {
    paths.push("/" + parts.slice(0, i + 1).join("/") + "/");
  }
  if (paths.length === 0) paths.push("/");
  return paths;
}

// ---------------------------------------------------------------------------
// Rebuild the chip filter UI based on current processedMedia
// ---------------------------------------------------------------------------
function rebuildFilterUI() {
  const typeCounts = {};
  const pathCounts = {};

  processedMedia.forEach((item) => {
    typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
    // Count every ancestor path so parent folders show the sum of their children
    ancestorPaths(item.pathDirectory).forEach((p) => {
      pathCounts[p] = (pathCounts[p] || 0) + 1;
    });
  });

  // Remove selected types that no longer exist in data
  for (const t of [...selectedTypes]) {
    if (!typeCounts[t]) selectedTypes.delete(t);
  }

  renderChips("filter-type-area", typeCounts, selectedTypes, (val) => {
    toggleFilter(selectedTypes, val);
    filterAndRender();
  }, { image: "Image", gif: "GIF", video: "Video", audio: "Audio" });

  // Only show paths that contain more than one item (same as old dropdown logic)
  const sharedPathCounts = {};
  for (const [p, n] of Object.entries(pathCounts)) {
    if (n > 1) sharedPathCounts[p] = n;
  }
  // Clean up any selected paths that no longer qualify
  for (const p of [...selectedPaths]) {
    if (!sharedPathCounts[p]) selectedPaths.delete(p);
  }

  renderChips("filter-path-area", sharedPathCounts, selectedPaths, (val) => {
    toggleFilter(selectedPaths, val);
    filterAndRender();
  });
}

function toggleFilter(set, val) {
  if (set.has(val)) set.delete(val);
  else set.add(val);
}

// Render clickable chips for a filter row; active chips are highlighted
function renderChips(containerId, counts, activeSet, onToggle, labels) {
  const area = document.getElementById(containerId);
  if (!area) return;
  area.innerHTML = "";

  const sorted = Object.keys(counts).sort((a, b) => {
    // Sort paths: shorter (parent) paths first, then alphabetically
    if (a.startsWith("/") && b.startsWith("/")) {
      const depthDiff = (a.match(/\//g) || []).length - (b.match(/\//g) || []).length;
      if (depthDiff !== 0) return depthDiff;
    }
    return a.localeCompare(b);
  });

  if (sorted.length === 0) {
    area.innerHTML = '<span class="filter-empty">—</span>';
    return;
  }

  sorted.forEach((val) => {
    const chip = document.createElement("span");
    chip.className = "filter-chip" + (activeSet.has(val) ? " active" : "");
    const label = (labels && labels[val]) ? labels[val] : val;
    chip.title = val;
    chip.innerHTML = `<span class="chip-label">${label}</span><span class="chip-count">${counts[val]}</span>`;
    chip.addEventListener("click", () => {
      onToggle(val);
      chip.className = "filter-chip" + (activeSet.has(val) ? " active" : "");
    });
    area.appendChild(chip);
  });
}

function filterAndRender() {
  currentFiltered = processedMedia.filter((item) => {
    if (selectedTypes.size > 0 && !selectedTypes.has(item.type)) return false;
    if (selectedPaths.size > 0) {
      // Item matches if any of its ancestor paths is in selectedPaths
      const ancestors = ancestorPaths(item.pathDirectory);
      if (!ancestors.some((p) => selectedPaths.has(p))) return false;
    }
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
    api.tabs.create({ url: item.dataUrl || item.originalUrl });
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

  // Avoid silent overwrites when two assets share a name.
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
