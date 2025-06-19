// Background script (Service Worker) for Markdown Saver extension

// 拡張機能のインストール・アップデート時の処理
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Markdown Saver extension installed/updated:', details.reason);
  
  // 初期設定の保存
  await chrome.storage.local.set({
    version: chrome.runtime.getManifest().version,
    installDate: new Date().toISOString()
  });
});

// メッセージリスナーの設定
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  switch (message.action) {
    case 'saveFile':
      handleFileSave(message.data)
        .then(result => sendResponse({ success: true, data: result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // 非同期レスポンスを有効にする
      
      
    default:
      console.warn('Unknown message action:', message.action);
      sendResponse({ success: false, error: 'Unknown action' });
      return false;
  }
});

// ファイル保存処理（Downloads API使用）
async function handleFileSave(data) {
  try {
    const { fileName, content, useDownloads = true } = data;
    
    if (useDownloads) {
      return await saveWithDownloadsAPI(fileName, content);
    } else {
      throw new Error('File System Access API is not available in background script');
    }
  } catch (error) {
    console.error('File save error:', error);
    throw error;
  }
}

// Downloads APIでのファイル保存
async function saveWithDownloadsAPI(fileName, content) {
  return new Promise((resolve, reject) => {
    try {
      // Data URLとして作成（Service Workerでより安全）
      const encodedContent = encodeURIComponent(content);
      const dataUrl = `data:text/markdown;charset=utf-8,${encodedContent}`;
      
      // ダウンロード実行
      chrome.downloads.download({
        url: dataUrl,
        filename: fileName,
        saveAs: false,
        conflictAction: 'uniquify'
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        // シンプルに成功として処理（監視なし）
        resolve({ downloadId, fileName });
      });
      
    } catch (error) {
      reject(error);
    }
  });
}




// Service Worker の起動確認
console.log('Markdown Saver background script (service worker) started');