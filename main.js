const { app, BrowserWindow, ipcMain, session, shell, screen, webContents, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const ftp = require('basic-ftp');
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
  console.warn('electron-updater não disponível no momento:', e.message);
}

// Evitar conflitos de permissão e otimizar velocidade de rede e renderização
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
// Flags de aceleração de carregamento de páginas Web / SPA (Dio.me, etc)
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-quic');
app.commandLine.appendSwitch('enable-tcp-fast-open');
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess,ParallelDownloading,CanvasOopRasterization');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,BlockInsecurePrivateNetworkRequests');
// Compatibilidade total com portais legados (DATASUS, Governamentais, Intranets, HTTP misto)
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('ignore-certificate-errors');

const vortexDataDir = path.join(app.getPath('appData'), 'VortexBrowserData');
try {
  if (!fs.existsSync(vortexDataDir)) {
    fs.mkdirSync(vortexDataDir, { recursive: true });
  }
  app.setPath('userData', vortexDataDir);
} catch (e) {
  console.error('Erro ao definir userData:', e);
}

// ── Configurações de Cookies e Armazenamento do Usuário ──
const cookieSettingsFile = path.join(vortexDataDir, 'cookie-settings.json');
let cookieSettings = {
  policy: 'block_third_party', // 'allow_all' | 'block_third_party' | 'block_all'
  autoAcceptBanners: true,
  clearOnExit: false
};

try {
  if (fs.existsSync(cookieSettingsFile)) {
    const raw = fs.readFileSync(cookieSettingsFile, 'utf8');
    cookieSettings = { ...cookieSettings, ...JSON.parse(raw) };
  }
} catch (e) {
  console.warn('Aviso ao carregar cookie-settings.json:', e.message);
}

function saveCookieSettings(data) {
  try {
    cookieSettings = { ...cookieSettings, ...data };
    fs.writeFileSync(cookieSettingsFile, JSON.stringify(cookieSettings, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Erro ao salvar cookie-settings.json:', e);
    return false;
  }
}

// ── Permissões de Sites Persistentes (Estilo Google Chrome) ──
const sitePermissionsFile = path.join(vortexDataDir, 'vortex-site-permissions.json');
let sitePermissions = {};

try {
  if (fs.existsSync(sitePermissionsFile)) {
    const raw = fs.readFileSync(sitePermissionsFile, 'utf8');
    sitePermissions = JSON.parse(raw);
  }
} catch (e) {
  console.warn('Aviso ao carregar vortex-site-permissions.json:', e.message);
  sitePermissions = {};
}

function saveSitePermission(origin, permission, allowed) {
  try {
    if (!origin) return;
    if (!sitePermissions[origin]) {
      sitePermissions[origin] = {};
    }
    sitePermissions[origin][permission] = !!allowed;
    fs.writeFileSync(sitePermissionsFile, JSON.stringify(sitePermissions, null, 2), 'utf8');
  } catch (e) {
    console.error('Erro ao salvar vortex-site-permissions.json:', e);
  }
}

function getSitePermission(origin, permission) {
  try {
    if (!origin || !sitePermissions[origin]) return undefined;
    return sitePermissions[origin][permission];
  } catch (e) {
    return undefined;
  }
}

// ── Gerenciamento de Múltiplas Janelas / Instâncias (Estilo Google Chrome) ──
// Ao clicar no atalho no desktop com o Vortex já aberto, abre uma NOVA JANELA independente.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Instância secundária: encerra imediatamente e delega a abertura para a instância principal
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Alguém clicou no atalho novamente no desktop ou barra de tarefas:
    // Cria e exibe uma nova janela do Vortex (igual ao Google Chrome)
    const newWin = createWindow();
    if (newWin) {
      if (newWin.isMinimized()) newWin.restore();
      newWin.focus();

      // Caso tenha sido passado uma URL via linha de comando
      const urlArg = commandLine.find(arg => arg && (arg.startsWith('http://') || arg.startsWith('https://')));
      if (urlArg) {
        newWin.webContents.once('did-finish-load', () => {
          newWin.webContents.send('open-in-new-tab', urlArg);
        });
      }
    }
  });
}

// ── Segurança: Limpar perfil importado automaticamente do Chrome ───────────
// Versões anteriores do Vortex podiam importar dados do Chrome sem permissão.
// Ao iniciar, verificamos se o perfil salvo veio de importação automática e limpamos.
const PROFILE_FILE_TEMP = path.join(vortexDataDir, 'vortex-profile.json');
try {
  if (fs.existsSync(PROFILE_FILE_TEMP)) {
    const savedProfile = JSON.parse(fs.readFileSync(PROFILE_FILE_TEMP, 'utf8'));
    // Se o perfil não tem a flag 'manuallyConnected', foi importado automaticamente — limpar
    if (savedProfile && savedProfile.email && !savedProfile.manuallyConnected) {
      const cleanProfile = { email: '', name: '', photoUrl: '', syncEnabled: false, lastSync: null };
      fs.writeFileSync(PROFILE_FILE_TEMP, JSON.stringify(cleanProfile, null, 2), 'utf8');
      console.log('[Vortex] Perfil auto-importado do Chrome removido. Usuário deve conectar manualmente.');
    }
  }
} catch(e) {}


// ── Cofre Seguro de Senhas e Perfil de Sincronização ───────────────────
const PASSWORDS_FILE = path.join(vortexDataDir, 'vortex-passwords.enc');
const PROFILE_FILE = path.join(vortexDataDir, 'vortex-profile.json');
const CRYPTO_KEY = crypto.scryptSync('VORTEX_BROWSER_VAULT_KEY_2026', 'vortex-salt', 32);

function encryptData(text) {
  try {
    // 1. Usar safeStorage nativo do Windows (DPAPI) sempre que disponível
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const encryptedBuffer = safeStorage.encryptString(text);
      return 'safe:' + encryptedBuffer.toString('hex');
    }
  } catch (e) {
    console.warn('safeStorage indisponível, usando AES-256 fallback:', e.message);
  }

  // 2. Fallback seguro com AES-256-CBC
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', CRYPTO_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return 'aes:' + iv.toString('hex') + ':' + encrypted;
  } catch (e) {
    return text;
  }
}

function decryptData(text) {
  if (!text) return text;

  // Formato seguro com safeStorage
  if (text.startsWith('safe:')) {
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const hex = text.slice(5);
        const buf = Buffer.from(hex, 'hex');
        return safeStorage.decryptString(buf);
      }
    } catch (e) {
      console.error('Erro ao descriptografar com safeStorage:', e.message);
    }
  }

  // Formato com prefixo 'aes:' ou legado 'iv:ciphertext'
  let rawText = text;
  if (rawText.startsWith('aes:')) {
    rawText = rawText.slice(4);
  }

  try {
    const parts = rawText.split(':');
    if (parts.length !== 2) return rawText;
    const iv = Buffer.from(parts[0], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', CRYPTO_KEY, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return text;
  }
}

function loadPasswords() {
  try {
    if (fs.existsSync(PASSWORDS_FILE)) {
      const raw = fs.readFileSync(PASSWORDS_FILE, 'utf8');
      const decrypted = decryptData(raw);
      const parsed = JSON.parse(decrypted);

      // Se foi lido do formato legado AES e o safeStorage estiver ativo, migrar automaticamente
      if (!raw.startsWith('safe:') && safeStorage && safeStorage.isEncryptionAvailable()) {
        savePasswords(parsed);
      }

      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.error('Erro ao ler cofre de senhas:', e);
  }
  return [];
}

function savePasswords(list) {
  try {
    const json = JSON.stringify(list, null, 2);
    const enc = encryptData(json);
    fs.writeFileSync(PASSWORDS_FILE, enc, 'utf8');
    return true;
  } catch (e) {
    console.error('Erro ao salvar cofre de senhas:', e);
    return false;
  }
}

function loadUserProfile() {
  try {
    if (fs.existsSync(PROFILE_FILE)) {
      return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Erro ao ler perfil:', e);
  }
  // Perfil padrão vazio — o usuário deve configurar manualmente
  return { email: '', name: '', photoUrl: '', syncEnabled: false, lastSync: null };
}

function saveUserProfile(profile) {
  try {
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Erro ao salvar perfil:', e);
    return false;
  }
}


let mainWindow = null;

function broadcastToWindows(channel, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

function safeGetWindowFromWebContents(wc) {
  if (!wc) return getActiveWindow();
  try {
    if (typeof BrowserWindow.fromWebContents === 'function') {
      const win = BrowserWindow.fromWebContents(wc);
      if (win && !win.isDestroyed()) return win;
    }
  } catch (e) {}
  return getActiveWindow();
}

function getActiveWindow() {
  return BrowserWindow.getFocusedWindow() || mainWindow || BrowserWindow.getAllWindows()[0] || null;
}

// Lista ampliada e eficiente de bloqueio de anúncios e telemetria (AdBlocker / Privacy Shield)
const TRACKER_BLOCK_LIST = [
  // Google Ads, Analytics & Telemetry
  '*://*.doubleclick.net/*',
  '*://*.google-analytics.com/*',
  '*://*.googletagmanager.com/*',
  '*://*.googleadservices.com/*',
  '*://*.googlesyndication.com/*',
  '*://pagead2.googlesyndication.com/*',
  '*://adservice.google.com/*',
  '*://*.googleoptimize.com/*',
  // Redes Sociais & Tracking Pixels
  '*://*.facebook.com/tr/*',
  '*://connect.facebook.net/*',
  '*://*.ads-twitter.com/*',
  '*://static.ads-twitter.com/*',
  '*://*.analytics.twitter.com/*',
  '*://*.tiktok.com/api/v1/pixel/*',
  '*://analytics.tiktok.com/*',
  '*://*.ads.linkedin.com/*',
  '*://snap.licdn.com/*',
  // Principais redes de Adtech, Afiliados e Popups
  '*://*.scorecardresearch.com/*',
  '*://*.adnxs.com/*',
  '*://*.criteo.com/*',
  '*://*.criteo.net/*',
  '*://*.hotjar.com/*',
  '*://*.hotjar.io/*',
  '*://*.outbrain.com/*',
  '*://*.taboola.com/*',
  '*://*.quantserve.com/*',
  '*://*.rubiconproject.com/*',
  '*://*.pubmatic.com/*',
  '*://*.openx.net/*',
  '*://*.casalemedia.com/*',
  '*://*.smartadserver.com/*',
  '*://*.advertising.com/*',
  '*://*.popads.net/*',
  '*://*.popcash.net/*',
  '*://*.propellerads.com/*',
  '*://*.exoclick.com/*',
  '*://*.trafficjunky.com/*',
  '*://*.zergnet.com/*',
  '*://*.adroll.com/*',
  '*://*.adcolony.com/*',
  '*://*.unityads.unity3d.com/*',
  '*://*.inmobi.com/*',
  '*://*.vungle.com/*',
  '*://*.ironsrc.com/*',
  '*://*.revcontent.com/*',
  '*://*.mgid.com/*',
  '*://*.adsterra.com/*',
  '*://*.yandex.ru/ads/*',
  '*://*.an.yandex.ru/*',
  '*://mc.yandex.ru/*',
  // Anti-Crypto Mining malicioso embutido em sites
  '*://*.coinhive.com/*',
  '*://*.coin-hive.com/*',
  '*://*.crypto-loot.com/*',
  '*://*.cryptoloot.pro/*'
];

let adBlockStats = { blockedCount: 0, enabled: true };

// Detector de arquivos que devem ser baixados diretamente
function isDownloadableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();

    // NUNCA interceptar páginas web comuns (.asp, .aspx, .php, .jsp, .html, .htm, .shtml) como arquivo baixável
    const webPageExts = ['.asp', '.aspx', '.jsp', '.php', '.html', '.htm', '.shtml'];
    if (webPageExts.some(ext => cleanUrl.endsWith(ext))) {
      return false;
    }

    const lower = url.toLowerCase();
    // Identifica especificamente servlets de download binário (ex: DATASUS / CNES DownloadServlet)
    if (lower.includes('downloadservlet') || lower.includes('/downloadservlet')) {
      return true;
    }

    // Extensões de arquivos executáveis, compactados e bases de dados que devem ser baixados diretamente
    const downloadExtensions = [
      '.exe', '.msi', '.zip', '.rar', '.7z', '.tar', '.gz',
      '.dts', '.dbf', '.dbc', '.cnv', '.iso', '.bin', '.apk',
      '.dmg', '.rpm', '.deb'
    ];

    // Se o caminho do arquivo terminar com uma extensão de download
    if (downloadExtensions.some(ext => cleanUrl.endsWith(ext))) {
      return true;
    }

    // Se houver parâmetros de query, verifica se termina explicitamente com uma extensão compactada (ex: file=data.zip)
    const query = url.split('?')[1]?.toLowerCase() || '';
    if (query) {
      if (downloadExtensions.some(ext => query.endsWith(ext) || query.includes(ext + '&') || query.includes('=' + ext.replace('.', '')))) {
        return true;
      }
    }

    return false;
  } catch (e) {
    return false;
  }
}

// Gerenciador nativo de Download FTP (Datasus: SIASUS, SIHD, CIHA, etc.)
async function downloadFtpUrl(ftpUrl, originWin = null) {
  let client;
  let fileName = 'download';
  let localPath = '';
  const targetWin = originWin || getActiveWindow();
  try {
    const parsed = new URL(ftpUrl);
    const host = parsed.hostname;
    const port = parsed.port ? parseInt(parsed.port, 10) : 21;
    const user = parsed.username || 'anonymous';
    const password = parsed.password || 'anonymous@vortex.local';
    const remotePath = decodeURIComponent(parsed.pathname);
    fileName = path.basename(remotePath) || 'download';

    const downloadsDir = app.getPath('downloads');
    const defaultPath = path.join(downloadsDir, fileName);

    const chosenPath = dialog.showSaveDialogSync(targetWin, {
      title: 'Salvar Arquivo FTP Como',
      defaultPath: defaultPath,
      properties: ['showOverwriteConfirmation']
    });

    if (!chosenPath) {
      return;
    }
    localPath = chosenPath;

    client = new ftp.Client();
    client.ftp.verbose = false;
    client.ftp.timeout = 45000;

    await client.access({
      host,
      port,
      user,
      password,
      secure: false
    });

    let totalBytes = 0;
    try {
      totalBytes = await client.size(remotePath);
    } catch (e) {
      totalBytes = 0;
    }

    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('download-started', {
        fileName,
        totalBytes
      });
    }

    client.trackProgress(info => {
      if (targetWin && !targetWin.isDestroyed()) {
        targetWin.webContents.send('download-progress', {
          fileName,
          receivedBytes: info.bytes,
          totalBytes: totalBytes || info.bytes
        });
      }
    });

    await client.downloadTo(localPath, remotePath);

    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('download-completed', {
        fileName,
        state: 'completed',
        savePath: localPath
      });
    }
  } catch (err) {
    console.error('Erro no download FTP do Vortex:', err);
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('download-completed', {
        fileName,
        state: 'interrupted',
        savePath: ''
      });
    }
  } finally {
    if (client) {
      try { client.close(); } catch (e) {}
    }
  }
}

// Inicia download HTTP/HTTPS via gerenciador de sessão do Electron com proteção contra chamadas duplicadas
let lastDownloadUrl = '';
let lastDownloadTime = 0;

function downloadHttpUrl(url) {
  if (!url || typeof url !== 'string') return;
  const now = Date.now();
  // Evita disparos duplicados para a mesma URL em menos de 3 segundos
  if (url === lastDownloadUrl && (now - lastDownloadTime) < 3000) {
    return;
  }
  lastDownloadUrl = url;
  lastDownloadTime = now;

  try {
    session.defaultSession.downloadURL(url);
  } catch (e) {
    console.error('Erro ao baixar URL HTTP:', e);
  }
}

let sessionInitialized = false;
function initDefaultSession() {
  if (sessionInitialized) return;
  sessionInitialized = true;

  const defaultSession = session.defaultSession;
  
  // Gerenciamento Inteligente de Permissões (Estilo Google Chrome)
  const pendingPermissionRequests = new Map();
  let permReqIdCounter = 0;

  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'openExternal') {
      callback(false);
      return;
    }

    // Identificar a URL de origem da requisição
    let origin = '';
    try {
      origin = details && details.requestingUrl ? new URL(details.requestingUrl).origin : (webContents.getURL() ? new URL(webContents.getURL()).origin : '');
    } catch(e) {
      origin = webContents.getURL() || '';
    }

    // Se for página interna ou esquema especial, libera diretamente
    if (origin.startsWith('vortex://') || origin.startsWith('about:') || origin.startsWith('chrome:')) {
      callback(true);
      return;
    }

    // Permissões comuns que o usuário deve autorizar igual ao Chrome
    const promptPermissions = ['geolocation', 'notifications', 'media', 'midi', 'pointerLock', 'clipboard-read', 'clipboard-sanitized-write'];

    if (!promptPermissions.includes(permission)) {
      callback(true);
      return;
    }

    // 1. Verifica se já existe uma decisão persistida para este domínio e permissão
    const savedDecision = getSitePermission(origin, permission);
    if (typeof savedDecision === 'boolean') {
      // Já foi autorizado ou bloqueado anteriormente: aplica sem incomodar o usuário
      callback(savedDecision);
      return;
    }

    permReqIdCounter++;
    const reqId = permReqIdCounter;
    pendingPermissionRequests.set(reqId, { callback, origin, permission });

    // Envia solicitação de permissão para a janela do Vortex
    broadcastToWindows('permission-requested', {
      requestId: reqId,
      permission,
      origin,
      url: details?.requestingUrl || webContents.getURL() || ''
    });

    // Timeout de segurança: se o usuário não responder em 30 segundos, não trava a requisição
    setTimeout(() => {
      if (pendingPermissionRequests.has(reqId)) {
        const item = pendingPermissionRequests.get(reqId);
        pendingPermissionRequests.delete(reqId);
        try { item.callback(false); } catch(e) {}
      }
    }, 30000);
  });

  defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === 'openExternal') {
      return false;
    }
    // Verifica se há regra persistida para esta permissão
    const saved = getSitePermission(requestingOrigin, permission);
    if (typeof saved === 'boolean') {
      return saved;
    }
    return true;
  });

  ipcMain.on('permission-response', (event, { requestId, allow, origin, permission }) => {
    if (pendingPermissionRequests.has(requestId)) {
      const item = pendingPermissionRequests.get(requestId);
      pendingPermissionRequests.delete(requestId);
      const effOrigin = origin || item.origin;
      const effPermission = permission || item.permission;
      
      // Persiste a decisão do usuário para que NUNCA MAIS peça novamente para este site
      if (effOrigin && effPermission) {
        saveSitePermission(effOrigin, effPermission, !!allow);
      }
      
      try {
        item.callback(!!allow);
      } catch (e) {}
    } else if (origin && permission) {
      saveSitePermission(origin, permission, !!allow);
    }
  });

  // Bloquear rastreadores e anúncios
  defaultSession.webRequest.onBeforeRequest({ urls: TRACKER_BLOCK_LIST }, (details, callback) => {
    if (!adBlockStats.enabled) {
      callback({});
      return;
    }
    adBlockStats.blockedCount++;
    broadcastToWindows('tracker-blocked', { 
      url: details.url, 
      count: adBlockStats.blockedCount 
    });
    callback({ cancel: true });
  });

  // User-Agent padrão idêntico ao Google Chrome mais recente (garante compatibilidade 100% com WhatsApp Web, Google Docs, etc.)
  const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

  defaultSession.setUserAgent(CHROME_USER_AGENT);

  defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    // DNT (Do Not Track) e GPC (Global Privacy Control)
    details.requestHeaders['DNT'] = '1';
    details.requestHeaders['Sec-GPC'] = '1';
    
    // Sempre envia o User-Agent oficial do Google Chrome para eliminar detecções e alertas em WhatsApp Web, DIO, etc.
    details.requestHeaders['User-Agent'] = CHROME_USER_AGENT;
    
    callback({ requestHeaders: details.requestHeaders });
  });

  // Política de Proteção e Bloqueio de Cookies
  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    
    // Se a política for bloquear todos os cookies
    if (cookieSettings.policy === 'block_all') {
      delete responseHeaders['set-cookie'];
      delete responseHeaders['Set-Cookie'];
      callback({ responseHeaders });
      return;
    }
    
    // Se a política for bloquear cookies de terceiros
    if (cookieSettings.policy === 'block_third_party' && (responseHeaders['set-cookie'] || responseHeaders['Set-Cookie'])) {
      try {
        const reqHost = new URL(details.url).hostname.toLowerCase();
        let topHost = '';
        if (details.initiator) {
          topHost = new URL(details.initiator).hostname.toLowerCase();
        } else if (details.referrer) {
          topHost = new URL(details.referrer).hostname.toLowerCase();
        }
        
        const getBaseDomain = (h) => {
          const parts = h.split('.');
          if (parts.length >= 2) return parts.slice(-2).join('.');
          return h;
        };

        if (topHost && getBaseDomain(reqHost) !== getBaseDomain(topHost) && details.resourceType !== 'mainFrame') {
          // Requisição de terceiro inserindo cookie de rastreamento
          delete responseHeaders['set-cookie'];
          delete responseHeaders['Set-Cookie'];
        }
      } catch (e) {}
    }

    callback({ responseHeaders });
  });

  // Gerenciador Nativo de Downloads HTTP/HTTPS do Vortex
  let isSaveDialogActive = false;
  let lastPromptedDownloadUrl = '';
  let lastPromptedDownloadTime = 0;

  defaultSession.on('will-download', (event, item, webContents) => {
    const itemUrl = item.getURL ? item.getURL() : '';
    const itemChain = item.getURLChain ? item.getURLChain() : [];
    const originUrl = itemChain.length > 0 ? itemChain[0] : itemUrl;
    const now = Date.now();

    // Se um diálogo de salvar já estiver aberto na tela, cancela a solicitação concorrente para evitar caixa dupla
    if (isSaveDialogActive) {
      console.log('[Vortex Download] Diálogo já ativo na tela. Cancelando download duplicado:', originUrl);
      item.cancel();
      return;
    }

    // Se a mesma URL disparou outro download em menos de 2,5 segundos, cancela o duplicado
    if (originUrl && originUrl === lastPromptedDownloadUrl && (now - lastPromptedDownloadTime) < 2500) {
      console.log('[Vortex Download] Ignorando download concorrente para mesma URL:', originUrl);
      item.cancel();
      return;
    }

    lastPromptedDownloadUrl = originUrl;
    lastPromptedDownloadTime = now;

    const fileName = item.getFilename();
    const totalBytes = item.getTotalBytes();
    const downloadsDir = app.getPath('downloads');
    const defaultPath = path.join(downloadsDir, fileName);
    const targetWin = safeGetWindowFromWebContents(webContents);

    // Abre diálogo para o usuário escolher a pasta de destino e nome do arquivo (igual Chrome)
    let chosenPath = null;
    isSaveDialogActive = true;
    try {
      if (targetWin && !targetWin.isDestroyed()) {
        chosenPath = dialog.showSaveDialogSync(targetWin, {
          title: 'Salvar Arquivo Como',
          defaultPath: defaultPath,
          properties: ['showOverwriteConfirmation']
        });
      } else {
        chosenPath = dialog.showSaveDialogSync({
          title: 'Salvar Arquivo Como',
          defaultPath: defaultPath,
          properties: ['showOverwriteConfirmation']
        });
      }
    } catch (err) {
      console.warn('Aviso no showSaveDialogSync:', err.message);
      chosenPath = defaultPath;
    } finally {
      isSaveDialogActive = false;
    }

    // Se o usuário cancelou a caixa de diálogo
    if (!chosenPath) {
      item.cancel();
      return;
    }

    item.setSavePath(chosenPath);
    
    // Notifica início do download
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('download-started', {
        fileName: path.basename(chosenPath),
        totalBytes
      });
    }

    item.on('updated', (event, state) => {
      if (state === 'progressing') {
        if (targetWin && !targetWin.isDestroyed()) {
          targetWin.webContents.send('download-progress', {
            fileName: path.basename(chosenPath),
            receivedBytes: item.getReceivedBytes(),
            totalBytes: item.getTotalBytes()
          });
        }
      }
    });

    item.once('done', (event, state) => {
      if (targetWin && !targetWin.isDestroyed()) {
        targetWin.webContents.send('download-completed', {
          fileName: path.basename(chosenPath),
          state, // 'completed', 'cancelled', 'interrupted'
          savePath: item.getSavePath ? item.getSavePath() : chosenPath
        });
      }
    });
  });
}

// ── Gerenciador de Estado da Janela (Estilo Google Chrome) ──────────────────
const windowStateFile = path.join(vortexDataDir, 'window-state.json');

function loadWindowState() {
  let primaryWorkArea = { x: 0, y: 0, width: 1280, height: 820 };
  try {
    const primary = screen.getPrimaryDisplay();
    if (primary && primary.workArea) {
      primaryWorkArea = primary.workArea;
    }
  } catch (e) {}

  // Padrão Google Chrome: primeira inicialização abre MAXIMIZADO preenchendo toda a tela
  const state = {
    x: undefined,
    y: undefined,
    width: Math.min(1366, primaryWorkArea.width || 1280),
    height: Math.min(860, primaryWorkArea.height || 820),
    isMaximized: true
  };

  try {
    if (fs.existsSync(windowStateFile)) {
      const saved = JSON.parse(fs.readFileSync(windowStateFile, 'utf8'));
      if (typeof saved.isMaximized === 'boolean') {
        state.isMaximized = saved.isMaximized;
      }
      if (Number.isInteger(saved.width) && saved.width >= 600) {
        state.width = saved.width;
      }
      if (Number.isInteger(saved.height) && saved.height >= 400) {
        state.height = saved.height;
      }
      if (Number.isInteger(saved.x) && Number.isInteger(saved.y)) {
        // Valida se as coordenadas salvas ainda estão visíveis em algum monitor atualmente conectado
        try {
          const displays = screen.getAllDisplays();
          const isVisible = displays.some(d => {
            const b = d.bounds;
            return (
              saved.x >= b.x - 20 &&
              saved.x < b.x + b.width - 50 &&
              saved.y >= b.y - 20 &&
              saved.y < b.y + b.height - 50
            );
          });
          if (isVisible) {
            state.x = saved.x;
            state.y = saved.y;
          }
        } catch (e) {}
      }
    }
  } catch (err) {
    console.warn('[WindowState] Falha ao ler estado salvo:', err.message);
  }

  return state;
}

let saveWindowStateTimer = null;
function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const isMax = win.isMaximized();
    let bounds = {};
    if (!isMax && !win.isMinimized() && !win.isFullScreen()) {
      bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    } else if (win.getNormalBounds) {
      bounds = win.getNormalBounds();
    }

    const state = {
      isMaximized: isMax,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    };
    fs.writeFileSync(windowStateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {}
}

function debouncedSaveWindowState(win) {
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(() => {
    saveWindowState(win);
  }, 400);
}

function createWindow() {
  const appIconPath = path.join(__dirname, 'assets', 'icon.png');
  const winState = loadWindowState();

  const win = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
    minWidth: 900,
    minHeight: 600,
    show: false, // Inicia invisível para aplicar o estado maximizado suavemente sem "pulo" visual
    icon: fs.existsSync(appIconPath) ? appIconPath : undefined,
    frame: false, // Frame customizado moderno / minimalista estilo Dev
    backgroundColor: '#0a0d14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true, // Habilita tags <webview> para isolamento de abas
      plugins: true     // Habilita visualizador de PDF embutido (evita abrir o Edge para PDFs)
    }
  });

  mainWindow = win;

  // Se o usuário fechou maximizado (ou é o primeiro acesso), abre maximizado
  if (winState.isMaximized) {
    win.maximize();
  }

  win.once('ready-to-show', () => {
    if (winState.isMaximized && !win.isMaximized()) {
      win.maximize();
    }
    win.show();
    try {
      win.webContents.send('window-maximized-change', win.isMaximized());
    } catch (e) {}
  });

  win.loadFile('index.html');

  // Monitora redimensionamento e movimento para persistir como no Google Chrome
  win.on('resize', () => {
    if (!win.isMaximized() && !win.isMinimized()) {
      debouncedSaveWindowState(win);
    }
  });

  win.on('move', () => {
    if (!win.isMaximized() && !win.isMinimized()) {
      debouncedSaveWindowState(win);
    }
  });

  win.on('maximize', () => {
    debouncedSaveWindowState(win);
    try {
      win.webContents.send('window-maximized-change', true);
    } catch (e) {}
  });

  win.on('unmaximize', () => {
    debouncedSaveWindowState(win);
    try {
      win.webContents.send('window-maximized-change', false);
    } catch (e) {}
  });

  win.on('close', () => {
    saveWindowState(win);
  });

  win.on('focus', () => {
    mainWindow = win;
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      const remaining = BrowserWindow.getAllWindows().filter(w => w !== win && !w.isDestroyed());
      mainWindow = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
  });

  return win;
}

// IPC Controls da Janela Customizada
ipcMain.handle('window-is-maximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || getActiveWindow();
  return win && !win.isDestroyed() ? win.isMaximized() : false;
});

ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || getActiveWindow();
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || getActiveWindow();
  if (win && !win.isDestroyed()) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    debouncedSaveWindowState(win);
  }
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || getActiveWindow();
  if (win && !win.isDestroyed()) {
    saveWindowState(win);
    win.close();
  }
});

ipcMain.on('get-block-stats', (event) => {
  event.returnValue = adBlockStats;
});

// Posição física e instantânea do mouse relativo à janela Vortex para o menu de contexto abrir exatamente na ponta da seta (igual ao Chrome)
function resolveCursorPoint(event) {
  try {
    const point = screen.getCursorScreenPoint();
    const win = (event && event.sender && BrowserWindow.fromWebContents(event.sender)) || getActiveWindow();
    if (win && !win.isDestroyed()) {
      const winBounds = win.getContentBounds ? win.getContentBounds() : win.getBounds();
      return { 
        x: Math.round(point.x - winBounds.x), 
        y: Math.round(point.y - winBounds.y) 
      };
    }
    return point;
  } catch (e) {
    return null;
  }
}

ipcMain.on('get-cursor-point', (event) => {
  event.returnValue = resolveCursorPoint(event);
});

ipcMain.handle('get-cursor-point', async (event) => {
  return resolveCursorPoint(event);
});

ipcMain.on('set-adblock-enabled', (event, enabled) => {
  adBlockStats.enabled = !!enabled;
});

ipcMain.handle('get-downloads-path', () => {
  return app.getPath('downloads');
});

// IPC para acionar download FTP
ipcMain.on('download-ftp', (event, url) => {
  const win = BrowserWindow.fromWebContents(event.sender) || getActiveWindow();
  if (url) downloadFtpUrl(url, win);
});

// IPC para acionar download HTTP
ipcMain.on('download-url', (event, url) => {
  if (url) downloadHttpUrl(url);
});

// IPC para mostrar arquivo baixado na pasta
ipcMain.on('show-item-in-folder', (event, fullPath) => {
  if (!isTrustedSender(event)) return;
  if (fullPath && fs.existsSync(fullPath)) {
    shell.showItemInFolder(fullPath);
  } else {
    shell.openPath(app.getPath('downloads'));
  }
});

// IPC para abrir arquivo baixado
ipcMain.on('open-path', (event, fullPath) => {
  if (!isTrustedSender(event)) return;
  if (fullPath && fs.existsSync(fullPath)) {
    shell.openPath(fullPath);
  }
});

// Limpeza de rastros ao fechar / modo privado
ipcMain.on('clear-browsing-data', async (event) => {
  await session.defaultSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'cache']
  });
  event.sender.send('browsing-data-cleared');
});

// Abertura de nova janela isolada
ipcMain.on('open-new-window', () => {
  createWindow();
});

// ── Validação Estrita de Remetente (Prevenção de Ataques IPC) ───────────
// Garante que APENAS a janela nativa do próprio Vortex possa acessar o cofre de senhas
function isTrustedSender(event) {
  if (!event || !event.sender) return false;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  return event.sender.id === win.webContents.id;
}

// ── IPC Handlers: Gerenciamento Avançado de Cookies e Segurança de Sites ─────
ipcMain.handle('get-cookies', async (event, filter = {}) => {
  if (!isTrustedSender(event)) return { success: false, cookies: [] };
  try {
    const cookies = await session.defaultSession.cookies.get(filter || {});
    return { success: true, cookies };
  } catch (err) {
    return { success: false, error: err.message, cookies: [] };
  }
});

ipcMain.handle('delete-cookie', async (event, { url, name }) => {
  if (!isTrustedSender(event)) return { success: false, error: 'Acesso negado' };
  try {
    if (!url || !name) return { success: false, error: 'Parâmetros inválidos' };
    await session.defaultSession.cookies.remove(url, name);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('clear-cookies-domain', async (event, domain) => {
  if (!isTrustedSender(event)) return { success: false, error: 'Acesso negado' };
  try {
    if (!domain) return { success: false, error: 'Domínio inválido' };
    const cookies = await session.defaultSession.cookies.get({ domain });
    let removed = 0;
    for (const c of cookies) {
      const protocol = c.secure ? 'https' : 'http';
      const cleanDomain = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain;
      const url = `${protocol}://${cleanDomain}${c.path || '/'}`;
      try {
        await session.defaultSession.cookies.remove(url, c.name);
        removed++;
      } catch (e) {}
    }
    return { success: true, count: removed };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('clear-all-cookies', async (event) => {
  if (!isTrustedSender(event)) return { success: false, error: 'Acesso negado' };
  try {
    await session.defaultSession.clearStorageData({ storages: ['cookies'] });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-site-security-info', async (event, pageUrl) => {
  if (!isTrustedSender(event)) return { success: false };
  try {
    if (!pageUrl || pageUrl.startsWith('about:') || pageUrl.startsWith('vortex://')) {
      return { 
        success: true,
        isInternal: true, 
        secure: true, 
        protocol: 'vortex://', 
        domain: 'vortex://interna', 
        cookieCount: 0, 
        cookies: [] 
      };
    }
    let urlObj;
    try {
      urlObj = new URL(pageUrl);
    } catch(e) {
      return { success: false, isInternal: false, secure: false, error: 'URL inválida', cookieCount: 0, cookies: [] };
    }
    const domain = urlObj.hostname;
    const cookies = await session.defaultSession.cookies.get({ domain });
    return {
      success: true,
      domain,
      protocol: urlObj.protocol,
      isHttps: urlObj.protocol === 'https:',
      cookieCount: cookies.length,
      cookies: cookies.map(c => ({
        name: c.name,
        value: c.value ? (c.value.length > 50 ? c.value.substring(0, 50) + '...' : c.value) : '',
        domain: c.domain,
        path: c.path,
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        session: !!c.session,
        expires: c.expirationDate ? new Date(c.expirationDate * 1000).toLocaleDateString('pt-BR') : 'Sessão'
      }))
    };
  } catch (err) {
    return { success: false, error: err.message, cookieCount: 0, cookies: [] };
  }
});

ipcMain.handle('get-cookie-settings', (event) => {
  if (!isTrustedSender(event)) return cookieSettings;
  return cookieSettings;
});

ipcMain.handle('set-cookie-settings', (event, newSettings) => {
  if (!isTrustedSender(event)) return { success: false };
  saveCookieSettings(newSettings);
  return { success: true, settings: cookieSettings };
});

// ── IPC Handlers: Gerenciador de Senhas e Sincronização por E-mail ─────
ipcMain.handle('get-saved-passwords', (event) => {
  if (!isTrustedSender(event)) return [];
  return loadPasswords();
});

ipcMain.handle('save-password', (event, entry) => {
  if (!isTrustedSender(event)) return { success: false, error: 'Acesso negado' };
  if (!entry || !entry.url || !entry.password) return { success: false };
  const list = loadPasswords();
  const index = list.findIndex(item => item.url === entry.url && item.username === entry.username);
  const now = Date.now();
  if (index >= 0) {
    list[index] = { ...list[index], ...entry, updatedAt: now };
  } else {
    list.push({
      id: 'pwd_' + now + '_' + Math.random().toString(36).slice(2, 7),
      url: entry.url,
      domain: entry.domain || (new URL(entry.url).hostname),
      username: entry.username || '',
      password: entry.password,
      createdAt: now,
      updatedAt: now
    });
  }
  const ok = savePasswords(list);
  return { success: ok, passwords: list };
});

ipcMain.handle('delete-password', (event, id) => {
  if (!isTrustedSender(event)) return { success: false, error: 'Acesso negado' };
  let list = loadPasswords();
  list = list.filter(item => item.id !== id);
  const ok = savePasswords(list);
  return { success: ok, passwords: list };
});

ipcMain.handle('get-user-profile', (event) => {
  if (!isTrustedSender(event)) return null;
  // Retorna APENAS o perfil salvo pelo próprio usuário no Vortex.
  // NUNCA lê dados de outros navegadores automaticamente.
  // O usuário deve conectar seu perfil manualmente pela interface.
  return loadUserProfile();
});

ipcMain.handle('sync-chrome-data', () => {
  try {
    const chromeUserData = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
    const defaultProfile = path.join(chromeUserData, 'Default');
    const prefFile = path.join(defaultProfile, 'Preferences');
    const bookmarksFile = path.join(defaultProfile, 'Bookmarks');
    const photoFile = path.join(defaultProfile, 'Google Profile Picture.png');

    let profile = loadUserProfile();
    let importedBookmarks = [];
    let photoData = '';

    // 1. Extrair foto do perfil
    if (fs.existsSync(photoFile)) {
      const imgBuf = fs.readFileSync(photoFile);
      if (imgBuf && imgBuf.length > 0) {
        photoData = `data:image/png;base64,${imgBuf.toString('base64')}`;
        profile.photoUrl = photoData;
      }
    }

    // 2. Extrair dados da conta Google logada no Chrome
    if (fs.existsSync(prefFile)) {
      const prefData = JSON.parse(fs.readFileSync(prefFile, 'utf8'));
      const acc = prefData.account_info?.[0] || {};
      const foundEmail = acc.email || prefData.google?.services?.signin?.email;
      const foundName = acc.full_name || prefData.profile?.name;
      if (foundEmail) {
        profile.email = foundEmail;
        profile.name = foundName || foundEmail.split('@')[0];
        profile.syncEnabled = true;
      }
      if (!photoData && acc.picture_url) {
        profile.photoUrl = acc.picture_url;
      }
      saveUserProfile(profile);
    }

    // 3. Extrair Favoritos
    if (fs.existsSync(bookmarksFile)) {
      const bData = JSON.parse(fs.readFileSync(bookmarksFile, 'utf8'));
      function extract(node, list = []) {
        if (!node) return list;
        if (node.type === 'url' && node.url) {
          list.push({ title: node.name || node.url, url: node.url, icon: '⭐' });
        }
        if (Array.isArray(node.children)) {
          node.children.forEach(c => extract(c, list));
        }
        return list;
      }
      const b1 = extract(bData.roots?.bookmark_bar);
      const b2 = extract(bData.roots?.other);
      importedBookmarks = [...b1, ...b2];
    }

    return {
      success: true,
      profile,
      bookmarks: importedBookmarks,
      bookmarksCount: importedBookmarks.length
    };
  } catch(err) {
    console.error('Erro ao sincronizar dados do Chrome:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-user-profile', (event, profile) => {
  const current = loadUserProfile();
  const updated = { ...current, ...profile, lastSync: Date.now() };
  const ok = saveUserProfile(updated);
  return { success: ok, profile: updated };
});

ipcMain.handle('export-vault', (event) => {
  if (!isTrustedSender(event)) return null;
  const passwords = loadPasswords();
  const profile = loadUserProfile();
  const vaultPayload = {
    vortexVersion: app.getVersion(),
    exportDate: new Date().toISOString(),
    profile,
    passwords
  };
  return JSON.stringify(vaultPayload, null, 2);
});

ipcMain.handle('import-vault', (event, jsonString) => {
  if (!isTrustedSender(event)) return { success: false, count: 0, error: 'Acesso negado' };
  try {
    const data = JSON.parse(jsonString);
    if (Array.isArray(data.passwords)) {
      const current = loadPasswords();
      const map = new Map();
      current.forEach(p => map.set(`${p.domain || p.url}_${p.username}`, p));
      data.passwords.forEach(p => {
        const key = `${p.domain || p.url}_${p.username}`;
        map.set(key, { ...p, id: p.id || ('pwd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)) });
      });
      const merged = Array.from(map.values());
      savePasswords(merged);
      if (data.profile && data.profile.email) {
        saveUserProfile(data.profile);
      }
      return { success: true, count: merged.length };
    }
  } catch (e) {
    console.error('Erro ao importar cofre:', e);
  }
  return { success: false, count: 0 };
});


// ── Modo Anônimo / Privado ───────────────────────────────────────────
// Cada chamada cria uma partição única completamente isolada:
//   - Sem cookies persistentes, sem cache, sem localStorage, sem sessão salva
//   - Bloqueio de rastreadores igual ao modo normal
//   - Não aparece no histórico

ipcMain.on('open-private-tab', (event, initialUrl) => {
  // Gera uma partição única para este tab anônimo (memória volátil, sem persistência)
  const partitionId = `incognito-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const privateSession = session.fromPartition(partitionId, { cache: false });
  activePrivateSessions.add(privateSession);

  // Aplica proxy da VPN caso já esteja conectada
  if (vpnState.connected && vpnState.proxyHost && vpnState.proxyPort) {
    privateSession.setProxy({ proxyRules: `socks5://${vpnState.proxyHost}:${vpnState.proxyPort}` }).catch(() => {});
  }

  // Copiar bloqueio de rastreadores para a sessão anônima
  privateSession.webRequest.onBeforeRequest({ urls: TRACKER_BLOCK_LIST }, (details, callback) => {
    if (!adBlockStats.enabled) { callback({}); return; }
    adBlockStats.blockedCount++;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tracker-blocked', { url: details.url, count: adBlockStats.blockedCount });
    }
    callback({ cancel: true });
  });

  // Aplicar headers de privacidade na sessão anônima
  privateSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['DNT'] = '1';
    details.requestHeaders['Sec-GPC'] = '1';
    callback({ requestHeaders: details.requestHeaders });
  });

  // Gerenciar downloads na sessão anônima
  privateSession.on('will-download', (ev, item) => {
    const itemUrl = item.getURL ? item.getURL() : '';
    const itemChain = item.getURLChain ? item.getURLChain() : [];
    const originUrl = itemChain.length > 0 ? itemChain[0] : itemUrl;
    const now = Date.now();

    if (isSaveDialogActive) {
      item.cancel();
      return;
    }
    if (originUrl && originUrl === lastPromptedDownloadUrl && (now - lastPromptedDownloadTime) < 2500) {
      item.cancel();
      return;
    }

    lastPromptedDownloadUrl = originUrl;
    lastPromptedDownloadTime = now;

    const fileName = item.getFilename();
    const totalBytes = item.getTotalBytes();
    const downloadsDir = app.getPath('downloads');
    const defaultPath = path.join(downloadsDir, fileName);
    const targetWin = safeGetWindowFromWebContents(null);

    let chosenPath = null;
    isSaveDialogActive = true;
    try {
      if (targetWin && !targetWin.isDestroyed()) {
        chosenPath = dialog.showSaveDialogSync(targetWin, {
          title: 'Salvar Arquivo Como (Guia Anônima)',
          defaultPath: defaultPath,
          properties: ['showOverwriteConfirmation']
        });
      } else {
        chosenPath = dialog.showSaveDialogSync({
          title: 'Salvar Arquivo Como (Guia Anônima)',
          defaultPath: defaultPath,
          properties: ['showOverwriteConfirmation']
        });
      }
    } catch (err) {
      console.warn('Aviso no showSaveDialogSync anônimo:', err.message);
      chosenPath = defaultPath;
    } finally {
      isSaveDialogActive = false;
    }

    if (!chosenPath) {
      item.cancel();
      return;
    }

    item.setSavePath(chosenPath);
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('download-started', { fileName: path.basename(chosenPath), totalBytes });
    }
    item.on('updated', (e2, state) => {
      if (state === 'progressing' && targetWin && !targetWin.isDestroyed()) {
        targetWin.webContents.send('download-progress', {
          fileName: path.basename(chosenPath), receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes()
        });
      }
    });
    item.once('done', (e2, state) => {
      if (targetWin && !targetWin.isDestroyed()) {
        targetWin.webContents.send('download-completed', {
          fileName: path.basename(chosenPath), state, savePath: item.getSavePath ? item.getSavePath() : chosenPath
        });
      }
    });
  });

  // Informar o renderer qual partição usar e qual URL carregar
  if (!event.sender.isDestroyed()) {
    event.sender.send('private-tab-ready', {
      partition: partitionId,
      url: initialUrl || null
    });
  }
});


// ── VPN Gratuita Integrada (Vortex Secure Tunnel) ────────────────────────
// Usa servidores SOCKS5/HTTP dinâmicos testados em tempo real por região.
// 100% gratuito, sem cadastro ou chaves de API.
let vpnState = {
  connected: false,
  region: 'auto',
  proxyHost: null,
  proxyPort: null,
  protocol: 'direct'
};

const activePrivateSessions = new Set();

function testSocks5Connection(ip, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: ip, port: parseInt(port, 10), timeout: timeoutMs });
    s.on('connect', () => { s.write(Buffer.from([0x05, 0x01, 0x00])); });
    s.on('data', (d) => { s.destroy(); resolve(d[0] === 0x05 && d[1] === 0x00); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

function fetchLiveRegionalProxy(regionCode) {
  return new Promise((resolve) => {
    const url = (!regionCode || regionCode === 'auto')
      ? 'https://proxmint.com/api/free-proxies?protocol=socks5&pageSize=8'
      : `https://proxmint.com/api/free-proxies?protocol=socks5&country=${encodeURIComponent(regionCode)}&pageSize=8`;

    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const json = JSON.parse(data);
          const candidates = json.rows || [];
          for (const cand of candidates) {
            const isAlive = await testSocks5Connection(cand.ip, cand.port, 2000);
            if (isAlive) {
              resolve({ host: cand.ip, port: cand.port, protocol: 'socks5', country: cand.countryCode });
              return;
            }
          }
        } catch (e) {}
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function applyProxyToAllSessions(proxyConfig) {
  const sessionsToUpdate = [session.defaultSession, ...activePrivateSessions];
  for (const sess of sessionsToUpdate) {
    try {
      if (sess && !sess.isDestroyed?.()) {
        await sess.setProxy(proxyConfig);
      }
    } catch (e) {
      console.error('Erro ao aplicar proxy na sessão:', e);
    }
  }
}

ipcMain.handle('set-vpn-proxy', async (event, { enable, region }) => {
  try {
    if (enable) {
      // 1. Tenta resolver um servidor ativo dinamicamente com teste de conexão SOCKS5
      let liveServer = await fetchLiveRegionalProxy(region);
      
      // 2. Se a região específica não tiver resposta em 4s, tenta a melhor localização (auto)
      if (!liveServer && region !== 'auto') {
        liveServer = await fetchLiveRegionalProxy('auto');
      }

      // 3. Fallback estável de contingência
      if (!liveServer) {
        liveServer = { host: '107.174.30.92', port: 1080, protocol: 'socks5', country: 'us' };
      }

      const proxyRules = `socks5://${liveServer.host}:${liveServer.port}`;
      await applyProxyToAllSessions({ proxyRules });

      vpnState = {
        connected: true,
        region: region || 'auto',
        proxyHost: liveServer.host,
        proxyPort: liveServer.port,
        protocol: liveServer.protocol
      };
    } else {
      await applyProxyToAllSessions({ proxyRules: 'direct://' });
      vpnState = {
        connected: false,
        region: region || 'auto',
        proxyHost: null,
        proxyPort: null,
        protocol: 'direct'
      };
    }
    return { success: true, ...vpnState };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-vpn-status', async () => {
  return { success: true, ...vpnState };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// ── DevTools Acoplado — Electron 33+ (setDevToolsWebContents foi removido no Electron 28+)
// Usa openDevTools({ mode: 'right' }) que é o método oficial suportado.
// O DevTools abre nativo do Chromium acoplado à direita da webview, igual ao Chrome.

ipcMain.handle('dock-devtools', async (event, { targetWebContentsId, devtoolsWebContentsId, x, y }) => {
  try {
    const targetWc = webContents.fromId(targetWebContentsId);
    if (!targetWc || targetWc.isDestroyed()) {
      return { success: false, error: 'WebContents não encontrado' };
    }

    let dockedInContainer = false;
    if (devtoolsWebContentsId) {
      const devtoolsWc = webContents.fromId(devtoolsWebContentsId);
      if (devtoolsWc && !devtoolsWc.isDestroyed() && typeof targetWc.setDevToolsWebContents === 'function') {
        try {
          targetWc.setDevToolsWebContents(devtoolsWc);
          targetWc.openDevTools();
          dockedInContainer = true;
        } catch (e) {
          console.warn('setDevToolsWebContents falhou, usando modo dock lateral:', e.message);
        }
      }
    }

    if (!dockedInContainer) {
      targetWc.openDevTools({ mode: 'right' });
    }

    if (typeof x === 'number' && typeof y === 'number') {
      const px = Math.max(0, Math.round(x));
      const py = Math.max(0, Math.round(y));
      setTimeout(() => {
        try {
          if (!targetWc.isDestroyed()) targetWc.inspectElement(px, py);
        } catch (e) {}
      }, 150);
    }
    return { success: true, dockedInContainer };
  } catch (err) {
    console.error('Erro ao acoplar DevTools:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-devtools', async (event, { targetWebContentsId, mode, x, y }) => {
  try {
    const targetWc = webContents.fromId(targetWebContentsId);
    if (!targetWc || targetWc.isDestroyed()) {
      return { success: false, error: 'WebContents não encontrado' };
    }
    const devMode = mode || 'detach';
    if (typeof x === 'number' && typeof y === 'number') {
      targetWc.openDevTools({ mode: devMode });
      const px = Math.max(0, Math.round(x));
      const py = Math.max(0, Math.round(y));
      try {
        if (!targetWc.isDestroyed()) targetWc.inspectElement(px, py);
      } catch(e) {}
    } else {
      targetWc.openDevTools({ mode: devMode });
    }
    return { success: true };
  } catch (err) {
    console.error('Erro ao abrir DevTools:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('close-devtools', async (event, { targetWebContentsId }) => {
  try {
    const targetWc = webContents.fromId(targetWebContentsId);
    if (targetWc && !targetWc.isDestroyed()) {
      targetWc.closeDevTools();
      return { success: true };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
  return { success: false };
});

ipcMain.handle('is-devtools-open', async (event, { targetWebContentsId }) => {
  try {
    const targetWc = webContents.fromId(targetWebContentsId);
    if (targetWc && !targetWc.isDestroyed()) {
      return { open: targetWc.isDevToolsOpened() };
    }
  } catch (err) {}
  return { open: false };
});

// Captura de tela da página ativa (Screenshot)
ipcMain.handle('capture-page', async (event, { targetWebContentsId }) => {
  try {
    let wc = null;
    if (targetWebContentsId) {
      wc = webContents.fromId(targetWebContentsId);
    }
    if (!wc || wc.isDestroyed()) {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) {
        const img = await win.capturePage();
        return { success: true, dataUrl: img.toDataURL() };
      }
      return { success: false, error: 'WebContents não encontrado' };
    }
    const image = await wc.capturePage();
    return { success: true, dataUrl: image.toDataURL() };
  } catch (err) {
    console.error('Erro ao capturar tela:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-screenshot-dialog', async (event, { dataUrl, defaultName }) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender) || getActiveWindow();
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    const savePath = dialog.showSaveDialogSync(win, {
      title: 'Salvar Captura de Tela',
      defaultPath: path.join(app.getPath('pictures') || app.getPath('downloads'), defaultName || `Vortex_Screenshot_${Date.now()}.png`),
      filters: [{ name: 'Imagens PNG', extensions: ['png'] }]
    });

    if (savePath) {
      fs.writeFileSync(savePath, buffer);
      return { success: true, path: savePath };
    }
    return { success: false, canceled: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Sistema de Atualizações Automáticas (Auto-Updater / GitHub Releases) ──
// Compara versões semver
function isNewerVersion(remote, local) {
  if (!remote || !local) return false;
  const r = remote.replace(/^v/, '').split('.').map(n => parseInt(n, 10));
  const l = local.replace(/^v/, '').split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

// Fallback direto via API pública do GitHub (caso autoUpdater falhe ou em ambiente de desenvolvimento)
function checkGitHubReleaseDirect() {
  return new Promise((resolve) => {
    const https = require('https');
    const headers = {
      'User-Agent': 'VortexBrowser-AutoUpdater'
    };
    if (process.env.GH_TOKEN) {
      headers['Authorization'] = 'token ' + process.env.GH_TOKEN;
    }
    const req = https.request({
      hostname: 'api.github.com',
      path: '/repos/vortexbrowser/vortex-browser/releases/latest',
      headers
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const rel = JSON.parse(data);
            const tagVer = (rel.tag_name || rel.name || '').replace(/^v/, '');
            const exeAsset = rel.assets?.find(a => a.name?.endsWith('.exe'));
            resolve({
              found: true,
              version: tagVer,
              releaseNotes: rel.body || '',
              publishedAt: rel.published_at,
              downloadUrl: exeAsset?.browser_download_url || rel.html_url
            });
            return;
          }
        } catch (e) {}
        resolve({ found: false });
      });
    });
    req.on('error', () => resolve({ found: false }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ found: false }); });
    req.end();
  });
}

function setupAutoUpdater() {
  if (!autoUpdater) return;

  try {
    const feedConfig = {
      provider: 'github',
      owner: 'vortexbrowser',
      repo: 'vortex-browser',
      releaseType: 'release'
    };
    autoUpdater.setFeedURL(feedConfig);
  } catch (err) {
    console.warn('[AutoUpdater] Erro ao configurar FeedURL:', err.message);
  }

  // Notificação com confirmação do usuário (NÃO baixa automaticamente; aguarda clique do usuário para iniciar o download)
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Verificando se há novas atualizações...');
  });

  autoUpdater.on('update-available', (info) => {
    const currentVer = app.getVersion();
    console.log(`[AutoUpdater] Versão instalada: ${currentVer} | Versão no GitHub: ${info.version}`);

    if (!isNewerVersion(info.version, currentVer)) {
      console.log('[AutoUpdater] Versão remota é igual ou menor. Nenhuma notificação necessária.');
      return;
    }

    console.log('[AutoUpdater] Nova versão disponível encontrada:', info.version);
    broadcastToWindows('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes || ''
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] Vortex já está na versão mais recente:', info?.version);
  });

  autoUpdater.on('error', (err) => {
    console.warn('[AutoUpdater] Aviso ao verificar atualização:', err.message);
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcastToWindows('update-download-progress', {
      percent: Math.round(progress.percent || 0),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Nova versão baixada e pronta para instalar:', info.version);
    broadcastToWindows('update-downloaded', {
      version: info.version
    });
  });
}

ipcMain.handle('check-for-updates', async () => {
  const currentVersion = app.getVersion();
  let updaterResult = null;
  let updaterError = null;

  if (autoUpdater && app.isPackaged) {
    try {
      updaterResult = await autoUpdater.checkForUpdates();
    } catch (err) {
      updaterError = err.message;
      console.warn('[AutoUpdater] autoUpdater falhou, tentando fallback GitHub:', err.message);
    }
  }

  if (updaterResult && updaterResult.updateInfo) {
    const isNewer = isNewerVersion(updaterResult.updateInfo.version, currentVersion);
    return {
      success: true,
      updateAvailable: isNewer,
      version: updaterResult.updateInfo.version,
      currentVersion,
      releaseNotes: updaterResult.updateInfo.releaseNotes || ''
    };
  }

  // Fallback via API do GitHub
  const direct = await checkGitHubReleaseDirect();
  if (direct && direct.found) {
    const isNewer = isNewerVersion(direct.version, currentVersion);
    return {
      success: true,
      updateAvailable: isNewer,
      version: direct.version,
      currentVersion,
      releaseNotes: direct.releaseNotes,
      downloadUrl: direct.downloadUrl
    };
  }

  if (updaterError) {
    return { success: false, error: updaterError, currentVersion };
  }

  return { success: true, updateAvailable: false, currentVersion };
});

ipcMain.handle('download-update', async () => {
  if (autoUpdater && app.isPackaged) {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      console.warn('[AutoUpdater] Download via autoUpdater falhou:', err.message);
    }
  }

  // Fallback: Baixa diretamente DENTRO do Vortex Browser, NUNCA abrindo o Chrome ou navegador externo
  const direct = await checkGitHubReleaseDirect();
  if (direct && direct.downloadUrl) {
    try {
      console.log('[AutoUpdater] Baixando atualização diretamente no Vortex Browser:', direct.downloadUrl);
      session.defaultSession.downloadURL(direct.downloadUrl);
      return { success: true, internalDownload: true };
    } catch (e) {
      console.error('[AutoUpdater] Erro ao iniciar download interno da atualização:', e);
    }
  }

  return { success: false, error: 'Não foi possível iniciar o download da atualização.' };
});

ipcMain.handle('install-update', () => {
  if (!autoUpdater) return { success: false };
  try {
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  } catch (err) {
    console.error('Erro ao reiniciar para instalar atualização:', err);
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
  if (!gotTheLock) return;
  initDefaultSession();
  createWindow();
  setupAutoUpdater();

  // Verificação de atualização estilo Google Chrome:
  // Checa 3.5 segundos após iniciar e depois periodicamente a cada 30 minutos em segundo plano
  function runBackgroundUpdateCheck() {
    try {
      if (app.isPackaged && autoUpdater) {
        autoUpdater.checkForUpdates().catch(err => {
          console.warn('[AutoUpdater] Verificação em background falhou:', err.message);
        });
      }
    } catch(e) {}
  }

  setTimeout(runBackgroundUpdateCheck, 3500);
  setInterval(runBackgroundUpdateCheck, 30 * 60 * 1000);

  // Garante isolamento estrito contra injeção maliciosa em webviews (reforço de segurança do Chromium)
  app.on('web-contents-created', (event, contents) => {
    // Define User-Agent padrão em todo webContents (garante que navigator.userAgent em JS retorne Chrome 134)
    if (typeof contents.setUserAgent === 'function') {
      contents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');
    }

    contents.on('will-attach-webview', (wvEvent, webPreferences, params) => {
      // Impede qualquer script em páginas web de tentar acessar módulos Node.js
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInWorker = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.backgroundThrottling = false; // Não congelar requisições em segundo plano ou carregamento
      webPreferences.images = true;
      webPreferences.webgl = true;
      webPreferences.spellcheck = false; // Evita overhead de checagem ortográfica durante render pesado de SPAs
      // Compatibilidade com portais legados (ex: DATASUS, SEFAZ, scripts HTTP em páginas e iframes)
      webPreferences.allowRunningInsecureContent = true;
    });

    // Permitir certificados de servidores governamentais / internos sem quebrar a navegação
    contents.on('certificate-error', (event, url, error, certificate, callback) => {
      event.preventDefault();
      callback(true);
    });

    // Intercepta window.open ou links com target="_blank"
    contents.setWindowOpenHandler(({ url }) => {
      // Permitir URLs internas do DevTools
      if (url.startsWith('devtools://') || url.startsWith('chrome-devtools://')) {
        return { action: 'allow' };
      }
      // Se a URL for vazia ou about:blank
      if (!url || url === 'about:blank' || url === 'about:blank#') {
        return { action: 'deny' };
      }

      const targetWin = safeGetWindowFromWebContents(contents);
      if (url.startsWith('ftp://')) {
        downloadFtpUrl(url, targetWin);
        return { action: 'deny' };
      }
      if (isDownloadableUrl(url)) {
        downloadHttpUrl(url);
        return { action: 'deny' };
      }
      if (targetWin && !targetWin.isDestroyed()) {
        const isIncognito = contents.session && (
          contents.session !== session.defaultSession ||
          (contents.session.partition && contents.session.partition.startsWith('incognito-'))
        );
        if (isIncognito) {
          targetWin.webContents.send('open-in-new-tab', {
            url,
            partition: contents.session.partition || ''
          });
        } else {
          targetWin.webContents.send('open-in-new-tab', url);
        }
      }
      return { action: 'deny' };
    });

    // Intercepta navegações diretas para evitar que o SO repasse para o navegador padrão (Edge)
    contents.on('will-navigate', (event, url) => {
      if (url.startsWith('ftp://')) {
        event.preventDefault();
        downloadFtpUrl(url);
        return;
      }
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (cookieSettings && cookieSettings.clearOnExit) {
    try {
      await session.defaultSession.clearStorageData({ storages: ['cookies'] });
    } catch (e) {}
  }
});

