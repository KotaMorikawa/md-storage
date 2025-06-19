document.addEventListener('DOMContentLoaded', async () => {
  const saveButton = document.getElementById('saveButton');
  const saveButtonText = document.getElementById('saveButtonText');
  const directoryButton = document.getElementById('directoryButton');
  const directoryPath = document.getElementById('directoryPath');
  const status = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const browserInfo = document.getElementById('browserInfo');
  const braveHelp = document.getElementById('braveHelp');
  const braveHelpToggle = document.getElementById('braveHelpToggle');
  const braveHelpContent = document.getElementById('braveHelpContent');
  const toggleIcon = braveHelpToggle?.querySelector('.toggle-icon');

  let selectedDirectoryHandle = null;
  let isProcessing = false;

  // 初期化：保存されたディレクトリ情報を復元
  await initializeDirectory();
  
  // ブラウザ情報を表示
  await initializeBrowserInfo();
  
  // Braveヘルプの折りたたみ機能
  if (braveHelpToggle && braveHelpContent && toggleIcon) {
    braveHelpToggle.addEventListener('click', () => {
      const isCollapsed = braveHelpContent.classList.contains('collapsed');
      
      if (isCollapsed) {
        braveHelpContent.classList.remove('collapsed');
        toggleIcon.classList.remove('rotated');
      } else {
        braveHelpContent.classList.add('collapsed');
        toggleIcon.classList.add('rotated');
      }
    });
  }

  // 保存ボタンのクリック処理
  saveButton.addEventListener('click', async () => {
    if (isProcessing) return;

    try {
      setProcessingState(true);
      showStatus('processing', '現在のページを取得中...');

      // アクティブタブの取得
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('アクティブなタブが見つかりません');
      }

      // content.js にメッセージを送信してページコンテンツを取得
      showStatus('processing', 'Markdownに変換中...');
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractContent' });

      if (!response || !response.success) {
        throw new Error(response?.error || 'ページコンテンツの取得に失敗しました');
      }

      const { title, markdown } = response.data;

      // ファイル保存処理
      showStatus('processing', 'ファイルを保存中...');
      await saveMarkdownFile(title, markdown, tab.url);

      showStatus('success', '保存が完了しました！');
      setTimeout(() => hideStatus(), 3000);

    } catch (error) {
      console.error('保存エラー:', error);
      showStatus('error', `エラー: ${error.message}`);
      setTimeout(() => hideStatus(), 5000);
    } finally {
      setProcessingState(false);
    }
  });

  // ディレクトリ選択ボタンのクリック処理
  directoryButton.addEventListener('click', async () => {
    try {
      showStatus('processing', 'ディレクトリ選択中...');
      
      // アクティブタブの取得
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('アクティブなタブが見つかりません');
      }
      
      // HTTPSページかチェック
      if (!tab.url.startsWith('https://')) {
        throw new Error('File System Access APIはHTTPSページでのみ利用可能です。HTTPSサイトでお試しください。');
      }
      
      // Content Script経由でディレクトリ選択
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'selectDirectory' });
      
      if (!response.success) {
        throw new Error(response.error);
      }
      
      // UIを更新
      await saveDirectoryName(response.data.name);
      updateDirectoryDisplay(response.data.name);
      showStatus('success', 'ディレクトリが選択されました');
      setTimeout(() => hideStatus(), 2000);
      
    } catch (error) {
      console.error('ディレクトリ選択エラー:', error);
      if (error.message.includes('HTTPSページでのみ')) {
        showStatus('error', 'HTTPSページでのみ利用可能です');
      } else {
        showStatus('error', error.message || 'ディレクトリの選択に失敗しました');
      }
      setTimeout(() => hideStatus(), 4000);
    }
  });

  // 初期化：保存されたディレクトリ情報を復元
  async function initializeDirectory() {
    try {
      const result = await chrome.storage.local.get(['directoryName', 'hasDirectoryAccess']);
      if (result.directoryName && result.hasDirectoryAccess) {
        updateDirectoryDisplay(result.directoryName);
        // content script内でディレクトリハンドルが保持されているかは不明なので、
        // 新しいページでは再選択が必要であることを示唆
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url.startsWith('https://')) {
          directoryPath.style.color = '#2e7d32';
        } else {
          directoryPath.textContent += ' (HTTPSページでのみ有効)';
          directoryPath.style.color = '#f57c00';
        }
      }
    } catch (error) {
      console.error('ディレクトリ情報の復元エラー:', error);
    }
  }

  // ディレクトリ名の保存
  async function saveDirectoryName(directoryName) {
    try {
      await chrome.storage.local.set({
        directoryName: directoryName,
        hasDirectoryAccess: true
      });
    } catch (error) {
      console.error('ディレクトリ名保存エラー:', error);
    }
  }

  // ディレクトリ表示の更新
  function updateDirectoryDisplay(dirName) {
    directoryPath.textContent = dirName;
    directoryPath.classList.remove('empty');
  }

  // Markdownファイルの保存
  async function saveMarkdownFile(title, markdown, url) {
    const fileName = sanitizeFileName(title || 'page') + '.md';
    
    // アクティブタブの取得
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('アクティブなタブが見つかりません');
    }
    
    // ディレクトリが選択されていて、HTTPSページの場合はFile System Access APIを使用
    const result = await chrome.storage.local.get(['hasDirectoryAccess']);
    const hasDirectoryAccess = result.hasDirectoryAccess;
    
    if (hasDirectoryAccess && tab.url.startsWith('https://')) {
      try {
        // Content Script経由でディレクトリに保存
        const response = await chrome.tabs.sendMessage(tab.id, { 
          action: 'saveToDirectory',
          data: { fileName, content: markdown }
        });
        
        if (!response.success) {
          throw new Error(response.error);
        }
        
        return response.data;
      } catch (error) {
        console.error('Directory save error:', error);
        showStatus('processing', 'ディレクトリ保存に失敗。ダウンロードフォルダに保存中...');
        // フォールバックとしてDownloads APIを使用
        await saveWithDownloadsAPI(fileName, markdown);
      }
    } else {
      // Downloads API使用
      await saveWithDownloadsAPI(fileName, markdown);
    }
  }


  // Downloads APIでの保存（background.js経由）
  async function saveWithDownloadsAPI(fileName, content) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'saveFile',
        data: { fileName, content, useDownloads: true }
      });
      
      if (!response.success) {
        throw new Error(response.error);
      }
      
      return response.data;
    } catch (error) {
      throw new Error(`ダウンロードに失敗しました: ${error.message}`);
    }
  }


  // ファイル名のサニタイズ
  function sanitizeFileName(fileName) {
    return fileName
      .replace(/[<>:"/\\|?*]/g, '')  // 無効な文字を削除
      .replace(/\s+/g, '_')          // スペースをアンダースコアに変換
      .substring(0, 100);            // 長さ制限
  }

  // 処理状態の設定
  function setProcessingState(processing) {
    isProcessing = processing;
    saveButton.disabled = processing;
    directoryButton.disabled = processing;
    
    if (processing) {
      saveButtonText.innerHTML = '<span class="spinner"></span>処理中...';
    } else {
      saveButtonText.textContent = 'ページを保存';
    }
  }

  // 状態表示
  function showStatus(type, message) {
    status.className = `status ${type}`;
    statusText.textContent = message;
  }

  // 状態非表示
  function hideStatus() {
    status.className = 'status hidden';
  }

  // ブラウザ名取得（非同期）
  async function getBrowserName() {
    const userAgent = navigator.userAgent;
    
    if (userAgent.includes('Edg/')) return 'Microsoft Edge';
    if (userAgent.includes('Chrome/') && !userAgent.includes('Edg')) {
      if (navigator.brave) {
        try {
          const isBrave = await navigator.brave.isBrave();
          if (isBrave) return 'Brave';
        } catch (error) {
          // Brave検出失敗時はChromeとして処理
        }
      }
      return userAgent.includes('OPR/') ? 'Opera' : 'Chrome';
    }
    if (userAgent.includes('Firefox/')) return 'Firefox';
    if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) return 'Safari';
    return 'Unknown Browser';
  }

  // ブラウザ情報の初期化
  async function initializeBrowserInfo() {
    const browserName = await getBrowserName();
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const isHttps = tab && tab.url.startsWith('https://');
      
      if (isHttps && browserName === 'Brave') {
        browserInfo.textContent = `${browserName} - File System API要手動有効化`;
        browserInfo.style.color = '#f57c00';
        braveHelp.classList.remove('hidden');
      } else if (isHttps) {
        browserInfo.textContent = `${browserName} - ディレクトリ選択対応（HTTPSページ）`;
        browserInfo.style.color = '#2e7d32';
        braveHelp.classList.add('hidden');
      } else {
        browserInfo.textContent = `${browserName} - HTTPSページでディレクトリ選択可能`;
        browserInfo.style.color = '#f57c00';
        braveHelp.classList.add('hidden');
      }
    } catch (error) {
      browserInfo.textContent = `${browserName} - ダウンロードフォルダのみ`;
      browserInfo.style.color = '#666';
      braveHelp.classList.add('hidden');
    }
  }
});


