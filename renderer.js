// ═══════════════════════════════════════════
// VORTEX BROWSER — renderer.js
// Gerenciamento completo de abas, navegação, menus, zoom, busca, favoritos e histórico
// ═══════════════════════════════════════════

// ── Estado global ─────────────────────────
let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let currentZoom = 100;
let searchEngine = 'duckduckgo';
let browsingHistory = JSON.parse(localStorage.getItem('vortex-history') || '[]');
let bookmarks = JSON.parse(localStorage.getItem('vortex-bookmarks') || '[]');
let recentlyClosedTabs = []; // Pilha para restaurar abas fechadas (Ctrl+Shift+T)
const TAB_SLEEP_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos de inatividade para hibernar aba e liberar memória

// ── Engines de busca ──────────────────────
const SEARCH_ENGINES = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q=',
  startpage: 'https://www.startpage.com/search?q=',
  ecosia: 'https://www.ecosia.org/search?q=',
  youtube: 'https://www.youtube.com/results?search_query='
};

// ── Elementos DOM principais ──────────────
const tabsListEl = document.getElementById('tabsList');
const viewsContainerEl = document.getElementById('viewsContainer');
const homeViewEl = document.getElementById('homeView');
const addressInputEl = document.getElementById('addressInput');
const trackerCountBadgeEl = document.getElementById('trackerCountBadge');
const modalTrackerCountEl = document.getElementById('modalTrackerCount');
const btnSecurityStatusEl = document.getElementById('btnSecurityStatus');
const securityIconEl = document.getElementById('securityIcon');
const securityTextEl = document.getElementById('securityText');
const securityModalEl = document.getElementById('securityModal');
const securityModalDescEl = document.getElementById('securityModalDesc');
const securityModalBadgeEl = document.getElementById('securityModalBadge');
const linkPreviewTooltipEl = document.getElementById('linkPreviewTooltip');
const bookmarksBarEl = document.getElementById('bookmarksBar');
const findBarEl = document.getElementById('findBar');
const findInputEl = document.getElementById('findInput');
const downloadToastContainer = document.getElementById('downloadToastContainer');
const btnCookieBadgeEl = document.getElementById('btnCookieBadge');
const cookieCountBadgeEl = document.getElementById('cookieCountBadge');
const modalSiteCookieCountBadgeEl = document.getElementById('modalSiteCookieCountBadge');
const modalSiteCookieDescEl = document.getElementById('modalSiteCookieDesc');
const securityModalDomainEl = document.getElementById('securityModalDomain');
const securityModalMainIconEl = document.getElementById('securityModalMainIcon');
const siteCookiesDetailListEl = document.getElementById('siteCookiesDetailList');
const btnAcceptCookiesCurrentSite = document.getElementById('btnAcceptCookiesCurrentSite');
const btnClearSiteCookiesModal = document.getElementById('btnClearSiteCookiesModal');
const btnToggleSiteCookiesDetail = document.getElementById('btnToggleSiteCookiesDetail');
const linkOpenCookieSettings = document.getElementById('linkOpenCookieSettings');
let currentActiveDomain = '';

// ── Carregar configurações salvas ─────────
function loadSavedSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('vortex-settings') || '{}');
    searchEngine = s.searchEngine || 'duckduckgo';

    // Placeholder do buscador na tela inicial
    const homeInput = document.getElementById('homeSearchInput');
    if (homeInput) {
      const names = {
        duckduckgo: 'DuckDuckGo sem rastreamento',
        google: 'Google',
        bing: 'Bing',
        brave: 'Brave Search',
        startpage: 'Startpage (privacidade)',
        ecosia: 'Ecosia'
      };
      homeInput.placeholder = `Buscar com ${names[searchEngine] || 'DuckDuckGo'}...`;
    }

    // Ativa o chip de busca correspondente
    document.querySelectorAll('.home-engine-chip').forEach(c => {
      if (c.getAttribute('data-engine') === searchEngine) {
        c.classList.add('active');
      } else {
        c.classList.remove('active');
      }
    });

    // Tema
    if (s.theme === 'light') document.body.classList.add('theme-light');
    else document.body.classList.remove('theme-light');
    if (s.highContrast) document.body.classList.add('high-contrast');
    else document.body.classList.remove('high-contrast');

    // Tamanho da fonte e animações
    document.body.classList.remove('font-small', 'font-medium', 'font-large', 'font-xlarge');
    if (s.fontSize) document.body.classList.add(`font-${s.fontSize}`);
    if (s.animations === false) document.body.classList.add('no-animations');
    else document.body.classList.remove('no-animations');

    // AdBlock toggle no main process
    if (s.adblock !== undefined && window.vortexAPI?.setAdblockEnabled) {
      window.vortexAPI.setAdblockEnabled(s.adblock !== false);
    }

    // Barra de favoritos
    const bar = document.getElementById('bookmarksBar');
    if (bar) bar.style.display = s.showBookmarksBar ? 'flex' : 'none';

    // Botão Home
    const homeBtn = document.getElementById('btnHome');
    if (homeBtn) homeBtn.style.display = s.showHomeBtn === false ? 'none' : '';

    // Zoom padrão
    if (s.defaultZoom) {
      currentZoom = parseInt(s.defaultZoom, 10) || 100;
      const zv = document.getElementById('dm-zoom-value');
      if (zv) zv.innerText = currentZoom + '%';
    }
  } catch (e) {}
}
loadSavedSettings();

// ── Controles da janela ───────────────────
const btnMaximizeEl = document.getElementById('btnMaximize');
function setMaximizeState(isMaximized) {
  if (!btnMaximizeEl) return;
  if (isMaximized) {
    btnMaximizeEl.textContent = '🗗';
    btnMaximizeEl.title = 'Restaurar';
  } else {
    btnMaximizeEl.textContent = '🗖';
    btnMaximizeEl.title = 'Maximizar';
  }
}

document.getElementById('btnMinimize').addEventListener('click', () => window.vortexAPI.minimize());
btnMaximizeEl.addEventListener('click', () => window.vortexAPI.maximize());
document.getElementById('btnClose').addEventListener('click', () => window.vortexAPI.close());

if (window.vortexAPI.onWindowStateChange) {
  window.vortexAPI.onWindowStateChange((isMaximized) => {
    setMaximizeState(isMaximized);
  });
}
if (window.vortexAPI.isMaximized) {
  window.vortexAPI.isMaximized().then(setMaximizeState).catch(() => {});
}

// Duplo clique na barra superior para alternar entre maximizado e restaurado (idêntico ao Google Chrome)
const titlebarEl = document.querySelector('.titlebar');
if (titlebarEl) {
  titlebarEl.addEventListener('dblclick', (e) => {
    if (!e.target.closest('button') && !e.target.closest('.tab') && !e.target.closest('.window-controls')) {
      window.vortexAPI.maximize();
    }
  });
}

// ── Modal de Privacidade ──────────────────
const privacyModal = document.getElementById('privacyModal');
document.getElementById('btnShieldModal').addEventListener('click', () => { privacyModal.style.display = 'flex'; });
document.getElementById('btnCloseModal').addEventListener('click', () => { privacyModal.style.display = 'none'; });
document.getElementById('btnClearData').addEventListener('click', () => { window.vortexAPI.clearBrowsingData(); });
window.vortexAPI.onDataCleared(() => {
  showToastNotification('✅', 'Dados limpos', 'Cache, cookies e armazenamento removidos.');
  privacyModal.style.display = 'none';
});

// ── Modal de Segurança & Cookies ────────────────────
btnSecurityStatusEl.addEventListener('click', () => { 
  securityModalEl.style.display = 'flex'; 
});
document.getElementById('btnCloseSecurityModal').addEventListener('click', () => { 
  securityModalEl.style.display = 'none'; 
});

// ── Popup de Permissão estilo Google Chrome ─────────────
const permissionPromptPopup = document.getElementById('permissionPromptPopup');
const permissionPromptIcon = document.getElementById('permissionPromptIcon');
const permissionPromptDomain = document.getElementById('permissionPromptDomain');
const permissionPromptDesc = document.getElementById('permissionPromptDesc');
const btnPermissionBlock = document.getElementById('btnPermissionBlock');
const btnPermissionAllow = document.getElementById('btnPermissionAllow');
let currentPermissionRequestId = null;

const PERMISSION_TRANSLATIONS = {
  geolocation: { icon: '📍', text: 'deseja saber a sua localização' },
  notifications: { icon: '🔔', text: 'deseja exibir notificações' },
  media: { icon: '🎥', text: 'deseja usar a sua câmera e microfone' },
  midi: { icon: '🎹', text: 'deseja acessar dispositivos MIDI' },
  pointerLock: { icon: '🖱️', text: 'deseja bloquear o ponteiro do mouse' },
  'clipboard-read': { icon: '📋', text: 'deseja ver texto e imagens da área de transferência' },
  'clipboard-sanitized-write': { icon: '📋', text: 'deseja copiar dados para a área de transferência' }
};

let currentPermissionData = null;

if (window.vortexAPI && window.vortexAPI.onPermissionRequested) {
  window.vortexAPI.onPermissionRequested((data) => {
    if (!data) return;
    currentPermissionRequestId = data.requestId;
    currentPermissionData = data;
    let domainStr = data.origin || '';
    try {
      if (domainStr) domainStr = new URL(domainStr).hostname;
    } catch(e) {}

    const permConfig = PERMISSION_TRANSLATIONS[data.permission] || { icon: '🔒', text: `solicitou autorização para ${data.permission}` };

    if (permissionPromptDomain) permissionPromptDomain.innerText = domainStr || 'Este site';
    if (permissionPromptDesc) permissionPromptDesc.innerText = permConfig.text;
    if (permissionPromptIcon) permissionPromptIcon.innerText = permConfig.icon;
    if (permissionPromptPopup) permissionPromptPopup.classList.add('open');
  });
}

function respondCurrentPermission(allow) {
  if (currentPermissionRequestId !== null && window.vortexAPI?.respondPermission) {
    const origin = currentPermissionData?.origin || '';
    const permission = currentPermissionData?.permission || '';
    window.vortexAPI.respondPermission(currentPermissionRequestId, allow, origin, permission);
    currentPermissionRequestId = null;
    currentPermissionData = null;
  }
  if (permissionPromptPopup) permissionPromptPopup.classList.remove('open');
}

btnPermissionBlock?.addEventListener('click', () => respondCurrentPermission(false));
btnPermissionAllow?.addEventListener('click', () => respondCurrentPermission(true));

// ── Modal de Limpar Histórico e Cookies estilo Google Chrome ────────
const chromeClearDataModal = document.getElementById('chromeClearDataModal');
const btnCloseChromeClearModal = document.getElementById('btnCloseChromeClearModal');
const btnCancelChromeClear = document.getElementById('btnCancelChromeClear');
const btnConfirmChromeClear = document.getElementById('btnConfirmChromeClear');
let selectedClearTimeframe = '24h';

document.querySelectorAll('.chrome-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chrome-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    selectedClearTimeframe = chip.getAttribute('data-time') || '24h';
  });
});

function openChromeClearModal() {
  if (!chromeClearDataModal) return;
  // Atualiza perfil no modal
  try {
    const profile = JSON.parse(localStorage.getItem('vortex-profile-cache') || '{}');
    const uName = document.getElementById('clearModalUserName');
    const uEmail = document.getElementById('clearModalUserEmail');
    const uAvatar = document.getElementById('clearModalAvatar');
    if (uName) uName.innerText = profile.name || 'Usuário Vortex';
    if (uEmail) uEmail.innerText = profile.email || 'Conta local';
    if (uAvatar && profile.photoUrl) {
      uAvatar.innerHTML = `<img src="${profile.photoUrl}" alt="Avatar">`;
    }
  } catch(e) {}

  // Atualiza contadores descritivos
  const histDesc = document.getElementById('clearHistoryCountDesc');
  if (histDesc) histDesc.innerText = `${browsingHistory.length} iten${browsingHistory.length !== 1 ? 's' : ''} no histórico`;

  chromeClearDataModal.style.display = 'flex';
}

function closeChromeClearModal() {
  if (chromeClearDataModal) chromeClearDataModal.style.display = 'none';
}

btnCloseChromeClearModal?.addEventListener('click', closeChromeClearModal);
btnCancelChromeClear?.addEventListener('click', closeChromeClearModal);

btnConfirmChromeClear?.addEventListener('click', async () => {
  const clearHist = !!document.getElementById('chkClearHistory')?.checked;
  const clearCook = !!document.getElementById('chkClearCookies')?.checked;
  const clearCach = !!document.getElementById('chkClearCache')?.checked;
  const clearDown = !!document.getElementById('chkClearDownloads')?.checked;
  const clearForm = !!document.getElementById('chkClearFormData')?.checked;

  const now = Date.now();
  let timeLimitMs = 0;
  if (selectedClearTimeframe === '15m') timeLimitMs = 15 * 60 * 1000;
  else if (selectedClearTimeframe === '1h') timeLimitMs = 60 * 60 * 1000;
  else if (selectedClearTimeframe === '24h') timeLimitMs = 24 * 60 * 60 * 1000;
  else if (selectedClearTimeframe === '7d') timeLimitMs = 7 * 24 * 60 * 60 * 1000;
  else timeLimitMs = Infinity;

  // 1. Limpa histórico filtrado por período
  if (clearHist) {
    if (timeLimitMs === Infinity) {
      browsingHistory = [];
    } else {
      browsingHistory = browsingHistory.filter(item => {
        const itemTime = item.time ? new Date(item.time).getTime() : 0;
        return (now - itemTime) > timeLimitMs;
      });
    }
    localStorage.setItem('vortex-history', JSON.stringify(browsingHistory));
    const histTab = tabs.find(t => t.isHistory);
    if (histTab && histTab.webview) renderHistoryPage(histTab.webview);
  }

  // 2. Limpa cookies se selecionado
  if (clearCook) {
    if (window.vortexAPI?.clearAllCookies) {
      await window.vortexAPI.clearAllCookies();
    }
  }

  // 3. Limpa cache e dados de sessão
  if (clearCach || clearForm) {
    if (window.vortexAPI?.clearBrowsingData) {
      window.vortexAPI.clearBrowsingData();
    }
  }

  // 4. Limpa histórico de downloads
  if (clearDown) {
    localStorage.removeItem('vortex-downloads');
    notifySettingsDownloadsUpdated([]);
  }

  closeChromeClearModal();
  showToastNotification('🗑️', 'Dados excluídos', 'Os dados de navegação selecionados foram removidos com sucesso.');
});
if (btnToggleSiteCookiesDetail) {
  btnToggleSiteCookiesDetail.addEventListener('click', () => {
    if (siteCookiesDetailListEl) siteCookiesDetailListEl.classList.toggle('hidden');
  });
}

// Botão Aceitar Cookies na página atual
if (btnAcceptCookiesCurrentSite) {
  btnAcceptCookiesCurrentSite.addEventListener('click', () => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && activeTab.webview && activeTab.webview.executeJavaScript) {
      activeTab.webview.executeJavaScript(`
        (function() {
          const acceptKeywords = ['aceitar todos', 'aceitar cookies', 'aceitar tudo', 'concordar e fechar', 'concordo', 'permitir todos', 'permitir cookies', 'aceito', 'accept all', 'accept cookies', 'agree', 'allow all', 'i agree'];
          const btns = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
          for (const b of btns) {
            const t = (b.innerText || b.value || b.getAttribute('aria-label') || '').toLowerCase().trim();
            if (acceptKeywords.some(k => t === k || t.includes(k))) {
              b.click();
              return true;
            }
          }
          return false;
        })();
      `).then(clicked => {
        showToastNotification('🍪', 'Cookies Aceitos', 'Consentimento de cookies confirmado nesta página.');
        if (activeTab.url) setTimeout(() => updateSecurityBadge(activeTab.url), 1000);
      }).catch(() => {});
    }
  });
}

// Botão Limpar Cookies deste site
if (btnClearSiteCookiesModal) {
  btnClearSiteCookiesModal.addEventListener('click', async () => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && activeTab.url) {
      try {
        const domain = new URL(activeTab.url).hostname;
        if (window.vortexAPI && window.vortexAPI.clearCookiesDomain) {
          await window.vortexAPI.clearCookiesDomain(domain);
          showToastNotification('🗑️', 'Cookies Limpos', `Cookies de ${domain} foram removidos.`);
          updateSecurityBadge(activeTab.url);
        }
      } catch (e) {}
    }
  });
}

// Link para abrir configurações na seção de cookies
if (linkOpenCookieSettings) {
  linkOpenCookieSettings.addEventListener('click', (e) => {
    e.preventDefault();
    securityModalEl.style.display = 'none';
    openSettings('cookies');
  });
}

// Exclusão individual de cookie no modal
window.deleteCurrentSiteCookie = async function(cookieName, domain) {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab || !activeTab.url) return;
  try {
    const urlObj = new URL(activeTab.url);
    const cookieUrl = `${urlObj.protocol}//${domain || urlObj.hostname}/`;
    if (window.vortexAPI && window.vortexAPI.deleteCookie) {
      await window.vortexAPI.deleteCookie({ url: cookieUrl, name: cookieName });
      updateSecurityBadge(activeTab.url);
    }
  } catch (e) {}
};

async function updateSecurityBadge(url) {
  btnSecurityStatusEl.className = 'security-badge';
  if (!url || url === '' || url.startsWith('about:') || url.startsWith('vortex://')) {
    currentActiveDomain = '';
    securityTextEl.innerText = 'Início';
    securityIconEl.innerHTML = `<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>`;
    if (securityModalDescEl) securityModalDescEl.innerText = 'Página interna protegida do Vortex Browser.';
    if (securityModalBadgeEl) {
      securityModalBadgeEl.innerText = 'PROTEGIDO';
      securityModalBadgeEl.style.color = 'var(--accent-cyan)';
    }
    if (securityModalDomainEl) securityModalDomainEl.innerText = 'Vortex Interno';
    if (securityModalMainIconEl) securityModalMainIconEl.innerText = '🌀';
    if (cookieCountBadgeEl) cookieCountBadgeEl.innerText = '0';
    if (modalSiteCookieCountBadgeEl) modalSiteCookieCountBadgeEl.innerText = '0 cookies';
    if (siteCookiesDetailListEl) siteCookiesDetailListEl.innerHTML = '<div style="text-align:center;padding:8px;color:var(--text-muted);font-size:11px;">Página interna não utiliza cookies de terceiros.</div>';
    return;
  }

  let isHttps = url.startsWith('https://');
  let isHttp = url.startsWith('http://') || url.startsWith('ftp://');

  try {
    const urlObj = new URL(url);
    currentActiveDomain = urlObj.hostname;
    if (securityModalDomainEl) securityModalDomainEl.innerText = currentActiveDomain;
  } catch (e) {
    currentActiveDomain = '';
  }

  if (isHttps) {
    btnSecurityStatusEl.classList.add('secure');
    securityTextEl.innerText = 'Seguro (SSL)';
    securityIconEl.innerHTML = `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>`;
    if (securityModalDescEl) securityModalDescEl.innerText = 'A conexão é protegida por TLS 1.3 com criptografia forte AES-256 bits. Informações transmitidas são privadas e seguras.';
    if (securityModalBadgeEl) {
      securityModalBadgeEl.innerText = 'SEGURO (SSL)';
      securityModalBadgeEl.style.color = 'var(--accent-emerald)';
    }
    if (securityModalMainIconEl) securityModalMainIconEl.innerText = '🔒';
  } else if (isHttp) {
    btnSecurityStatusEl.classList.add('insecure');
    securityTextEl.innerText = 'Não seguro';
    securityIconEl.innerHTML = `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>`;
    if (securityModalDescEl) securityModalDescEl.innerText = 'A conexão não é criptografada. Hackers na mesma rede podem interceptar dados sensíveis. Evite inserir senhas.';
    if (securityModalBadgeEl) {
      securityModalBadgeEl.innerText = 'NÃO CRIPTOGRAFADO';
      securityModalBadgeEl.style.color = '#fbbf24';
    }
    if (securityModalMainIconEl) securityModalMainIconEl.innerText = '⚠️';
  } else {
    securityTextEl.innerText = 'Vortex';
    securityIconEl.innerHTML = `<circle cx="12" cy="12" r="10"></circle>`;
    if (securityModalDescEl) securityModalDescEl.innerText = 'Protocolo seguro customizado do Vortex.';
    if (securityModalBadgeEl) {
      securityModalBadgeEl.innerText = 'INTERNO';
      securityModalBadgeEl.style.color = 'var(--accent-cyan)';
    }
    if (securityModalMainIconEl) securityModalMainIconEl.innerText = '⚡';
  }

  // Consulta detalhes reais dos cookies armazenados para este site
  if (window.vortexAPI && window.vortexAPI.getSiteSecurityInfo) {
    try {
      const info = await window.vortexAPI.getSiteSecurityInfo(url);
      if (info && info.success) {
        const count = info.cookieCount || 0;
        if (cookieCountBadgeEl) cookieCountBadgeEl.innerText = count;
        if (modalSiteCookieCountBadgeEl) modalSiteCookieCountBadgeEl.innerText = `${count} cookie${count !== 1 ? 's' : ''}`;
        if (modalSiteCookieDescEl) {
          modalSiteCookieDescEl.innerText = count > 0 
            ? `${count} cookie${count !== 1 ? 's' : ''} ativo${count !== 1 ? 's' : ''} salvos para ${info.domain}.`
            : `Nenhum cookie ativo salvo para ${info.domain}.`;
        }

        if (siteCookiesDetailListEl) {
          if (info.cookies && info.cookies.length > 0) {
            siteCookiesDetailListEl.innerHTML = info.cookies.map(c => `
              <div class="site-cookie-row">
                <div class="site-cookie-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
                <div class="site-cookie-meta">${c.secure ? '🔒' : ''} ${escapeHtml(c.expires)}</div>
                <button type="button" class="btn-site-cookie-del" onclick="deleteCurrentSiteCookie('${escapeHtml(c.name)}', '${info.domain}')" title="Excluir este cookie">✕</button>
              </div>
            `).join('');
          } else {
            siteCookiesDetailListEl.innerHTML = '<div style="text-align:center;padding:8px;color:var(--text-muted);font-size:11px;">Nenhum cookie salvo para este site.</div>';
          }
        }
      }
    } catch(e) {}
  }
}

// ── AdBlock / Tracker count ───────────────
window.vortexAPI.onTrackerBlocked((data) => {
  trackerCountBadgeEl.innerText = data.count;
  modalTrackerCountEl.innerText = data.count;
});

// ── Toast de notificação genérico ─────────
function showToastNotification(icon, title, desc, isError = false) {
  const toast = document.createElement('div');
  toast.className = 'download-toast';
  if (isError) toast.style.borderColor = '#ef4444';
  toast.innerHTML = `
    <span style="font-size:20px">${icon}</span>
    <div>
      <div style="font-weight:600">${title}</div>
      <div class="download-toast-progress">${desc}</div>
    </div>
  `;
  downloadToastContainer.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// ── Detector de Links de Download Direto ──────────
function isDownloadableUrl(url) {
  if (!url) return false;
  try {
    const clean = url.split('?')[0].split('#')[0].toLowerCase();
    const exts = ['.exe', '.msi', '.zip', '.rar', '.7z', '.tar', '.gz', '.dts', '.dbf', '.dbc', '.cnv', '.iso', '.bin', '.apk', '.dmg', '.rpm', '.deb'];
    return exts.some(ext => clean.endsWith(ext));
  } catch (e) {
    return false;
  }
}

// Interceptar abertura de novas abas via Main Process
let lastOpenedTabUrl = '';
let lastOpenedTabTime = 0;

window.vortexAPI.onOpenInNewTab((url) => {
  if (url && typeof url === 'string') {
    const cleanUrl = url.trim();
    if (!cleanUrl || cleanUrl === 'about:blank' || cleanUrl === 'about:blank#') return;
    
    // Evita duplicação em cascata de abertura da mesma URL dentro de 1 segundo
    const now = Date.now();
    if (cleanUrl === lastOpenedTabUrl && (now - lastOpenedTabTime) < 1000) {
      return;
    }
    lastOpenedTabUrl = cleanUrl;
    lastOpenedTabTime = now;

    if (cleanUrl.startsWith('ftp://')) {
      window.vortexAPI.downloadFtp(cleanUrl);
      return;
    }
    if (isDownloadableUrl(cleanUrl)) {
      window.vortexAPI.downloadUrl(cleanUrl);
      return;
    }
    createTab(cleanUrl);
  }
});

// ══════════════════════════════════════════
// MODO ANÔNIMO / PRIVADO
// ══════════════════════════════════════════

// Conjuntos de IDs de tabs anônimas (para bloquear histórico e distinguir UI)
const incognitoTabIds = new Set();

// Modal de boas-vindas ao modo anônimo
const incognitoModal = document.getElementById('incognitoModal');
const incognitoModalClose = document.getElementById('incognitoModalClose');
let incognitoModalShownOnce = false;

function showIncognitoModal() {
  if (incognitoModal) {
    incognitoModal.classList.add('open');
  }
}

if (incognitoModalClose) {
  incognitoModalClose.addEventListener('click', () => {
    incognitoModal.classList.remove('open');
  });
}

// Criar aba anônima usando a partição isolada vinda do main process
function openIncognitoTab(initialUrl) {
  // Pedir ao main process uma partição anônima nova
  window.vortexAPI.openPrivateTab(initialUrl || null);
}

// Receber resposta do main process com a partição isolada
window.vortexAPI.onPrivateTabReady((data) => {
  const { partition, url } = data;
  createIncognitoTabWithPartition(partition, url);
});
// ══════════════════════════════════════════
// HELPERS DE FAVICON DE ABAS (Estilo Google Chrome)
// ══════════════════════════════════════════
function applyFaviconToTab(faviconEl, faviconUrl, currentUrl = '', isIncognito = false) {
  if (!faviconEl) return;
  const img = document.createElement('img');
  img.src = faviconUrl;
  img.width = 16;
  img.height = 16;
  img.style.cssText = 'width:16px;height:16px;object-fit:contain;border-radius:2px;flex-shrink:0;display:block;';
  
  img.onerror = () => {
    // Se a URL direta de favicon falhar, tenta via Google Favicons API se for um site web válido
    if (currentUrl && !currentUrl.startsWith('about:') && !currentUrl.startsWith('vortex://') && !faviconUrl.includes('google.com/s2/favicons')) {
      try {
        const domain = new URL(currentUrl).hostname;
        if (domain) {
          img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
          return;
        }
      } catch(e) {}
    }
    // Fallback padrão se tudo falhar
    if (isIncognito) {
      faviconEl.className = 'tab-favicon tab-favicon-incognito';
      faviconEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    } else {
      faviconEl.className = 'tab-favicon';
      faviconEl.innerHTML = `<svg class="tab-favicon-default" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    }
  };

  img.onload = () => {
    faviconEl.className = 'tab-favicon';
    faviconEl.innerHTML = '';
    faviconEl.appendChild(img);
  };
}

function setTabFaviconFromUrl(faviconEl, url, isIncognito = false) {
  if (!faviconEl || !url || url.startsWith('about:') || url.startsWith('vortex://')) return;
  try {
    const domain = new URL(url).hostname;
    if (domain) {
      const gFavicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
      applyFaviconToTab(faviconEl, gFavicon, url, isIncognito);
    }
  } catch(e) {}
}

function createIncognitoTabWithPartition(partition, initialUrl) {
  tabCounter++;
  const id = `tab-${tabCounter}`;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab incognito';
  tabEl.id = `tab-btn-${id}`;
  tabEl.innerHTML = `<span class="tab-favicon tab-favicon-incognito"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="1" y1="1" x2="23" y2="23" stroke-width="2"/></svg></span><span class="tab-title">Anônimo</span><span class="tab-close" data-id="${id}">✕</span>`;

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) {
      closeTab(id);
    } else {
      switchTab(id);
    }
  });

  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showTabContextMenu(e.clientX, e.clientY, id);
  });

  tabsListEl.appendChild(tabEl);

  // Webview com partição anônima isolada
  const wv = document.createElement('webview');
  wv.id = `wv-${id}`;
  wv.style.display = 'none';
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('plugins', '');
  wv.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');
  wv.setAttribute('partition', partition); // Isolamento real de sessão

  if (initialUrl) {
    wv.src = initialUrl;
  } else {
    wv.src = 'about:blank';
  }

  // Listeners de navegação (idênticos ao createWebview mas sem salvar histórico)
  wv.addEventListener('did-start-loading', () => {
    const t = tabs.find(item => item.id === id);
    if (t) {
      const titleEl = t.tabEl.querySelector('.tab-title');
      if (titleEl && (!t.title || t.title === 'Carregando...' || t.title === 'Anônimo')) {
        if (t.url && !t.url.startsWith('about:')) {
          try {
            titleEl.innerText = new URL(t.url).hostname;
          } catch(e) {
            titleEl.innerText = t.url;
          }
        }
      }
      const faviconEl = t.tabEl.querySelector('.tab-favicon');
      if (faviconEl) faviconEl.innerHTML = '<span class="tab-favicon-spinner"></span>';
    }
    if (activeTabId === id) updateNavButtons();
  });
  wv.addEventListener('did-stop-loading', () => {
    const t = tabs.find(item => item.id === id);
    if (t) {
      const titleEl = t.tabEl.querySelector('.tab-title');
      if (titleEl && (!titleEl.innerText || titleEl.innerText === 'Carregando...')) {
        titleEl.innerText = t.title || (t.url ? new URL(t.url).hostname : 'Anônimo');
      }
      const faviconEl = t.tabEl.querySelector('.tab-favicon');
      if (faviconEl && faviconEl.querySelector('.tab-favicon-spinner')) {
        // Se a página parou de carregar e ainda estava com o spinner, tenta carregar o favicon do domínio
        if (t.url && !t.url.startsWith('about:') && !t.url.startsWith('vortex://')) {
          setTabFaviconFromUrl(faviconEl, t.url, true);
        } else {
          faviconEl.className = 'tab-favicon tab-favicon-incognito';
          faviconEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="1" y1="1" x2="23" y2="23" stroke-width="2"/></svg>`;
        }
      }
    }
    if (activeTabId === id) updateNavButtons();
  });
  // Favicon real do site na aba anônima
  wv.addEventListener('page-favicon-updated', (e) => {
    if (!e.favicons || !e.favicons.length) return;
    const t = tabs.find(item => item.id === id);
    if (!t) return;
    const faviconEl = t.tabEl.querySelector('.tab-favicon');
    if (!faviconEl) return;
    applyFaviconToTab(faviconEl, e.favicons[0], t.url, true);
  });
  wv.addEventListener('page-title-updated', (e) => {
    const t = tabs.find(item => item.id === id);
    if (t) {
      t.title = e.title;
      t.tabEl.querySelector('.tab-title').innerText = e.title;
      // NÃO salva histórico — modo anônimo
    }
  });
  wv.addEventListener('did-navigate', (e) => {
    const t = tabs.find(item => item.id === id);
    if (t) {
      t.url = e.url;
      if (activeTabId === id) {
        addressInputEl.value = e.url;
        updateSecurityBadge(e.url);
        updateNavButtons();
        updateStarState(e.url);
      }
      // NÃO salva histórico — modo anônimo
    }
    closeFindBar();
  });
  wv.addEventListener('did-navigate-in-page', (e) => {
    const t = tabs.find(item => item.id === id);
    if (t && activeTabId === id) {
      t.url = e.url;
      addressInputEl.value = e.url;
      updateSecurityBadge(e.url);
      updateNavButtons();
      updateStarState(e.url);
    }
  });
  wv.addEventListener('update-target-url', (e) => {
    if (activeTabId === id) {
      if (e.url) {
        linkPreviewTooltipEl.innerText = e.url;
        linkPreviewTooltipEl.style.display = 'block';
      } else {
        linkPreviewTooltipEl.style.display = 'none';
      }
    }
  });
  wv.addEventListener('will-navigate', (e) => {
    if (e.url.startsWith('ftp://')) { e.preventDefault(); window.vortexAPI.downloadFtp(e.url); return; }
    if (isDownloadableUrl(e.url)) { e.preventDefault(); window.vortexAPI.downloadUrl(e.url); return; }
  });
  wv.addEventListener('new-window', (e) => {
    e.preventDefault();
    if (e.url) {
      if (e.url.startsWith('ftp://')) { window.vortexAPI.downloadFtp(e.url); return; }
      if (isDownloadableUrl(e.url)) { window.vortexAPI.downloadUrl(e.url); return; }
      // Novos popups em abas anônimas abrem na mesma partição
      createIncognitoTabWithPartition(partition, e.url);
    }
  });
  wv.addEventListener('dom-ready', () => {
    wv.executeJavaScript(`
      if (!window.__vortex_interceptor) {
        window.__vortex_interceptor = true;
        document.addEventListener('click', (e) => {
          const a = e.target.closest('a');
          if (a && a.href && a.href.startsWith('ftp://')) {
            e.preventDefault(); e.stopPropagation();
            console.log('__VORTEX_FTP__:' + a.href);
          }
        }, true);
      }
    `).catch(() => {});
  });
  wv.addEventListener('console-message', (e) => {
    if (e.message && e.message.startsWith('__VORTEX_FTP__:')) {
      window.vortexAPI.downloadFtp(e.message.replace('__VORTEX_FTP__:', ''));
    }
  });
  wv.addEventListener('context-menu', (e) => {
    e.preventDefault();
    lastContextMenuTarget = {
      x: e.params?.x || 0,
      y: e.params?.y || 0
    };
    if (typeof showContextMenuAt === 'function') {
      let clickX = null;
      let clickY = null;
      if (window.vortexAPI && typeof window.vortexAPI.getCursorPoint === 'function') {
        try {
          const pt = window.vortexAPI.getCursorPoint();
          if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
            clickX = pt.x;
            clickY = pt.y;
          }
        } catch (err) {}
      }
      if (clickX === null || clickY === null) {
        const rect = wv.getBoundingClientRect();
        clickX = e.params ? (rect.left + e.params.x) : (window.innerWidth / 2);
        clickY = e.params ? (rect.top + e.params.y) : (window.innerHeight / 2);
      }
      showContextMenuAt(clickX, clickY);
    }
  });

  viewsContainerEl.appendChild(wv);

  const tabData = { id, tabEl, webview: wv, url: initialUrl || '', title: 'Anônimo', isIncognito: true };
  tabs.push(tabData);
  incognitoTabIds.add(id);
  switchTab(id);

  if (initialUrl) {
    homeViewEl.style.display = 'none';
    wv.style.display = 'flex';
    addressInputEl.value = initialUrl;
    updateSecurityBadge(initialUrl);
  }

  // Mostrar modal de boas-vindas somente na primeira aba anônima da sessão
  if (!incognitoModalShownOnce) {
    incognitoModalShownOnce = true;
    setTimeout(() => showIncognitoModal(), 150);
  }
}

// Atualizar indicador visual quando a aba ativa é anônima
function updateIncognitoUI() {
  const activeTab = getActiveTab();
  if (activeTab && activeTab.isIncognito) {
    document.body.classList.add('incognito-active');
    if (homeViewEl) homeViewEl.classList.add('incognito-home');
  } else {
    document.body.classList.remove('incognito-active');
    if (homeViewEl) homeViewEl.classList.remove('incognito-home');
  }
}

// ── Gerenciador de Downloads Persistente (Estilo Google Chrome) ──────────────
function getStoredDownloads() {
  try {
    return JSON.parse(localStorage.getItem('vortex-downloads') || '[]');
  } catch(e) {
    return [];
  }
}

function saveStoredDownloads(list) {
  try {
    localStorage.setItem('vortex-downloads', JSON.stringify(list.slice(0, 100))); // guarda até 100 itens
  } catch(e) {}
}

function notifySettingsDownloadsUpdated(downloadsList) {
  const settingsTab = tabs.find(t => t.isSettings && t.webview);
  if (settingsTab && settingsTab.webview && settingsTab.webview.contentWindow) {
    try {
      settingsTab.webview.contentWindow.postMessage({
        type: 'downloads-list-updated',
        downloads: downloadsList || getStoredDownloads()
      }, '*');
    } catch(e) {}
  }
}

window.vortexAPI.onDownloadStarted((data) => {
  const toast = document.createElement('div');
  toast.className = 'download-toast';
  toast.id = `download-${data.fileName.replace(/[^a-zA-Z0-9]/g, '_')}`;
  toast.innerHTML = `
    <span style="font-size:20px">⬇️</span>
    <div style="flex:1">
      <div style="font-weight:600">Baixando: ${data.fileName}</div>
      <div class="download-toast-progress">Download iniciado...</div>
    </div>
  `;
  downloadToastContainer.appendChild(toast);

  // Registrar nos downloads ativos e persistidos
  const list = getStoredDownloads();
  const existingIdx = list.findIndex(d => d.fileName === data.fileName && d.state === 'progressing');
  const item = {
    id: 'dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    fileName: data.fileName,
    totalBytes: data.totalBytes || 0,
    receivedBytes: 0,
    state: 'progressing',
    startTime: Date.now(),
    savePath: ''
  };
  if (existingIdx >= 0) list[existingIdx] = item;
  else list.unshift(item);
  saveStoredDownloads(list);
  notifySettingsDownloadsUpdated(list);
});

window.vortexAPI.onDownloadProgress((data) => {
  const toastId = `download-${data.fileName.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const toast = document.getElementById(toastId);
  const pct = data.totalBytes > 0 ? Math.round((data.receivedBytes / data.totalBytes) * 100) : 0;
  if (toast && data.totalBytes > 0) {
    const progressEl = toast.querySelector('.download-toast-progress');
    if (progressEl) progressEl.innerText = `${pct}% concluído`;
  }

  // Atualizar progresso no storage e na tela de downloads
  const list = getStoredDownloads();
  const item = list.find(d => d.fileName === data.fileName && d.state === 'progressing');
  if (item) {
    item.receivedBytes = data.receivedBytes;
    item.totalBytes = data.totalBytes || item.totalBytes;
    item.percent = pct;
    saveStoredDownloads(list);
    notifySettingsDownloadsUpdated(list);
  }
});

window.vortexAPI.onDownloadCompleted((data) => {
  const toastId = `download-${data.fileName.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const toast = document.getElementById(toastId);
  if (toast) {
    if (data.state === 'completed') {
      toast.style.borderColor = 'var(--accent-emerald)';
      toast.innerHTML = `
        <span style="font-size:20px">✅</span>
        <div style="flex:1">
          <div style="font-weight:600">Download concluído!</div>
          <div class="download-toast-progress">${data.fileName} salvo na pasta Downloads.</div>
          ${data.savePath ? `<button class="btn-open-folder" style="margin-top:6px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);color:var(--text-main,#fff);border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">📂 Abrir pasta</button>` : ''}
        </div>
      `;
      if (data.savePath) {
        toast.querySelector('.btn-open-folder')?.addEventListener('click', (e) => {
          e.stopPropagation();
          window.vortexAPI.showItemInFolder(data.savePath);
        });
      }
    } else {
      toast.style.borderColor = '#ef4444';
      toast.innerHTML = `
        <span style="font-size:20px">⚠️</span>
        <div style="flex:1">
          <div style="font-weight:600">Download ${data.state === 'interrupted' ? 'falhou' : data.state}</div>
          <div class="download-toast-progress">${data.fileName}</div>
        </div>
      `;
    }
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 6000);
  }

  // Atualizar estado concluído/interrompido no histórico de downloads
  const list = getStoredDownloads();
  const item = list.find(d => d.fileName === data.fileName && d.state === 'progressing');
  if (item) {
    item.state = data.state;
    item.savePath = data.savePath || '';
    item.completedTime = Date.now();
    if (data.state === 'completed') item.receivedBytes = item.totalBytes || item.receivedBytes;
  } else {
    list.unshift({
      id: 'dl_' + Date.now(),
      fileName: data.fileName,
      totalBytes: 0,
      receivedBytes: 0,
      state: data.state,
      savePath: data.savePath || '',
      completedTime: Date.now()
    });
  }
  saveStoredDownloads(list);
  notifySettingsDownloadsUpdated(list);
});

// ══════════════════════════════════════════
// HISTÓRICO DE NAVEGAÇÃO
// ══════════════════════════════════════════
function addToHistory(url, title) {
  const activeTab = getActiveTab();
  if (activeTab && activeTab.isIncognito) return;
  if (!url || url.startsWith('about:') || url.startsWith('vortex://') || url.startsWith('view-source:')) return;
  const entry = { url, title: title || url, time: Date.now() };
  browsingHistory.unshift(entry);
  if (browsingHistory.length > 500) browsingHistory = browsingHistory.slice(0, 500);
  localStorage.setItem('vortex-history', JSON.stringify(browsingHistory));
}

// ══════════════════════════════════════════
// FAVORITOS (BOOKMARKS)
// ══════════════════════════════════════════
function renderBookmarksBar() {
  const bar = bookmarksBarEl;
  if (!bar) return;
  // Mantém itens estáticos já existentes no HTML como padrão se não tiver favoritos salvos
  const items = bookmarks.length > 0 ? bookmarks : [
    { url: 'https://github.com', title: 'GitHub', icon: '🐙' },
    { url: 'https://duckduckgo.com', title: 'DuckDuckGo', icon: '🦆' },
    { url: 'https://news.ycombinator.com', title: 'Hacker News', icon: '⚡' },
    { url: 'https://developer.mozilla.org', title: 'MDN Web Docs', icon: '🌐' },
    { url: 'https://google.com', title: 'Google', icon: '🔍' }
  ];
  bar.innerHTML = '';
  items.forEach(b => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';

    let domain = '';
    if (b.url && !b.url.startsWith('about:') && !b.url.startsWith('vortex://')) {
      try {
        domain = new URL(b.url).hostname;
      } catch(e) {}
    }

    let favContent = b.icon || '🔖';
    if (domain) {
      const gFavicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
      favContent = `<img src="${gFavicon}" alt="" onerror="this.outerHTML='<span>${b.icon || '🔖'}</span>'">`;
    }

    item.innerHTML = `<span class="bookmark-fav">${favContent}</span><span>${b.title}</span>`;
    item.addEventListener('click', () => navigateTo(b.url));
    bar.appendChild(item);
  });

  // Botão para adicionar favorito atual
  const addBtn = document.createElement('div');
  addBtn.className = 'bookmark-item bookmark-add-btn';
  addBtn.title = 'Adicionar página atual aos favoritos';
  addBtn.innerHTML = `<span class="bookmark-fav">➕</span><span>Adicionar</span>`;
  addBtn.addEventListener('click', addCurrentPageToBookmarks);
  bar.appendChild(addBtn);
}

function addCurrentPageToBookmarks() {
  const cur = getActiveTab();
  if (!cur || !cur.url || cur.url.startsWith('vortex://') || !cur.webview) {
    showToastNotification('⚠️', 'Não foi possível adicionar', 'Navegue para uma página primeiro.', true);
    return;
  }
  const title = cur.title || cur.url;
  const url = cur.url;
  const exists = bookmarks.some(b => b.url === url);
  if (exists) {
    showToastNotification('ℹ️', 'Já nos favoritos', title);
    return;
  }
  bookmarks.push({ url, title, icon: '⭐' });
  localStorage.setItem('vortex-bookmarks', JSON.stringify(bookmarks));
  renderBookmarksBar();
  showToastNotification('⭐', 'Adicionado aos favoritos', title);
}

// ── Atualiza estado da estrela na barra de endereços ──
function updateStarState(url) {
  const starBtn = document.getElementById('btnBookmarkStar');
  if (!starBtn) return;
  const isBookmarked = bookmarks.some(b => b.url === url);
  if (isBookmarked) {
    starBtn.classList.add('bookmarked');
    starBtn.title = 'Página nos favoritos';
  } else {
    starBtn.classList.remove('bookmarked');
    starBtn.title = 'Adicionar aos favoritos (Ctrl+D)';
  }
}

renderBookmarksBar();

// ══════════════════════════════════════════
// GERENCIAMENTO DE ABAS
// ══════════════════════════════════════════
function createTab(initialUrl = null) {
  tabCounter++;
  const id = `tab-${tabCounter}`;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.id = `tab-btn-${id}`;
  tabEl.innerHTML = `<span class="tab-favicon"><svg class="tab-favicon-default" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span><span class="tab-title">Nova Aba</span><span class="tab-close" data-id="${id}">✕</span>`;

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) {
      closeTab(id);
    } else {
      switchTab(id);
    }
  });

  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showTabContextMenu(e.clientX, e.clientY, id);
  });

  tabsListEl.appendChild(tabEl);

  let webview = null;
  if (initialUrl) {
    let cleanUrl = initialUrl.trim();
    if (cleanUrl && !cleanUrl.includes('://') && !cleanUrl.startsWith('about:') && !cleanUrl.startsWith('data:') && !cleanUrl.startsWith('view-source:') && !cleanUrl.startsWith('blob:')) {
      cleanUrl = 'https://' + cleanUrl;
    }
    initialUrl = cleanUrl;
    webview = createWebview(id, initialUrl);
  }

  let initialTitle = 'Nova Aba';
  if (initialUrl && !initialUrl.startsWith('about:')) {
    try {
      initialTitle = new URL(initialUrl).hostname;
    } catch(e) {
      initialTitle = initialUrl;
    }
  }

  const tabData = { id, tabEl, webview, url: initialUrl || '', title: initialTitle };
  tabs.push(tabData);
  switchTab(id);
}

function createWebview(id, url) {
  const wv = document.createElement('webview');
  wv.id = `wv-${id}`;
  wv.src = url;
  wv.style.display = 'none';
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('plugins', ''); // Habilita visualizador embutido de PDFs
  wv.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');

  wv.addEventListener('did-start-loading', () => {
    const t = tabs.find(item => item.id === id);
    if (t) {
      // Se a aba não tiver título definido ainda, usa um fallback temporário baseado na URL ou 'Nova Aba'
      const titleEl = t.tabEl.querySelector('.tab-title');
      if (titleEl && (!t.title || t.title === 'Carregando...' || t.title === 'Nova Aba')) {
        if (t.url && !t.url.startsWith('about:')) {
          try {
            titleEl.innerText = new URL(t.url).hostname;
          } catch(e) {
            titleEl.innerText = t.url;
          }
        }
      }
      // Mostrar spinner de loading no lugar do favicon (exatamente como o Chrome)
      const faviconEl = t.tabEl.querySelector('.tab-favicon');
      if (faviconEl) {
        faviconEl.innerHTML = '<span class="tab-favicon-spinner"></span>';
      }
    }
    if (activeTabId === id) updateNavButtons();
  });

  wv.addEventListener('did-stop-loading', () => {
    const t = tabs.find(item => item.id === id);
    if (t) {
      // Garantir que o título fique correto caso o evento page-title-updated não tenha disparado
      const titleEl = t.tabEl.querySelector('.tab-title');
      if (titleEl && (!titleEl.innerText || titleEl.innerText === 'Carregando...')) {
        titleEl.innerText = t.title || (t.url ? new URL(t.url).hostname : 'Nova Aba');
      }
      // Se não recebeu favicon pelo page-favicon-updated, tenta resolver via URL do site
      const faviconEl = t.tabEl.querySelector('.tab-favicon');
      if (faviconEl && faviconEl.querySelector('.tab-favicon-spinner')) {
        if (t.url && !t.url.startsWith('about:') && !t.url.startsWith('vortex://')) {
          setTabFaviconFromUrl(faviconEl, t.url, false);
        } else {
          faviconEl.innerHTML = `<svg class="tab-favicon-default" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
        }
      }
    }
    if (activeTabId === id) updateNavButtons();
  });

  // ── Favicon do site (ícone da aba igual Chrome) ──
  wv.addEventListener('page-favicon-updated', (e) => {
    if (!e.favicons || !e.favicons.length) return;
    const t = tabs.find(item => item.id === id);
    if (!t) return;
    const faviconEl = t.tabEl.querySelector('.tab-favicon');
    if (!faviconEl) return;
    applyFaviconToTab(faviconEl, e.favicons[0], t.url, false);
  });

  wv.addEventListener('page-title-updated', (e) => {
    const t = tabs.find(item => item.id === id);
    if (t) {
      t.title = e.title;
      t.tabEl.querySelector('.tab-title').innerText = e.title;
      if (t.url) addToHistory(t.url, e.title);
    }
  });

  wv.addEventListener('did-navigate', (e) => {
    const t = tabs.find(item => item.id === id);
    if (t) {
      t.url = e.url;
      if (activeTabId === id) {
        addressInputEl.value = e.url;
        updateSecurityBadge(e.url);
        updateNavButtons();
        updateStarState(e.url);
      }
      addToHistory(e.url, t.title);

      // Detecta logout/saída do Google para desvincular automaticamente igual ao Chrome
      try {
        const u = e.url.toLowerCase();
        if (u.includes('accounts.google.com/logout') || u.includes('accounts.google.com/signout') || u.includes('myaccount.google.com/signout')) {
          disconnectProfile(false);
          showToastNotification('ℹ️', 'Google desconectado', 'Você saiu da sua conta Google.');
        }
      } catch(err) {}
    }
    closeFindBar();
  });

  wv.addEventListener('did-navigate-in-page', (e) => {
    const t = tabs.find(item => item.id === id);
    if (t && activeTabId === id) {
      t.url = e.url;
      addressInputEl.value = e.url;
      updateSecurityBadge(e.url);
      updateNavButtons();
      updateStarState(e.url);

      // Detecta logout em Single Page Apps do Google
      try {
        const u = e.url.toLowerCase();
        if (u.includes('accounts.google.com/logout') || u.includes('accounts.google.com/signout') || u.includes('myaccount.google.com/signout')) {
          disconnectProfile(false);
          showToastNotification('ℹ️', 'Google desconectado', 'Você saiu da sua conta Google.');
        }
      } catch(err) {}
    }
  });

  wv.addEventListener('update-target-url', (e) => {
    if (activeTabId === id) {
      if (e.url) {
        linkPreviewTooltipEl.innerText = e.url;
        linkPreviewTooltipEl.style.display = 'block';
      } else {
        linkPreviewTooltipEl.style.display = 'none';
      }
    }
  });

  // Interceptar tentativas de navegação da página para FTP ou downloads diretos
  wv.addEventListener('will-navigate', (e) => {
    if (e.url.startsWith('ftp://')) {
      e.preventDefault();
      window.vortexAPI.downloadFtp(e.url);
      return;
    }
    if (isDownloadableUrl(e.url)) {
      e.preventDefault();
      window.vortexAPI.downloadUrl(e.url);
      return;
    }
  });

  // Interceptar links com target="_blank" ou window.open
  wv.addEventListener('new-window', (e) => {
    e.preventDefault();
    if (e.url && typeof e.url === 'string') {
      const cleanTarget = e.url.trim();
      if (!cleanTarget || cleanTarget === 'about:blank' || cleanTarget === 'about:blank#') return;
      if (cleanTarget.startsWith('ftp://')) {
        window.vortexAPI.downloadFtp(cleanTarget);
        return;
      }
      if (isDownloadableUrl(cleanTarget)) {
        window.vortexAPI.downloadUrl(cleanTarget);
        return;
      }
      createTab(cleanTarget);
    }
  });

  // Injetar estilos de fundo opaco e scripts de detecção de links e senhas
  wv.addEventListener('dom-ready', () => {
    // 1. Garante que páginas normais tenham fundo branco e páginas de view-source tenham exibição impecável idêntica ao Chrome
    const currentWvUrl = wv.getURL ? wv.getURL() : url;
    if (currentWvUrl && currentWvUrl.startsWith('view-source:')) {
      // Injeta estilos premium idênticos ao Google Chrome para o código-fonte
      wv.insertCSS(`
        html, body {
          background-color: #1e1e1e !important;
          color: #d4d4d4 !important;
          font-family: Consolas, "Courier New", monospace !important;
          font-size: 13px !important;
          line-height: 1.5 !important;
        }
        table {
          width: 100% !important;
          border-collapse: collapse !important;
        }
        td.line-number {
          color: #858585 !important;
          background-color: #252526 !important;
          border-right: 1px solid #3c3c3c !important;
          padding: 0 10px 0 10px !important;
          text-align: right !important;
          user-select: none !important;
          vertical-align: top !important;
        }
        td.line-content {
          padding-left: 12px !important;
          white-space: pre-wrap !important;
          word-break: break-all !important;
          color: #e0e0e0 !important;
        }
        .html-tag { color: #569cd6 !important; }
        .html-attribute-name { color: #9cdcfe !important; }
        .html-attribute-value { color: #ce9178 !important; }
        .html-comment { color: #6a9955 !important; font-style: italic !important; }
      `).catch(() => {});
    } else {
      wv.insertCSS(`
        html, body {
          background-color: #ffffff;
        }
      `).catch(() => {});
    }

    // 2. Interceptador de cliques FTP e Detecção Inteligente de Senhas
    wv.executeJavaScript(`
      if (!window.__vortex_interceptor) {
        window.__vortex_interceptor = true;

        // Previne links FTP de travar a navegação interna
        document.addEventListener('click', (e) => {
          const a = e.target.closest('a');
          if (a && a.href && a.href.startsWith('ftp://')) {
            e.preventDefault();
            e.stopPropagation();
            console.log('__VORTEX_FTP__:' + a.href);
          }
        }, true);

        // Detector de Envio de Senhas para salvar no Vortex
        document.addEventListener('submit', (e) => {
          try {
            const form = e.target;
            const pwdInput = form.querySelector('input[type="password"]');
            if (pwdInput && pwdInput.value) {
              const textInput = form.querySelector('input[type="text"], input[type="email"], input[type="tel"]') ||
                                document.querySelector('input[type="text"], input[type="email"]');
              const username = textInput ? textInput.value : '';
              const password = pwdInput.value;
              console.log('__VORTEX_LOGIN__:' + JSON.stringify({ username, password }));
            }
          } catch(err) {}
        }, true);
      }
    `).catch(() => {});

    // 3. Preenchimento automático de senhas salvas para o domínio atual
    try {
      if (window.vortexAPI && window.vortexAPI.getSavedPasswords) {
        window.vortexAPI.getSavedPasswords().then(passwords => {
          if (!passwords || !passwords.length) return;
          const currentUrl = wv.getURL ? wv.getURL() : url;
          const currentDomain = new URL(currentUrl).hostname;
          const match = passwords.find(p => p.domain === currentDomain || currentUrl.includes(p.domain));
          if (match) {
            wv.executeJavaScript(`
              (function() {
                const pwdInput = document.querySelector('input[type="password"]');
                if (pwdInput && !pwdInput.value) {
                  pwdInput.value = ${JSON.stringify(match.password)};
                  pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
                  pwdInput.dispatchEvent(new Event('change', { bubbles: true }));
                  const userInput = document.querySelector('input[type="text"], input[type="email"], input[type="tel"]');
                  if (userInput && !userInput.value && ${JSON.stringify(match.username)}) {
                    userInput.value = ${JSON.stringify(match.username)};
                    userInput.dispatchEvent(new Event('input', { bubbles: true }));
                    userInput.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }
              })();
            `).catch(() => {});
          }
        }).catch(() => {});
      }
    } catch(e) {}

    // 4. Detecção de foto de perfil sincronizada do Google (quando o usuário JÁ está logado)
    // NÃO preenche campos de login automaticamente — o usuário deve digitar suas credenciais.
    try {
      const curUrl = wv.getURL ? wv.getURL() : url;
      if (curUrl.includes('google.com') || curUrl.includes('accounts.google.com') || curUrl.includes('myaccount.google.com')) {
        wv.executeJavaScript(`
          (function() {
            try {
              // Detectar foto de perfil do usuário JÁ logado no Google (sincroniza avatar)
              const possibleAvatars = [
                'a[href*="SignOutOptions"] img',
                'a[href*="accounts.google.com"] img[src*="googleusercontent.com"]',
                'img[src*="googleusercontent.com/a/"]',
                'img[src*="googleusercontent.com/ogw/"]',
                'header img[src*="googleusercontent.com"]',
                '.gb_A img',
                'button[aria-label*="Google"] img',
                'a[aria-label*="Google"] img'
              ];
              let photo = '';
              for (const sel of possibleAvatars) {
                const img = document.querySelector(sel);
                if (img && img.src && (img.src.includes('googleusercontent.com') || img.src.includes('gstatic.com'))) {
                  photo = img.src;
                  break;
                }
              }

              // Detectar email se o usuário já estiver logado e visível na página
              let detectedEmail = '';
              let detectedName = '';
              const accountBtn = document.querySelector('a[aria-label*="@"], button[aria-label*="@"], a[href*="SignOutOptions"]');
              if (accountBtn) {
                const label = accountBtn.getAttribute('aria-label') || '';
                const m = label.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/);
                if (m) detectedEmail = m[1];
              }

              // Só envia notificação se detectou foto ou email de sessão ativa — sem preencher campos
              if (photo || detectedEmail) {
                console.log('__VORTEX_GOOGLE_ACCOUNT__:' + JSON.stringify({
                  photoUrl: photo,
                  email: detectedEmail,
                  name: detectedName
                }));
              }
              // NOTA: Não preenchemos campos de login automaticamente.
              // O usuário deve digitar suas credenciais manualmente.
            } catch(e) {}
          })();
        `).catch(() => {});
      }
    } catch(e) {}

    // 5. Assistente Inteligente de Consentimento de Cookies da Página (Auto-Consent LGPD/GDPR)
    try {
      const s = JSON.parse(localStorage.getItem('vortex-settings') || '{}');
      if (s.autoAcceptBanners !== false) {
        wv.executeJavaScript(`
          (function() {
            try {
              if (window.__vortexCookieHandled) return;
              const acceptKeywords = [
                'aceitar todos', 'aceitar cookies', 'aceitar tudo', 'concordar e fechar', 
                'concordo', 'permitir todos', 'permitir cookies', 'aceito', 'prossegue',
                'accept all', 'accept cookies', 'agree', 'allow all', 'i agree', 'got it', 'understand'
              ];
              const popularSelectors = [
                '#onetrust-accept-btn-handler',
                '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
                '#CybotCookiebotDialogBodyButtonAccept',
                '.cc-btn.cc-allow',
                '.cookie-banner__accept',
                '.js-accept-cookies',
                'button[data-testid*="cookie-policy-manage-dialog-accept-button"]',
                'button[id*="cookie-accept"]',
                'button[class*="cookie-accept"]',
                'button[aria-label*="Aceitar todos"]'
              ];
              for (const sel of popularSelectors) {
                const btn = document.querySelector(sel);
                if (btn && btn.offsetParent !== null) {
                  btn.click();
                  window.__vortexCookieHandled = true;
                  return;
                }
              }
              const clickable = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
              for (const el of clickable) {
                const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').toLowerCase().trim();
                if (acceptKeywords.some(kw => text === kw || text.includes(kw))) {
                  const parent = el.closest('[id*="cookie"], [class*="cookie"], [id*="consent"], [class*="consent"], [id*="banner"], [class*="banner"], [id*="lgpd"], [class*="lgpd"]');
                  if (parent || text.includes('cookie') || text.includes('concord')) {
                    el.click();
                    window.__vortexCookieHandled = true;
                    return;
                  }
                }
              }
            } catch(e) {}
          })();
        `).catch(() => {});
      }
    } catch(e) {}
  });

  wv.addEventListener('console-message', (e) => {
    if (e.message && e.message.startsWith('__VORTEX_FTP__:')) {
      const ftpUrl = e.message.replace('__VORTEX_FTP__:', '');
      window.vortexAPI.downloadFtp(ftpUrl);
    } else if (e.message && e.message.startsWith('__VORTEX_GOOGLE_ACCOUNT__:')) {
      try {
        const acc = JSON.parse(e.message.replace('__VORTEX_GOOGLE_ACCOUNT__:', ''));
        const currentProfile = JSON.parse(localStorage.getItem('vortex-profile-cache') || '{}');
        let changed = false;

        if (acc.photoUrl && acc.photoUrl !== currentProfile.photoUrl) {
          currentProfile.photoUrl = acc.photoUrl;
          changed = true;
        }
        if (acc.email && (!currentProfile.email || !currentProfile.email.includes('@'))) {
          currentProfile.email = acc.email;
          if (!currentProfile.name) currentProfile.name = acc.email.split('@')[0];
          changed = true;
        }

        if (changed) {
          localStorage.setItem('vortex-profile-cache', JSON.stringify(currentProfile));
          if (window.vortexAPI?.saveUserProfile) {
            window.vortexAPI.saveUserProfile(currentProfile).catch(() => {});
          }
          updateProfileButton();
        }
      } catch(err) {}
    } else if (e.message && e.message.startsWith('__VORTEX_LOGIN__:')) {
      try {
        const payload = JSON.parse(e.message.replace('__VORTEX_LOGIN__:', ''));
        const currentUrl = wv.getURL ? wv.getURL() : url;
        promptSavePassword(currentUrl, payload.username, payload.password);
      } catch(err) {}
    }
  });

  wv.addEventListener('context-menu', (e) => {
    e.preventDefault();
    lastContextMenuTarget = {
      x: e.params?.x || 0,
      y: e.params?.y || 0
    };
    if (typeof showContextMenuAt === 'function') {
      let clickX = null;
      let clickY = null;
      if (window.vortexAPI && typeof window.vortexAPI.getCursorPoint === 'function') {
        try {
          const pt = window.vortexAPI.getCursorPoint();
          if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
            clickX = pt.x;
            clickY = pt.y;
          }
        } catch (err) {}
      }
      if (clickX === null || clickY === null) {
        const rect = wv.getBoundingClientRect();
        clickX = e.params ? (rect.left + e.params.x) : (window.innerWidth / 2);
        clickY = e.params ? (rect.top + e.params.y) : (window.innerHeight / 2);
      }
      showContextMenuAt(clickX, clickY);
    }
  });

  wv.addEventListener('found-in-page', (e) => {
    const r = e.result;
    const info = document.getElementById('findResultInfo');
    if (info) {
      info.innerText = r.matches ? `${r.activeMatchOrdinal} de ${r.matches}` : 'Nenhum resultado';
    }
  });

  viewsContainerEl.appendChild(wv);
  return wv;
}

function switchTab(id) {
  activeTabId = id;
  tabs.forEach(t => {
    if (t.id === id) {
      t.tabEl.classList.add('active');
      t.lastActiveAt = Date.now();

      // Despertar aba suspensa caso estivesse dormindo
      if (t.isSuspended) {
        wakeUpSuspendedTab(t);
      }

      if (t.isSettings && t.webview) {
        homeViewEl.style.display = 'none';
        t.webview.style.display = 'block';
        addressInputEl.value = 'vortex://configuracoes';
        updateSecurityBadge('vortex://configuracoes');
      } else if (t.isHistory && t.webview) {
        homeViewEl.style.display = 'none';
        t.webview.style.display = 'block';
        addressInputEl.value = 'vortex://historico';
        updateSecurityBadge('vortex://historico');
      } else if (t.isBookmarks && t.webview) {
        homeViewEl.style.display = 'none';
        t.webview.style.display = 'block';
        addressInputEl.value = 'vortex://favoritos';
        updateSecurityBadge('vortex://favoritos');
      } else if (t.isViewSource && t.webview) {
        homeViewEl.style.display = 'none';
        t.webview.style.display = 'block';
        addressInputEl.value = t.url || '';
        updateSecurityBadge(t.url || '');
      } else if (t.isExtensions && t.webview) {
        homeViewEl.style.display = 'none';
        t.webview.style.display = 'block';
        addressInputEl.value = 'vortex://extensoes';
        updateSecurityBadge('vortex://extensoes');
      } else if (t.webview && t.url && t.url !== 'about:blank') {
        homeViewEl.style.display = 'none';
        t.webview.style.display = 'flex';
        addressInputEl.value = t.url || '';
        updateSecurityBadge(t.url || '');
      } else {
        if (t.webview) t.webview.style.display = 'none';
        homeViewEl.style.display = 'flex';
        addressInputEl.value = '';
        updateSecurityBadge('');
        updateStarState('');
      }
      updateNavButtons();
      // Update star state when switching tabs
      const activeT = tabs.find(item => item.id === id);
      if (activeT && activeT.url && !activeT.isSettings && !activeT.isHistory && !activeT.isBookmarks && !activeT.isExtensions) {
        updateStarState(activeT.url);
      }
    } else {
      t.tabEl.classList.remove('active');
      if (t.webview) t.webview.style.display = 'none';
    }
  });
  linkPreviewTooltipEl.style.display = 'none';
  closeFindBar();
  if (typeof closeDockedDevTools === 'function') {
    const cur = getActiveTab();
    if (cur && cur.webview) closeDockedDevTools(cur.webview);
  }
  updateIncognitoUI();
}

// Suspende abas inativas para economizar memória RAM (Sleeping Tabs)
function suspendTab(tab) {
  if (!tab || tab.id === activeTabId || tab.isSuspended) return;
  // Não suspender abas de sistema ou abas sem URL
  if (tab.isSettings || tab.isHistory || tab.isBookmarks || tab.isExtensions || !tab.url || tab.url === 'about:blank') return;

  tab.isSuspended = true;
  tab.tabEl.classList.add('suspended');
  tab.tabEl.title = `${tab.title || tab.url} (Em repouso para economizar memória)`;

  if (tab.webview) {
    try {
      // Congelar renderizador e liberar memória de background
      if (typeof tab.webview.stop === 'function') tab.webview.stop();
    } catch(e) {}
  }
}

function wakeUpSuspendedTab(tab) {
  if (!tab || !tab.isSuspended) return;
  tab.isSuspended = false;
  tab.lastActiveAt = Date.now();
  tab.tabEl.classList.remove('suspended');
  tab.tabEl.title = tab.title || tab.url;

  if (tab.webview) {
    try {
      if (typeof tab.webview.reload === 'function') {
        tab.webview.reload();
      }
    } catch(e) {}
  }
}

// Monitor periódico de abas inativas para suspensão
setInterval(() => {
  const now = Date.now();
  tabs.forEach(t => {
    if (t.id !== activeTabId && !t.isSuspended && t.lastActiveAt && (now - t.lastActiveAt > TAB_SLEEP_TIMEOUT_MS)) {
      suspendTab(t);
    }
  });
}, 60000); // Checa a cada minuto

function restoreLastClosedTab() {
  if (recentlyClosedTabs.length === 0) {
    showToastNotification('ℹ️', 'Nenhuma aba recente', 'Não há abas fechadas para reabrir.');
    return;
  }
  const closed = recentlyClosedTabs.pop();
  if (closed && closed.url) {
    createTab(closed.url);
    showToastNotification('↩️', 'Aba restaurada', closed.title || closed.url);
  }
}

function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id);
  if (index === -1) return;
  const tabToRemove = tabs[index];

  // Salvar no histórico de abas fechadas (exceto abas anônimas) para Ctrl+Shift+T
  if (tabToRemove.url && tabToRemove.url !== 'about:blank' && !tabToRemove.isIncognito && !tabToRemove.isSettings) {
    recentlyClosedTabs.push({
      url: tabToRemove.url,
      title: tabToRemove.title || tabToRemove.url,
      timestamp: Date.now()
    });
    if (recentlyClosedTabs.length > 20) recentlyClosedTabs.shift();
  }

  if (tabToRemove.webview) {
    if (typeof closeDockedDevTools === 'function') {
      closeDockedDevTools(tabToRemove.webview);
    }
    tabToRemove.webview.remove();
  }
  tabToRemove.tabEl.remove();
  // Limpar partição anônima da memória ao fechar a aba
  incognitoTabIds.delete(id);
  tabs.splice(index, 1);
  if (tabs.length === 0) {
    createTab();
  } else if (activeTabId === id) {
    switchTab(tabs[Math.max(0, index - 1)].id);
  }
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId);
}

function updateNavButtons() {
  const cur = getActiveTab();
  const backBtn = document.getElementById('btnBack');
  const fwdBtn = document.getElementById('btnForward');
  if (backBtn) backBtn.style.opacity = (cur && cur.webview && cur.webview.canGoBack && cur.webview.canGoBack()) ? '1' : '0.4';
  if (fwdBtn) fwdBtn.style.opacity = (cur && cur.webview && cur.webview.canGoForward && cur.webview.canGoForward()) ? '1' : '0.4';
}

// ── Navegação ─────────────────────────────
function navigateTo(target) {
  let url = target.trim();
  if (!url) return;

  // Suporte a URLs internas do Vortex via barra de endereços
  if (url === 'vortex://configuracoes' || url === 'vortex://settings') {
    openSettings();
    return;
  }
  if (url === 'vortex://historico' || url === 'vortex://history') {
    openHistoryTab();
    return;
  }
  if (url === 'vortex://favoritos' || url === 'vortex://bookmarks') {
    openBookmarksTab();
    return;
  }
  if (url === 'vortex://extensoes' || url === 'vortex://extensions') {
    openExtensionsTab();
    return;
  }

  if (url.startsWith('ftp://')) {
    window.vortexAPI.downloadFtp(url);
    return;
  }

  if (isDownloadableUrl(url)) {
    window.vortexAPI.downloadUrl(url);
    return;
  }

  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('view-source:') && !url.startsWith('about:')) {
    if (url.includes('.') && !url.includes(' ')) {
      url = 'https://' + url;
    } else {
      const engine = SEARCH_ENGINES[searchEngine] || SEARCH_ENGINES.duckduckgo;
      url = engine + encodeURIComponent(url);
    }
  }

  const currentTab = getActiveTab();
  if (!currentTab) return;

  if (currentTab.isSettings || currentTab.isHistory || currentTab.isBookmarks || currentTab.isExtensions) {
    createTab(url);
    return;
  }

  if (!currentTab.webview) {
    currentTab.webview = createWebview(currentTab.id, url);
  } else {
    if (currentTab.webview.src === 'about:blank' || !currentTab.webview.src) {
      currentTab.webview.src = url;
    } else {
      currentTab.webview.loadURL(url);
    }
  }

  homeViewEl.style.display = 'none';
  currentTab.webview.style.display = 'flex';
  addressInputEl.value = url;
  updateSecurityBadge(url);
  currentTab.url = url;
  closeFindBar();
}

// ── Event listeners básicos ───────────────
document.getElementById('btnNewTab').addEventListener('click', () => createTab());
document.getElementById('btnIncognito')?.addEventListener('click', () => openIncognitoTab());

// ── Omnibox Autocomplete & Sugestões (estilo Google Chrome) ──
const addressDropdownEl = document.getElementById('addressAutocompleteDropdown');
let autocompleteSelectedIndex = -1;
let autocompleteDebounceTimer = null;

function hideAutocomplete() {
  if (addressDropdownEl) {
    addressDropdownEl.classList.remove('open');
    addressDropdownEl.innerHTML = '';
  }
  autocompleteSelectedIndex = -1;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}

async function fetchGoogleSuggestions(query) {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data[1]) ? data[1].slice(0, 5) : [];
  } catch (e) {
    return [];
  }
}

function renderAutocompleteSuggestions(items, query) {
  if (!addressDropdownEl) return;
  if (!items || items.length === 0) {
    hideAutocomplete();
    return;
  }

  autocompleteSelectedIndex = -1;
  const qLower = query.toLowerCase();

  let html = '';
  items.forEach((item, idx) => {
    let iconHtml = '';
    let badgeText = '';

    // Extrair domínio para buscar favicon real via Google Favicons API (igual ao Chrome)
    let domain = '';
    if (item.url) {
      try {
        domain = new URL(item.url).hostname;
      } catch(e) {
        domain = item.url.split('/')[0];
      }
    }

    if (item.type === 'history') {
      badgeText = '<span class="ac-badge">Histórico</span>';
      if (domain) {
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
        iconHtml = `<img src="${faviconUrl}" alt="" onerror="this.outerHTML='<svg viewBox=\\\'0 0 24 24\\\' fill=\\\'none\\\' stroke=\\\'currentColor\\\' stroke-width=\\\'2\\\'><circle cx=\\\'12\\\' cy=\\\'12\\\' r=\\\'10\\\'/><polyline points=\\\'12 6 12 12 16 14\\\'/></svg>'">`;
      } else {
        iconHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
      }
    } else if (item.type === 'bookmark') {
      badgeText = '<span class="ac-badge">Favorito</span>';
      if (domain) {
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
        iconHtml = `<img src="${faviconUrl}" alt="" onerror="this.outerHTML='<svg viewBox=\\\'0 0 24 24\\\' fill=\\\'#facc15\\\' stroke=\\\'#facc15\\\' stroke-width=\\\'1\\\'><polygon points=\\\'12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\\\'/></svg>'">`;
      } else {
        iconHtml = `<svg viewBox="0 0 24 24" fill="#facc15" stroke="#facc15" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
      }
    } else if (item.type === 'direct-url') {
      badgeText = '<span class="ac-badge">Acessar</span>';
      if (domain) {
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
        iconHtml = `<img src="${faviconUrl}" alt="" onerror="this.outerHTML='<svg viewBox=\\\'0 0 24 24\\\' fill=\\\'none\\\' stroke=\\\'currentColor\\\' stroke-width=\\\'2\\\'><circle cx=\\\'12\\\' cy=\\\'12\\\' r=\\\'10\\\'/><line x1=\\\'2\\\' y1=\\\'12\\\' x2=\\\'22\\\' y2=\\\'12\\\'/><path d=\\\'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z\\\'/></svg>'">`;
      } else {
        iconHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
      }
    } else {
      badgeText = '<span class="ac-badge">Pesquisa</span>';
      iconHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
    }

    // Destaque visual do texto que o usuário digitou
    const titleSafe = escapeHtml(item.title);
    let titleFormatted = titleSafe;
    const matchPos = titleSafe.toLowerCase().indexOf(qLower);
    if (matchPos !== -1) {
      const matchPart = titleSafe.slice(matchPos, matchPos + qLower.length);
      titleFormatted = titleSafe.slice(0, matchPos) + `<span class="ac-match">${matchPart}</span>` + titleSafe.slice(matchPos + qLower.length);
    }

    const urlDisplay = item.url ? `<span class="ac-url">${escapeHtml(item.url)}</span>` : '';

    html += `
      <div class="ac-item" data-index="${idx}" data-target="${escapeHtml(item.target)}">
        <div class="ac-icon">${iconHtml}</div>
        <div class="ac-content">
          <span class="ac-title">${titleFormatted}</span>
          ${urlDisplay}
        </div>
        ${badgeText}
      </div>`;
  });

  addressDropdownEl.innerHTML = html;
  addressDropdownEl.classList.add('open');

  // Adicionar eventos de clique em cada sugestão
  addressDropdownEl.querySelectorAll('.ac-item').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const target = el.getAttribute('data-target');
      if (target) {
        addressInputEl.value = target;
        hideAutocomplete();
        navigateTo(target);
      }
    });
  });
}

// Domínios mais populares da Web para autocompletar instantâneo (estilo Google Chrome)
const POPULAR_DOMAINS = [
  'google.com', 'youtube.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'whatsapp.com', 'tiktok.com', 'netflix.com', 'globo.com', 'uol.com.br', 'g1.globo.com',
  'mercadolivre.com.br', 'amazon.com.br', 'amazon.com', 'github.com', 'chatgpt.com',
  'openai.com', 'wikipedia.org', 'reddit.com', 'linkedin.com', 'gov.br', 'datasus.gov.br'
];

async function updateAutocomplete(query) {
  const q = (query || '').trim();
  if (!q) {
    hideAutocomplete();
    return;
  }

  const qLower = q.toLowerCase();
  const suggestions = [];
  const seenTargets = new Set();

  // 1. Sempre oferecer a opção direta de pesquisar pelo termo digitado
  suggestions.push({
    type: 'search',
    title: q,
    url: '',
    target: q
  });
  seenTargets.add(q.toLowerCase());

  // 2. Verificar correspondência com os domínios mais populares (ex: "go" -> "google.com")
  for (const dom of POPULAR_DOMAINS) {
    if (dom.startsWith(qLower) || dom.includes(qLower)) {
      const fullUrl = `https://${dom}`;
      if (!seenTargets.has(fullUrl.toLowerCase())) {
        seenTargets.add(fullUrl.toLowerCase());
        suggestions.push({
          type: 'direct-url',
          title: dom,
          url: fullUrl,
          target: fullUrl
        });
        if (suggestions.length >= 4) break;
      }
    }
  }

  // 3. Verificar se o próprio texto é uma URL direta
  const isLikelyUrl = q.includes('.') && !q.includes(' ') && !q.startsWith('http');
  if (isLikelyUrl) {
    const fullUrl = `https://${q}`;
    if (!seenTargets.has(fullUrl.toLowerCase())) {
      seenTargets.add(fullUrl.toLowerCase());
      suggestions.push({
        type: 'direct-url',
        title: q,
        url: fullUrl,
        target: fullUrl
      });
    }
  }

  // 4. Buscar correspondências no Histórico local de navegação
  if (Array.isArray(browsingHistory)) {
    for (const h of browsingHistory) {
      if (!h || !h.url) continue;
      const titleMatch = h.title && h.title.toLowerCase().includes(qLower);
      const urlMatch = h.url.toLowerCase().includes(qLower);
      if ((titleMatch || urlMatch) && !seenTargets.has(h.url.toLowerCase())) {
        seenTargets.add(h.url.toLowerCase());
        suggestions.push({
          type: 'history',
          title: h.title || h.url,
          url: h.url,
          target: h.url
        });
        if (suggestions.length >= 7) break;
      }
    }
  }

  // 5. Buscar correspondências nos Favoritos
  if (Array.isArray(bookmarks)) {
    for (const b of bookmarks) {
      if (!b || !b.url) continue;
      const bTitleMatch = b.title && b.title.toLowerCase().includes(qLower);
      const bUrlMatch = b.url.toLowerCase().includes(qLower);
      if ((bTitleMatch || bUrlMatch) && !seenTargets.has(b.url.toLowerCase())) {
        seenTargets.add(b.url.toLowerCase());
        suggestions.push({
          type: 'bookmark',
          title: b.title || b.url,
          url: b.url,
          target: b.url
        });
        if (suggestions.length >= 8) break;
      }
    }
  }

  // Renderiza imediatamente as sugestões locais instantâneas (sem latência de rede)
  if (addressInputEl && addressInputEl.value.trim() === q) {
    renderAutocompleteSuggestions(suggestions, q);
  }

  // 6. Buscar sugestões em tempo real do Google Suggest de forma assíncrona
  try {
    const googleResults = await fetchGoogleSuggestions(q);
    if (addressInputEl && addressInputEl.value.trim() === q) {
      for (const gQuery of googleResults) {
        if (!seenTargets.has(gQuery.toLowerCase())) {
          seenTargets.add(gQuery.toLowerCase());
          suggestions.push({
            type: 'search',
            title: gQuery,
            url: '',
            target: gQuery
          });
          if (suggestions.length >= 9) break;
        }
      }
      renderAutocompleteSuggestions(suggestions, q);
    }
  } catch (err) {}
}

// ── Event listeners da barra de endereço e Omnibox ──
addressInputEl.addEventListener('input', () => {
  clearTimeout(autocompleteDebounceTimer);
  const val = addressInputEl.value;
  if (!val.trim()) {
    hideAutocomplete();
    return;
  }
  // Dispara imediatamente para sugestões locais e domínios instantâneos
  updateAutocomplete(val);
});

addressInputEl.addEventListener('keydown', (e) => {
  const items = addressDropdownEl ? addressDropdownEl.querySelectorAll('.ac-item') : [];
  const isOpen = addressDropdownEl && addressDropdownEl.classList.contains('open') && items.length > 0;

  if (e.key === 'ArrowDown' && isOpen) {
    e.preventDefault();
    autocompleteSelectedIndex = (autocompleteSelectedIndex + 1) % items.length;
    items.forEach((el, i) => el.classList.toggle('selected', i === autocompleteSelectedIndex));
    if (items[autocompleteSelectedIndex]) {
      const target = items[autocompleteSelectedIndex].getAttribute('data-target');
      addressInputEl.value = target;
    }
    return;
  }

  if (e.key === 'ArrowUp' && isOpen) {
    e.preventDefault();
    autocompleteSelectedIndex = (autocompleteSelectedIndex - 1 + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('selected', i === autocompleteSelectedIndex));
    if (items[autocompleteSelectedIndex]) {
      const target = items[autocompleteSelectedIndex].getAttribute('data-target');
      addressInputEl.value = target;
    }
    return;
  }

  if (e.key === 'Escape') {
    hideAutocomplete();
    return;
  }

  if (e.key === 'Enter') {
    if (isOpen && autocompleteSelectedIndex >= 0 && items[autocompleteSelectedIndex]) {
      const target = items[autocompleteSelectedIndex].getAttribute('data-target');
      hideAutocomplete();
      navigateTo(target);
    } else {
      hideAutocomplete();
      navigateTo(addressInputEl.value);
    }
  }
});

addressInputEl.addEventListener('focus', () => {
  addressInputEl.select();
  if (addressInputEl.value.trim()) {
    updateAutocomplete(addressInputEl.value);
  }
});

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.address-bar-wrapper')) {
    hideAutocomplete();
  }
});

addressInputEl.addEventListener('blur', () => {
  // Pequeno timeout para permitir o clique em uma sugestão antes de fechar
  setTimeout(() => {
    hideAutocomplete();
  }, 180);
});

window.addEventListener('blur', () => {
  hideAutocomplete();
});

const homeSearchInputEl = document.getElementById('homeSearchInput');
homeSearchInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') navigateTo(homeSearchInputEl.value);
});

// Seletores rápidos de buscador na tela inicial
document.querySelectorAll('.home-engine-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.home-engine-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const engine = chip.getAttribute('data-engine');
    if (engine) {
      searchEngine = engine;
      const names = {
        duckduckgo: 'DuckDuckGo sem rastreamento',
        google: 'Google',
        brave: 'Brave Search',
        bing: 'Bing',
        youtube: 'YouTube'
      };
      if (homeSearchInputEl) {
        homeSearchInputEl.placeholder = `Buscar com ${names[engine] || engine}...`;
        homeSearchInputEl.focus();
      }
      try {
        const s = JSON.parse(localStorage.getItem('vortex-settings') || '{}');
        s.searchEngine = engine;
        localStorage.setItem('vortex-settings', JSON.stringify(s));
      } catch (e) {}
    }
  });
});

document.querySelectorAll('.tile').forEach(tile => {
  tile.addEventListener('click', () => { const url = tile.getAttribute('data-url'); navigateTo(url); });
});

// ── Botões da barra de navegação ──────────
document.getElementById('btnBack').addEventListener('click', () => {
  const cur = getActiveTab();
  if (cur && cur.webview && cur.webview.canGoBack()) cur.webview.goBack();
});

document.getElementById('btnForward').addEventListener('click', () => {
  const cur = getActiveTab();
  if (cur && cur.webview && cur.webview.canGoForward()) cur.webview.goForward();
});

document.getElementById('btnReload').addEventListener('click', () => {
  const cur = getActiveTab();
  if (cur && cur.webview) cur.webview.reload();
});

document.getElementById('btnHome').addEventListener('click', () => {
  const cur = getActiveTab();
  const s = JSON.parse(localStorage.getItem('vortex-settings') || '{}');
  const homePage = s.homePage;
  if (homePage && homePage.trim()) {
    navigateTo(homePage);
  } else {
    if (cur) {
      if (cur.webview) cur.webview.style.display = 'none';
      homeViewEl.style.display = 'flex';
      addressInputEl.value = '';
      updateSecurityBadge('');
      linkPreviewTooltipEl.style.display = 'none';
    }
  }
});

// ══════════════════════════════════════════════════════════
// FERRAMENTAS DO DESENVOLVEDOR - PAINEL ACOPLADO À DIREITA
// Usa setDevToolsWebContents para renderizar o DevTools
// diretamente no painel lateral direito da mesma janela.
// ══════════════════════════════════════════════════════════

const devtoolsDockContainerEl = document.getElementById('devtoolsDockContainer');
const devtoolsDockWebviewEl = document.getElementById('devtoolsDockWebview');
const devtoolsResizerEl = document.getElementById('devtoolsResizer');
let isDevToolsDockOpen = false;
let devToolsCurrentTargetWcId = null;

// Inicializa redimensionamento do painel DevTools
if (devtoolsResizerEl && devtoolsDockContainerEl) {
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  devtoolsResizerEl.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = devtoolsDockContainerEl.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const delta = startX - e.clientX;
    const newWidth = Math.max(340, Math.min(window.innerWidth * 0.85, startWidth + delta));
    devtoolsDockContainerEl.style.width = `${newWidth}px`;
  });

  window.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// Botões do cabeçalho do painel DevTools
document.getElementById('btnDevtoolsClose')?.addEventListener('click', () => {
  closeDockedDevTools();
});

document.getElementById('btnDevtoolsDetach')?.addEventListener('click', async () => {
  const cur = getActiveTab();
  if (!cur || !cur.webview) return;
  const wcId = cur.webview.getWebContentsId ? cur.webview.getWebContentsId() : null;
  closeDockedDevTools();
  if (wcId && window.vortexAPI?.openDevTools) {
    await window.vortexAPI.openDevTools({ targetWebContentsId: wcId, mode: 'detach' });
  } else if (typeof cur.webview.openDevTools === 'function') {
    cur.webview.openDevTools();
  }
});

// Abre o DevTools oficial do Chromium com Elements, Console, Network e Sources
async function openDockedDevTools(targetWv, inspectX, inspectY) {
  const cur = getActiveTab();
  const wv = targetWv || cur?.webview;
  if (!wv) return;

  // Garante que o container dummy antigo não fique aberto atrapalhando
  if (devtoolsDockContainerEl) {
    devtoolsDockContainerEl.classList.remove('open');
  }

  try {
    const targetWcId = wv.getWebContentsId ? wv.getWebContentsId() : null;

    if (typeof inspectX === 'number' && typeof inspectY === 'number') {
      const px = Math.max(0, Math.round(inspectX));
      const py = Math.max(0, Math.round(inspectY));
      if (typeof wv.inspectElement === 'function') {
        wv.inspectElement(px, py);
      } else if (targetWcId && window.vortexAPI?.openDevTools) {
        await window.vortexAPI.openDevTools({ targetWebContentsId: targetWcId, mode: 'right', x: px, y: py });
      }
    } else {
      if (typeof wv.openDevTools === 'function') {
        wv.openDevTools({ mode: 'right' });
      } else if (targetWcId && window.vortexAPI?.openDevTools) {
        await window.vortexAPI.openDevTools({ targetWebContentsId: targetWcId, mode: 'right' });
      }
    }
  } catch (err) {
    console.error('Erro ao abrir DevTools nativo:', err);
  }
}

// Fecha o DevTools
async function closeDockedDevTools(targetWv) {
  if (devtoolsDockContainerEl) {
    devtoolsDockContainerEl.classList.remove('open');
  }

  const cur = getActiveTab();
  const wv = targetWv || cur?.webview;
  if (wv) {
    try {
      if (typeof wv.closeDevTools === 'function') {
        wv.closeDevTools();
      }
      const wcId = wv.getWebContentsId ? wv.getWebContentsId() : null;
      if (wcId && window.vortexAPI?.closeDevTools) {
        await window.vortexAPI.closeDevTools({ targetWebContentsId: wcId });
      }
    } catch(e) {}
  }
}

// Função global para a paleta de comandos e ações do usuário
function openDevToolsAction() {
  const cur = getActiveTab();
  if (cur && cur.webview) toggleDockedDevTools(cur.webview);
}

// Alterna o DevTools (abre se fechado, fecha se aberto)
async function toggleDockedDevTools(targetWv) {
  const cur = getActiveTab();
  const wv = targetWv || cur?.webview;
  if (!wv) return;

  let isOpen = false;
  try {
    if (typeof wv.isDevToolsOpened === 'function') {
      isOpen = wv.isDevToolsOpened();
    }
  } catch(e) {}

  if (isOpen) {
    await closeDockedDevTools(wv);
  } else {
    await openDockedDevTools(wv);
  }
}

// Botão DevTools na barra de navegação
document.getElementById('btnDevTools')?.addEventListener('click', () => {
  const cur = getActiveTab();
  if (cur && cur.webview) toggleDockedDevTools(cur.webview);
});

// ══════════════════════════════════════════
// BARRA DE BUSCA NA PÁGINA (Find in Page)
// ══════════════════════════════════════════
function openFindBar() {
  if (!findBarEl) return;
  findBarEl.style.display = 'flex';
  if (findInputEl) { findInputEl.value = ''; findInputEl.focus(); }
}

function closeFindBar() {
  if (!findBarEl) return;
  findBarEl.style.display = 'none';
  const cur = getActiveTab();
  if (cur && cur.webview && typeof cur.webview.stopFindInPage === 'function') {
    cur.webview.stopFindInPage('clearSelection');
  }
  const info = document.getElementById('findResultInfo');
  if (info) info.innerText = '';
}

function findInPage(forward = true) {
  const cur = getActiveTab();
  if (!cur || !cur.webview || !findInputEl) return;
  const query = findInputEl.value.trim();
  if (!query) return;
  cur.webview.findInPage(query, { forward, findNext: true });
}

if (findInputEl) {
  findInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') findInPage(!e.shiftKey);
    if (e.key === 'Escape') closeFindBar();
  });
  findInputEl.addEventListener('input', () => {
    const cur = getActiveTab();
    if (!cur || !cur.webview) return;
    const query = findInputEl.value.trim();
    if (query) cur.webview.findInPage(query);
    else cur.webview.stopFindInPage('clearSelection');
  });
}

document.getElementById('findPrev')?.addEventListener('click', () => findInPage(false));
document.getElementById('findNext')?.addEventListener('click', () => findInPage(true));
document.getElementById('findClose')?.addEventListener('click', () => closeFindBar());

// ══════════════════════════════════════════
// ATALHOS DE TECLADO GLOBAIS
// ══════════════════════════════════════════
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); restoreLastClosedTab(); }
  else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); openIncognitoTab(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 't') { e.preventDefault(); createTab(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
  else if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    if (tabs.length > 1) {
      const curIdx = tabs.findIndex(t => t.id === activeTabId);
      if (curIdx >= 0) {
        const nextIdx = e.shiftKey 
          ? (curIdx - 1 + tabs.length) % tabs.length 
          : (curIdx + 1) % tabs.length;
        switchTab(tabs[nextIdx].id);
      }
    }
  }
  else if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); addressInputEl.select(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); window.vortexAPI.openNewWindow(); }
  else if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.keyCode === 73))) { e.preventDefault(); const cur = getActiveTab(); if (cur && cur.webview) toggleDockedDevTools(cur.webview); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'r') { e.preventDefault(); const cur = getActiveTab(); if (cur && cur.webview) cur.webview.reload(); }
  else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'delete') { e.preventDefault(); window.vortexAPI.clearBrowsingData(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); openFindBar(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'u') { e.preventDefault(); const cur = getActiveTab(); if (cur && cur.url) createTab('view-source:' + cur.url); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'j') { e.preventDefault(); openSettings('downloads'); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'h') { e.preventDefault(); openHistoryTab(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); openBookmarkPopup(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); const cur = getActiveTab(); if (cur && cur.webview && cur.webview.print) cur.webview.print(); else window.print(); }
  else if (e.key === 'F5') { e.preventDefault(); const cur = getActiveTab(); if (cur && cur.webview) cur.webview.reload(); }
  else if (e.key === 'Escape') { closeFindBar(); closeAllMenus(); closeBookmarkPopup(); }
});

// ══════════════════════════════════════════
// MENU TRÊS PONTINHOS (Chrome-style)
// ══════════════════════════════════════════
const dotsMenu = document.getElementById('dotsMenu');
const btnMenuDots = document.getElementById('btnMenuDots');

const contextMenuBackdrop = document.getElementById('contextMenuBackdrop');

// Função unificada para fechar todos os menus, popups e dropdowns
function closeAllPopups(exceptEl) {
  const popups = [
    dotsMenu,
    document.getElementById('extensionsPopup'),
    document.getElementById('profilePopup'),
    document.getElementById('vpnPopup'),
    document.getElementById('bookmarkPopup'),
    document.getElementById('passwordSavePopup'),
    contextMenu
  ];
  popups.forEach(p => {
    if (p && p !== exceptEl) {
      p.classList.remove('open');
    }
  });
  if (contextMenuBackdrop && contextMenuBackdrop !== exceptEl) {
    contextMenuBackdrop.classList.remove('open');
  }
}

function closeAllMenus() {
  closeAllPopups();
}

btnMenuDots.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = dotsMenu.classList.contains('open');
  closeAllPopups();
  if (!isOpen) {
    dotsMenu.classList.add('open');
  }
});

// Listener global: fecha qualquer popup se clicar fora dele e fora do seu botão disparador
document.addEventListener('pointerdown', (e) => {
  const isInsidePopupOrButton = e.target.closest(
    '#dotsMenu, #btnMenuDots, #extensionsPopup, #btnExtensions, #profilePopup, #btnProfileMenu, #vpnPopup, #btnVpn, #bookmarkPopup, #btnBookmarkStar, #passwordSavePopup, #contextMenu'
  );
  if (!isInsidePopupOrButton) {
    closeAllPopups();
  }
});

// ── Itens do menu ─────────────────────────
document.getElementById('dm-new-tab')?.addEventListener('click', () => { closeAllMenus(); createTab(); });

document.getElementById('dm-new-window')?.addEventListener('click', () => { closeAllMenus(); window.vortexAPI.openNewWindow(); });

document.getElementById('dm-incognito')?.addEventListener('click', () => { closeAllMenus(); openIncognitoTab(); });

document.getElementById('dm-history')?.addEventListener('click', () => { closeAllMenus(); openHistoryTab(); });

document.getElementById('dm-downloads')?.addEventListener('click', () => { closeAllMenus(); openSettings('downloads'); });

document.getElementById('dm-bookmarks')?.addEventListener('click', () => { closeAllMenus(); openBookmarksTab(); });

document.getElementById('dm-passwords')?.addEventListener('click', () => { closeAllMenus(); openSettings('passwords'); });

document.getElementById('dm-extensions')?.addEventListener('click', () => { closeAllMenus(); openExtensionsTab(); });

document.getElementById('dm-clear')?.addEventListener('click', () => {
  closeAllMenus();
  openChromeClearModal();
});

document.getElementById('dm-print')?.addEventListener('click', () => {
  closeAllMenus();
  const cur = getActiveTab();
  if (cur && cur.webview && typeof cur.webview.print === 'function') cur.webview.print();
  else window.print();
});

document.getElementById('dm-find')?.addEventListener('click', () => {
  closeAllMenus();
  openFindBar();
});

document.getElementById('dm-devtools')?.addEventListener('click', () => {
  closeAllMenus();
  const cur = getActiveTab();
  if (cur && cur.webview) toggleDockedDevTools(cur.webview);
});

document.getElementById('dm-settings')?.addEventListener('click', () => { closeAllMenus(); openSettings(); });
document.getElementById('dm-quit')?.addEventListener('click', () => { closeAllMenus(); window.vortexAPI.close(); });

// ── Adicionar favorito pelo menu ──────────
document.getElementById('dm-bookmark-page')?.addEventListener('click', () => { closeAllMenus(); addCurrentPageToBookmarks(); });

// ── Controles de Zoom ─────────────────────
document.getElementById('dm-zoom-out')?.addEventListener('click', (e) => {
  e.stopPropagation();
  currentZoom = Math.max(25, currentZoom - 10);
  applyZoom();
});

document.getElementById('dm-zoom-in')?.addEventListener('click', (e) => {
  e.stopPropagation();
  currentZoom = Math.min(500, currentZoom + 10);
  applyZoom();
});

document.getElementById('dm-zoom-full')?.addEventListener('click', (e) => {
  e.stopPropagation();
  closeAllMenus();
  // Alterna tela cheia
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
});

function applyZoom() {
  const zv = document.getElementById('dm-zoom-value');
  if (zv) zv.innerText = currentZoom + '%';
  const cur = getActiveTab();
  if (cur && cur.webview && typeof cur.webview.setZoomFactor === 'function') {
    cur.webview.setZoomFactor(currentZoom / 100);
  }
}

// ══════════════════════════════════════════
// ABA DE CONFIGURAÇÕES
// ══════════════════════════════════════════
function openSettings(section = '') {
  const existing = tabs.find(t => t.isSettings);
  if (existing) {
    switchTab(existing.id);
    if (section && existing.webview) {
      try {
        existing.webview.contentWindow.postMessage({ type: 'navigate-section', section }, '*');
      } catch (e) {
        existing.webview.src = 'settings.html#' + section;
      }
    }
    return;
  }

  tabCounter++;
  const id = `tab-${tabCounter}`;
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.id = `tab-btn-${id}`;
  tabEl.innerHTML = `<span class="tab-title">⚙️ Configurações</span><span class="tab-close" data-id="${id}">✕</span>`;

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) closeTab(id);
    else switchTab(id);
  });

  tabsListEl.appendChild(tabEl);

  const iframe = document.createElement('iframe');
  iframe.id = `wv-${id}`;
  iframe.src = section ? `settings.html#${section}` : 'settings.html';
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:none;';
  viewsContainerEl.appendChild(iframe);

  const tabData = { id, tabEl, webview: iframe, url: 'settings.html', title: '⚙️ Configurações', isSettings: true };
  tabs.push(tabData);
  switchTab(id);
  homeViewEl.style.display = 'none';
  iframe.style.display = 'block';
  addressInputEl.value = 'vortex://configuracoes';
  updateSecurityBadge('vortex://configuracoes');
}

// ══════════════════════════════════════════
// ABA DE EXTENSÕES & SINCRONIZAÇÃO (vortex://extensoes)
// ══════════════════════════════════════════
function openExtensionsTab(page = 'installed') {
  const existing = tabs.find(t => t.isExtensions);
  if (existing) {
    switchTab(existing.id);
    if (page && existing.webview) {
      try {
        existing.webview.contentWindow.postMessage({ type: 'navigate-page', page }, '*');
      } catch (e) {
        existing.webview.src = 'extensions.html#' + page;
      }
    }
    return;
  }

  tabCounter++;
  const id = `tab-${tabCounter}`;
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.id = `tab-btn-${id}`;
  tabEl.innerHTML = `<span class="tab-title">🧩 Extensões</span><span class="tab-close" data-id="${id}">✕</span>`;

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) closeTab(id);
    else switchTab(id);
  });

  tabsListEl.appendChild(tabEl);

  const iframe = document.createElement('iframe');
  iframe.id = `wv-${id}`;
  iframe.src = page ? `extensions.html#${page}` : 'extensions.html';
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:none;';
  viewsContainerEl.appendChild(iframe);

  const tabData = { id, tabEl, webview: iframe, url: 'extensions.html', title: '🧩 Extensões', isExtensions: true };
  tabs.push(tabData);
  switchTab(id);
  homeViewEl.style.display = 'none';
  iframe.style.display = 'block';
  addressInputEl.value = 'vortex://extensoes';
  updateSecurityBadge('vortex://extensoes');
}

// ══════════════════════════════════════════
// ABA DE HISTÓRICO
// ══════════════════════════════════════════
function openHistoryTab() {
  const existing = tabs.find(t => t.isHistory);
  if (existing) { switchTab(existing.id); return; }

  tabCounter++;
  const id = `tab-${tabCounter}`;
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.id = `tab-btn-${id}`;
  tabEl.innerHTML = `<span class="tab-title">🕐 Histórico</span><span class="tab-close" data-id="${id}">✕</span>`;

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) closeTab(id);
    else switchTab(id);
  });
  tabsListEl.appendChild(tabEl);

  const iframe = document.createElement('iframe');
  iframe.id = `wv-${id}`;
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:none;background:var(--bg-dark);';
  viewsContainerEl.appendChild(iframe);

  const tabData = { id, tabEl, webview: iframe, url: 'vortex://historico', title: '🕐 Histórico', isHistory: true };
  tabs.push(tabData);
  switchTab(id);
  homeViewEl.style.display = 'none';
  iframe.style.display = 'block';
  addressInputEl.value = 'vortex://historico';
  updateSecurityBadge('vortex://historico');

  // Renderiza a página de histórico dentro do iframe
  renderHistoryPage(iframe);
}

function renderHistoryPage(iframe) {
  const isLight = document.body.classList.contains('theme-light');
  const bg = isLight ? '#f6f8fa' : '#0a0d14';
  const text = isLight ? '#1f2328' : '#c9d1d9';
  const titleColor = isLight ? '#1f2328' : '#e6edf3';
  const cardBg = isLight ? '#ffffff' : '#161b22';
  const border = isLight ? 'rgba(0,0,0,0.12)' : '#30363d';
  const hoverBg = isLight ? '#eef2f6' : '#161b22';
  const delHover = isLight ? '#e2e8f0' : '#21262d';
  const btnBg = isLight ? '#f1f5f9' : '#21262d';

  const grouped = {};
  browsingHistory.forEach(entry => {
    const date = new Date(entry.time).toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(entry);
  });

  let rows = '';
  for (const [date, entries] of Object.entries(grouped)) {
    rows += `<div class="h-date-group"><h3>${date}</h3>`;
    entries.forEach((e, i) => {
      const t = new Date(e.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      rows += `
        <div class="h-entry" onclick="parent.postMessage({type:'navigate',url:'${e.url}'},'*')">
          <span class="h-time">${t}</span>
          <div class="h-info">
            <div class="h-title">${e.title || e.url}</div>
            <div class="h-url">${e.url}</div>
          </div>
          <button class="h-del" onclick="event.stopPropagation();parent.postMessage({type:'delete-history',index:${browsingHistory.indexOf(e)}},'*')">✕</button>
        </div>`;
    });
    rows += '</div>';
  }

  if (!rows) rows = `<div class="h-empty"><div style="font-size:48px">🕐</div><p>Nenhuma página visitada ainda.</p></div>`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Segoe UI',sans-serif;background:${bg};color:${text};padding:32px;}
    h2{font-size:22px;font-weight:700;margin-bottom:24px;color:${titleColor};}
    .search-bar{width:100%;padding:10px 16px;background:${cardBg};border:1px solid ${border};border-radius:8px;color:${text};font-size:14px;margin-bottom:24px;outline:none;}
    .search-bar:focus{border-color:#38bdf8;}
    .h-date-group{margin-bottom:20px;}
    h3{font-size:13px;font-weight:600;color:${isLight ? '#64748b' : '#8b949e'};margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em;}
    .h-entry{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;cursor:pointer;transition:background 0.15s;border:1px solid transparent;}
    .h-entry:hover{background:${hoverBg};border-color:${border};}
    .h-time{font-size:12px;color:${isLight ? '#64748b' : '#8b949e'};min-width:40px;}
    .h-info{flex:1;overflow:hidden;}
    .h-title{font-size:13px;color:${titleColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .h-url{font-size:11px;color:${isLight ? '#64748b' : '#8b949e'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .h-del{background:none;border:none;color:${isLight ? '#64748b' : '#8b949e'};cursor:pointer;padding:4px 8px;border-radius:4px;font-size:14px;}
    .h-del:hover{color:#ef4444;background:${delHover};}
    .h-empty{text-align:center;padding:80px;color:${isLight ? '#64748b' : '#8b949e'};}
    .btn-clear-all{padding:8px 18px;background:${btnBg};border:1px solid ${border};color:${text};border-radius:8px;cursor:pointer;font-size:13px;margin-bottom:20px;}
    .btn-clear-all:hover{background:#ef4444;border-color:#ef4444;color:#fff;}
  </style></head><body>
    <h2>🕐 Histórico de Navegação</h2>
    <input class="search-bar" id="hSearch" placeholder="Pesquisar no histórico..." oninput="filterHistory(this.value)">
    <button class="btn-clear-all" onclick="parent.postMessage({type:'open-chrome-clear-modal'},'*')">🗑️ Excluir dados de navegação...</button>
    <div id="hContent">${rows}</div>
    <script>
    function filterHistory(q){
      const entries = document.querySelectorAll('.h-entry');
      entries.forEach(el=>{
        const txt = el.innerText.toLowerCase();
        el.style.display = txt.includes(q.toLowerCase()) ? 'flex' : 'none';
      });
    }
    <\/script>
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  iframe.src = blobUrl;
}

// ══════════════════════════════════════════
// ABA DE FAVORITOS
// ══════════════════════════════════════════
function openBookmarksTab() {
  const existing = tabs.find(t => t.isBookmarks);
  if (existing) { switchTab(existing.id); return; }

  tabCounter++;
  const id = `tab-${tabCounter}`;
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.id = `tab-btn-${id}`;
  tabEl.innerHTML = `<span class="tab-title">⭐ Favoritos</span><span class="tab-close" data-id="${id}">✕</span>`;

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) closeTab(id);
    else switchTab(id);
  });
  tabsListEl.appendChild(tabEl);

  const iframe = document.createElement('iframe');
  iframe.id = `wv-${id}`;
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:none;background:var(--bg-dark);';
  viewsContainerEl.appendChild(iframe);

  const tabData = { id, tabEl, webview: iframe, url: 'vortex://favoritos', title: '⭐ Favoritos', isBookmarks: true };
  tabs.push(tabData);
  switchTab(id);
  homeViewEl.style.display = 'none';
  iframe.style.display = 'block';
  addressInputEl.value = 'vortex://favoritos';
  updateSecurityBadge('vortex://favoritos');

  renderBookmarksPage(iframe);
}

function renderBookmarksPage(iframe) {
  const isLight = document.body.classList.contains('theme-light');
  const bg = isLight ? '#f6f8fa' : '#0a0d14';
  const text = isLight ? '#1f2328' : '#c9d1d9';
  const titleColor = isLight ? '#1f2328' : '#e6edf3';
  const cardBg = isLight ? '#ffffff' : '#161b22';
  const border = isLight ? 'rgba(0,0,0,0.12)' : '#30363d';
  const hoverBg = isLight ? '#eef2f6' : '#161b22';
  const delHover = isLight ? '#e2e8f0' : '#21262d';

  const allBookmarks = bookmarks.length > 0 ? bookmarks : [
    { url: 'https://github.com', title: 'GitHub', icon: '🐙' },
    { url: 'https://duckduckgo.com', title: 'DuckDuckGo', icon: '🦆' },
    { url: 'https://news.ycombinator.com', title: 'Hacker News', icon: '⚡' },
    { url: 'https://developer.mozilla.org', title: 'MDN Web Docs', icon: '🌐' },
    { url: 'https://google.com', title: 'Google', icon: '🔍' }
  ];

  let rows = allBookmarks.map((b, i) => `
    <div class="bm-entry" onclick="parent.postMessage({type:'navigate',url:'${b.url}'},'*')">
      <span class="bm-icon">${b.icon || '🔖'}</span>
      <div class="bm-info">
        <div class="bm-title">${b.title}</div>
        <div class="bm-url">${b.url}</div>
      </div>
      <button class="bm-del" onclick="event.stopPropagation();parent.postMessage({type:'delete-bookmark',index:${i}},'*')">🗑️</button>
    </div>`).join('');

  if (!rows) rows = `<div class="bm-empty"><div style="font-size:48px">⭐</div><p>Nenhum favorito salvo ainda.<br>Use Ctrl+D para adicionar páginas.</p></div>`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Segoe UI',sans-serif;background:${bg};color:${text};padding:32px;}
    h2{font-size:22px;font-weight:700;margin-bottom:24px;color:${titleColor};}
    .bm-entry{display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:8px;cursor:pointer;transition:background 0.15s;margin-bottom:4px;border:1px solid transparent;}
    .bm-entry:hover{background:${hoverBg};border-color:${border};}
    .bm-icon{font-size:20px;min-width:28px;}
    .bm-info{flex:1;overflow:hidden;}
    .bm-title{font-size:14px;color:${titleColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .bm-url{font-size:12px;color:${isLight ? '#64748b' : '#8b949e'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .bm-del{background:none;border:none;color:${isLight ? '#64748b' : '#8b949e'};cursor:pointer;padding:6px;border-radius:6px;font-size:14px;}
    .bm-del:hover{color:#ef4444;background:${delHover};}
    .bm-empty{text-align:center;padding:80px;color:${isLight ? '#64748b' : '#8b949e'};}
    .search-bar{width:100%;padding:10px 16px;background:${cardBg};border:1px solid ${border};border-radius:8px;color:${text};font-size:14px;margin-bottom:24px;outline:none;}
    .search-bar:focus{border-color:#38bdf8;}
  </style></head><body>
    <h2>⭐ Favoritos</h2>
    <input class="search-bar" placeholder="Pesquisar favoritos..." oninput="this.nextElementSibling.querySelectorAll('.bm-entry').forEach(el=>el.style.display=el.innerText.toLowerCase().includes(this.value.toLowerCase())?'flex':'none')">
    <div id="bmContent">${rows}</div>
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  iframe.src = URL.createObjectURL(blob);
}

// ── Receber mensagens dos iframes internos ─
window.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || !data.type) return;

  if (data.type === 'navigate' && data.url) {
    createTab(data.url);
  }
  if (data.type === 'open-history-tab') {
    openHistoryTab();
  }
  if (data.type === 'clear-history') {
    browsingHistory = [];
    localStorage.removeItem('vortex-history');
    const histTab = tabs.find(t => t.isHistory);
    if (histTab && histTab.webview) renderHistoryPage(histTab.webview);
    showToastNotification('🗑️', 'Histórico limpo', 'Todo o histórico de navegação foi removido.');
  }
  if (data.type === 'delete-history' && data.index !== undefined) {
    browsingHistory.splice(data.index, 1);
    localStorage.setItem('vortex-history', JSON.stringify(browsingHistory));
    const histTab = tabs.find(t => t.isHistory);
    if (histTab && histTab.webview) renderHistoryPage(histTab.webview);
  }
  if (data.type === 'delete-bookmark' && data.index !== undefined) {
    bookmarks.splice(data.index, 1);
    localStorage.setItem('vortex-bookmarks', JSON.stringify(bookmarks));
    renderBookmarksBar();
    const bmTab = tabs.find(t => t.isBookmarks);
    if (bmTab && bmTab.webview) renderBookmarksPage(bmTab.webview);
    showToastNotification('🗑️', 'Favorito removido', '');
  }
  if (data.type === 'settings-updated') {
    // Aplica configurações imediatamente
    if (data.settings) applySettingsFromData(data.settings);
  }
  if (data.type === 'navigate-section' && data.section) {
    const settingsTab = tabs.find(t => t.isSettings);
    if (settingsTab && settingsTab.webview) {
      try { settingsTab.webview.contentWindow.switchSection(data.section); } catch (er) {}
    }
  }
  if (data.type === 'get-downloads-path-request') {
    if (window.vortexAPI?.getDownloadsPath) {
      window.vortexAPI.getDownloadsPath().then(p => {
        try {
          const settingsTab = tabs.find(t => t.isSettings && t.webview);
          if (settingsTab && settingsTab.webview && settingsTab.webview.contentWindow) {
            settingsTab.webview.contentWindow.postMessage({ type: 'downloads-path-response', path: p }, '*');
          }
        } catch(e) {}
      });
    }
  }
  if (data.type === 'get-downloads-list-request') {
    notifySettingsDownloadsUpdated();
  }
  if (data.type === 'get-app-version-request') {
    if (window.vortexAPI?.getAppVersion) {
      window.vortexAPI.getAppVersion().then(v => {
        try {
          const settingsTab = tabs.find(t => t.url && t.url.includes('settings.html'));
          if (settingsTab && settingsTab.webview && settingsTab.webview.contentWindow) {
            settingsTab.webview.contentWindow.postMessage({ type: 'app-version-response', version: v }, '*');
          }
        } catch(e) {}
      });
    }
  }
  if (data.type === 'trigger-check-updates') {
    if (window.vortexAPI?.checkForUpdates) {
      window.vortexAPI.checkForUpdates().then(res => {
        try {
          const settingsTab = tabs.find(t => t.url && t.url.includes('settings.html'));
          if (settingsTab && settingsTab.webview && settingsTab.webview.contentWindow) {
            settingsTab.webview.contentWindow.postMessage({ type: 'check-updates-response', result: res }, '*');
          }
        } catch(e) {}
      });
    }
  }
  if (data.type === 'trigger-download-update') {
    if (window.vortexAPI?.downloadUpdate) window.vortexAPI.downloadUpdate();
  }
  if (data.type === 'trigger-install-update') {
    if (window.vortexAPI?.installUpdate) window.vortexAPI.installUpdate();
  }
  if (data.type === 'open-download-file' && data.path) {
    if (window.vortexAPI?.openPath) window.vortexAPI.openPath(data.path);
  }
  if (data.type === 'show-download-in-folder' && data.path) {
    if (window.vortexAPI?.showItemInFolder) window.vortexAPI.showItemInFolder(data.path);
  }
  if (data.type === 'open-downloads-folder') {
    if (window.vortexAPI?.showItemInFolder) window.vortexAPI.showItemInFolder('');
  }
  if (data.type === 'clear-downloads-history-request') {
    localStorage.removeItem('vortex-downloads');
    notifySettingsDownloadsUpdated([]);
    showToastNotification('🗑️', 'Downloads limpos', 'O histórico de arquivos baixados foi removido.');
  }
  if (data.type === 'clear-browsing-data-request') {
    openChromeClearModal();
  }
  if (data.type === 'open-chrome-clear-modal') {
    openChromeClearModal();
  }
  if (data.type === 'get-current-page-url-request') {
    const cur = getActiveTab();
    let curUrl = '';
    if (cur && cur.url && !cur.url.startsWith('vortex://') && !cur.url.startsWith('about:')) {
      curUrl = cur.url;
    }
    const settingsTab = tabs.find(t => t.isSettings && t.webview);
    if (settingsTab && settingsTab.webview && settingsTab.webview.contentWindow) {
      settingsTab.webview.contentWindow.postMessage({ type: 'current-page-url-response', url: curUrl }, '*');
    }
  }
});

function applySettingsFromData(s) {
  if (s.searchEngine) {
    searchEngine = s.searchEngine;
    const homeInput = document.getElementById('homeSearchInput');
    if (homeInput) {
      const names = {
        duckduckgo: 'DuckDuckGo sem rastreamento',
        google: 'Google',
        bing: 'Bing',
        brave: 'Brave Search',
        startpage: 'Startpage (privacidade)',
        ecosia: 'Ecosia'
      };
      homeInput.placeholder = `Buscar com ${names[searchEngine] || 'DuckDuckGo'}...`;
    }
  }
  // Tema no documento principal
  if (s.theme === 'light') document.body.classList.add('theme-light');
  else document.body.classList.remove('theme-light');
  if (s.highContrast) document.body.classList.add('high-contrast');
  else document.body.classList.remove('high-contrast');

  // Tamanho de fonte e animações
  document.body.classList.remove('font-small', 'font-medium', 'font-large', 'font-xlarge');
  if (s.fontSize) document.body.classList.add(`font-${s.fontSize}`);
  if (s.animations === false) document.body.classList.add('no-animations');
  else document.body.classList.remove('no-animations');

  // AdBlock no processo principal
  if (s.adblock !== undefined && window.vortexAPI?.setAdblockEnabled) {
    window.vortexAPI.setAdblockEnabled(s.adblock !== false);
  }

  // Repassa tema para o iframe de configurações (se aberto)
  try {
    const settingsTab = tabs.find(t => t.isSettings && t.webview);
    if (settingsTab && settingsTab.webview && settingsTab.webview.contentWindow) {
      settingsTab.webview.contentWindow.postMessage({ type: 'settings-updated', settings: s }, '*');
    }
  } catch(e) {}
  // Re-renderiza páginas internas abertas (histórico e favoritos) com o novo tema
  try {
    const histTab = tabs.find(t => t.isHistory && t.webview);
    if (histTab && histTab.webview) renderHistoryPage(histTab.webview);
    const bmTab = tabs.find(t => t.isBookmarks && t.webview);
    if (bmTab && bmTab.webview) renderBookmarksPage(bmTab.webview);
  } catch(e) {}
  // Barra de favoritos
  const bar = document.getElementById('bookmarksBar');
  if (bar) bar.style.display = s.showBookmarksBar ? 'flex' : 'none';
  // Botão home
  const homeBtn = document.getElementById('btnHome');
  if (homeBtn) homeBtn.style.display = s.showHomeBtn === false ? 'none' : '';
  // Zoom padrão
  if (s.defaultZoom) {
    const z = parseInt(s.defaultZoom, 10);
    if (!isNaN(z)) {
      currentZoom = z;
      const zv = document.getElementById('dm-zoom-value');
      if (zv) zv.innerText = z + '%';
      const cur = getActiveTab();
      if (cur && cur.webview && typeof cur.webview.setZoomFactor === 'function') {
        cur.webview.setZoomFactor(z / 100);
      }
    }
  }
}

// ══════════════════════════════════════════
// MENU DE CONTEXTO (Botão Direito)
// ══════════════════════════════════════════
const contextMenu = document.getElementById('contextMenu');

async function showContextMenuAt(clientX, clientY) {
  closeAllMenus();
  
  // Usa diretamente as coordenadas do ponteiro fornecidas pelo evento para exibição imediata e fluida (0ms de latência)
  let posX = clientX;
  let posY = clientY;

  // Se por ventura clientX/clientY não vierem definidos, consulta de forma assíncrona
  if (typeof posX !== 'number' || typeof posY !== 'number' || isNaN(posX) || isNaN(posY)) {
    if (window.vortexAPI && typeof window.vortexAPI.getCursorPointAsync === 'function') {
      try {
        const pt = await window.vortexAPI.getCursorPointAsync();
        if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
          posX = pt.x;
          posY = pt.y;
        }
      } catch (e) {}
    }
  }

  // Fallback seguro de centro de tela
  if (typeof posX !== 'number' || isNaN(posX)) posX = window.innerWidth / 2;
  if (typeof posY !== 'number' || isNaN(posY)) posY = window.innerHeight / 2;

  // Ajuste milimétrico estilo Google Chrome (abre imediatamente no vértice do cursor)
  let x = Math.round(posX);
  let y = Math.round(posY);

  // Dimensões do menu de contexto
  const menuW = 230;
  const menuH = 320;

  // Evitar sair da tela na direita ou no fundo
  if (x + menuW > window.innerWidth - 6) {
    x = Math.max(6, x - menuW);
  }
  if (y + menuH > window.innerHeight - 6) {
    y = Math.max(6, y - menuH);
  }

  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.add('open');
  if (contextMenuBackdrop) contextMenuBackdrop.classList.add('open');
}

contextMenuBackdrop?.addEventListener('mousedown', (e) => {
  e.preventDefault();
  closeAllMenus();
});

contextMenuBackdrop?.addEventListener('click', (e) => {
  e.preventDefault();
  closeAllMenus();
});

// Fecha ao clicar fora em qualquer lugar da janela ou perder foco
window.addEventListener('blur', () => {
  closeAllMenus();
});

viewsContainerEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  let clickX = e.clientX;
  let clickY = e.clientY;
  if (window.vortexAPI && typeof window.vortexAPI.getCursorPoint === 'function') {
    try {
      const pt = window.vortexAPI.getCursorPoint();
      if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
        clickX = pt.x;
        clickY = pt.y;
      }
    } catch (err) {}
  }
  showContextMenuAt(clickX, clickY);
});

document.getElementById('ctx-back')?.addEventListener('click', () => {
  closeAllMenus();
  const cur = getActiveTab();
  if (cur && cur.webview && cur.webview.canGoBack && cur.webview.canGoBack()) cur.webview.goBack();
});

document.getElementById('ctx-forward')?.addEventListener('click', () => {
  closeAllMenus();
  const cur = getActiveTab();
  if (cur && cur.webview && cur.webview.canGoForward && cur.webview.canGoForward()) cur.webview.goForward();
});

document.getElementById('ctx-reload')?.addEventListener('click', () => {
  closeAllMenus();
  const cur = getActiveTab();
  if (cur && cur.webview && typeof cur.webview.reload === 'function') cur.webview.reload();
});

document.getElementById('ctx-new-tab')?.addEventListener('click', () => {
  closeAllMenus();
  createTab();
});

document.getElementById('ctx-incognito')?.addEventListener('click', () => {
  closeAllMenus();
  openIncognitoTab();
});

document.getElementById('ctx-save')?.addEventListener('click', () => {
  closeAllMenus();
  const cur = getActiveTab();
  if (cur && cur.webview && typeof cur.webview.downloadURL === 'function') {
    cur.webview.downloadURL(cur.url);
  } else if (cur && cur.url) {
    const a = document.createElement('a');
    a.href = cur.url;
    a.download = '';
    a.click();
  }
});

document.getElementById('ctx-print')?.addEventListener('click', () => {
  closeAllMenus();
  const cur = getActiveTab();
  if (cur && cur.webview && typeof cur.webview.print === 'function') cur.webview.print();
  else window.print();
});

document.getElementById('ctx-view-source')?.addEventListener('click', () => {
  closeAllMenus();
  const cur = getActiveTab();
  if (cur && cur.url && !cur.url.startsWith('view-source:')) {
    createTab('view-source:' + cur.url);
  }
});

document.getElementById('ctx-inspect')?.addEventListener('click', () => {
  closeAllMenus();
  const cur = getActiveTab();
  if (cur && cur.webview) {
    // Abrir DevTools nativo e inspecionar elemento na posição do clique (igual ao Chrome)
    if (lastContextMenuTarget && typeof lastContextMenuTarget.x === 'number') {
      openDockedDevTools(cur.webview, lastContextMenuTarget.x, lastContextMenuTarget.y);
    } else {
      openDockedDevTools(cur.webview);
    }
  }
});

document.getElementById('ctx-find')?.addEventListener('click', () => {
  closeAllMenus();
  openFindBar();
});

document.getElementById('ctx-bookmark')?.addEventListener('click', () => {
  closeAllMenus();
  addCurrentPageToBookmarks();
});

// ══════════════════════════════════════════
// BOOKMARK STAR POPUP
// ══════════════════════════════════════════
const bookmarkPopupEl   = document.getElementById('bookmarkPopup');
const bookmarkStarBtn   = document.getElementById('btnBookmarkStar');
const bookmarkNameInput = document.getElementById('bookmarkNameInput');
const bookmarkUrlInput  = document.getElementById('bookmarkUrlInput');
const bookmarkFolder    = document.getElementById('bookmarkFolder');
const bookmarkPopupTitle = document.getElementById('bookmarkPopupTitle');

function openBookmarkPopup() {
  const cur = getActiveTab();
  const url = (cur && cur.url) ? cur.url : '';
  const title = (cur && cur.title) ? cur.title : url;
  const existing = bookmarks.find(b => b.url === url);

  if (bookmarkNameInput) bookmarkNameInput.value = existing ? existing.title : title;
  if (bookmarkUrlInput)  bookmarkUrlInput.value  = url;
  if (bookmarkFolder)    bookmarkFolder.value     = (existing && existing.folder) ? existing.folder : 'bar';
  if (bookmarkPopupTitle) bookmarkPopupTitle.textContent = existing ? 'Favorito editado' : 'Favorito adicionado';

  // Show remove button only if already bookmarked
  const removeBtn = document.getElementById('bookmarkRemoveBtn');
  if (removeBtn) removeBtn.style.display = existing ? 'inline-block' : 'none';

  if (bookmarkPopupEl) bookmarkPopupEl.classList.add('open');
}

function closeBookmarkPopup() {
  if (bookmarkPopupEl) bookmarkPopupEl.classList.remove('open');
}

bookmarkPopupEl?.addEventListener('click', (e) => e.stopPropagation());

// Star button click — open popup
bookmarkStarBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = bookmarkPopupEl && bookmarkPopupEl.classList.contains('open');
  closeAllPopups();
  if (!isOpen) {
    openBookmarkPopup();
  }
});

// Close X on popup
document.getElementById('bookmarkPopupClose')?.addEventListener('click', closeBookmarkPopup);

// Save / Concluído
document.getElementById('bookmarkSaveBtn')?.addEventListener('click', () => {
  const url   = bookmarkUrlInput  ? bookmarkUrlInput.value.trim()  : '';
  const name  = bookmarkNameInput ? bookmarkNameInput.value.trim() : url;
  const folder = bookmarkFolder   ? bookmarkFolder.value           : 'bar';
  if (!url) { closeBookmarkPopup(); return; }

  // Remove existing entry for this URL, then re-add updated
  bookmarks = bookmarks.filter(b => b.url !== url);
  bookmarks.push({ url, title: name || url, icon: '⭐', folder });
  localStorage.setItem('vortex-bookmarks', JSON.stringify(bookmarks));
  renderBookmarksBar();
  updateStarState(url);
  closeBookmarkPopup();
  showToastNotification('⭐', 'Favorito salvo', name || url);
});

// Remover favorito
document.getElementById('bookmarkRemoveBtn')?.addEventListener('click', () => {
  const url = bookmarkUrlInput ? bookmarkUrlInput.value.trim() : '';
  bookmarks = bookmarks.filter(b => b.url !== url);
  localStorage.setItem('vortex-bookmarks', JSON.stringify(bookmarks));
  renderBookmarksBar();
  updateStarState(url);
  closeBookmarkPopup();
  showToastNotification('🗑️', 'Favorito removido', url);
});

// ── Toggle Barra de Favoritos ─────────────
document.getElementById('btnToggleBookmarksBar')?.addEventListener('click', () => {
  const bar = document.getElementById('bookmarksBar');
  if (!bar) return;
  const isVisible = bar.style.display === 'flex';
  bar.style.display = isVisible ? 'none' : 'flex';
  // Persist preference
  try {
    const s = JSON.parse(localStorage.getItem('vortex-settings') || '{}');
    s.showBookmarksBar = !isVisible;
    localStorage.setItem('vortex-settings', JSON.stringify(s));
  } catch (e) {}
});

// Close popup when clicking outside
document.addEventListener('click', (e) => {
  if (bookmarkPopupEl && bookmarkPopupEl.classList.contains('open')) {
    if (!bookmarkPopupEl.contains(e.target) && e.target !== bookmarkStarBtn) {
      closeBookmarkPopup();
    }
  }
});

// ══════════════════════════════════════════
// GERENCIADOR DE SENHAS & COFRE VORTEX
// ══════════════════════════════════════════
const passwordSavePopupEl = document.getElementById('passwordSavePopup');
const passwordPopupCloseBtn = document.getElementById('passwordPopupClose');
const passwordPopupDomainEl = document.getElementById('passwordPopupDomain');
const passwordUsernameInputEl = document.getElementById('passwordUsernameInput');
const passwordPasswordInputEl = document.getElementById('passwordPasswordInput');
const passwordSaveConfirmBtnEl = document.getElementById('passwordSaveConfirmBtn');
const passwordCancelBtnEl = document.getElementById('passwordCancelBtn');
const passwordNeverBtnEl = document.getElementById('passwordNeverBtn');
const btnTogglePopupPasswordEl = document.getElementById('btnTogglePopupPassword');
const btnVaultPasswordsEl = document.getElementById('btnVaultPasswords');

let pendingPasswordSave = null;
const neverSaveDomains = new Set(JSON.parse(localStorage.getItem('vortex-never-save-domains') || '[]'));

function promptSavePassword(url, username, password) {
  try {
    const s = JSON.parse(localStorage.getItem('vortex-settings') || '{}');
    if (s.offerSavePasswords === false) return;
    const domain = new URL(url).hostname;
    if (neverSaveDomains.has(domain)) return;

    pendingPasswordSave = { url, domain, username, password };
    if (passwordPopupDomainEl) passwordPopupDomainEl.innerText = domain;
    if (passwordUsernameInputEl) passwordUsernameInputEl.value = username || '';
    if (passwordPasswordInputEl) passwordPasswordInputEl.value = password || '';
    if (passwordSavePopupEl) passwordSavePopupEl.classList.add('open');
  } catch(e) {}
}

function closePasswordPopup() {
  if (passwordSavePopupEl) passwordSavePopupEl.classList.remove('open');
  pendingPasswordSave = null;
}

passwordPopupCloseBtn?.addEventListener('click', closePasswordPopup);
passwordCancelBtnEl?.addEventListener('click', closePasswordPopup);

passwordNeverBtnEl?.addEventListener('click', () => {
  if (pendingPasswordSave && pendingPasswordSave.domain) {
    neverSaveDomains.add(pendingPasswordSave.domain);
    localStorage.setItem('vortex-never-save-domains', JSON.stringify(Array.from(neverSaveDomains)));
    showToastNotification('ℹ️', 'Preferência salva', `Senhas não serão sugeridas para ${pendingPasswordSave.domain}`);
  }
  closePasswordPopup();
});

btnTogglePopupPasswordEl?.addEventListener('click', () => {
  if (passwordPasswordInputEl) {
    passwordPasswordInputEl.type = passwordPasswordInputEl.type === 'password' ? 'text' : 'password';
  }
});

passwordSaveConfirmBtnEl?.addEventListener('click', async () => {
  if (!pendingPasswordSave) { closePasswordPopup(); return; }
  const username = passwordUsernameInputEl ? passwordUsernameInputEl.value.trim() : pendingPasswordSave.username;
  const password = passwordPasswordInputEl ? passwordPasswordInputEl.value : pendingPasswordSave.password;

  if (window.vortexAPI && window.vortexAPI.savePassword) {
    await window.vortexAPI.savePassword({
      url: pendingPasswordSave.url,
      domain: pendingPasswordSave.domain,
      username,
      password
    });
    showToastNotification('🔑', 'Senha salva no Vortex', `Login salvo para ${pendingPasswordSave.domain}`);
  }
  closePasswordPopup();
});

// Botão de acesso rápido ao cofre de senhas
btnVaultPasswordsEl?.addEventListener('click', () => {
  openSettings('passwords');
});

document.getElementById('dm-passwords')?.addEventListener('click', () => {
  closeAllMenus();
  openSettings('passwords');
});

// Tratar solicitações de senhas vindas do iframe de configurações
window.addEventListener('message', async (event) => {
  if (!event.data) return;
  const t = event.data.type;
  if (t === 'get-passwords-request' && window.vortexAPI?.getSavedPasswords) {
    const list = await window.vortexAPI.getSavedPasswords();
    event.source?.postMessage({ type: 'passwords-response', passwords: list }, '*');
  } else if (t === 'delete-password-request' && window.vortexAPI?.deletePassword) {
    const res = await window.vortexAPI.deletePassword(event.data.id);
    event.source?.postMessage({ type: 'passwords-response', passwords: res.passwords }, '*');
  } else if (t === 'get-sync-profile-request' && window.vortexAPI?.getUserProfile) {
    const prof = await window.vortexAPI.getUserProfile();
    event.source?.postMessage({ type: 'sync-profile-response', profile: prof }, '*');
  } else if (t === 'save-sync-profile-request' && window.vortexAPI?.saveUserProfile) {
    const res = await window.vortexAPI.saveUserProfile(event.data.profile);
    event.source?.postMessage({ type: 'sync-profile-response', profile: res.profile }, '*');
    showToastNotification('☁️', 'Perfil sincronizado', `Conectado com ${res.profile.email}`);
  } else if (t === 'export-vault-request' && window.vortexAPI?.exportVault) {
    const jsonStr = await window.vortexAPI.exportVault();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = `vortex-backup-senhas-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(u);
  } else if (t === 'import-vault-request' && window.vortexAPI?.importVault) {
    const res = await window.vortexAPI.importVault(event.data.data);
    if (res && res.success) {
      showToastNotification('✅', 'Cofre importado', `${res.count} senhas sincronizadas com sucesso.`);
      if (window.vortexAPI.getSavedPasswords) {
        const list = await window.vortexAPI.getSavedPasswords();
        event.source?.postMessage({ type: 'passwords-response', passwords: list }, '*');
      }
    }
  } else if (t === 'open-url' && event.data.url) {
    createTab(event.data.url);
  }
});

// ── Inicia com a primeira aba ou sessão personalizada ─────────────
(function initStartupSession() {
  try {
    const s = JSON.parse(localStorage.getItem('vortex-settings') || '{}');
    if (s.startup === 'lastSession') {
      const savedUrls = JSON.parse(localStorage.getItem('vortex-last-session-urls') || '[]');
      if (savedUrls && Array.isArray(savedUrls) && savedUrls.length > 0) {
        // Filtra URLs válidas para restaurar
        const validUrls = savedUrls.filter(u => typeof u === 'string' && u.trim().length > 0 && !u.startsWith('about:blank'));
        if (validUrls.length > 0) {
          validUrls.forEach(url => createTab(url));
          return;
        }
      }
    } else if (s.startup === 'customUrl' && s.homePage && s.homePage.trim()) {
      let hp = s.homePage.trim();
      if (!hp.includes('://') && !hp.startsWith('about:') && !hp.startsWith('data:')) {
        hp = 'https://' + hp;
      }
      createTab(hp);
      return;
    } else if (s.homePage && s.homePage.trim() && s.startup !== 'newtab' && s.startup !== 'home' && s.startup !== 'lastSession') {
      let hp = s.homePage.trim();
      if (!hp.includes('://') && !hp.startsWith('about:') && !hp.startsWith('data:')) {
        hp = 'https://' + hp;
      }
      createTab(hp);
      return;
    }
  } catch(e) {}
  createTab();
})();

// Salva periodicamente as URLs abertas para 'lastSession'
function persistSessionUrls() {
  try {
    const s = JSON.parse(localStorage.getItem('vortex-settings') || '{}');
    if (s.startup === 'lastSession') {
      const urls = tabs
        .filter(t => t.url && !t.url.startsWith('vortex://') && !t.url.startsWith('about:') && !t.isIncognito)
        .map(t => t.url);
      localStorage.setItem('vortex-last-session-urls', JSON.stringify(urls));
    }
  } catch(e) {}
}

window.addEventListener('beforeunload', persistSessionUrls);
setInterval(persistSessionUrls, 10000);



// ═══════════════════════════════════════════════════════
// EXTENSIONS POPUP & PROFILE POPUP (Chrome-like)
// ═══════════════════════════════════════════════════════

// ── Extensions Popup ────────────────────────────────
const extensionsPopupEl = document.getElementById('extensionsPopup');
const btnExtensionsEl = document.getElementById('btnExtensions');
const extPopupPinnedEl = document.getElementById('extPopupPinned');
const extPopupOthersEl = document.getElementById('extPopupOthers');
const extPopupDividerOtherEl = document.getElementById('extPopupDividerOther');

function getExtensions() {
  try { return JSON.parse(localStorage.getItem('vortex-extensions') || '[]'); } catch(e) { return []; }
}

function renderExtensionsPopup() {
  const exts = getExtensions();
  const pinned = exts.filter(e => e.pinned === true);
  const others = exts.filter(e => e.pinned !== true);

  function makeItem(ext) {
    const div = document.createElement('div');
    div.className = 'ext-popup-item';
    div.innerHTML = `
      <div class="ext-popup-icon">${ext.icon || '🧩'}</div>
      <span class="ext-popup-name">${ext.name}</span>
      <div class="ext-popup-toggle-track ${ext.enabled !== false ? 'on' : ''}" data-toggle="${ext.id}">
        <div class="ext-popup-toggle-thumb"></div>
      </div>`;
    div.querySelector('.ext-popup-toggle-track').addEventListener('click', (ev) => {
      ev.stopPropagation();
      let list = getExtensions();
      const idx = list.findIndex(e => e.id === ext.id);
      if (idx >= 0) { list[idx].enabled = !list[idx].enabled; localStorage.setItem('vortex-extensions', JSON.stringify(list)); renderExtensionsPopup(); }
    });
    return div;
  }

  if (pinned.length === 0 && others.length === 0) {
    extPopupPinnedEl.innerHTML = '<div class="ext-popup-empty">Nenhuma extensão instalada.<br>Use <strong>Gerenciar</strong> para adicionar.</div>';
    extPopupOthersEl.innerHTML = '';
    extPopupDividerOtherEl.style.display = 'none';
  } else {
    extPopupPinnedEl.innerHTML = '';
    if (pinned.length > 0) {
      const label = document.createElement('div');
      label.className = 'ext-popup-section-label';
      label.textContent = 'Fixadas';
      extPopupPinnedEl.appendChild(label);
      pinned.forEach(e => extPopupPinnedEl.appendChild(makeItem(e)));
    }

    extPopupOthersEl.innerHTML = '';
    if (others.length > 0) {
      if (pinned.length > 0) { extPopupDividerOtherEl?.classList.remove('hidden'); }
      const label = document.createElement('div');
      label.className = 'ext-popup-section-label';
      label.textContent = 'Outras extensões';
      extPopupOthersEl.appendChild(label);
      others.forEach(e => extPopupOthersEl.appendChild(makeItem(e)));
    } else {
      extPopupDividerOtherEl?.classList.add('hidden');
    }
  }

  // Update badge count
  if (btnExtensionsEl) {
    let badge = btnExtensionsEl.querySelector('.ext-count-badge');
    if (exts.length > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'ext-count-badge'; btnExtensionsEl.appendChild(badge); }
      badge.textContent = exts.length;
    } else if (badge) { badge.remove(); }
  }
}

if (btnExtensionsEl) {
  btnExtensionsEl.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const isOpen = extensionsPopupEl.classList.contains('open');
    closeAllPopups();
    if (!isOpen) {
      renderExtensionsPopup();
      extensionsPopupEl.classList.add('open');
    }
  });
}

const btnManageExtensionsEl = document.getElementById('btnManageExtensions');
if (btnManageExtensionsEl) {
  btnManageExtensionsEl.addEventListener('click', () => {
    extensionsPopupEl.classList.remove('open');
    openExtensionsTab('store');
  });
}

const extPopupOpenPageEl = document.getElementById('extPopupOpenPage');
if (extPopupOpenPageEl) {
  extPopupOpenPageEl.addEventListener('click', (ev) => {
    ev.preventDefault();
    extensionsPopupEl.classList.remove('open');
    openExtensionsTab('installed');
  });
}

// Previne fechar o popup ao clicar em seu conteúdo interno
extensionsPopupEl?.addEventListener('click', (e) => e.stopPropagation());

// ── Profile Popup ──────────────────────────────────
const profilePopupEl = document.getElementById('profilePopup');
const btnProfileMenuEl = document.getElementById('btnProfileMenu');
const profilePopupAvatarEl = document.getElementById('profilePopupAvatar');
const profilePopupNameEl = document.getElementById('profilePopupName');
const profilePopupEmailEl = document.getElementById('profilePopupEmail');

function updateProfileButton() {
  try {
    const p = JSON.parse(localStorage.getItem('vortex-profile-cache') || '{}');
    const avatarUrl = p.photoUrl || p.avatarUrl || null;

    if (btnProfileMenuEl) {
      if (p.email) {
        btnProfileMenuEl.classList.add('has-profile');
        if (avatarUrl) {
          btnProfileMenuEl.innerHTML = `<img src="${avatarUrl}" class="profile-avatar-img" alt="Avatar" onerror="this.onerror=null;this.parentElement.innerHTML='<span class=\\'profile-initial\\'>${(p.name || p.email)[0].toUpperCase()}</span>';">`;
        } else {
          const initial = (p.name || p.email)[0].toUpperCase();
          btnProfileMenuEl.innerHTML = `<span class="profile-initial">${initial}</span>`;
        }
      } else {
        btnProfileMenuEl.classList.remove('has-profile');
        btnProfileMenuEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
      }
    }
    if (profilePopupAvatarEl) {
      if (p.email && avatarUrl) {
        profilePopupAvatarEl.innerHTML = `<img src="${avatarUrl}" class="profile-avatar-img" alt="Avatar" onerror="this.onerror=null;this.textContent='${(p.name || p.email)[0].toUpperCase()}';">`;
      } else {
        profilePopupAvatarEl.textContent = p.email ? (p.name || p.email)[0].toUpperCase() : '?';
      }
    }
    if (profilePopupNameEl) profilePopupNameEl.textContent = p.name || (p.email ? p.email.split('@')[0] : 'Não conectado');
    if (profilePopupEmailEl) profilePopupEmailEl.textContent = p.email || 'Clique para conectar seu e-mail';

    const connectWrap = document.getElementById('profileConnectActionWrap');
    if (connectWrap) {
      connectWrap.style.display = p.email ? 'none' : 'block';
    }

    const btnGoogleAcc = document.getElementById('btnOpenGoogleAccounts');
    if (btnGoogleAcc) {
      btnGoogleAcc.style.display = (p.email && p.email.includes('@')) ? 'flex' : 'none';
    }

    const btnLogout = document.getElementById('btnProfileLogout');
    if (btnLogout) {
      btnLogout.style.display = p.email ? 'flex' : 'none';
    }

    // Update sync badge
    let badge = document.querySelector('.profile-popup-sync-badge');
    if (p.email) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'profile-popup-sync-badge';
        badge.textContent = '✓ Sincronização ativada';
        profilePopupEmailEl?.after(badge);
      }
    } else if (badge) { badge.remove(); }
  } catch(e) {}
}

if (btnProfileMenuEl) {
  btnProfileMenuEl.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const isOpen = profilePopupEl.classList.contains('open');
    closeAllPopups();
    if (!isOpen) {
      updateProfileButton();
      profilePopupEl.classList.add('open');
    }
  });
}

profilePopupEl?.addEventListener('click', (e) => e.stopPropagation());

// Profile popup button actions
const profileLoginModalEl = document.getElementById('profileLoginModal');
const btnCloseLoginModalEl = document.getElementById('btnCloseLoginModal');
const btnCancelLoginEmailEl = document.getElementById('btnCancelLoginEmail');
const btnConfirmLoginEmailEl = document.getElementById('btnConfirmLoginEmail');
const loginInputNameEl = document.getElementById('loginInputName');
const loginInputEmailEl = document.getElementById('loginInputEmail');

function openProfileLoginModal() {
  profilePopupEl?.classList.remove('open');
  try {
    const p = JSON.parse(localStorage.getItem('vortex-profile-cache') || '{}');
    if (loginInputNameEl) loginInputNameEl.value = p.name || '';
    if (loginInputEmailEl) loginInputEmailEl.value = p.email || '';
  } catch(e) {}
  if (profileLoginModalEl) {
    profileLoginModalEl.style.display = 'flex';
    setTimeout(() => {
      if (loginInputEmailEl && !loginInputEmailEl.value) loginInputEmailEl.focus();
      else if (loginInputNameEl) loginInputNameEl.focus();
    }, 100);
  }
}

function closeProfileLoginModal() {
  if (profileLoginModalEl) profileLoginModalEl.style.display = 'none';
}

document.getElementById('profilePopupHero')?.addEventListener('click', () => {
  openProfileLoginModal();
});

document.getElementById('btnQuickConnectEmail')?.addEventListener('click', (ev) => {
  ev.stopPropagation();
  openProfileLoginModal();
});

btnCloseLoginModalEl?.addEventListener('click', () => closeProfileLoginModal());
btnCancelLoginEmailEl?.addEventListener('click', () => closeProfileLoginModal());

profileLoginModalEl?.addEventListener('click', (e) => {
  if (e.target === profileLoginModalEl) closeProfileLoginModal();
});

btnConfirmLoginEmailEl?.addEventListener('click', async () => {
  const email = (loginInputEmailEl?.value || '').trim();
  const name = (loginInputNameEl?.value || '').trim();
  if (!email || !email.includes('@')) {
    showToastNotification('⚠️', 'E-mail obrigatório', 'Por favor, digite um endereço de e-mail válido.', true);
    loginInputEmailEl?.focus();
    return;
  }

  const profile = {
    name: name || email.split('@')[0],
    email: email,
    syncEnabled: true,
    manuallyConnected: true, // Marca que o usuário conectou manualmente (não foi importado automaticamente)
    lastSync: Date.now()
  };

  localStorage.setItem('vortex-profile-cache', JSON.stringify(profile));

  if (window.vortexAPI?.saveUserProfile) {
    try {
      await window.vortexAPI.saveUserProfile(profile);
    } catch(err) {
      console.error('Erro ao salvar perfil no main process:', err);
    }
  }

  closeProfileLoginModal();
  updateProfileButton();
  showToastNotification('✅', 'Conta conectada!', `Sincronização ativada com sucesso para ${profile.email}.`);
});

loginInputEmailEl?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnConfirmLoginEmailEl?.click();
});
loginInputNameEl?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnConfirmLoginEmailEl?.click();
});

document.getElementById('btnConnectGoogleWeb')?.addEventListener('click', () => {
  profilePopupEl?.classList.remove('open');
  closeProfileLoginModal();
  const googleLoginUrl = 'https://accounts.google.com/signin/v2/identifier?hl=pt-BR&continue=https%3A%2F%2Fwww.google.com%2F';
  createTab(googleLoginUrl);
});

document.getElementById('btnOpenGoogleAccounts')?.addEventListener('click', () => {
  profilePopupEl?.classList.remove('open');
  createTab('https://myaccount.google.com/');
});

document.getElementById('btnProfileSync')?.addEventListener('click', () => {
  profilePopupEl?.classList.remove('open');
  openExtensionsTab('sync');
});
document.getElementById('btnProfilePasswords')?.addEventListener('click', () => {
  profilePopupEl?.classList.remove('open');
  openSettings('passwords');
});
document.getElementById('btnProfileExtensions')?.addEventListener('click', () => {
  profilePopupEl?.classList.remove('open');
  openExtensionsTab('installed');
});
document.getElementById('btnProfileSettings')?.addEventListener('click', () => {
  profilePopupEl?.classList.remove('open');
  openProfileLoginModal();
});

function disconnectProfile(notify = true) {
  const emptyProfile = { name: '', email: '', photoUrl: '', avatarUrl: '', syncEnabled: false, lastSync: null };
  localStorage.setItem('vortex-profile-cache', JSON.stringify(emptyProfile));
  if (window.vortexAPI?.saveUserProfile) {
    window.vortexAPI.saveUserProfile(emptyProfile).catch(() => {});
  }
  updateProfileButton();
  if (notify) {
    showToastNotification('ℹ️', 'Conta desvinculada', 'Seu perfil foi desconectado do navegador.');
  }
}

document.getElementById('btnProfileLogout')?.addEventListener('click', () => {
  profilePopupEl?.classList.remove('open');
  disconnectProfile(true);
});

async function syncFromGoogleChrome(manual = false) {
  if (!window.vortexAPI?.syncChromeData) return;
  // Esta função SÓ deve ser chamada por ação manual do usuário
  if (!manual) return; // Proteção extra: nunca chamar automaticamente
  try {
    const res = await window.vortexAPI.syncChromeData();
    if (res && res.success) {
      let updatedSomething = false;
      if (res.profile && res.profile.email) {
        // Marca como manualmente conectado para não ser apagado na próxima inicialização
        const profileWithFlag = { ...res.profile, manuallyConnected: true };
        localStorage.setItem('vortex-profile-cache', JSON.stringify(profileWithFlag));
        updateProfileButton();
        updatedSomething = true;
      }
      if (Array.isArray(res.bookmarks) && res.bookmarks.length > 0) {
        // Mesclar com favoritos atuais sem duplicatas de URL
        const existingUrls = new Set(bookmarks.map(b => b.url.toLowerCase()));
        let added = 0;
        res.bookmarks.forEach(b => {
          if (!existingUrls.has(b.url.toLowerCase())) {
            bookmarks.push(b);
            existingUrls.add(b.url.toLowerCase());
            added++;
          }
        });
        if (added > 0) {
          localStorage.setItem('vortex-bookmarks', JSON.stringify(bookmarks));
          renderBookmarksBar();
          updatedSomething = true;
        }
      }
      showToastNotification('🌐', 'Google Chrome Sincronizado', `${res.bookmarksCount || 0} favoritos e perfil importados com sucesso!`);
    } else {
      showToastNotification('ℹ️', 'Google Chrome', 'Nenhum perfil ativo do Chrome foi detectado nesta máquina.');
    }
  } catch(e) {
    showToastNotification('⚠️', 'Erro na sincronização', 'Não foi possível ler os dados do Chrome.');
  }
}

document.getElementById('btnImportChromeData')?.addEventListener('click', () => {
  profilePopupEl?.classList.remove('open');
  syncFromGoogleChrome(true);
});

// Initialize on page load
updateProfileButton();
renderExtensionsPopup();


// Carrega perfil salvo pelo usuário no Vortex (NUNCA importa automaticamente de outros navegadores)
if (window.vortexAPI?.getUserProfile) {
  window.vortexAPI.getUserProfile().then(p => {
    // Só atualiza o botão se o usuário JÁ configurou um perfil no Vortex
    if (p && p.email && p.email.includes('@')) {
      localStorage.setItem('vortex-profile-cache', JSON.stringify(p));
      updateProfileButton();
    }
    // Se não tiver perfil configurado: nenhuma ação automática.
    // O usuário deve clicar no ícone de perfil e conectar manualmente.
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════
// VPN GRATUITA INTEGRADA (Vortex Secure Tunnel)
// ═══════════════════════════════════════════════════════
(function initVPN() {
  let vpnConnected = false;
  let vpnConnecting = false;

  const btnVpn       = document.getElementById('btnVpn');
  const vpnPopup     = document.getElementById('vpnPopup');
  const btnVpnClose  = document.getElementById('btnVpnClose');
  const btnVpnToggle = document.getElementById('btnVpnToggle');
  const vpnBadgeDot  = document.getElementById('vpnBadgeDot');
  const vpnStatusHero   = document.getElementById('vpnStatusHero');
  const vpnStatusBadge  = document.getElementById('vpnStatusBadge');
  const vpnStatusIp     = document.getElementById('vpnStatusIp');
  const vpnToggleLabel  = document.getElementById('vpnToggleLabel');
  const vpnLocationSelect = document.getElementById('vpnLocationSelect');

  if (!btnVpn || !vpnPopup) return;

  // ── Abrir / fechar popup ────────────────────────────
  btnVpn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = vpnPopup.classList.contains('open');
    closeAllPopups();
    if (!isOpen) {
      vpnPopup.classList.add('open');
    }
  });

  vpnPopup.addEventListener('click', (e) => e.stopPropagation());
  btnVpnClose?.addEventListener('click', () => vpnPopup.classList.remove('open'));

  // ── Atualizar UI com base no estado ────────────────
  function updateVpnUI(connected, connecting = false) {
    vpnConnected  = connected;
    vpnConnecting = connecting;

    if (connecting) {
      // Estado de carregamento
      vpnStatusHero?.classList.remove('connected', 'disconnected');
      vpnStatusHero?.classList.add('connecting');
      if (vpnStatusBadge) vpnStatusBadge.textContent = 'CONECTANDO...';
      if (vpnStatusIp)    vpnStatusIp.textContent = 'Estabelecendo túnel criptografado...';
      if (vpnToggleLabel) vpnToggleLabel.textContent = 'Aguarde...';
      if (vpnBadgeDot)    { vpnBadgeDot.style.background = '#f59e0b'; vpnBadgeDot.style.display = 'block'; }
      btnVpnToggle?.classList.add('connecting');
    } else if (connected) {
      // Estado conectado
      const loc = vpnLocationSelect?.options[vpnLocationSelect.selectedIndex]?.text || 'Servidor VPN';
      vpnStatusHero?.classList.remove('disconnected', 'connecting');
      vpnStatusHero?.classList.add('connected');
      if (vpnStatusBadge) vpnStatusBadge.textContent = 'CONECTADO ✓';
      if (vpnStatusIp)    vpnStatusIp.textContent = `🌍 ${loc} — IP mascarado`;
      if (vpnToggleLabel) vpnToggleLabel.textContent = 'Clique para desconectar';
      if (vpnBadgeDot)    { vpnBadgeDot.style.background = '#22c55e'; vpnBadgeDot.style.display = 'block'; }
      btnVpnToggle?.classList.remove('connecting');
    } else {
      // Estado desconectado
      vpnStatusHero?.classList.remove('connected', 'connecting');
      vpnStatusHero?.classList.add('disconnected');
      if (vpnStatusBadge) vpnStatusBadge.textContent = 'DESCONECTADO';
      if (vpnStatusIp)    vpnStatusIp.textContent = 'Seu IP real está exposto';
      if (vpnToggleLabel) vpnToggleLabel.textContent = 'Clique para conectar';
      if (vpnBadgeDot)    { vpnBadgeDot.style.background = ''; vpnBadgeDot.style.display = 'none'; }
      btnVpnToggle?.classList.remove('connecting');
    }
  }

  // ── Botão de ligar / desligar ───────────────────────
  btnVpnToggle?.addEventListener('click', async () => {
    if (vpnConnecting) return; // previne duplo clique
    const region = vpnLocationSelect?.value || 'auto';

    if (!vpnConnected) {
      // Conectar
      updateVpnUI(false, true);
      try {
        const res = await window.vortexAPI?.setVPNProxy({ enable: true, region });
        if (res?.success) {
          updateVpnUI(true, false);
          showToastNotification('🛡️', 'VPN Ativada', 'Seu tráfego está sendo roteado pelo túnel Vortex.');
        } else {
          updateVpnUI(false, false);
          showToastNotification('⚠️', 'VPN', 'Não foi possível conectar ao servidor. Tente outra região.');
        }
      } catch (e) {
        updateVpnUI(false, false);
        showToastNotification('⚠️', 'VPN', 'Erro ao conectar: ' + (e?.message || 'desconhecido'));
      }
    } else {
      // Desconectar
      updateVpnUI(false, true);
      try {
        await window.vortexAPI?.setVPNProxy({ enable: false, region });
        updateVpnUI(false, false);
        showToastNotification('ℹ️', 'VPN Desativada', 'Navegando com sua conexão normal.');
      } catch (e) {
        updateVpnUI(false, false);
      }
    }
  });

  // ── Troca de região fecha e reinicia se conectado ──
  vpnLocationSelect?.addEventListener('change', async () => {
    if (!vpnConnected) return;
    const region = vpnLocationSelect.value;
    updateVpnUI(false, true);
    try {
      await window.vortexAPI?.setVPNProxy({ enable: false, region: 'auto' });
      const res = await window.vortexAPI?.setVPNProxy({ enable: true, region });
      if (res?.success) {
        updateVpnUI(true, false);
        showToastNotification('🛡️', 'Servidor Trocado', 'VPN reconectada na nova região.');
      } else {
        updateVpnUI(false, false);
      }
    } catch (e) {
      updateVpnUI(false, false);
    }
  });

  // ── Inicializar: verificar estado atual do proxy ───
  (async () => {
    try {
      const status = await window.vortexAPI?.getVPNStatus();
      if (status?.connected) {
        if (vpnLocationSelect && status.region) vpnLocationSelect.value = status.region;
        updateVpnUI(true, false);
      } else {
        updateVpnUI(false, false);
      }
    } catch (e) {
      updateVpnUI(false, false);
    }
  })();
})();

// ══════════════════════════════════════════════════════════════════
// NOTIFICAÇÃO E ATUALIZAÇÃO AUTOMÁTICA DO VORTEX (Estilo Google Chrome)
// ══════════════════════════════════════════════════════════════════
(function initAutoUpdateUI() {
  const btnUpdateBadge = document.getElementById('btnUpdateBadge');
  const dmUpdateGroup = document.getElementById('dm-update-group');
  const dmUpdateDivider = document.getElementById('dm-update-divider');
  const dmUpdate = document.getElementById('dm-update');
  const updateModal = document.getElementById('updatePromptModal');
  const btnCloseUpdateModal = document.getElementById('btnCloseUpdateModal');
  const btnPostponeUpdate = document.getElementById('btnPostponeUpdate');
  const btnActionUpdate = document.getElementById('btnActionUpdate');
  const updateVersionTitle = document.getElementById('updateVersionTitle');
  const updateVersionDesc = document.getElementById('updateVersionDesc');
  const updateProgressContainer = document.getElementById('updateProgressContainer');
  const updateProgressBarFill = document.getElementById('updateProgressBarFill');
  const updateProgressLabel = document.getElementById('updateProgressLabel');
  const updateReadyBox = document.getElementById('updateReadyBox');

  let updateState = 'none'; // 'none' | 'available' | 'downloading' | 'downloaded'
  let latestUpdateInfo = null;

  async function showUpdateNotification(info) {
    if (!info || !info.version) return;

    // Dupla checagem: obter versão local do app e garantir que info.version é estritamente maior
    try {
      if (window.vortexAPI?.getAppVersion) {
        const localVer = await window.vortexAPI.getAppVersion();
        const r = info.version.replace(/^v/, '').split('.').map(n => parseInt(n, 10));
        const l = (localVer || '0.0.0').replace(/^v/, '').split('.').map(n => parseInt(n, 10));
        let isNewer = false;
        for (let i = 0; i < Math.max(r.length, l.length); i++) {
          const rv = r[i] || 0;
          const lv = l[i] || 0;
          if (rv > lv) { isNewer = true; break; }
          if (rv < lv) { isNewer = false; break; }
        }
        if (!isNewer) {
          // App já está na mesma versão ou superior: esconde o badge
          if (btnUpdateBadge) btnUpdateBadge.classList.remove('show');
          if (dmUpdateGroup) dmUpdateGroup.style.display = 'none';
          if (dmUpdateDivider) dmUpdateDivider.style.display = 'none';
          return;
        }
      }
    } catch(e) {}

    latestUpdateInfo = info;
    updateState = 'available';

    // Exibe botão verde/azul pulsante no canto superior direito igual ao Chrome
    if (btnUpdateBadge) {
      btnUpdateBadge.classList.add('show');
      btnUpdateBadge.title = `Nova versão ${info?.version || ''} do Vortex disponível! Clique para atualizar.`;
    }
    // Exibe item no menu de 3 pontinhos
    if (dmUpdateGroup) dmUpdateGroup.style.display = 'block';
    if (dmUpdateDivider) dmUpdateDivider.style.display = 'block';
  }

  function openUpdateModal() {
    if (!updateModal) return;
    updateModal.classList.add('active');

    if (updateState === 'available') {
      if (updateVersionTitle) updateVersionTitle.textContent = `Vortex ${latestUpdateInfo?.version || 'Nova Versão'} Disponível!`;
      if (updateVersionDesc) updateVersionDesc.textContent = 'Novas melhorias de velocidade, correções e recursos de privacidade estão prontos.';
      if (updateProgressContainer) updateProgressContainer.style.display = 'none';
      if (updateReadyBox) updateReadyBox.style.display = 'none';
      if (btnActionUpdate) {
        btnActionUpdate.textContent = 'Baixar e Atualizar';
        btnActionUpdate.disabled = false;
      }
    } else if (updateState === 'downloading') {
      if (updateProgressContainer) updateProgressContainer.style.display = 'block';
      if (updateReadyBox) updateReadyBox.style.display = 'none';
      if (btnActionUpdate) {
        btnActionUpdate.textContent = 'Baixando...';
        btnActionUpdate.disabled = true;
      }
    } else if (updateState === 'downloaded') {
      if (updateVersionTitle) updateVersionTitle.textContent = `Atualização Pronta para Instalar!`;
      if (updateVersionDesc) updateVersionDesc.textContent = 'O instalador foi baixado com sucesso.';
      if (updateProgressContainer) updateProgressContainer.style.display = 'none';
      if (updateReadyBox) updateReadyBox.style.display = 'flex';
      if (btnActionUpdate) {
        btnActionUpdate.textContent = 'Reiniciar Agora';
        btnActionUpdate.disabled = false;
      }
    }
  }

  function closeUpdateModal() {
    if (updateModal) updateModal.classList.remove('active');
  }

  btnUpdateBadge?.addEventListener('click', openUpdateModal);
  dmUpdate?.addEventListener('click', () => {
    closeAllMenus();
    openUpdateModal();
  });
  btnCloseUpdateModal?.addEventListener('click', closeUpdateModal);
  btnPostponeUpdate?.addEventListener('click', closeUpdateModal);

  btnActionUpdate?.addEventListener('click', async () => {
    if (updateState === 'downloaded') {
      // Reinicia e instala
      btnActionUpdate.textContent = 'Reiniciando...';
      btnActionUpdate.disabled = true;
      try {
        await window.vortexAPI?.installUpdate();
      } catch (e) {
        console.error('Erro ao acionar installUpdate:', e);
      }
    } else {
      // Inicia o download da atualização
      updateState = 'downloading';
      if (btnActionUpdate) {
        btnActionUpdate.textContent = 'Baixando...';
        btnActionUpdate.disabled = true;
      }
      if (updateProgressContainer) updateProgressContainer.style.display = 'block';
      if (updateProgressBarFill) updateProgressBarFill.style.width = '5%';
      if (updateProgressLabel) updateProgressLabel.textContent = 'Iniciando download da nova versão...';

      try {
        await window.vortexAPI?.downloadUpdate();
      } catch (err) {
        console.warn('Erro ao acionar downloadUpdate:', err);
      }
    }
  });

  // Listeners do Main Process
  function forwardToSettingsTab(msg) {
    try {
      const settingsTab = tabs.find(t => t.url && t.url.includes('settings.html'));
      if (settingsTab && settingsTab.webview && settingsTab.webview.contentWindow) {
        settingsTab.webview.contentWindow.postMessage(msg, '*');
      }
    } catch(e) {}
  }

  if (window.vortexAPI?.onUpdateAvailable) {
    window.vortexAPI.onUpdateAvailable((info) => {
      showUpdateNotification(info);
      showToastNotification('🚀', 'Atualização Disponível', `Vortex ${info.version} está disponível para download.`);
      forwardToSettingsTab({ type: 'update-available', info });
    });
  }

  if (window.vortexAPI?.onUpdateProgress) {
    window.vortexAPI.onUpdateProgress((progress) => {
      updateState = 'downloading';
      if (btnUpdateBadge) {
        const textEl = btnUpdateBadge.querySelector('.update-badge-text');
        if (textEl) textEl.textContent = `Atualizando ${progress.percent}%`;
      }
      if (updateProgressBarFill) updateProgressBarFill.style.width = `${progress.percent}%`;
      if (updateProgressLabel) updateProgressLabel.textContent = `Baixando atualização... ${progress.percent}%`;
      forwardToSettingsTab({ type: 'update-download-progress', progress });
    });
  }

  if (window.vortexAPI?.onUpdateDownloaded) {
    window.vortexAPI.onUpdateDownloaded((info) => {
      updateState = 'downloaded';
      if (btnUpdateBadge) {
        const textEl = btnUpdateBadge.querySelector('.update-badge-text');
        if (textEl) textEl.textContent = 'Reiniciar';
        btnUpdateBadge.title = 'Atualização baixada! Clique para reiniciar o Vortex.';
      }
      if (updateProgressContainer) updateProgressContainer.style.display = 'none';
      if (updateReadyBox) updateReadyBox.style.display = 'flex';
      if (btnActionUpdate) {
        btnActionUpdate.textContent = 'Reiniciar Agora';
        btnActionUpdate.disabled = false;
      }
      showToastNotification('✓', 'Atualização Pronta', 'Clique em Reiniciar para aplicar a nova versão.');
      forwardToSettingsTab({ type: 'update-downloaded', info });
    });
  }
})();

// ══════════════════════════════════════════════════════════════════
// FASE 1: RECURSOS MODERNOS DE NAVEGAÇÃO
// 1. Fixar Abas & Menu de Contexto da Aba
// 2. Gerador de QR Code
// 3. Captura de Tela Nativa
// 4. Barra de Comandos Rápida (Ctrl+K)
// ══════════════════════════════════════════════════════════════════

// ── 1. Fixar Abas & Menu de Contexto ──────────────────────────────
let contextMenuTargetTabId = null;
const tabContextMenuEl = document.getElementById('tabContextMenu');
const menuPinTabEl = document.getElementById('menuPinTab');
const menuPinTabTextEl = document.getElementById('menuPinTabText');
const menuDuplicateTabEl = document.getElementById('menuDuplicateTab');
const menuReloadTabEl = document.getElementById('menuReloadTab');
const menuCloseOtherTabsEl = document.getElementById('menuCloseOtherTabs');
const menuCloseThisTabEl = document.getElementById('menuCloseThisTab');

function showTabContextMenu(x, y, tabId) {
  contextMenuTargetTabId = tabId;
  const targetTab = tabs.find(t => t.id === tabId);
  if (!targetTab) return;

  if (menuPinTabTextEl) {
    menuPinTabTextEl.textContent = targetTab.isPinned ? 'Desafixar Aba' : 'Fixar Aba';
  }

  if (tabContextMenuEl) {
    tabContextMenuEl.style.display = 'block';
    const menuWidth = 180;
    const menuHeight = 170;
    const maxX = window.innerWidth - menuWidth - 10;
    const maxY = window.innerHeight - menuHeight - 10;
    tabContextMenuEl.style.left = `${Math.min(x, maxX)}px`;
    tabContextMenuEl.style.top = `${Math.min(y, maxY)}px`;
  }
}

function hideTabContextMenu() {
  if (tabContextMenuEl) tabContextMenuEl.style.display = 'none';
  contextMenuTargetTabId = null;
}

document.addEventListener('click', (e) => {
  if (tabContextMenuEl && !tabContextMenuEl.contains(e.target)) {
    hideTabContextMenu();
  }
});

function togglePinTab(tabId) {
  const targetTab = tabs.find(t => t.id === tabId);
  if (!targetTab) return;

  targetTab.isPinned = !targetTab.isPinned;
  if (targetTab.isPinned) {
    targetTab.tabEl.classList.add('pinned');
    targetTab.tabEl.title = `📌 ${targetTab.title || 'Aba Fixada'}`;
    // Mover aba fixada para a esquerda entre as primeiras da lista
    const firstNonPinned = tabs.find(t => !t.isPinned && t.id !== targetTab.id);
    if (firstNonPinned && firstNonPinned.tabEl) {
      tabsListEl.insertBefore(targetTab.tabEl, firstNonPinned.tabEl);
    }
    showToastNotification('📌', 'Aba Fixada', targetTab.title || 'Aba compactada com sucesso');
  } else {
    targetTab.tabEl.classList.remove('pinned');
    targetTab.tabEl.title = targetTab.title || '';
    showToastNotification('📌', 'Aba Desafixada', targetTab.title || '');
  }
}

menuPinTabEl?.addEventListener('click', () => {
  if (contextMenuTargetTabId) togglePinTab(contextMenuTargetTabId);
  hideTabContextMenu();
});

menuDuplicateTabEl?.addEventListener('click', () => {
  if (contextMenuTargetTabId) {
    const t = tabs.find(tab => tab.id === contextMenuTargetTabId);
    if (t && t.url) createTab(t.url);
  }
  hideTabContextMenu();
});

menuReloadTabEl?.addEventListener('click', () => {
  if (contextMenuTargetTabId) {
    const t = tabs.find(tab => tab.id === contextMenuTargetTabId);
    if (t && t.webview && typeof t.webview.reload === 'function') t.webview.reload();
  }
  hideTabContextMenu();
});

menuCloseOtherTabsEl?.addEventListener('click', () => {
  if (contextMenuTargetTabId) {
    const toClose = tabs.filter(t => t.id !== contextMenuTargetTabId && !t.isPinned).map(t => t.id);
    toClose.forEach(id => closeTab(id));
  }
  hideTabContextMenu();
});

menuCloseThisTabEl?.addEventListener('click', () => {
  if (contextMenuTargetTabId) closeTab(contextMenuTargetTabId);
  hideTabContextMenu();
});

// ── 2. Gerador de QR Code Nativo ─────────────────────────────────
const btnQrCodeEl = document.getElementById('btnQrCode');
const qrCodeModalEl = document.getElementById('qrCodeModal');
const btnCloseQrModalEl = document.getElementById('btnCloseQrModal');
const btnCloseQrModalActionEl = document.getElementById('btnCloseQrModalAction');
const qrCodeImageEl = document.getElementById('qrCodeImage');
const qrPageUrlTextEl = document.getElementById('qrPageUrlText');
const btnCopyQrUrlEl = document.getElementById('btnCopyQrUrl');

function openQrCodeModal() {
  const activeTab = getActiveTab();
  const currentUrl = activeTab?.url || addressInputEl.value || '';
  if (!currentUrl || currentUrl.startsWith('about:') || currentUrl.startsWith('vortex://')) {
    showToastNotification('ℹ️', 'QR Code', 'Navegue para um site na web para gerar o QR Code.');
    return;
  }

  if (qrPageUrlTextEl) qrPageUrlTextEl.textContent = currentUrl;
  if (qrCodeImageEl) {
    // API pública e gratuita para geração instantânea de QR Code
    qrCodeImageEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=4&data=${encodeURIComponent(currentUrl)}`;
  }
  if (qrCodeModalEl) qrCodeModalEl.classList.add('active');
}

function closeQrCodeModal() {
  if (qrCodeModalEl) qrCodeModalEl.classList.remove('active');
}

btnQrCodeEl?.addEventListener('click', openQrCodeModal);
btnCloseQrModalEl?.addEventListener('click', closeQrCodeModal);
btnCloseQrModalActionEl?.addEventListener('click', closeQrCodeModal);
btnCopyQrUrlEl?.addEventListener('click', () => {
  const activeTab = getActiveTab();
  const currentUrl = activeTab?.url || addressInputEl.value || '';
  if (currentUrl) {
    navigator.clipboard.writeText(currentUrl).then(() => {
      showToastNotification('📋', 'Link Copiado', 'Endereço copiado para a área de transferência.');
      closeQrCodeModal();
    });
  }
});

// ── 3. Captura de Tela Nativa (Screenshot) ────────────────────────
const btnScreenshotEl = document.getElementById('btnScreenshot');
const screenshotModalEl = document.getElementById('screenshotModal');
const btnCloseScreenshotModalEl = document.getElementById('btnCloseScreenshotModal');
const screenshotPreviewImgEl = document.getElementById('screenshotPreviewImg');
const btnCopyScreenshotClipboardEl = document.getElementById('btnCopyScreenshotClipboard');
const btnSaveScreenshotFileEl = document.getElementById('btnSaveScreenshotFile');

let currentScreenshotDataUrl = null;

async function captureActivePage() {
  const activeTab = getActiveTab();
  if (!activeTab || !activeTab.webview) {
    showToastNotification('ℹ️', 'Captura de Tela', 'Abra uma página web para capturar a tela.');
    return;
  }

  showToastNotification('📸', 'Capturando tela...', 'Processando imagem da página...');
  try {
    const targetWcId = activeTab.webview.getWebContentsId ? activeTab.webview.getWebContentsId() : null;
    let res = null;
    if (window.vortexAPI?.capturePage) {
      res = await window.vortexAPI.capturePage({ targetWebContentsId: targetWcId });
    }
    if (res && res.success && res.dataUrl) {
      currentScreenshotDataUrl = res.dataUrl;
      if (screenshotPreviewImgEl) screenshotPreviewImgEl.src = res.dataUrl;
      if (screenshotModalEl) screenshotModalEl.classList.add('active');
    } else {
      showToastNotification('⚠️', 'Falha na Captura', res?.error || 'Não foi possível capturar a página.', true);
    }
  } catch (err) {
    showToastNotification('⚠️', 'Erro', err.message, true);
  }
}

function closeScreenshotModal() {
  if (screenshotModalEl) screenshotModalEl.classList.remove('active');
  currentScreenshotDataUrl = null;
}

btnScreenshotEl?.addEventListener('click', captureActivePage);
btnCloseScreenshotModalEl?.addEventListener('click', closeScreenshotModal);

btnCopyScreenshotClipboardEl?.addEventListener('click', async () => {
  if (!currentScreenshotDataUrl) return;
  try {
    const res = await fetch(currentScreenshotDataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showToastNotification('📋', 'Imagem Copiada', 'Captura copiada para a área de transferência!');
    closeScreenshotModal();
  } catch(e) {
    showToastNotification('⚠️', 'Erro ao copiar', 'Não foi possível copiar diretamente para a área de transferência.', true);
  }
});

btnSaveScreenshotFileEl?.addEventListener('click', async () => {
  if (!currentScreenshotDataUrl) return;
  const activeTab = getActiveTab();
  let hostName = 'pagina';
  try {
    if (activeTab?.url) hostName = new URL(activeTab.url).hostname.replace(/[^a-zA-Z0-9]/g, '_');
  } catch(e) {}
  const fileName = `Vortex_${hostName}_${Date.now()}.png`;

  if (window.vortexAPI?.saveScreenshotDialog) {
    const res = await window.vortexAPI.saveScreenshotDialog({
      dataUrl: currentScreenshotDataUrl,
      defaultName: fileName
    });
    if (res && res.success) {
      showToastNotification('💾', 'Imagem Salva', `Salvo com sucesso em: ${res.path}`);
      closeScreenshotModal();
    }
  }
});

// ── 4. Barra de Comandos Rápida (Command Palette - Ctrl+K) ────────
const commandPaletteOverlayEl = document.getElementById('commandPaletteOverlay');
const commandPaletteInputEl = document.getElementById('commandPaletteInput');
const commandPaletteResultsEl = document.getElementById('commandPaletteResults');

const COMMAND_ACTIONS = [
  { id: 'new-tab', title: 'Nova Guia', category: 'Navegação', icon: '➕', hint: 'Ctrl+T', action: () => createTab() },
  { id: 'new-incognito', title: 'Nova Guia Anônima', category: 'Privacidade', icon: '🕶️', hint: 'Ctrl+Shift+N', action: () => openIncognitoTab() },
  { id: 'settings', title: 'Abrir Configurações', category: 'Preferências', icon: '⚙️', hint: 'vortex://configuracoes', action: () => openSettingsTab() },
  { id: 'history', title: 'Histórico de Navegação', category: 'Navegação', icon: '📜', hint: 'Ctrl+H', action: () => openHistoryTab() },
  { id: 'bookmarks', title: 'Gerenciador de Favoritos', category: 'Favoritos', icon: '⭐', hint: 'Ctrl+Shift+O', action: () => openBookmarksTab() },
  { id: 'passwords', title: 'Senhas Salvas & Cofre', category: 'Segurança', icon: '🔑', hint: 'Vortex Vault', action: () => openPasswordsTab() },
  { id: 'extensions', title: 'Gerenciar Extensões', category: 'Extensões', icon: '🧩', hint: 'vortex://extensoes', action: () => openExtensionsTab() },
  { id: 'screenshot', title: 'Capturar Tela da Página', category: 'Ferramentas', icon: '📸', hint: 'Screenshot', action: () => captureActivePage() },
  { id: 'qrcode', title: 'Abrir QR Code no Celular', category: 'Ferramentas', icon: '📱', hint: 'Compartilhar', action: () => openQrCodeModal() },
  { id: 'pin-tab', title: 'Fixar / Desafixar Aba Atual', category: 'Abas', icon: '📌', hint: 'Pin Tab', action: () => { if (activeTabId) togglePinTab(activeTabId); } },
  { id: 'reopen-tab', title: 'Reabrir Aba Fechada', category: 'Abas', icon: '↩️', hint: 'Ctrl+Shift+T', action: () => restoreLastClosedTab() },
  { id: 'clear-data', title: 'Limpar Dados de Navegação', category: 'Privacidade', icon: '🗑️', hint: 'Cache & Cookies', action: () => window.vortexAPI?.clearBrowsingData?.() },
  { id: 'devtools', title: 'Abrir Ferramentas do Desenvolvedor', category: 'Desenvolvedor', icon: '🛠️', hint: 'F12', action: () => openDevToolsAction() },
  { id: 'check-updates', title: 'Verificar Atualizações do Vortex', category: 'Sistema', icon: '🚀', hint: 'GitHub Releases', action: () => openSettingsTab('about') }
];

let selectedCommandIndex = 0;
let filteredCommands = [];

function openCommandPalette() {
  if (!commandPaletteOverlayEl) return;
  commandPaletteOverlayEl.classList.add('active');
  if (commandPaletteInputEl) {
    commandPaletteInputEl.value = '';
    commandPaletteInputEl.focus();
  }
  renderCommandResults('');
}

function closeCommandPalette() {
  if (commandPaletteOverlayEl) commandPaletteOverlayEl.classList.remove('active');
}

function renderCommandResults(query) {
  if (!commandPaletteResultsEl) return;
  const q = (query || '').toLowerCase().trim();
  filteredCommands = [];

  // 1. Pesquisa entre as Abas Abertas
  const matchingTabs = tabs.filter(t => {
    if (!q) return false;
    const title = (t.title || '').toLowerCase();
    const url = (t.url || '').toLowerCase();
    return title.includes(q) || url.includes(q);
  });

  // 2. Pesquisa entre Comandos do Navegador
  const matchingActions = COMMAND_ACTIONS.filter(c => {
    if (!q) return true;
    return c.title.toLowerCase().includes(q) || c.category.toLowerCase().includes(q);
  });

  let html = '';
  let itemCounter = 0;

  if (matchingTabs.length > 0) {
    html += `<div class="cmd-result-group-title">Abas Abertas (${matchingTabs.length})</div>`;
    matchingTabs.forEach(t => {
      const idx = itemCounter++;
      filteredCommands.push({ type: 'tab', id: t.id });
      html += `
        <div class="cmd-item ${idx === selectedCommandIndex ? 'selected' : ''}" data-index="${idx}">
          <div class="cmd-item-left">
            <span class="cmd-item-icon">🗂️</span>
            <span class="cmd-item-text">${t.title || t.url || 'Nova Aba'}</span>
          </div>
          <span class="cmd-item-hint">Alternar para aba</span>
        </div>
      `;
    });
  }

  if (matchingActions.length > 0) {
    html += `<div class="cmd-result-group-title">Comandos do Vortex</div>`;
    matchingActions.forEach(c => {
      const idx = itemCounter++;
      filteredCommands.push({ type: 'action', item: c });
      html += `
        <div class="cmd-item ${idx === selectedCommandIndex ? 'selected' : ''}" data-index="${idx}">
          <div class="cmd-item-left">
            <span class="cmd-item-icon">${c.icon}</span>
            <span class="cmd-item-text">${c.title}</span>
          </div>
          <span class="cmd-item-hint">${c.hint || c.category}</span>
        </div>
      `;
    });
  }

  if (filteredCommands.length === 0) {
    html = `<div style="padding: 24px; text-align: center; color: #64748b; font-size: 13.5px;">Nenhum comando ou aba encontrada para "<strong>${query}</strong>"</div>`;
  }

  commandPaletteResultsEl.innerHTML = html;

  // Click listener nos itens
  commandPaletteResultsEl.querySelectorAll('.cmd-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.index, 10);
      executeCommandByIndex(idx);
    });
  });
}

function executeCommandByIndex(index) {
  const item = filteredCommands[index];
  if (!item) return;
  closeCommandPalette();

  if (item.type === 'tab') {
    switchTab(item.id);
  } else if (item.type === 'action' && item.item?.action) {
    item.item.action();
  }
}

commandPaletteInputEl?.addEventListener('input', (e) => {
  selectedCommandIndex = 0;
  renderCommandResults(e.target.value);
});

commandPaletteInputEl?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (filteredCommands.length > 0) {
      selectedCommandIndex = (selectedCommandIndex + 1) % filteredCommands.length;
      updateSelectedCommandVisual();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (filteredCommands.length > 0) {
      selectedCommandIndex = (selectedCommandIndex - 1 + filteredCommands.length) % filteredCommands.length;
      updateSelectedCommandVisual();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    executeCommandByIndex(selectedCommandIndex);
  } else if (e.key === 'Escape') {
    closeCommandPalette();
  }
});

function updateSelectedCommandVisual() {
  if (!commandPaletteResultsEl) return;
  const items = commandPaletteResultsEl.querySelectorAll('.cmd-item');
  items.forEach((item, idx) => {
    if (idx === selectedCommandIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}

commandPaletteOverlayEl?.addEventListener('click', (e) => {
  if (e.target === commandPaletteOverlayEl) closeCommandPalette();
});

// Atalho de Teclado Global: Ctrl + K ou Ctrl + Shift + P
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if (commandPaletteOverlayEl?.classList.contains('active')) {
      closeCommandPalette();
    } else {
      openCommandPalette();
    }
  } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    openCommandPalette();
  } else if (e.key === 'Escape') {
    closeCommandPalette();
    closeQrCodeModal();
    closeScreenshotModal();
    hideTabContextMenu();
  }
});

// ══════════════════════════════════════════════════════════════════
// FASE 2 & 3: MODO LEITURA, PICTURE-IN-PICTURE & WIDGETS
// ══════════════════════════════════════════════════════════════════

// ── 5. Modo Leitura (Reader Mode) ─────────────────────────────────
const btnReaderModeEl = document.getElementById('btnReaderMode');

function toggleReaderMode() {
  const activeTab = getActiveTab();
  if (!activeTab || !activeTab.webview) {
    showToastNotification('ℹ️', 'Modo Leitura', 'Abra uma página de notícia ou artigo para ler.');
    return;
  }

  activeTab.isReaderMode = !activeTab.isReaderMode;
  if (btnReaderModeEl) {
    btnReaderModeEl.style.color = activeTab.isReaderMode ? 'var(--accent-cyan)' : '';
  }

  if (activeTab.isReaderMode) {
    activeTab.webview.executeJavaScript(`
      (() => {
        if (window.__vortex_reader_active) return;
        window.__vortex_reader_active = true;

        // Salvar HTML original
        window.__vortex_original_body = document.body.innerHTML;
        window.__vortex_original_bg = document.body.style.backgroundColor;

        // Tentar capturar conteúdo principal do artigo
        const article = document.querySelector('article') || 
                        document.querySelector('[role="main"]') || 
                        document.querySelector('.post-content') || 
                        document.querySelector('.entry-content') || 
                        document.querySelector('.article-body') || 
                        document.querySelector('main');

        const title = document.title || 'Modo Leitura Vortex';
        const content = article ? article.innerHTML : document.body.innerHTML;

        document.body.innerHTML = \`
          <div id="__vortex_reader_container" style="
            max-width: 720px;
            margin: 40px auto;
            padding: 20px 28px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            font-size: 19px;
            line-height: 1.75;
            color: #d1d5db;
            background-color: #111827;
          ">
            <h1 style="font-size: 32px; font-weight: 700; color: #f9fafb; margin-bottom: 24px; line-height: 1.25;">\${title}</h1>
            <div style="font-size: 18px; line-height: 1.8;">
              \${content}
            </div>
          </div>
        \`;
        document.body.style.backgroundColor = '#111827';

        // Ocultar elementos irrelevantes dentro da leitura
        const toRemove = document.querySelectorAll('#__vortex_reader_container iframe, #__vortex_reader_container ad, #__vortex_reader_container nav, #__vortex_reader_container header, #__vortex_reader_container footer, #__vortex_reader_container script');
        toRemove.forEach(el => el.remove());
      })();
    `).catch(() => {});
    showToastNotification('📖', 'Modo Leitura Ativado', 'Formatado para leitura limpa e confortável.');
  } else {
    activeTab.webview.executeJavaScript(`
      (() => {
        if (!window.__vortex_reader_active) return;
        window.__vortex_reader_active = false;
        if (window.__vortex_original_body) {
          document.body.innerHTML = window.__vortex_original_body;
          document.body.style.backgroundColor = window.__vortex_original_bg || '';
        }
      })();
    `).catch(() => {});
    showToastNotification('📖', 'Modo Leitura Desativado', 'Página restaurada ao formato original.');
  }
}

btnReaderModeEl?.addEventListener('click', toggleReaderMode);

// ── 6. Picture-in-Picture (PiP) ───────────────────────────────────
const btnPipEl = document.getElementById('btnPip');

function togglePictureInPicture() {
  const activeTab = getActiveTab();
  if (!activeTab || !activeTab.webview) {
    showToastNotification('ℹ️', 'Picture-in-Picture', 'Nenhum vídeo em reprodução detectado.');
    return;
  }

  activeTab.webview.executeJavaScript(`
    (() => {
      const video = document.querySelector('video');
      if (!video) return { success: false, error: 'Nenhum vídeo encontrado nesta página' };
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
        return { success: true, mode: 'exit' };
      } else {
        video.requestPictureInPicture();
        return { success: true, mode: 'enter' };
      }
    })();
  `).then(res => {
    if (res && res.success) {
      if (res.mode === 'enter') {
        showToastNotification('📺', 'Mini-Player Ativado', 'Vídeo em Picture-in-Picture.');
      } else {
        showToastNotification('📺', 'Mini-Player Desativado', 'Vídeo retornou à aba.');
      }
    } else {
      showToastNotification('ℹ️', 'Picture-in-Picture', res?.error || 'Nenhum vídeo encontrado na página.');
    }
  }).catch(() => {
    showToastNotification('ℹ️', 'Picture-in-Picture', 'Nenhum vídeo compatível encontrado.');
  });
}

btnPipEl?.addEventListener('click', togglePictureInPicture);

// ── 7. Widgets da Nova Guia (Relógio e Clima Minimalista) ──────────
function initHomeWidgets() {
  const timeEl = document.getElementById('homeClockTime');
  const dateEl = document.getElementById('homeClockDate');
  const tempEl = document.getElementById('homeWeatherTemp');
  const descEl = document.getElementById('homeWeatherDesc');
  const iconEl = document.getElementById('homeWeatherIcon');

  function updateClock() {
    const now = new Date();
    if (timeEl) {
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      timeEl.textContent = `${h}:${m}`;
    }
    if (dateEl) {
      const opts = { weekday: 'long', day: 'numeric', month: 'long' };
      dateEl.textContent = now.toLocaleDateString('pt-BR', opts);
    }
  }

  updateClock();
  setInterval(updateClock, 1000);

  // Previsão do tempo gratuita via Open-Meteo API
  async function fetchWeather() {
    try {
      // Posição padrão baseada em fuso horário local ou São Paulo (exemplo neutro padrão BR)
      const lat = -23.5505;
      const lon = -46.6333;
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.current_weather) {
        const temp = Math.round(data.current_weather.temperature);
        const code = data.current_weather.weathercode;
        if (tempEl) tempEl.textContent = `${temp}°C`;

        let desc = 'Ensolarado';
        let icon = '☀️';
        if (code >= 1 && code <= 3) { desc = 'Parcialmente nublado'; icon = '🌤️'; }
        else if (code >= 45 && code <= 48) { desc = 'Nevoeiro'; icon = '🌫️'; }
        else if (code >= 51 && code <= 67) { desc = 'Chuva leve'; icon = '🌧️'; }
        else if (code >= 71 && code <= 77) { desc = 'Frio intenso'; icon = '❄️'; }
        else if (code >= 80 && code <= 99) { desc = 'Tempestade'; icon = '⛈️'; }

        if (descEl) descEl.textContent = desc;
        if (iconEl) iconEl.textContent = icon;
      }
    } catch(e) {
      if (descEl) descEl.textContent = 'Tempo indisponível';
    }
  }

  fetchWeather();
}

initHomeWidgets();


