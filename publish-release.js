const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

console.log('========================================================');
console.log('       🚀 PUBLICADOR AUTOMÁTICO DE ATUALIZAÇÕES DO VORTEX');
console.log('========================================================\n');

// 1. Carrega GH_TOKEN do .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0]?.trim();
      const val = parts.slice(1).join('=').trim();
      if (key && val) {
        process.env[key] = val;
      }
    }
  }
}

if (!process.env.GH_TOKEN) {
  console.error('[ERRO] GH_TOKEN não encontrado no arquivo .env!');
  process.exit(1);
}
process.env.GITHUB_TOKEN = process.env.GH_TOKEN;

// 2. Incrementa a versão no package.json (suporta minor/major quando for grande atualização)
const arg = process.argv[2];
const pkgPath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const parts = pkg.version.split('.').map(n => parseInt(n, 10));

let newVer = '';
if (arg === 'minor') {
  parts[1] += 1;
  parts[2] = 0;
  newVer = parts.join('.');
  console.log('[1/4] Grande atualização (Minor release)...');
} else if (arg === 'major') {
  parts[0] += 1;
  parts[1] = 0;
  parts[2] = 0;
  newVer = parts.join('.');
  console.log('[1/4] Atualização Maior (Major release)...');
} else if (arg && /^\d+\.\d+\.\d+$/.test(arg)) {
  newVer = arg;
  console.log(`[1/4] Definindo versão específica para ${newVer}...`);
} else {
  parts[2] += 1;
  newVer = parts.join('.');
  console.log('[1/4] Incrementando versão de patch...');
}

const oldVer = pkg.version;
pkg.version = newVer;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`Versão: ${oldVer} -> ${newVer}`);

const tag = `v${newVer}`;

// Atualiza o arquivo version.json do site na pasta docs para o site sincronizar instantaneamente
const docsVerPath = path.join(__dirname, 'docs', 'version.json');
try {
  const versionInfo = {
    version: newVer,
    tag: tag,
    name: `Vortex Browser ${tag}`,
    releaseDate: new Date().toISOString(),
    fileName: `Vortex-Browser-Setup-${newVer}.exe`,
    fileSize: '80.5 MB',
    downloadUrl: `https://github.com/vortexbrowser/vortex-browser/releases/download/${tag}/Vortex-Browser-Setup-${newVer}.exe`,
    githubReleaseUrl: `https://github.com/vortexbrowser/vortex-browser/releases/tag/${tag}`,
    changelog: [
      `Vortex Browser ${tag} Oficial`,
      'Abertura de Links em Nova Guia: Menu de contexto com opção "Abrir link em uma nova guia", "Abrir link em nova guia anônima" e "Copiar endereço do link"',
      'Suporte a links com target="_blank" e popups em portais de saúde/governo (DATASUS, CNES e outros)',
      'Abertura rápida com clique do botão do meio do mouse (scrollwheel click)',
      'Atualizações 100% Nativas: Downloads de atualização executados exclusivamente dentro do próprio Vortex Browser com notificação e barra de progresso',
      'Menus e popups com fechamento instantâneo por toggle e clique externo',
      'DevTools e Inspeção de Elementos com abertura instantânea sem travamentos'
    ]
  };
  fs.writeFileSync(docsVerPath, JSON.stringify(versionInfo, null, 2) + '\n', 'utf8');
  console.log(`[Site Vortex] docs/version.json atualizado automaticamente para ${tag}!`);
} catch (e) {
  console.warn('[Site Vortex] Aviso: Não foi possível atualizar docs/version.json:', e.message);
}

// 3. Git commit e sincronização
console.log('\n[2/4] Registrando no Git e sincronizando com GitHub...');
spawnSync('git', ['add', '-A'], { stdio: 'inherit' });
spawnSync('git', ['commit', '-m', `chore: release ${tag}`, '--allow-empty'], { stdio: 'inherit' });
spawnSync('git', ['push', 'origin', 'main'], { stdio: 'inherit' });

// 4. Compila o instalador .exe do Vortex
console.log(`\n[3/4] Compilando instalador .exe para Windows (NSIS)...`);
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

// Limpa artefatos antigos de dist
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  try {
    fs.rmSync(distDir, { recursive: true, force: true });
    console.log('[Build] Pasta dist limpa para evitar conflitos.');
  } catch (e) {}
}

const buildResult = spawnSync(npmCmd, ['run', 'dist'], {
  stdio: 'inherit',
  env: process.env,
  shell: true
});

if (buildResult.status !== 0) {
  console.error('\n[ERRO] Falha durante a compilação do instalador.');
  process.exit(buildResult.status || 1);
}

// Garante que latest.yml e hash sha512 estejam prontos para o autoUpdater
const ymlPath = path.join(__dirname, 'dist', 'latest.yml');
let exeName = '';
let exeFullPath = '';
try {
  const exeFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.exe') && !f.includes('uninstaller'));
  if (exeFiles.length > 0) {
    exeName = exeFiles[0];
    exeFullPath = path.join(distDir, exeName);
    const buf = fs.readFileSync(exeFullPath);
    const sha512 = crypto.createHash('sha512').update(buf).digest('base64');
    const autoYml = [
      `version: ${newVer}`,
      'files:',
      `  - url: ${exeName.replace(/\s+/g, '-')}`,
      `    sha512: ${sha512}`,
      `    size: ${buf.length}`,
      `path: ${exeName.replace(/\s+/g, '-')}`,
      `sha512: ${sha512}`,
      `releaseDate: '${new Date().toISOString()}'`
    ].join('\n') + '\n';
    fs.writeFileSync(ymlPath, autoYml, 'utf8');
  }
} catch (e) {}

// 5. Cria ou atualiza a Release no GitHub e faz upload de todos os assets
const token = process.env.GH_TOKEN;
if (token) {
  console.log(`[GitHub API] Publicando release ${tag} e fazendo upload dos artefatos...`);

  const ghRequest = (options, postData) => new Promise((resolve, reject) => {
    const r = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    r.on('error', reject);
    if (postData) r.write(postData);
    r.end();
  });

  const uploadAsset = (releaseId, name, contentType, buffer) => new Promise(resolve => {
    const upReq = https.request({
      method: 'POST',
      hostname: 'uploads.github.com',
      path: `/repos/vortexbrowser/vortex-browser/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
      headers: {
        'Authorization': 'token ' + token,
        'User-Agent': 'VortexUploader',
        'Content-Type': contentType,
        'Content-Length': buffer.length
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log(`[Upload Asset] ${name} -> Status: ${res.statusCode}`);
        resolve(res.statusCode);
      });
    });
    upReq.on('error', (err) => {
      console.warn(`[Upload Asset Error] ${name}:`, err.message);
      resolve(null);
    });
    upReq.write(buffer);
    upReq.end();
  });

  (async () => {
    try {
      // 1. Cria a tag no Git remoto se ainda não existir
      spawnSync('git', ['tag', '-f', tag], { stdio: 'ignore' });
      spawnSync('git', ['push', 'origin', tag, '--force'], { stdio: 'ignore' });

      // 2. Procura se a release já existe
      const listRes = await ghRequest({
        hostname: 'api.github.com',
        path: '/repos/vortexbrowser/vortex-browser/releases',
        headers: { 'Authorization': 'token ' + token, 'User-Agent': 'VortexUpdater' }
      });
      const releases = JSON.parse(listRes.body || '[]');
      let rel = Array.isArray(releases) ? releases.find(r => r.tag_name === tag) : null;

      const releaseBody = `## 🚀 Novidades na versão ${tag}\n\n- 🔗 **Abertura de Links em Nova Guia**: Menu de contexto nativo com "Abrir link em uma nova guia", "Abrir link em uma nova guia anônima" e "Copiar endereço do link".\n- 🏥 **Compatibilidade com Portais Públicos**: Suporte aprimorado para portais governamentais e de saúde como CNES e DATASUS (links target="_blank" e popups).\n- 🖱️ **Clique do Botão do Meio (Scrollwheel)**: Suporte completo para abrir links em nova aba com o botão de rolagem do mouse.\n- 🔄 **Atualização 100% Interna**: O Vortex notifica e baixa atualizações exclusivamente dentro da sua própria janela nativa.\n- 🎯 **Popups e Menus Otimizados**: Menus com fechamento imediato por toggle e clique fora.\n- ⚡ **Inspecionar e DevTools Instantâneo**: Ferramentas de desenvolvedor abertas imediatamente sem atrasos.`;

      if (!rel) {
        console.log(`[GitHub API] Criando nova Release ${tag}...`);
        const createRes = await ghRequest({
          method: 'POST',
          hostname: 'api.github.com',
          path: '/repos/vortexbrowser/vortex-browser/releases',
          headers: {
            'Authorization': 'token ' + token,
            'User-Agent': 'VortexUpdater',
            'Content-Type': 'application/json'
          }
        }, JSON.stringify({
          tag_name: tag,
          name: `Vortex Browser ${tag}`,
          body: releaseBody,
          draft: false,
          prerelease: false
        }));
        rel = JSON.parse(createRes.body || '{}');
      } else {
        console.log(`[GitHub API] Atualizando Release existente ${tag}...`);
        await ghRequest({
          method: 'PATCH',
          hostname: 'api.github.com',
          path: `/repos/vortexbrowser/vortex-browser/releases/${rel.id}`,
          headers: {
            'Authorization': 'token ' + token,
            'User-Agent': 'VortexUpdater',
            'Content-Type': 'application/json'
          }
        }, JSON.stringify({
          draft: false,
          name: `Vortex Browser ${tag}`,
          body: releaseBody
        }));
      }

      if (rel && rel.id) {
        const existingAssets = rel.assets || [];

        // Upload do .exe do instalador
        if (exeFullPath && fs.existsSync(exeFullPath)) {
          const exeUploadName = exeName.replace(/\s+/g, '-');
          const already = existingAssets.find(a => a.name === exeUploadName);
          if (already) {
            await ghRequest({
              method: 'DELETE',
              hostname: 'api.github.com',
              path: `/repos/vortexbrowser/vortex-browser/releases/assets/${already.id}`,
              headers: { 'Authorization': 'token ' + token, 'User-Agent': 'VortexUpdater' }
            });
          }
          await uploadAsset(rel.id, exeUploadName, 'application/octet-stream', fs.readFileSync(exeFullPath));
        }

        // Upload de blockmap
        const blockmapFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.blockmap'));
        for (const bm of blockmapFiles) {
          const targetName = bm.replace(/\s+/g, '-');
          const already = existingAssets.find(a => a.name === targetName);
          if (already) {
            await ghRequest({
              method: 'DELETE',
              hostname: 'api.github.com',
              path: `/repos/vortexbrowser/vortex-browser/releases/assets/${already.id}`,
              headers: { 'Authorization': 'token ' + token, 'User-Agent': 'VortexUpdater' }
            });
          }
          await uploadAsset(rel.id, targetName, 'application/octet-stream', fs.readFileSync(path.join(distDir, bm)));
        }

        // Upload de latest.yml
        if (fs.existsSync(ymlPath)) {
          const already = existingAssets.find(a => a.name === 'latest.yml');
          if (already) {
            await ghRequest({
              method: 'DELETE',
              hostname: 'api.github.com',
              path: `/repos/vortexbrowser/vortex-browser/releases/assets/${already.id}`,
              headers: { 'Authorization': 'token ' + token, 'User-Agent': 'VortexUpdater' }
            });
          }
          await uploadAsset(rel.id, 'latest.yml', 'text/yaml', fs.readFileSync(ymlPath));
        }

        console.log(`[GitHub API] Release ${tag} com todos os arquivos publicada com sucesso!`);
      }
    } catch (err) {
      console.warn('[GitHub API Error]:', err.message);
    }
  })();
}

// Sincroniza tamanho real e artefato gerado em docs/version.json
if (fs.existsSync(ymlPath) && fs.existsSync(docsVerPath)) {
  try {
    const ymlContent = fs.readFileSync(ymlPath, 'utf8');
    const sizeMatch = ymlContent.match(/size:\s*(\d+)/);
    const fileMatch = ymlContent.match(/path:\s*([^\r\n]+)/);
    if (sizeMatch && sizeMatch[1]) {
      const bytes = parseInt(sizeMatch[1], 10);
      const curDocs = JSON.parse(fs.readFileSync(docsVerPath, 'utf8'));
      curDocs.fileSize = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      if (fileMatch && fileMatch[1]) {
        curDocs.fileName = fileMatch[1].trim();
      }
      fs.writeFileSync(docsVerPath, JSON.stringify(curDocs, null, 2) + '\n', 'utf8');
      spawnSync('git', ['add', docsVerPath], { stdio: 'ignore' });
      spawnSync('git', ['commit', '-m', `chore: update site metadata for ${tag}`], { stdio: 'ignore' });
      spawnSync('git', ['push', 'origin', 'main'], { stdio: 'ignore' });
      console.log(`[Site Vortex] Metadados finais do site sincronizados com sucesso no GitHub Pages!`);
    }
  } catch (e) {}
}

console.log('\n========================================================');
console.log(`[4/4] SUCESSO! A versão ${tag} foi publicada no GitHub!`);
console.log('      Todos os usuários do Vortex serão atualizados automaticamente.');
console.log('      O site de download oficial em /docs foi atualizado com a nova versão.');
console.log('========================================================\n');

