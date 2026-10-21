# Playwright-Core 在 NapCat 插件中的集成指南

## 一、依赖管理与打包策略

### 1.1 核心思路：内联打包 vs 外部依赖

NapCat 插件本质上是一个被插件管理器动态加载的 ES Module。与常规 Node.js 项目不同，插件**不应依赖用户手动执行 `npm install`**，否则会极大降低插件的安装体验。

参照 `napcat-plugin-puppeteer` 的做法，核心策略是**将 `playwright-core` 及其相关依赖通过 Vite 直接打包进最终的 `index.mjs` 产物中**，使插件成为一个自包含的独立模块。

在 `vite.config.ts` 中，这一策略通过 `rollupOptions.external` 的控制来实现——只将 Node.js 内置模块和少数原生模块声明为外部依赖，而**不包含 `playwright-core`**：

```typescript
// vite.config.ts
import { resolve, dirname } from 'path';
import { defineConfig } from 'vite';
import nodeResolve from '@rollup/plugin-node-resolve';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const nodeModules = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
].flat();

export default defineConfig({
  resolve: {
    conditions: ['node', 'default'],
  },
  build: {
    sourcemap: false,
    target: 'esnext',
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    rollupOptions: {
      // 关键：不 external playwright-core，让它打包进 mjs
      external: [
        ...nodeModules,
        'bufferutil',
        'utf-8-validate',
      ],
      output: {
        inlineDynamicImports: true,
      },
    },
    outDir: 'dist',
    // 处理 CommonJS 模块
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
      defaultIsModuleExports: true,
    },
  },
  plugins: [nodeResolve()],
});
```

**关键配置说明**：

| 配置项                              | 作用                                                |
| ----------------------------------- | --------------------------------------------------- |
| `external` 不包含 `playwright-core` | 使 Rollup 将 `playwright-core` 及其依赖树打包进产物 |
| `inlineDynamicImports: true`        | 将所有动态导入内联到单个文件，避免产生多个 chunk    |
| `commonjsOptions`                   | 将 `node_modules` 中的 CommonJS 模块转换为 ESM      |
| `nodeResolve()` 插件                | 解析 `node_modules` 中的依赖                        |

### 1.2 package.json 配置

`playwright-core` 应声明在 `dependencies` 中（用于开发和构建阶段），但由于最终产物已打包，用户安装时无需再次安装：

```json
{
  "name": "napcat-plugin-playwright",
  "plugin": "Playwright 渲染服务",
  "version": "1.0.0",
  "type": "module",
  "main": "index.mjs",
  "napcat": {
    "tags": ["工具", "渲染"],
    "minVersion": "4.14.13"
  },
  "dependencies": {
    "napcat-types": "0.0.11",
    "playwright-core": "^1.40.0"
  },
  "devDependencies": {
    "@rollup/plugin-node-resolve": "^15.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0"
  },
  "scripts": {
    "build": "vite build",
    "watch": "vite build --watch"
  }
}
```

构建脚本在完成 `vite build` 后，还需要将 `package.json` 复制到 `dist` 目录，并**移除 `devDependencies` 和 `scripts` 字段**，只保留插件运行时所需的元数据：

```json
"copy": "node -e \"const fs=require('fs');fs.cpSync('src/webui/dist','dist/webui',{recursive:true});const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));delete pkg.devDependencies;delete pkg.scripts;fs.writeFileSync('dist/package.json',JSON.stringify(pkg,null,2))\""
```

### 1.3 代码中的导入方式

在源代码中，可以像使用普通 Node.js 模块一样导入 `playwright-core`：

```typescript
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';
```

经过 Vite 打包后，这些导入会被内联到最终的 `index.mjs` 中，运行时无需 `node_modules` 目录。


## 二、浏览器获取：自建 Chrome 安装服务

`playwright-core` 与 `puppeteer-core` 一样，**不包含浏览器二进制文件**，仅提供控制浏览器的高层 API。因此插件必须自行解决浏览器的获取问题。

参照 `napcat-plugin-puppeteer` 的实现，需要构建一套完整的 Chrome 安装服务，涵盖**多源下载、版本管理、平台检测、跨平台依赖安装**等能力。

### 2.1 下载源与版本信息

```typescript
// src/services/chrome-installer.ts

/** Chrome 下载源 */
export const DOWNLOAD_SOURCES = {
  /** 谷歌官方源 */
  GOOGLE: 'https://storage.googleapis.com/chrome-for-testing-public',
  /** NPM 镜像源 CDN（国内推荐） */
  NPMMIRROR: 'https://cdn.npmmirror.com/binaries/chrome-for-testing',
  /** NPM 镜像源 Registry（备用） */
  NPMMIRROR_REGISTRY: 'https://registry.npmmirror.com/-/binary/chrome-for-testing',
} as const;

/** 版本信息 JSON 地址 */
export const VERSIONS_JSON_URLS = {
  NPMMIRROR: 'https://cdn.npmmirror.com/binaries/chrome-for-testing/known-good-versions-with-downloads.json',
  GOOGLE: 'https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json',
} as const;

/** 默认 Chrome 版本 */
export const DEFAULT_CHROME_VERSION = '131.0.6778.204';
```

提供三个下载源的原因在于网络环境差异：Google 官方源在国内访问不稳定，NPM 镜像 CDN 通常速度最快，Registry 作为备用。

### 2.2 Windows 版本兼容性检测

Chrome for Testing 从版本 113 开始提供，且要求 Windows 10 及以上。对于旧版 Windows（7/8/8.1/Server 2012），需要回退到最后一个支持的版本 `109.0.5414.120`，并提示用户手动安装：

```typescript
/** 最后一个支持 Windows 7/8/8.1/Server 2012 的 Chrome 版本 */
export const LAST_LEGACY_WINDOWS_CHROME_VERSION = '109.0.5414.120';

/** Chrome for Testing 最低支持的 Windows 版本 */
const MIN_WINDOWS_VERSION_MAJOR = 10;
const MIN_WINDOWS_VERSION_MINOR = 0;

export interface WindowsVersionInfo {
  major: number;
  minor: number;
  build: number;
  isServer: boolean;
  name: string;
  supportsChromeForTesting: boolean;
}

/**
 * 获取推荐的 Chrome 版本（考虑系统兼容性）
 */
export function getRecommendedChromeVersion(): {
  version: string;
  isLegacy: boolean;
  canAutoInstall: boolean;
  reason?: string;
} {
  if (os.platform() === 'win32') {
    const winInfo = getWindowsVersion();
    if (winInfo && !winInfo.supportsChromeForTesting) {
      return {
        version: LAST_LEGACY_WINDOWS_CHROME_VERSION,
        isLegacy: true,
        canAutoInstall: false,
        reason: `${winInfo.name} 不支持 Chrome for Testing（需要 Windows 10+）。` +
          `请手动安装 Chrome 浏览器并在配置中指定路径。`,
      };
    }
  }
  return {
    version: DEFAULT_CHROME_VERSION,
    isLegacy: false,
    canAutoInstall: true,
  };
}
```

`getWindowsVersion()` 通过 `os.release()` 解析版本号，并通过注册表查询判断是否为 Server 版本。

### 2.3 平台类型与浏览器来源定义

```typescript
/** 平台类型 */
export const Platform = {
  WIN32: 'win32',
  WIN64: 'win64',
  MAC: 'darwin',
  MAC_ARM: 'darwin_arm',
  LINUX: 'linux',
  LINUX_ARM: 'linux_arm',
} as const;

/** 浏览器来源 */
export const BrowserSource = {
  DEFAULT_PATH: 'Default Path',
  REGISTRY: 'Registry',
  PATH_ENVIRONMENT: 'PATH Environment',
  PUPPETEER_CACHE: 'Puppeteer Cache',
  PLAYWRIGHT_CACHE: 'Playwright Cache',
} as const;

/** 安装状态 */
export type InstallStatus =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'installing-deps'
  | 'completed'
  | 'failed';

/** 安装进度信息 */
export interface InstallProgress {
  status: InstallStatus;
  progress: number;
  message: string;
  error?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  speed?: string;
  eta?: string;
}

/** 安装选项 */
export interface InstallOptions {
  version?: string;
  source?: keyof typeof DOWNLOAD_SOURCES | string;
  installPath?: string;
  installDeps?: boolean;
  onProgress?: (progress: InstallProgress) => void;
}
```

### 2.4 跨平台安装路径与系统依赖

Chrome 的安装路径和 Linux 系统依赖因发行版而异。需要检测 Linux 发行版并安装对应的依赖包：

```typescript
/**
 * 获取 Chrome 默认安装路径
 */
export function getDefaultInstallPath(): string {
  const platform = os.platform();
  const homeDir = os.homedir();

  if (platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || homeDir, 'napcat-chrome');
  } else if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Caches', 'napcat-chrome');
  } else {
    return path.join(homeDir, '.cache', 'napcat-chrome');
  }
}

/**
 * 获取 Chrome 可执行文件路径
 */
export function getChromeExecutablePath(installPath: string): string | null {
  const platform = os.platform();

  if (platform === 'win32') {
    const candidate = path.join(
      installPath,
      'chrome-win64', 'chrome.exe'
    );
    if (fs.existsSync(candidate)) return candidate;
    const candidate32 = path.join(
      installPath,
      'chrome-win32', 'chrome.exe'
    );
    return fs.existsSync(candidate32) ? candidate32 : null;
  }

  if (platform === 'darwin') {
    const candidate = path.join(
      installPath,
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents', 'MacOS',
      'Google Chrome for Testing'
    );
    if (fs.existsSync(candidate)) return candidate;
    const candidateX64 = path.join(
      installPath,
      'chrome-mac-x64',
      'Google Chrome for Testing.app',
      'Contents', 'MacOS',
      'Google Chrome for Testing'
    );
    return fs.existsSync(candidateX64) ? candidateX64 : null;
  }

  // Linux
  const candidate = path.join(
    installPath,
    'chrome-linux64',
    'chrome'
  );
  return fs.existsSync(candidate) ? candidate : null;
}
```

### 2.5 系统浏览器自动检测

除了自建安装服务，还应检测系统中已有的浏览器路径，作为兜底方案：

```typescript
/**
 * 获取系统默认浏览器路径列表
 */
export function getDefaultBrowserPaths(): string[] {
  const platform = process.platform;

  if (platform === 'win32') {
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
  } else if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  } else {
    // Linux / Docker
    return [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
      '/opt/google/chrome/chrome',
      '/opt/google/chrome/google-chrome',
      '/headless-shell/headless-shell',
      '/chrome/chrome',
    ];
  }
}
```


## 三、运行时浏览器连接与管理

### 3.1 双模式连接设计

插件应同时支持**本地启动**和**远程连接**两种模式。远程模式通过 `browserWSEndpoint` 连接 Docker 中运行的浏览器，适合生产环境部署。

### 3.2 核心服务模块

```typescript
// src/services/puppeteer-service.ts (使用 playwright-core 的对应版本)

import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { pluginState } from '../core/state';
import {
  getDefaultBrowserPaths,
  DEFAULT_BROWSER_CONFIG,
} from '../config';
import {
  getDefaultInstallPath,
  getChromeExecutablePath,
} from './chrome-installer';
import type { BrowserConfig } from '../types';

// ==================== 状态管理 ====================

/** 浏览器实例 */
let browser: Browser | null = null;
/** 浏览器上下文 */
let context: BrowserContext | null = null;
/** 当前打开的页面数 */
let currentPageCount = 0;
/** 页面信号量（用于限制并发） */
let pageQueue: Array<() => void> = [];

/** 重连相关状态 */
let isReconnecting = false;
let isClosing = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_BASE = 3000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** 健康检查定时器 */
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
const HEALTH_CHECK_INTERVAL = 30000;

/** 断连防抖 */
let disconnectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const DISCONNECT_DEBOUNCE_MS = 2000;

// ==================== 视口配置 ====================

function getDefaultViewport(config: BrowserConfig, overrides?: {
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
}) {
  return {
    width: overrides?.width ?? config.defaultViewportWidth ??
      DEFAULT_BROWSER_CONFIG.defaultViewportWidth!,
    height: overrides?.height ?? config.defaultViewportHeight ??
      DEFAULT_BROWSER_CONFIG.defaultViewportHeight!,
    deviceScaleFactor: overrides?.deviceScaleFactor ??
      config.deviceScaleFactor ??
      DEFAULT_BROWSER_CONFIG.deviceScaleFactor!,
  };
}

// ==================== 重连管理 ====================

function clearReconnectState(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (disconnectDebounceTimer) {
    clearTimeout(disconnectDebounceTimer);
    disconnectDebounceTimer = null;
  }
  isReconnecting = false;
  reconnectAttempts = 0;
}

/**
 * 启动远程连接健康检查
 * 定期通过 browser.version() 探测连接是否正常
 */
function startHealthCheck(): void {
  stopHealthCheck();
  healthCheckTimer = setInterval(async () => {
    if (!browser || isClosing || isReconnecting) return;
    try {
      await browser.version();
    } catch {
      pluginState.logDebug('健康检查失败，连接可能已断开');
    }
  }, HEALTH_CHECK_INTERVAL);
}

function stopHealthCheck(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

/**
 * 尝试重连远程浏览器
 * 使用指数退避策略，最大延迟 30 秒
 */
async function attemptReconnect(): Promise<boolean> {
  const config = pluginState.config.browser;

  if (!config.browserWSEndpoint) return false;

  if (isReconnecting) {
    pluginState.logDebug('已在重连中，跳过');
    return false;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    pluginState.log('error',
      `远程浏览器重连失败，已达到最大重试次数 (${MAX_RECONNECT_ATTEMPTS})`);
    clearReconnectState();
    return false;
  }

  isReconnecting = true;
  reconnectAttempts++;

  // 指数退避延迟，最大 30 秒
  const delay = Math.min(
    RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempts - 1),
    30000
  );

  pluginState.log('info',
    `将在 ${delay}ms 后尝试第 ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} 次重连...`);

  await new Promise(resolve => setTimeout(resolve, delay));

  try {
    pluginState.logDebug(`正在重连远程浏览器: ${config.browserWSEndpoint}`);

    browser = await chromium.connect({
      wsEndpoint: config.browserWSEndpoint,
    });

    setupDisconnectHandler();
    startHealthCheck();

    pluginState.log('info', '远程浏览器重连成功');
    clearReconnectState();
    return true;
  } catch (error) {
    pluginState.logDebug(
      `重连失败 (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}):`, error);
    browser = null;
    isReconnecting = false;

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      return attemptReconnect();
    } else {
      pluginState.log('error',
        `远程浏览器重连失败，已达到最大重试次数 (${MAX_RECONNECT_ATTEMPTS})`);
      clearReconnectState();
      return false;
    }
  }
}
```

> **注意**：`playwright-core` 使用 `chromium.connect({ wsEndpoint })` 而非 `puppeteer.connect({ browserWSEndpoint })`。Playwright 的连接参数名称为 `wsEndpoint`。

### 3.3 断连处理器

```typescript
/**
 * 设置浏览器断开连接处理器
 */
function setupDisconnectHandler(): void {
  if (!browser) return;

  const config = pluginState.config.browser;
  const isRemoteMode = !!config.browserWSEndpoint;

  browser.on('disconnected', () => {
    // 主动关闭/断开时不触发重连
    if (isClosing) {
      pluginState.logDebug('浏览器已主动关闭/断开，跳过重连');
      return;
    }

    stopHealthCheck();
    browser = null;
    context = null;
    currentPageCount = 0;
    pageQueue = [];

    if (!isRemoteMode) {
      pluginState.log('warn', '本地浏览器已断开连接');
      return;
    }

    // 远程模式：防抖避免瞬间多次触发
    if (isReconnecting) {
      pluginState.logDebug('已在重连中，跳过重复的断连事件');
      return;
    }

    if (disconnectDebounceTimer) {
      clearTimeout(disconnectDebounceTimer);
    }

    pluginState.logDebug('远程浏览器连接断开，等待防抖后重连...');
    disconnectDebounceTimer = setTimeout(() => {
      disconnectDebounceTimer = null;
      if (!isClosing && !isReconnecting && !browser) {
        pluginState.log('warn', '远程浏览器连接已断开，准备自动重连...');
        attemptReconnect();
      }
    }, DISCONNECT_DEBOUNCE_MS);
  });
}
```

### 3.4 浏览器初始化

```typescript
/**
 * 查找可用的浏览器路径
 */
function findBrowserPath(
  configPath?: string,
  suppressLog = false
): string | undefined {
  // 优先使用配置的路径
  if (configPath && fs.existsSync(configPath)) {
    return configPath;
  }

  // 检查自建安装服务的路径
  const installedPath = getChromeExecutablePath(getDefaultInstallPath());
  if (installedPath && fs.existsSync(installedPath)) {
    if (!suppressLog) {
      pluginState.log('info',
        `检测到已安装的集成浏览器: ${installedPath}`);
    }
    return installedPath;
  }

  // 自动检测系统浏览器
  const defaultPaths = getDefaultBrowserPaths();
  for (const browserPath of defaultPaths) {
    if (browserPath && fs.existsSync(browserPath)) {
      if (!suppressLog) {
        pluginState.log('info',
          `检测到系统浏览器: ${browserPath}`);
      }
      return browserPath;
    }
  }

  return undefined;
}

/**
 * 初始化浏览器
 * 支持本地启动和远程连接两种模式
 */
export async function initBrowser(): Promise<boolean> {
  const config = pluginState.config.browser;

  try {
    isClosing = false;

    // ==================== 远程模式 ====================
    if (config.browserWSEndpoint) {
      pluginState.log('info',
        `正在连接远程浏览器: ${config.browserWSEndpoint}`);

      browser = await chromium.connect({
        wsEndpoint: config.browserWSEndpoint,
      });

      setupDisconnectHandler();
      startHealthCheck();

      pluginState.log('info', '远程浏览器连接成功');
      return true;
    }

    // ==================== 本地模式 ====================
    const executablePath = findBrowserPath(config.executablePath);

    if (!executablePath) {
      pluginState.log('error',
        '未找到可用的浏览器。请安装 Chrome 或配置浏览器路径。');
      return false;
    }

    pluginState.log('info', `正在启动本地浏览器: ${executablePath}`);

    browser = await chromium.launch({
      executablePath,
      headless: config.headless ?? true,
      args: config.args ?? DEFAULT_BROWSER_CONFIG.args,
      proxy: config.proxy,
    });

    setupDisconnectHandler();

    pluginState.log('info', '本地浏览器启动成功');
    return true;
  } catch (error) {
    pluginState.log('error', '浏览器初始化失败:', error);
    browser = null;
    return false;
  }
}
```

### 3.5 页面并发控制

通过信号量机制限制同时打开的页面数量，防止资源耗尽：

```typescript
/**
 * 获取页面信号量
 * 超过 maxPages 限制时等待
 */
async function acquirePageSlot(): Promise<void> {
  const maxPages = pluginState.config.browser.maxPages ?? 10;

  if (currentPageCount < maxPages) {
    currentPageCount++;
    return;
  }

  await new Promise<void>(resolve => {
    pageQueue.push(resolve);
  });
  currentPageCount++;
}

/**
 * 释放页面信号量
 */
function releasePageSlot(): void {
  currentPageCount--;
  if (pageQueue.length > 0) {
    const next = pageQueue.shift();
    next?.();
  }
}
```

### 3.6 截图核心逻辑

```typescript
export interface ScreenshotOptions {
  url?: string;
  html?: string;
  filePath?: string;
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  fullPage?: boolean;
  encoding?: 'base64' | 'binary';
  timeout?: number;
}

export interface RenderResult {
  success: boolean;
  data?: string;
  error?: string;
}

/**
 * 执行截图渲染
 */
export async function screenshot(
  options: ScreenshotOptions
): Promise<RenderResult> {
  if (!browser) {
    const ok = await initBrowser();
    if (!ok) {
      return { success: false, error: '浏览器未就绪' };
    }
  }

  await acquirePageSlot();

  let page: Page | null = null;

  try {
    const config = pluginState.config.browser;
    const viewport = getDefaultViewport(config, {
      width: options.width,
      height: options.height,
      deviceScaleFactor: options.deviceScaleFactor,
    });

    // 创建上下文和页面
    context = await browser!.newContext({
      viewport,
      deviceScaleFactor: viewport.deviceScaleFactor,
    });

    page = await context.newPage();

    // 设置超时
    page.setDefaultTimeout(options.timeout ?? config.timeout ?? 30000);

    // 加载内容
    if (options.url) {
      await page.goto(options.url, {
        waitUntil: 'networkidle',
        timeout: options.timeout ?? config.timeout ?? 30000,
      });
    } else if (options.html) {
      await page.setContent(options.html, {
        waitUntil: 'networkidle',
      });
    } else if (options.filePath) {
      await page.goto(`file://${path.resolve(options.filePath)}`, {
        waitUntil: 'networkidle',
      });
    } else {
      return { success: false, error: '未提供渲染内容（url/html/filePath）' };
    }

    // 截图
    const screenshotBuffer = await page.screenshot({
      fullPage: options.fullPage ?? false,
      type: 'png',
    });

    const encoding = options.encoding ?? 'base64';

    if (encoding === 'base64') {
      return {
        success: true,
        data: screenshotBuffer.toString('base64'),
      };
    } else {
      return {
        success: true,
        data: screenshotBuffer.toString('binary'),
      };
    }
  } catch (error: any) {
    pluginState.log('error', '截图渲染失败:', error);
    return {
      success: false,
      error: error.message || '截图渲染失败',
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
      context = null;
    }
    releasePageSlot();
  }
}
```

### 3.7 浏览器关闭与清理

```typescript
/**
 * 关闭浏览器
 */
export async function closeBrowser(): Promise<void> {
  isClosing = true;
  clearReconnectState();
  stopHealthCheck();

  if (browser) {
    try {
      await browser.close();
      pluginState.log('info', '浏览器已关闭');
    } catch (e) {
      pluginState.logDebug('关闭浏览器时出错:', e);
    }
    browser = null;
  }

  context = null;
  currentPageCount = 0;
  pageQueue = [];
}

/**
 * 重启浏览器
 */
export async function restartBrowser(): Promise<boolean> {
  await closeBrowser();
  isClosing = false;
  return initBrowser();
}
```

### 3.8 插件生命周期集成

在 `plugin_init` 阶段完成浏览器初始化，并注册 WebUI 路由，将截图能力暴露为 API 供其他插件调用：

```typescript
// src/index.ts
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from './core/state';
import { initBrowser, closeBrowser, screenshot } from './services/puppeteer-service';
import { installChrome, getInstallProgress } from './services/chrome-installer';

const plugin_init = async (ctx: NapCatPluginContext) => {
  try {
    pluginState.initFromContext(ctx);
    pluginState.loadConfig(ctx);

    // 初始化浏览器
    if (pluginState.config.enabled) {
      const success = await initBrowser();
      if (!success) {
        pluginState.log('warn', '浏览器初始化失败，请检查配置');
      }
    }

    // 注册 WebUI 路由
    const router = ctx.router;

    // 无认证 API（供其他插件调用）
    router.getNoAuth('/info', (_req: any, res: any) => {
      res.json({
        code: 0,
        data: {
          pluginName: ctx.pluginName,
          version: '1.0.0',
        },
      });
    });

    // 截图 API
    router.postNoAuth('/screenshot', async (req: any, res: any) => {
      try {
        const body = req.body || {};
        const result = await screenshot({
          url: body.url,
          html: body.html,
          filePath: body.filePath,
          width: body.width,
          height: body.height,
          fullPage: body.fullPage,
          encoding: body.encoding,
        });
        res.json({ code: 0, data: result });
      } catch (e: any) {
        res.status(500).json({ code: -1, message: e.message });
      }
    });

    // Chrome 安装 API
    router.postNoAuth('/install-chrome', async (_req: any, res: any) => {
      try {
        await installChrome({
          onProgress: (progress) => {
            // 可通过 WebSocket 推送进度
          },
        });
        res.json({ code: 0, message: '安装完成' });
      } catch (e: any) {
        res.status(500).json({ code: -1, message: e.message });
      }
    });

    router.getNoAuth('/install-progress', (_req: any, res: any) => {
      res.json({ code: 0, data: getInstallProgress() });
    });
  } catch (error) {
    pluginState.log('error', '插件初始化失败:', error);
  }
};

/** 插件清理函数 */
const plugin_cleanup = async () => {
  await closeBrowser();
  pluginState.log('info', '插件已清理');
};

export { plugin_init, plugin_cleanup };
```

### 3.9 默认浏览器配置

```typescript
// src/config.ts
import type { BrowserConfig, PluginConfig } from './types';

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  executablePath: '',
  browserWSEndpoint: '',
  headless: true,
  args: [
    '--window-size=800,600',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--no-zygote',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-crash-reporter',
    '--disable-translate',
    '--disable-notifications',
    '--disable-device-discovery-notifications',
    '--disable-accelerated-2d-canvas',
  ],
  proxy: undefined,
  maxPages: 10,
  timeout: 30000,
  defaultViewportWidth: 800,
  defaultViewportHeight: 600,
  deviceScaleFactor: 1,
};

export const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  browser: { ...DEFAULT_BROWSER_CONFIG },
  debug: false,
};
```


## 四、Playwright-Core 与 Puppeteer-Core 的关键差异

在将本方案应用于 `playwright-core` 时，需要注意以下 API 差异：

| 功能           | Puppeteer-Core                             | Playwright-Core                       |
| -------------- | ------------------------------------------ | ------------------------------------- |
| 远程连接       | `puppeteer.connect({ browserWSEndpoint })` | `chromium.connect({ wsEndpoint })`    |
| 启动本地浏览器 | `puppeteer.launch({ executablePath })`     | `chromium.launch({ executablePath })` |
| 创建上下文     | `browser.createIncognitoBrowserContext()`  | `browser.newContext()`                |
| 设置页面内容   | `page.setContent(html)`                    | `page.setContent(html)`               |
| 截图           | `page.screenshot({ fullPage })`            | `page.screenshot({ fullPage })`       |
| 断开连接事件   | `browser.on('disconnected')`               | `browser.on('disconnected')`          |

`playwright-core` 的 `connect()` 参数名为 `wsEndpoint`，这与 Puppeteer 的 `browserWSEndpoint` 不同，在编写代码时需要特别注意。


## 五、构建与部署流程总结

```
开发阶段:
  package.json (dependencies: playwright-core)
       ↓
  vite.config.ts (external 不包含 playwright-core)
       ↓
  vite build → dist/index.mjs (playwright-core 已内联)
       ↓
  copy package.json → dist/package.json (移除 devDependencies)
       ↓
  发布 dist/ 目录

用户安装:
  下载 dist/ → 放入 NapCat plugins/ 目录
       ↓
  插件管理器加载 index.mjs (无需 npm install)
       ↓
  plugin_init → 初始化浏览器
       ↓
  如果未检测到浏览器 → 通过 WebUI 一键安装 Chrome
       ↓
  浏览器就绪 → 提供截图 API
```

通过这套完整的依赖管理、浏览器获取和运行时管理方案，`playwright-core` 可以在 NapCat 插件中实现**开箱即用**的浏览器自动化能力，用户无需关心 Node.js 依赖安装或浏览器配置的复杂性。