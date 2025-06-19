# Markdown Saver

WebページをMarkdown形式で保存するブラウザ拡張機能です。

## 機能

- WebページをMarkdown形式で保存
- 指定したディレクトリへの直接保存
- 自動ファイル名生成と重複回避
- Chrome/Firefox対応

## インストール

### Chrome（開発者モード）

1. `chrome://extensions/` にアクセス
2. 開発者モードを有効にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このプロジェクトのフォルダを選択

### Firefox（一時的なアドオン）

1. `about:debugging` にアクセス
2. 「この Firefox」をクリック
3. 「一時的なアドオンを読み込む」をクリック
4. `manifest.json` ファイルを選択

## 使用方法

1. 保存したいWebページを開く
2. 拡張機能アイコンをクリック
3. 初回は保存先ディレクトリを選択
4. 「ページを保存」ボタンをクリック

## 対応ブラウザ

| ブラウザ     | ディレクトリ選択 | フォールバック |
| ------------ | :--------------: | :------------: |
| Chrome 88+   |        ✓         |       ✓        |
| Edge 88+     |        ✓         |       ✓        |
| Firefox 109+ |        -         |       ✓        |

## 開発

### デバッグ方法

- 拡張機能エラー確認: `chrome://extensions/` → 詳細 → 拡張機能エラー
- Service Worker デバッグ: 拡張機能管理で「Service Worker」をクリック
- コンテンツスクリプト: 対象ページの開発者ツールでコンソール確認

### ファイル構成

```
md-storage/
├── manifest.json          # 拡張機能設定
├── popup.html             # ポップアップUI
├── popup.js               # UI制御
├── content.js             # コンテンツ抽出
├── background.js          # Service Worker
├── styles.css             # スタイル
├── icons/                 # アイコン
└── libs/                  # 外部ライブラリ
    └── turndown.min.js    # HTML→Markdown変換
```

## 技術仕様

- Manifest V3
- File System Access API
- IndexedDB（権限管理）
- Turndown.js（HTML→Markdown変換）
