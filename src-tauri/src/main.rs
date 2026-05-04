#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use log::{info, warn, error, debug};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use chrono::{DateTime, Local, Utc};

const APP_NAME: &str = "Hugging Face Cache Cleaner";
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ModelInfo {
    id: String,
    name: String,
    organization: String,
    size_bytes: u64,
    size_formatted: String,
    file_count: usize,
    last_modified: String,
    last_modified_timestamp: i64,
    path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheStats {
    total_models: usize,
    total_size_bytes: u64,
    total_size_formatted: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: String,
    version: String,
    cache_location: Option<String>,
}

fn setup_logging() {
    let colors = fern::colors::ColoredLevelConfig::new()
        .info(fern::colors::Color::Green)
        .warn(fern::colors::Color::Yellow)
        .error(fern::colors::Color::Red)
        .debug(fern::colors::Color::Blue);

    fern::Dispatch::new()
        .format(move |out, message, record| {
            out.finish(format_args!(
                "[{}][{}] {}",
                colors.color(record.level()),
                record.target(),
                message
            ))
        })
        .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
        .chain(std::io::stdout())
        .apply()
        .unwrap_or_else(|e| eprintln!("Failed to setup logging: {}", e));
}

fn get_cache_dir() -> Option<PathBuf> {
    debug!("Searching for Hugging Face cache directory...");

    // Check HF_HOME environment variable first
    if let Ok(hf_home) = std::env::var("HF_HOME") {
        let cache_dir = PathBuf::from(&hf_home).join("hub");
        if cache_dir.exists() {
            info!("Found cache via HF_HOME: {}", cache_dir.display());
            return Some(cache_dir);
        }
    }

    // Check TRANSFORMERS_CACHE (legacy)
    if let Ok(transformers_cache) = std::env::var("TRANSFORMERS_CACHE") {
        let cache_dir = PathBuf::from(&transformers_cache);
        if cache_dir.exists() {
            info!("Found cache via TRANSFORMERS_CACHE: {}", cache_dir.display());
            return Some(cache_dir);
        }
    }

    // Check HF_HUB_CACHE
    if let Ok(hf_hub_cache) = std::env::var("HF_HUB_CACHE") {
        let cache_dir = PathBuf::from(&hf_hub_cache);
        if cache_dir.exists() {
            info!("Found cache via HF_HUB_CACHE: {}", cache_dir.display());
            return Some(cache_dir);
        }
    }

    // Default locations based on OS
    if let Some(home_dir) = dirs::home_dir() {
        let default_cache = home_dir.join(".cache/huggingface/hub");
        if default_cache.exists() {
            info!("Found cache at default location: {}", default_cache.display());
            return Some(default_cache);
        }
    }

    warn!("Could not find Hugging Face cache directory");
    None
}

fn format_size(size_bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB", "PB"];
    let mut size = size_bytes as f64;
    let mut unit_index = 0;

    while size >= 1024.0 && unit_index < UNITS.len() - 1 {
        size /= 1024.0;
        unit_index += 1;
    }

    format!("{:.2} {}", size, UNITS[unit_index])
}

fn parse_model_id(folder_name: &str) -> (String, String) {
    // Hugging Face cache folders are named like: models--org--model-name
    if folder_name.starts_with("models--") {
        let parts: Vec<&str> = folder_name.trim_start_matches("models--").split("--").collect();
        if parts.len() >= 2 {
            let org = parts[0].to_string();
            let name = parts[1..].join("-");
            return (org, name);
        }
    }
    
    // Datasets: datasets--org--dataset-name
    if folder_name.starts_with("datasets--") {
        let parts: Vec<&str> = folder_name.trim_start_matches("datasets--").split("--").collect();
        if parts.len() >= 2 {
            let org = parts[0].to_string();
            let name = parts[1..].join("-");
            return (format!("{}/datasets", org), name);
        }
    }

    // Spaces: spaces--org--space-name
    if folder_name.starts_with("spaces--") {
        let parts: Vec<&str> = folder_name.trim_start_matches("spaces--").split("--").collect();
        if parts.len() >= 2 {
            let org = parts[0].to_string();
            let name = parts[1..].join("-");
            return (format!("{}/spaces", org), name);
        }
    }

    ("unknown".to_string(), folder_name.to_string())
}

fn get_model_info(model_path: &Path) -> Option<ModelInfo> {
    let folder_name = model_path.file_name()?.to_str()?;
    let (organization, name) = parse_model_id(folder_name);
    
    let mut total_size: u64 = 0;
    let mut file_count: usize = 0;
    let mut last_modified: Option<std::time::SystemTime> = None;

    for entry in WalkDir::new(model_path).into_iter().filter_map(|e| e.ok()) {
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_file() {
                total_size += metadata.len();
                file_count += 1;
                
                if let Ok(modified) = metadata.modified() {
                    last_modified = last_modified.map(|l| l.max(modified)).or(Some(modified));
                }
            }
        }
    }

    if file_count == 0 {
        return None;
    }

    let last_modified_dt: DateTime<Utc> = last_modified?.into();
    let last_modified_local: DateTime<Local> = last_modified_dt.with_timezone(&Local);

    Some(ModelInfo {
        id: folder_name.to_string(),
        name: name.clone(),
        organization: organization.clone(),
        size_bytes: total_size,
        size_formatted: format_size(total_size),
        file_count,
        last_modified: last_modified_local.format("%Y-%m-%d %H:%M").to_string(),
        last_modified_timestamp: last_modified_local.timestamp(),
        path: model_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn get_app_info() -> Result<AppInfo, String> {
    Ok(AppInfo {
        name: APP_NAME.to_string(),
        version: VERSION.to_string(),
        cache_location: get_cache_dir().map(|p| p.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn get_cache_location() -> Result<String, String> {
    match get_cache_dir() {
        Some(path) => Ok(path.to_string_lossy().to_string()),
        None => {
            error!("Cache directory not found");
            Err("Could not find Hugging Face cache directory. Make sure you have downloaded models using the Hugging Face ecosystem (transformers, diffusers, etc.).".to_string())
        }
    }
}

#[tauri::command]
fn list_models() -> Result<Vec<ModelInfo>, String> {
    info!("Listing models...");
    
    let cache_dir = get_cache_dir()
        .ok_or("Could not find Hugging Face cache directory")?;

    let mut models = Vec::new();

    let entries = fs::read_dir(&cache_dir)
        .map_err(|e| {
            error!("Failed to read cache directory: {}", e);
            format!("Failed to read cache directory: {}", e)
        })?;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            let folder_name = entry.file_name().to_string_lossy().to_string();
            
            // Only include HF cache folders
            if folder_name.starts_with("models--") 
                || folder_name.starts_with("datasets--")
                || folder_name.starts_with("spaces--") {
                
                if let Some(model_info) = get_model_info(&path) {
                    debug!("Found model: {} ({})", model_info.name, model_info.size_formatted);
                    models.push(model_info);
                }
            }
        }
    }

    // Sort by last modified date (newest first)
    models.sort_by(|a, b| b.last_modified_timestamp.cmp(&a.last_modified_timestamp));
    
    info!("Found {} models", models.len());
    Ok(models)
}

#[tauri::command]
fn get_cache_stats() -> Result<CacheStats, String> {
    let models = list_models()?;
    
    let total_size: u64 = models.iter().map(|m| m.size_bytes).sum();
    
    info!("Cache stats: {} models, {} total", models.len(), format_size(total_size));
    
    Ok(CacheStats {
        total_models: models.len(),
        total_size_bytes: total_size,
        total_size_formatted: format_size(total_size),
    })
}

#[tauri::command]
fn delete_model(model_id: String) -> Result<(), String> {
    info!("Deleting model: {}", model_id);
    
    let cache_dir = get_cache_dir()
        .ok_or("Could not find Hugging Face cache directory")?;

    let model_path = cache_dir.join(&model_id);
    
    if !model_path.exists() {
        error!("Model not found: {}", model_id);
        return Err(format!("Model '{}' not found", model_id));
    }

    // Safety check: ensure the path is within the cache directory
    let canonical_cache = cache_dir.canonicalize()
        .map_err(|e| format!("Failed to canonicalize cache dir: {}", e))?;
    let canonical_model = model_path.canonicalize()
        .map_err(|e| format!("Failed to canonicalize model path: {}", e))?;
    
    if !canonical_model.starts_with(&canonical_cache) {
        error!("Security: Attempted to delete path outside cache directory");
        return Err("Security error: Cannot delete files outside cache directory".to_string());
    }

    if model_path.is_dir() {
        fs::remove_dir_all(&model_path)
            .map_err(|e| {
                error!("Failed to delete model directory: {}", e);
                format!("Failed to delete model: {}", e)
            })?;
    } else {
        fs::remove_file(&model_path)
            .map_err(|e| {
                error!("Failed to delete model file: {}", e);
                format!("Failed to delete model: {}", e)
            })?;
    }

    info!("Successfully deleted model: {}", model_id);
    Ok(())
}

#[tauri::command]
fn delete_models(model_ids: Vec<String>) -> Result<DeleteResult, String> {
    info!("Bulk deleting {} models", model_ids.len());
    
    let mut deleted = Vec::new();
    let mut failed = Vec::new();
    
    for model_id in model_ids {
        match delete_model(model_id.clone()) {
            Ok(_) => deleted.push(model_id),
            Err(e) => {
                warn!("Failed to delete model {}: {}", model_id, e);
                failed.push((model_id, e));
            }
        }
    }
    
    info!("Bulk delete complete: {} succeeded, {} failed", deleted.len(), failed.len());
    
    Ok(DeleteResult {
        deleted_count: deleted.len(),
        failed_count: failed.len(),
        deleted,
        failed,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteResult {
    deleted_count: usize,
    failed_count: usize,
    deleted: Vec<String>,
    failed: Vec<(String, String)>,
}

#[tauri::command]
fn open_cache_folder() -> Result<(), String> {
    let cache_dir = get_cache_dir()
        .ok_or("Could not find Hugging Face cache directory")?;
    
    info!("Opening cache folder: {}", cache_dir.display());
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&cache_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&cache_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&cache_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    Ok(())
}

fn main() {
    setup_logging();
    
    info!("Starting {} v{}", APP_NAME, VERSION);

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            get_cache_location,
            list_models,
            get_cache_stats,
            delete_model,
            delete_models,
            open_cache_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
