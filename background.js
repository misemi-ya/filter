import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bjwmvbfwpvbzmjxjclgr.supabase.co';
const supabaseKey = 'sb_publishable_Phz_7QEJR8QkFdEEuu_RFA_Jlk8J2rr';
const GEMINI_API_KEY = 'AIzaSyA73wZvsF9_tTOFm3cDHV5Vq06qh_e9HiU'; // Geminiのキー
const supabase = createClient(supabaseUrl, supabaseKey);
// background.js の修正箇所

// ブロック時の飛ばし先を自分のドメインにする
const BLOCK_PAGE_URL = "https://filter.misemi-ya.net/blocked.html";

let currentMode = 'free';
let checkInterval;

// 1. 監視ループ開始 (15秒に1回チェック)
chrome.runtime.onStartup.addListener(startMonitoring);
chrome.runtime.onInstalled.addListener(startMonitoring);

function startMonitoring() {
  fetchPolicy(); // モード確認
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(checkScreenAndJudge, 15000); // 15秒間隔
}

// 2. リアルタイムポリシー監視
supabase
  .channel('public:policies')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'policies' }, payload => {
    currentMode = payload.new.mode;
    console.log("モード変更:", currentMode);
  })
  .subscribe();

async function fetchPolicy() {
  const { data } = await supabase.from('policies').select('mode').single();
  if (data) currentMode = data.mode;
}

// 3. 画面キャプチャ＆AI判定のメイン処理
async function checkScreenAndJudge() {
  if (currentMode !== 'study') return; // 勉強モード以外は何もしない

  // アクティブなタブを取得
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || tab.url.startsWith('chrome://')) return;

  // 生徒の情報を取得 (ChromeにログインしているGoogleアカウント)
  chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, async (userInfo) => {
    const studentEmail = userInfo.email || 'guest';

    // スクリーンショット撮影 (base64)
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 50 }, async (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) return;

      // Base64のヘッダー削除
      const base64Image = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

      // AIに画像を見せる
      const result = await askGeminiVision(base64Image);

      console.log("AI判定:", result);

      // ログ保存
      await supabase.from('logs').insert([{
        student_id: studentEmail,
        url: tab.url,
        ai_reason: result.reason,
        screenshot_score: result.score
      }]);

      // 有害(ゲーム/動画)ならブロック画面へ
      if (result.isBlocked) {
        chrome.tabs.update(tab.id, { url: "https://school-warning.vercel.app" });
      }
    });
  });
}

// Gemini Vision API (画像解析)
async function askGeminiVision(base64Image) {
  const prompt = `
    You are a teacher monitoring a student's screen.
    Analyze this screenshot. Is the student playing a game, watching entertainment videos (YouTube/Netflix), or looking at adult content?
    Or are they studying/working (document, coding, news, search engine)?
    
    Respond in JSON format:
    {
      "isBlocked": true/false, (true if game/entertainment/adult)
      "score": 0-100, (100 is definitely harmful, 0 is safe)
      "reason": "Short reason in Japanese"
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
    
    // JSON部分だけ取り出す処理
    const jsonStr = text.match(/\{[\s\S]*\}/)[0];
    return JSON.parse(jsonStr);

  } catch (error) {
    console.error("AI Error:", error);
    return { isBlocked: false, score: 0, reason: "Error" };
  }
}