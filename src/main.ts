import "./style.css";
import { invoke } from "@tauri-apps/api";

// Types
interface ModelInfo {
  id: string;
  name: string;
  organization: string;
  sizeBytes: number;
  sizeFormatted: string;
  fileCount: number;
  lastModified: string;
  lastModifiedTimestamp: number;
  path: string;
}

interface CacheStats {
  totalModels: number;
  totalSizeBytes: number;
  totalSizeFormatted: string;
}

interface AppInfo {
  name: string;
  version: string;
  cacheLocation?: string;
}

interface DeleteResult {
  deletedCount: number;
  failedCount: number;
  deleted: string[];
  failed: Array<[string, string]>;
}



// State
let models: ModelInfo[] = [];
let selectedModels = new Set<string>();
let sortField: keyof ModelInfo = "lastModifiedTimestamp";
let sortAsc = false;

let isLoading = false;

// DOM Elements
const app = document.getElementById("app")!;

// Initialize app
function init() {
  renderApp();
  setupEventListeners();
  loadData();
  setupKeyboardShortcuts();
}

function renderApp() {
  app.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="logo">
          <div class="logo-icon">🤗</div>
          <div class="logo-text">
            <h1>HF Cache</h1>
            <span class="version">v1.0.0</span>
          </div>
        </div>
        
        <nav class="nav">
          <button class="nav-item active" data-view="models">
            <span class="nav-icon">📦</span>
            <span>Models</span>
            <span class="nav-badge" id="nav-count">0</span>
          </button>
          <button class="nav-item" id="open-folder-nav">
            <span class="nav-icon">📂</span>
            <span>Open Cache</span>
          </button>
        </nav>
        
        <div class="sidebar-footer">
          <div class="cache-info">
            <span class="cache-label">Cache Size</span>
            <span class="cache-value" id="sidebar-size">-</span>
          </div>
          <button class="btn btn-danger btn-small btn-full" id="delete-selected-sidebar" disabled>
            🗑️ Delete Selected
          </button>
        </div>
      </aside>

      <main class="main">
        <header class="header">
          <div class="header-search">
            <span class="search-icon">🔍</span>
            <input 
              type="text" 
              id="search-input" 
              placeholder="Search models by name or organization..."
              autocomplete="off"
            />
            <kbd class="shortcut">⌘K</kbd>
          </div>
          <div class="header-actions">
            <button class="btn btn-icon" id="refresh-btn" title="Refresh (⌘R)">
              🔄
            </button>
          </div>
        </header>

        <div class="content">
          <div class="toolbar">
            <div class="toolbar-left">
              <label class="checkbox-wrapper">
                <input type="checkbox" id="select-all" />
                <span>Select All</span>
              </label>
              <span class="selection-info" id="selection-info"></span>
            </div>
            <div class="toolbar-right">
              <span class="sort-label">Sort by:</span>
              <select id="sort-select" class="sort-select">
                <option value="lastModifiedTimestamp">Last Modified</option>
                <option value="sizeBytes">Size</option>
                <option value="name">Name</option>
                <option value="organization">Organization</option>
              </select>
              <button class="btn btn-icon" id="sort-direction" title="Toggle sort direction">
                ↓
              </button>
            </div>
          </div>

          <div class="models-container">
            <div class="loading-state" id="loading">
              <div class="spinner"></div>
              <p>Loading models...</p>
            </div>
            
            <div class="error-state" id="error" style="display: none;">
              <div class="error-icon">⚠️</div>
              <h3>Error loading models</h3>
              <p id="error-message"></p>
              <button class="btn btn-secondary" id="retry-btn">Try Again</button>
            </div>
            
            <div class="empty-state" id="empty" style="display: none;">
              <div class="empty-icon">📭</div>
              <h3>No models found</h3>
              <p>Your Hugging Face cache is empty.</p>
              <p class="hint">Download models using transformers, diffusers, or other HF libraries to see them here.</p>
            </div>
            
            <div class="models-list" id="models-list" style="display: none;"></div>
          </div>
        </div>
      </main>
    </div>

    <div class="toast-container" id="toast-container"></div>

    <div class="modal" id="confirm-modal" style="display: none;">
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3>Confirm Deletion</h3>
          <button class="modal-close" id="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <p id="confirm-message"></p>
          <div class="warning-box">
            <span>⚠️</span>
            <span>This action cannot be undone. The model will need to be re-downloaded if needed.</span>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="cancel-delete">Cancel</button>
          <button class="btn btn-danger" id="confirm-delete">
            <span class="btn-text">Delete</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function setupEventListeners() {
  // Search
  const searchInput = document.getElementById("search-input") as HTMLInputElement;
  searchInput.addEventListener("input", debounce(filterModels, 150));
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      filterModels();
      searchInput.blur();
    }
  });

  // Buttons
  document.getElementById("refresh-btn")!.addEventListener("click", () => loadData());
  document.getElementById("retry-btn")?.addEventListener("click", () => loadData());
  document.getElementById("open-folder-nav")!.addEventListener("click", openCacheFolder);
  document.getElementById("modal-close")!.addEventListener("click", hideConfirmModal);
  document.getElementById("cancel-delete")!.addEventListener("click", hideConfirmModal);
  document.getElementById("confirm-delete")!.addEventListener("click", executeDelete);
  
  // Select all
  document.getElementById("select-all")!.addEventListener("change", (e) => {
    toggleSelectAll((e.target as HTMLInputElement).checked);
  });

  // Delete selected
  document.getElementById("delete-selected-sidebar")!.addEventListener("click", () => {
    if (selectedModels.size > 0) {
      showDeleteConfirmation(Array.from(selectedModels));
    }
  });

  // Sort
  document.getElementById("sort-select")!.addEventListener("change", (e) => {
    sortField = (e.target as HTMLSelectElement).value as keyof ModelInfo;
    renderModels();
  });

  document.getElementById("sort-direction")!.addEventListener("click", () => {
    sortAsc = !sortAsc;
    updateSortDirectionIcon();
    renderModels();
  });

  // Modal overlay click
  document.querySelector(".modal-overlay")?.addEventListener("click", hideConfirmModal);
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    const metaKey = e.metaKey || e.ctrlKey;
    
    // Cmd/Ctrl + K: Focus search
    if (metaKey && e.key === "k") {
      e.preventDefault();
      document.getElementById("search-input")!.focus();
    }
    
    // Cmd/Ctrl + R: Refresh
    if (metaKey && e.key === "r") {
      e.preventDefault();
      loadData();
    }
    
    // Escape: Close modal
    if (e.key === "Escape") {
      hideConfirmModal();
    }
    
    // Cmd/Ctrl + A: Select all (when not in input)
    if (metaKey && e.key === "a" && document.activeElement?.tagName !== "INPUT") {
      e.preventDefault();
      const selectAll = document.getElementById("select-all") as HTMLInputElement;
      selectAll.checked = !selectAll.checked;
      toggleSelectAll(selectAll.checked);
    }
  });
}

// Data loading
async function loadData() {
  if (isLoading) return;
  
  isLoading = true;
  showLoading();
  
  try {
    const [_appInfo, stats, modelList] = await Promise.all([
      invoke<AppInfo>("get_app_info").catch(() => null),
      invoke<CacheStats>("get_cache_stats"),
      invoke<ModelInfo[]>("list_models"),
    ]);


    models = modelList;
    
    // Update UI
    updateSidebar(stats);
    updateNavCount(stats.totalModels);
    
    selectedModels.clear();
    updateSelectionUI();
    
    if (models.length === 0) {
      showEmpty();
    } else {
      renderModels();
      showList();
    }
    
    showToast(`Loaded ${models.length} models`, "success");
  } catch (err) {
    showError(err as string);
  } finally {
    isLoading = false;
  }
}

// UI Updates
function updateSidebar(stats: CacheStats) {
  document.getElementById("sidebar-size")!.textContent = stats.totalSizeFormatted;
}

function updateNavCount(count: number) {
  document.getElementById("nav-count")!.textContent = count.toString();
}

function showLoading() {
  document.getElementById("loading")!.style.display = "flex";
  document.getElementById("error")!.style.display = "none";
  document.getElementById("empty")!.style.display = "none";
  document.getElementById("models-list")!.style.display = "none";
}

function showError(message: string) {
  document.getElementById("loading")!.style.display = "none";
  document.getElementById("error")!.style.display = "flex";
  document.getElementById("empty")!.style.display = "none";
  document.getElementById("models-list")!.style.display = "none";
  document.getElementById("error-message")!.textContent = message;
}

function showEmpty() {
  document.getElementById("loading")!.style.display = "none";
  document.getElementById("error")!.style.display = "none";
  document.getElementById("empty")!.style.display = "flex";
  document.getElementById("models-list")!.style.display = "none";
}

function showList() {
  document.getElementById("loading")!.style.display = "none";
  document.getElementById("error")!.style.display = "none";
  document.getElementById("empty")!.style.display = "none";
  document.getElementById("models-list")!.style.display = "grid";
}

// Model rendering
function filterModels() {
  renderModels();
}

function getFilteredModels(): ModelInfo[] {
  const query = (document.getElementById("search-input") as HTMLInputElement).value.toLowerCase().trim();
  if (!query) return models;
  
  return models.filter((m) =>
    m.name.toLowerCase().includes(query) ||
    m.organization.toLowerCase().includes(query) ||
    m.id.toLowerCase().includes(query)
  );
}

function sortModels(modelList: ModelInfo[]): ModelInfo[] {
  return [...modelList].sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortAsc ? aVal - bVal : bVal - aVal;
    }
    
    return 0;
  });
}

function updateSortDirectionIcon() {
  const btn = document.getElementById("sort-direction")!;
  btn.textContent = sortAsc ? "↑" : "↓";
}

function renderModels() {
  let filtered = getFilteredModels();
  filtered = sortModels(filtered);

  const container = document.getElementById("models-list")!;
  
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="no-results">
        <span class="no-results-icon">🔍</span>
        <p>No models match your search</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((model) => `
    <div class="model-card ${selectedModels.has(model.id) ? "selected" : ""}" data-id="${model.id}">
      <div class="model-checkbox-wrapper">
        <input 
          type="checkbox" 
          class="model-checkbox" 
          data-id="${model.id}" 
          ${selectedModels.has(model.id) ? "checked" : ""}
        />
      </div>
      <div class="model-info">
        <div class="model-header">
          <span class="model-org">${escapeHtml(model.organization)}</span>
          <span class="model-separator">/</span>
          <span class="model-name">${escapeHtml(model.name)}</span>
        </div>
        <div class="model-meta">
          <span class="meta-item" title="Size">💾 ${model.sizeFormatted}</span>
          <span class="meta-item" title="Files">📄 ${model.fileCount} files</span>
          <span class="meta-item" title="Last modified">🕒 ${model.lastModified}</span>
        </div>
      </div>
      <button class="btn btn-icon btn-delete" data-id="${model.id}" title="Delete">
        🗑️
      </button>
    </div>
  `).join("");

  // Add event listeners
  container.querySelectorAll(".model-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".model-checkbox") || target.closest(".btn-delete")) {
        return;
      }
      const id = card.getAttribute("data-id")!;
      const checkbox = card.querySelector(".model-checkbox") as HTMLInputElement;
      checkbox.checked = !checkbox.checked;
      toggleModelSelection(id, checkbox.checked);
    });
  });

  container.querySelectorAll(".model-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", (e) => {
      const id = (e.target as HTMLInputElement).getAttribute("data-id")!;
      toggleModelSelection(id, (e.target as HTMLInputElement).checked);
    });
  });

  container.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).getAttribute("data-id")!;
      showDeleteConfirmation([id]);
    });
  });
}

function toggleModelSelection(id: string, selected: boolean) {
  if (selected) {
    selectedModels.add(id);
  } else {
    selectedModels.delete(id);
  }
  updateSelectionUI();
  
  // Update card visual state
  const card = document.querySelector(`.model-card[data-id="${id}"]`);
  if (card) {
    card.classList.toggle("selected", selected);
  }
}

function toggleSelectAll(selected: boolean) {
  const filtered = getFilteredModels();
  if (selected) {
    filtered.forEach((m) => selectedModels.add(m.id));
  } else {
    filtered.forEach((m) => selectedModels.delete(m.id));
  }
  updateSelectionUI();
  renderModels();
}

function updateSelectionUI() {
  const count = selectedModels.size;
  const deleteBtn = document.getElementById("delete-selected-sidebar") as HTMLButtonElement;
  const info = document.getElementById("selection-info")!;
  const selectAll = document.getElementById("select-all") as HTMLInputElement;
  
  deleteBtn.disabled = count === 0;
  
  if (count > 0) {
    info.textContent = `${count} selected`;
    deleteBtn.innerHTML = `🗑️ Delete ${count} model${count > 1 ? "s" : ""}`;
  } else {
    info.textContent = "";
    deleteBtn.innerHTML = "🗑️ Delete Selected";
  }
  
  const filtered = getFilteredModels();
  selectAll.checked = count > 0 && count === filtered.length;
  selectAll.indeterminate = count > 0 && count < filtered.length;
}

// Delete functionality
let modelsToDelete: string[] = [];

function showDeleteConfirmation(ids: string[]) {
  modelsToDelete = ids;
  const isSingle = ids.length === 1;
  const model = isSingle ? models.find((m) => m.id === ids[0]) : null;
  
  const message = document.getElementById("confirm-message")!;
  message.innerHTML = isSingle
    ? `Are you sure you want to delete <strong>${escapeHtml(model?.name || ids[0])}</strong>?`
    : `Are you sure you want to delete <strong>${ids.length} models</strong>?`;
  
  document.getElementById("confirm-modal")!.style.display = "block";
  document.body.style.overflow = "hidden";
}

function hideConfirmModal() {
  document.getElementById("confirm-modal")!.style.display = "none";
  document.body.style.overflow = "";
  modelsToDelete = [];
}

async function executeDelete() {
  if (modelsToDelete.length === 0) return;

  const confirmBtn = document.getElementById("confirm-delete") as HTMLButtonElement;
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = `<span class="spinner-small"></span> Deleting...`;

  try {
    if (modelsToDelete.length === 1) {
      await invoke("delete_model", { modelId: modelsToDelete[0] });
      showToast("Model deleted successfully", "success");
    } else {
      const result = await invoke<DeleteResult>("delete_models", { modelIds: modelsToDelete });
      if (result.failedCount > 0) {
        showToast(`Deleted ${result.deletedCount} models, ${result.failedCount} failed`, "error");
      } else {
        showToast(`Deleted ${result.deletedCount} models successfully`, "success");
      }
    }

    modelsToDelete.forEach((id) => selectedModels.delete(id));
    updateSelectionUI();
    await loadData();
    hideConfirmModal();
  } catch (err) {
    showToast(`Failed to delete: ${err}`, "error");
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = "<span class=\"btn-text\">Delete</span>";
  }
}

async function openCacheFolder() {
  try {
    await invoke("open_cache_folder");
    showToast("Opened cache folder", "info");
  } catch (err) {
    showToast(`Failed to open folder: ${err}`, "error");
  }
}

// Toast notifications
function showToast(message: string, type: "success" | "error" | "info" = "info") {
  const container = document.getElementById("toast-container")!;
  const toast = document.createElement("div");
  Math.random().toString(36).substr(2, 9);
  
  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
  
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;
  
  container.appendChild(toast);
  
  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });
  
  // Remove after delay
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Utilities
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timeout: number;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = window.setTimeout(() => fn(...args), delay);
  };
}

// Start app
init();
