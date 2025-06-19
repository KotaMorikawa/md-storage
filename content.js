// Content script for extracting page content and converting to Markdown

// File System Access APIの保存ハンドル
let currentDirectoryHandle = null;

// IndexedDBの設定
const DB_NAME = 'MarkdownSaverDB';
const DB_VERSION = 1;
const STORE_NAME = 'directoryHandles';
const HANDLE_KEY = 'selectedDirectory';

// メッセージリスナーの設定
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractContent') {
    try {
      const result = extractPageContent();
      sendResponse({ success: true, data: result });
    } catch (error) {
      console.error('Content extraction error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // 非同期レスポンスを有効にする
  }
  
  if (message.action === 'selectDirectory') {
    handleDirectorySelection()
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.action === 'saveToDirectory') {
    handleDirectorySave(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.action === 'checkDirectoryPermission') {
    checkDirectoryPermission()
      .then(permission => sendResponse({ success: true, data: permission }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.action === 'checkFileSystemAPI') {
    try {
      const isSupported = !!(window.showDirectoryPicker && window.location.protocol === 'https:');
      sendResponse({ success: true, data: isSupported });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
});

// ページコンテンツの抽出とMarkdown変換
function extractPageContent() {
  try {
    // ページタイトルの取得
    const title = document.title || 'Untitled';
    
    // URLの取得
    const url = window.location.href;
    
    // ページコンテンツのクローン作成
    const content = document.cloneNode(true);
    
    // 不要な要素を除去
    removeUnwantedElements(content);
    
    // メインコンテンツの抽出
    const mainContent = extractMainContent(content);
    
    // TurndownService の確認と初期化
    if (typeof TurndownService === 'undefined') {
      throw new Error('Turndown library is not loaded');
    }

    // HTMLをMarkdownに変換
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      fence: '```',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
      linkReferenceStyle: 'full'
    });

    // 画像の処理を改善
    turndownService.addRule('images', {
      filter: 'img',
      replacement: function(content, node) {
        const alt = node.getAttribute('alt') || '';
        const src = node.getAttribute('src') || '';
        const title = node.getAttribute('title') || '';
        
        // 相対URLを絶対URLに変換
        const absoluteSrc = new URL(src, window.location.href).href;
        
        return title ? `![${alt}](${absoluteSrc} "${title}")` : `![${alt}](${absoluteSrc})`;
      }
    });

    // リンクの処理を改善
    turndownService.addRule('links', {
      filter: 'a',
      replacement: function(content, node) {
        const href = node.getAttribute('href') || '';
        const title = node.getAttribute('title') || '';
        
        if (!href) return content;
        
        // 相対URLを絶対URLに変換
        const absoluteHref = new URL(href, window.location.href).href;
        
        return title ? `[${content}](${absoluteHref} "${title}")` : `[${content}](${absoluteHref})`;
      }
    });

    // テーブルの処理を追加
    turndownService.addRule('tables', {
      filter: 'table',
      replacement: function(content, node) {
        const rows = Array.from(node.querySelectorAll('tr'));
        if (rows.length === 0) return '';

        let markdown = '\n';
        
        rows.forEach((row, index) => {
          const cells = Array.from(row.querySelectorAll('td, th'));
          const cellContents = cells.map(cell => 
            cell.textContent.trim().replace(/\|/g, '\\|')
          );
          
          markdown += '| ' + cellContents.join(' | ') + ' |\n';
          
          // ヘッダー行の後に区切り線を追加
          if (index === 0 && row.querySelector('th')) {
            const separator = cells.map(() => '---').join(' | ');
            markdown += '| ' + separator + ' |\n';
          }
        });
        
        return markdown + '\n';
      }
    });
    
    const markdown = turndownService.turndown(mainContent.innerHTML);
    
    // メタデータの追加
    const metadata = generateMetadata(title, url);
    const finalMarkdown = `${metadata}\n\n${markdown}`;
    
    return {
      title: title,
      url: url,
      markdown: finalMarkdown,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    throw new Error(`コンテンツ抽出エラー: ${error.message}`);
  }
}

// 不要な要素の除去
function removeUnwantedElements(content) {
  const unwantedSelectors = [
    // スクリプトとスタイル
    'script', 'style', 'noscript',
    
    // ナビゲーション要素
    'nav', 'header', 'footer', 'aside',
    
    // 広告関連
    '.ad', '.ads', '.advertisement', '.sponsor',
    '[class*="ad-"]', '[id*="ad-"]',
    '[class*="ads-"]', '[id*="ads-"]',
    
    // ソーシャル・共有ボタン
    '.social-share', '.share-buttons', '.social-buttons',
    '[class*="share"]', '[class*="social"]',
    
    // コメント・フィードバック
    '.comments', '.comment-section', '#comments',
    '.feedback', '.rating',
    
    // ポップアップ・モーダル
    '.popup', '.modal', '.overlay', '.lightbox',
    
    // その他の不要要素
    '.sidebar', '.widget', '.banner',
    '[role="complementary"]', '[role="banner"]'
  ];
  
  unwantedSelectors.forEach(selector => {
    try {
      const elements = content.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    } catch (e) {
      // セレクタエラーは無視
    }
  });
}

// メインコンテンツの抽出
function extractMainContent(content) {
  // メインコンテンツの候補セレクタ（優先順位付き）
  const contentSelectors = [
    'main',
    'article',
    '[role="main"]',
    '.main-content',
    '.content',
    '.post-content',
    '.entry-content',
    '.article-content',
    '#main-content',
    '#content',
    '#main',
    '.container .content',
    '.page-content'
  ];
  
  // 優先順位に従ってメインコンテンツを検索
  for (const selector of contentSelectors) {
    try {
      const element = content.querySelector(selector);
      if (element && element.textContent.trim().length > 100) {
        return element;
      }
    } catch (e) {
      // セレクタエラーは無視して次へ
      continue;
    }
  }
  
  // メインコンテンツが見つからない場合、body全体を使用
  const body = content.querySelector('body');
  if (body) {
    return body;
  }
  
  // bodyも見つからない場合、content全体を使用
  return content.documentElement || content;
}

// メタデータの生成
function generateMetadata(title, url) {
  const now = new Date();
  const dateString = now.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const timeString = now.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit'
  });
  
  return `# ${title}

**保存日時**: ${dateString} ${timeString}  
**元URL**: ${url}

---`;
}

// ページ読み込み完了時の初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

async function initialize() {
  // content scriptの初期化処理
  console.log('Markdown Saver content script loaded');
  
  // 保存されたディレクトリハンドルの復元を試行
  try {
    await restoreDirectoryHandle();
  } catch (error) {
    console.log('Directory handle restoration failed:', error.message);
  }
}

// IndexedDBデータベースを開く
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

// ディレクトリハンドルを保存
async function saveDirectoryHandle(handle) {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    await new Promise((resolve, reject) => {
      const request = store.put(handle, HANDLE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    console.log('Directory handle saved to IndexedDB');
  } catch (error) {
    console.error('Failed to save directory handle:', error);
    throw error;
  }
}

// ディレクトリハンドルを復元
async function restoreDirectoryHandle() {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    const handle = await new Promise((resolve, reject) => {
      const request = store.get(HANDLE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    if (handle) {
      // 権限の確認
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        currentDirectoryHandle = handle;
        console.log('Directory handle restored successfully:', handle.name);
        
        // Chrome storageにもディレクトリ名を保存（UI表示用）
        await chrome.storage.local.set({
          directoryName: handle.name,
          hasDirectoryAccess: true
        });
        
        return true;
      } else if (permission === 'prompt') {
        // ユーザーの許可を求める
        try {
          const newPermission = await handle.requestPermission({ mode: 'readwrite' });
          if (newPermission === 'granted') {
            currentDirectoryHandle = handle;
            console.log('Directory handle permission granted:', handle.name);
            
            await chrome.storage.local.set({
              directoryName: handle.name,
              hasDirectoryAccess: true
            });
            
            return true;
          }
        } catch (permError) {
          console.log('Permission request failed:', permError);
        }
      }
      
      // 権限が拒否された場合はハンドルをクリア
      await clearStoredDirectoryHandle();
    }
    
    return false;
  } catch (error) {
    console.error('Failed to restore directory handle:', error);
    return false;
  }
}

// 保存されたディレクトリハンドルをクリア
async function clearStoredDirectoryHandle() {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    await new Promise((resolve, reject) => {
      const request = store.delete(HANDLE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    // Chrome storageもクリア
    await chrome.storage.local.set({
      directoryName: null,
      hasDirectoryAccess: false
    });
    
    currentDirectoryHandle = null;
    console.log('Stored directory handle cleared');
  } catch (error) {
    console.error('Failed to clear stored directory handle:', error);
  }
}

// ディレクトリアクセス権限の確認
async function checkDirectoryPermission() {
  if (!currentDirectoryHandle) {
    return 'denied';
  }
  
  try {
    return await currentDirectoryHandle.queryPermission({ mode: 'readwrite' });
  } catch (error) {
    console.error('Permission check failed:', error);
    return 'denied';
  }
}

// ディレクトリ選択処理（Content Scriptで実行）
async function handleDirectorySelection() {
  try {
    // HTTPSページでのみFile System Access APIが動作
    if (window.location.protocol !== 'https:') {
      throw new Error('File System Access APIはHTTPSページでのみ利用可能です');
    }
    
    // File System Access APIの対応確認
    if (!window.showDirectoryPicker) {
      // ブラウザ判定
      const userAgent = navigator.userAgent;
      let browserName = 'このブラウザ';
      
      if (userAgent.includes('Chrome/') && !userAgent.includes('Edg')) {
        if (navigator.brave) {
          try {
            const isBrave = await navigator.brave.isBrave();
            if (isBrave) {
              browserName = 'Brave';
            }
          } catch (error) {
            // Brave検出失敗、Chrome判定で継続
          }
        }
      }
      
      if (browserName === 'Brave') {
        throw new Error(`Braveブラウザでは、プライバシー保護のため File System Access API がデフォルトで無効になっています。

📁 ディレクトリ選択機能を使用するには：

1. 新しいタブで brave://flags を開く
2. 「File System Access API」を検索
3. 設定を「Enabled」に変更
4. ブラウザを再起動

⚠️ 注意：この機能を有効にすると、ウェブサイトがファイルシステムにアクセスできるようになります。信頼できるサイトでのみ使用してください。

💡 ヒント：この設定を変更したくない場合は、ダウンロードフォルダへの保存をご利用ください。`);
      } else {
        throw new Error('このブラウザはFile System Access APIに対応していません。ChromeまたはEdgeブラウザでお試しください。');
      }
    }
    
    // ディレクトリ選択ダイアログを表示
    currentDirectoryHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads'
    });
    
    // ハンドルをIndexedDBに保存
    await saveDirectoryHandle(currentDirectoryHandle);
    
    // Chrome storageにもディレクトリ名を保存（UI表示用）
    await chrome.storage.local.set({
      directoryName: currentDirectoryHandle.name,
      hasDirectoryAccess: true
    });
    
    return {
      name: currentDirectoryHandle.name,
      success: true
    };
  } catch (error) {
    console.error('Directory selection error:', error);
    throw error;
  }
}

// ディレクトリへのファイル保存処理
async function handleDirectorySave(data) {
  try {
    // ディレクトリハンドルの有効性を確認
    if (!currentDirectoryHandle) {
      // 保存されたハンドルの復元を試行
      const restored = await restoreDirectoryHandle();
      if (!restored) {
        throw new Error('ディレクトリが選択されていません。保存先を選択してください。');
      }
    }
    
    // 権限の再確認
    const permission = await checkDirectoryPermission();
    if (permission !== 'granted') {
      if (permission === 'prompt') {
        // ユーザーの許可を求める
        const newPermission = await currentDirectoryHandle.requestPermission({ mode: 'readwrite' });
        if (newPermission !== 'granted') {
          throw new Error('ディレクトリへのアクセス権限が拒否されました。');
        }
      } else {
        throw new Error('ディレクトリへのアクセス権限がありません。');
      }
    }
    
    const { fileName, content } = data;
    
    // 重複しないファイル名を生成
    const finalFileName = await getUniqueFileName(fileName);
    
    // ファイルを作成・書き込み
    const fileHandle = await currentDirectoryHandle.getFileHandle(finalFileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    
    return {
      fileName: finalFileName,
      directoryName: currentDirectoryHandle.name,
      success: true
    };
  } catch (error) {
    console.error('Directory save error:', error);
    
    // 権限エラーの場合はハンドルをクリア
    if (error.name === 'NotAllowedError' || error.message.includes('権限')) {
      await clearStoredDirectoryHandle();
    }
    
    throw error;
  }
}

// 重複しないファイル名の生成
async function getUniqueFileName(fileName) {
  let counter = 0;
  let finalFileName = fileName;
  
  while (true) {
    try {
      await currentDirectoryHandle.getFileHandle(finalFileName);
      // ファイルが存在する場合、カウンターを増やして再試行
      counter++;
      const nameParts = fileName.split('.');
      const extension = nameParts.pop();
      const baseName = nameParts.join('.');
      finalFileName = `${baseName}_${counter}.${extension}`;
    } catch (error) {
      // ファイルが存在しない場合、この名前を使用
      break;
    }
  }
  
  return finalFileName;
}