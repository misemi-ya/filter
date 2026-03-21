const query = new URLSearchParams(location.search);
const category = query.get("category") || "未分類";

const blockedMessage = document.getElementById("blockedMessage");
const categoryText = document.getElementById("categoryText");

blockedMessage.textContent = "このサイトはミセフィルタのポリシーによりブロックされています。";
categoryText.textContent = `カテゴリ: ${category}`;

document.getElementById("goBack").addEventListener("click", () => {
  history.back();
});

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
