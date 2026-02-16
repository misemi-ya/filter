import { createClient } from '@supabase/supabase-js';

// --- 設定エリア ---
const supabaseUrl = 'https://bjwmvbfwpvbzmjxjclgr.supabase.co';
const supabaseKey = 'sb_publishable_Phz_7QEJR8QkFdEEuu_RFA_Jlk8J2rr';
const GEMINI_API_KEY = 'AIzaSyA73wZvsF9_tTOFm3cDHV5Vq06qh_e9HiU'; 
const BLOCK_PAGE_URL = "https://filter.misemi-ya.net/blocked.html";

const supabase = createClient(supabaseUrl, supabaseKey);

let currentMode = 'free';
let categorySettings = {}; // 50カテゴリの設定が入る箱
let checkInterval;

// --- 1. 初期化処理 ---

chrome.runtime.onStartup.addListener(startMonitoring);
chrome.runtime.onInstalled.addListener(startMonitoring);

async function startMonitoring() {
  await fetchPolicy(); // 起動時にDBから設定を取得
  if (checkInterval) clearInterval(checkInterval);
  // 15秒ごとに画面をチェック
  checkInterval = setInterval(checkScreenAndJudge, 15000); 
}

// --- 2. リアルタイム監視 (Supabase) ---

supabase
  .channel('public:policies')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'policies' }, payload => {
    currentMode = payload.new.mode;
    categorySettings = payload.new.category_settings; // 50カテゴリ設定も更新
    console.log("設定が更新されました:", { mode: currentMode, categories: categorySettings });
    
    // モードが変わった瞬間にアイコンを更新するための反映
    refreshCurrentTabIcon();
  })
  .subscribe();

async function fetchPolicy() {
  const { data } = await supabase.from('policies').select('*').single();
  if (data) {
    currentMode = data.mode;
    categorySettings = data.category_settings;
  }
}

// --- 3. メインロジック (画面キャプチャ & AI判定) ---

async function checkScreenAndJudge() {
  // アクティブなタブを取得
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
    return;
  }

  // 自由モードならチェックせず「OK」アイコンにして終了
  if (currentMode === 'free') {
    updateIcon('safe', tab.id);
    return;
  }

  // ユーザー情報の取得
  chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, async (userInfo) => {
    const studentEmail = userInfo.email || 'guest';

    // 画面キャプチャ (jpeg形式)
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 40 }, async (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) return;

      const base64Image = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

      // AIに画像判定を依頼
      const result = await askGeminiVision(base64Image);
      console.log("AI判定結果:", result);

      // --- ブロック判定ロジック ---
      // 1. AIが判定したカテゴリが、先生の設定で「true（ブロック対象）」になっているか確認
      const isCategoryBlocked = categorySettings[result.category] === true;
      
      // 2. 最終的にブロックするかどうか
      const finalBlock = result.isBlockedSystem || isCategoryBlocked;

      // ログをSupabaseへ保存
      supabase.from('logs').insert([{
        student_id: studentEmail,
        url: tab.url,
        ai_reason: `${result.category}: ${result.reason}`,
        screenshot_score: result.score
      }]);

      if (finalBlock) {
        updateIcon('blocked', tab.id);
        chrome.tabs.update(tab.id, { url: BLOCK_PAGE_URL });
      } else {
        updateIcon('safe', tab.id);
      }
    });
  });
}

// --- 4. Gemini Vision API (50カテゴリ対応版) ---

async function askGeminiVision(base64Image) {
  // 判定させるカテゴリのリストをAIに教える
  const categoryList = Object.keys(categorySettings).join(', ');

  const prompt = `
    あなたは学校の先生です。生徒の画面を監視しています。
    このスクリーンショットを分析し、以下のカテゴリリストの中から最も当てはまるものを1つだけ選んでください。
    
    カテゴリリスト: [${categoryList}]
    
    また、それが「ゲーム・エンタメ・娯楽・アダルト」に該当し、学習を妨げるものである場合は isBlockedSystem を true にしてください。
    
    返答は必ず以下のJSON形式のみで行ってください。
    {
      "category": "カテゴリ名",
      "isBlockedSystem": true/false,
      "score": 0-100,
      "reason": "日本語の理由"
    }
  `;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/jpeg", data: base64Image } }
          ]
        }]
      })
    });

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;
    const jsonStr = text.match(/\{[\s\S]*\}/)[0];
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("AI判定エラー:", error);
    return { category: "other", isBlockedSystem: false, score: 0, reason: "Error" };
  }
}

// --- 5. アイコン・タブ操作ユーティリティ ---

function updateIcon(status, tabId) {
  const iconPath = status === 'blocked' ? 'no.png' : 'ok.png';
  chrome.action.setIcon({
    path: iconPath,
    tabId: tabId
  });
}

// タブを切り替えたときにもアイコンを正しくする
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  refreshCurrentTabIcon(activeInfo.tabId);
});

async function refreshCurrentTabIcon(targetTabId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const tid = targetTabId || tab.id;

  if (currentMode === 'free') {
    updateIcon('safe', tid);
  } else if (tab.url && tab.url.includes("filter.misemi-ya.net/blocked.html")) {
    updateIcon('blocked', tid);
  } else {
    updateIcon('safe', tid);
  }
}