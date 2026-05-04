# 🤗 Hugging Face Cache Cleaner

A modern, fast desktop application to manage your local Hugging Face cache. Built with Tauri (Rust + TypeScript).

![App Screenshot](screenshot.png)

## Features

- 📊 **Disk Usage Overview** - See total cache size and model count at a glance
- 🔍 **Smart Search** - Find models by name or organization instantly
- 🎯 **Bulk Operations** - Select and delete multiple models at once
- 📅 **Sortable List** - Sort by size, date, name, or organization
- 🎨 **Modern UI** - Clean dark theme with smooth animations
- ⌨️ **Keyboard Shortcuts** - Power user friendly (Cmd/Ctrl + K to search, etc.)
- 🔔 **Toast Notifications** - Get feedback on all actions
- 📂 **Open in Finder** - Quick access to cache location

## Installation

### Download Pre-built Binaries

Download the latest release for your platform from the [Releases](https://github.com/yourusername/huggingface-cache-cleaner/releases) page.

Supported platforms:
- macOS (Intel & Apple Silicon)
- Windows
- Linux (AppImage & .deb)

### Build from Source

#### Prerequisites

- [Node.js](https://nodejs.org/) 16+ 
- [Rust](https://rustup.rs/) 1.70+
- Platform-specific build tools (see [Tauri docs](https://tauri.app/v1/guides/getting-started/prerequisites))

#### Build Steps

```bash
# Clone the repository
git clone https://github.com/yourusername/huggingface-cache-cleaner.git
cd huggingface-cache-cleaner

# Install dependencies
npm install

# Run in development mode
npm run tauri:dev

# Build for production
npm run tauri:build
```

The built application will be in `src-tauri/target/release/bundle/`.

## Usage

1. **Launch** the application - it will automatically detect your Hugging Face cache
2. **Browse** your models in the main list
3. **Search** using the search bar (Cmd/Ctrl + K to focus)
4. **Select** models using checkboxes
5. **Delete** selected models using the delete button

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Focus search bar |
| `Cmd/Ctrl + R` | Refresh model list |
| `Cmd/Ctrl + A` | Select all visible models |
| `Escape` | Clear search / Close modal |

## Cache Location

The app automatically detects your cache by checking (in order):

1. `HF_HOME/hub` environment variable
2. `TRANSFORMERS_CACHE` environment variable (legacy)
3. `HF_HUB_CACHE` environment variable
4. Default: `~/.cache/huggingface/hub`

## Safety

- ✅ Path traversal protection - can only delete files within the cache directory
- ✅ Confirmation dialogs for all delete operations
- ✅ Detailed logging for debugging

## Development

```bash
# Start development server with hot reload
npm run tauri:dev

# Check TypeScript
npm run check

# Generate icons (requires SVG at src-tauri/icons/icon.svg)
npm run icons
```

## Tech Stack

- **Frontend**: TypeScript, Vite, Custom CSS
- **Backend**: Rust, Tauri
- **UI Design**: GitHub-inspired dark theme

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- [Tauri](https://tauri.app/) - For the amazing framework
- [Hugging Face](https://huggingface.co/) - For the amazing ML ecosystem
