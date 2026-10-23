# LocalMark — 100% Offline Bulk Watermark Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](./LICENSE)
[![Built with React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Built with Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

**LocalMark** is a fast, privacy-first, **100% offline bulk image & video watermarking studio** that runs entirely inside your browser. Zero cloud uploads, zero file size limits, and zero server dependencies—every image and video is processed locally on your device using hardware-accelerated HTML5 Canvas and Web APIs while preserving **100% of your original resolution and quality**.

Created by **[Itz RJ](https://github.com/itz-rj-here)**.

---

## ✨ Key Features

### 🔒 100% Local & Privacy-First
- **Zero Cloud Uploads**: All media files and brand logos stay strictly on your local machine.
- **Original Resolution & Quality Preserved**: Exports at exact source pixel dimensions (`width × height`) without downscaling or lossy re-compression artifacts when exporting lossless formats.
- **EXIF Orientation Normalization**: Automatically detects and normalizes EXIF orientation tags (`1`–`8`) on camera JPEGs so portraits and landscapes render right-side-up.

### 📂 Step 1: Add Media & Brand Logo
- **Drag-and-Drop Files or Entire Folders**: Recursively scans dropped directories and files (`JPG`, `PNG`, `WebP`, `AVIF`, `GIF`, `SVG`, `BMP`, `TIFF`, `MP4`, `WebM`, `MOV`).
- **Automatic Resolution & Aspect-Ratio Grouping**: Automatically categorizes imported media into smart groups:
  - *Exact Resolution Clusters* (e.g., `1920×1080`, `3840×2160`, `1080×1350`)
  - *Aspect Ratio Buckets* (`Landscape 16:9`, `Portrait 9:16`, `Square 1:1`, `Panoramic`, `Standard 4:3`)
  - *Megapixel Tiers* (`4K+ Ultra HD`, `HD / Full HD`, `Web / Social`)
- **Logo Studio**: Upload transparent `PNG`, `SVG`, `WebP`, or `JPG` watermark logos, or pick from built-in vector studio badges.
- **Built-in Sample Pack & High-Volume Batch Generator**: Test 25+ procedural high-res photos immediately with one click.

### 🎨 Step 2: Precision Watermark Configuration
- **Per-Resolution Group Overrides**: Configure a global watermark style or customize placement, scale, and opacity **independently for each resolution group** (e.g., different watermark placement for `1920×1080` Landscapes vs. `1080×1920` Stories) while keeping 100% original image quality.
- **3 Placement Modes**:
  - **Single Anchor**: 9-point quick snap grid (`Top-Left` to `Bottom-Right`) + interactive drag-on-canvas + fine `X`/`Y` percentage sliders.
  - **Diagonal Tile**: Repeating angled security watermark pattern with customizable tile spacing and angle.
  - **Grid Tile**: Uniform rows & columns grid protection across the entire frame.
- **Visual Styling & Color Harmonization**:
  - Relative size (`1%` – `100%`), opacity (`5%` – `100%`), rotation (`-180°` – `+180°`), and edge margin protection.
  - **Blend Modes**: `Normal`, `Multiply`, `Screen`, `Overlay`, `Soft Light`, `Difference`.
  - **Color Adjustments**: Brightness, Contrast, Saturation, Grayscale, Invert, and Custom Color Tint overlay.
  - **Effects**: Drop Shadow (blur, offset, color), Outline Stroke, and Frosted/Solid Backdrop Pill.
- **Inspection Tools**:
  - Interactive **Before / After Split Slider**
  - **Pixel Loupe Magnifier** for 1:1 quality inspection
  - Rule-of-Thirds & Safe-Zone overlays
  - Full **Undo / Redo** history (`Ctrl+Z` / `Ctrl+Y`)
  - Save, load, import (`.json`), and export custom presets

### ⚡ Step 3: Multi-Core Batch Processing & Export
- **Configurable Worker Concurrency**: Process 1 to 8 items in parallel with real-time throughput (`items/sec`), elapsed time, and ETA tracking.
- **Pause, Resume & Cancel**: Full control over long batch queues at any point.
- **Global Bottom Progress Bar**: Persistent visual progress bar at the bottom of the screen tracking completion percentage across large batches.
- **Optional Synthesized Audio Alerts**: Web Audio API completion chimes and critical error alerts (with instant test sound preview and zero external audio asset dependencies).
- **Flexible Export Options**:
  - **Save to Folder**: Writes all watermarked files directly to a chosen local directory via the File System Access API (`showDirectoryPicker`), with an automatic multi-file sequential download fallback for browsers without directory picker support.
  - **Download All (`.zip`)**: Streams all completed files into a single uncompressed store-mode `.zip` archive via `fflate` for instant archiving with zero quality loss.
  - **Output Formats**: Keep Original Format, `JPEG`, `PNG` (Lossless), or `WebP`, with custom filename prefix/suffix and sequential numbering.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `1` / `2` / `3` | Switch between Step 1, Step 2, and Step 3 |
| `←` / `→` | Previous / Next media item in Step 2 preview |
| `Ctrl/Cmd + Z` | Undo watermark configuration change |
| `Ctrl/Cmd + Y` or `Ctrl/Cmd + Shift + Z` | Redo watermark configuration change |
| `Arrow Keys` (Canvas focused) | Nudge watermark position by `1%` (`Shift + Arrow` for `5%`) |

---

## 🛠️ Tech Stack

- **Frontend Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vite.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) (`@tailwindcss/vite`)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Archive Engine**: Native zero-dependency CRC32 Store-Mode `.zip` streaming builder
- **Rendering & Audio**: Native HTML5 2D Canvas API, File System Access API, and Web Audio API

---

## 🚀 Getting Started (Local Development)

### Prerequisites
- **Node.js** `v18.0.0` or higher (or **Bun** / **pnpm** / **Yarn**)

### 1. Clone the repository
```bash
git clone https://github.com/itz-rj-here/localmark.git
cd localmark
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start the development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build for production
```bash
npm run build
npm run preview
```

---

## 🌐 Deploying to Vercel

This project is pre-configured with [`vercel.json`](./vercel.json) and [`.npmrc`](./.npmrc) for zero-configuration deployment on **Vercel**.

### Option 1: Deploy via Vercel Dashboard (Recommended)
1. Push this repository to your GitHub, GitLab, or Bitbucket account.
2. Go to [vercel.com/new](https://vercel.com/new) and import your repository.
3. Vercel will automatically detect **Vite** using `vercel.json`:
   - **Framework Preset**: `Vite`
   - **Install Command**: `npm install --legacy-peer-deps`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Click **Deploy** — your live site will be ready in under a minute!

### Option 2: Deploy via Vercel CLI
```bash
npm i -g vercel
vercel
```
To deploy directly to production:
```bash
vercel --prod
```

---

## 📁 Project Structure

```text
├── src/
│   ├── components/
│   │   ├── TopBar.tsx             # Step navigation, sound toggle, help modal & reset
│   │   ├── Step1AddMedia.tsx      # Media & logo ingestion, resolution grouping
│   │   ├── Step2Configure.tsx     # Interactive canvas preview, per-resolution overrides
│   │   ├── Step3ProcessExport.tsx # Batch processor, ZIP & Save-to-Folder export
│   │   └── HelpModal.tsx          # Interactive guide & shortcut reference
│   ├── types/
│   │   └── watermark.ts           # TypeScript interfaces & default configurations
│   ├── utils/
│   │   ├── canvasRenderer.ts      # High-precision HTML5 Canvas & video watermark renderer
│   │   ├── soundAlerts.ts         # Web Audio API synthesized sound alerts
│   │   └── watermarkEngine.ts     # Batch processing, EXIF parser & store-mode ZIP builder
│   ├── App.tsx                    # Root state, resolution overrides, global progress & footer
│   ├── index.css                  # Tailwind CSS v4 + custom scrollbar styling
│   └── main.tsx                   # Application entry point
├── .npmrc                         # NPM peer-dependency resolution config for Vercel/CI
├── index.html                     # HTML entry point
├── LICENSE                        # MIT License
├── package.json                   # Project metadata, scripts & dependencies
├── tsconfig.json                  # TypeScript configuration
├── vercel.json                    # Vercel deployment & SPA routing configuration
└── vite.config.ts                 # Vite bundler configuration
```

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](./LICENSE) for full details.

---

## 👤 Author & Credits

Created with ❤️ by **Itz RJ**
- GitHub: [@itz-rj-here](https://github.com/itz-rj-here)
