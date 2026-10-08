# ZNE 噪聲偵探：React + FastAPI + IBM Quantum

可玩的教學原型：取得 1× / 3× / 5× 量測平均、猜零噪聲答案、選直線或指數模型、揭曉參考答案。

## 本機啟動

在本專案根目錄開啟兩個終端。需要 Python 3.12+、Node.js 22.12+。

後端（PowerShell）：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

前端：

```powershell
cd frontend
npm install
npm run dev
```

開啟 http://127.0.0.1:5173 。API 文件：http://127.0.0.1:8000/docs 。

### 目前這台電腦的快速啟動

Codex 已安裝相依套件；但沙箱中的監聽服務可能無法被一般瀏覽器存取。請在你自己的 PowerShell（不需要管理員）執行本專案 `start-local.ps1`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1
```

這裡的 ExecutionPolicy Bypass 僅針對本次腳本程序，不更改系統設定。腳本在目前使用者環境以隱藏視窗啟動前後端，驗證 HTTP 健康狀態，顯示本次 PID；log 在 `.local/`。它不停止任何既有服務，不更改防火牆，不呼叫 IBM。此快速啟動也能使用 Codex 存在本次工作資料夾 `work/pydeps` 的 Python 套件；複製到其他電腦後依前面的標準流程安裝。

若 8000 或 5173 已占用，腳本自動選下一個可綁定的連接埠，同步設定後端 port、前端 API proxy 與 CORS。請使用腳本輸出的 `Ready:` URL，可能不是 5173。也可指定 `-BackendPort 8010 -FrontendPort 5180`。瀏覽器測試若使用不同 URL，先設定 `$env:ZNE_TEST_URL = 'http://127.0.0.1:5180'`。

IBM key 請只在啟動後端的本機終端設定環境變數，不貼聊天、不寫前端。若已啟動後端，變更 key / IBM_ENABLE 後需停止該後端 PID 再重新啟動，不能靠刷新前端載入新環境變數。

## 三個不同的值

- 教學模型的參考值：0.9，提交前保留在後端。
- 量測值：由 0 / 1 次數換算，0 記 +1、1 記 −1；不是正確率。
- 外推值：由有噪聲的量測點擬合得到；不能當成真實答案。

教學模式是合成二項抽樣模型，不是量子電路模擬器。直線模型為 0.9−0.1λ；指數模型為 0.9×0.8^λ。seed 固定為 42，方便重現。不同 shots 用相同 seed 的實驗仍不保證單次結果隨 shots 單調改善。

誤差棒是 ±2 個估計標準誤，供教學比較，並非所有情況都具有精確的 95% 覆蓋率。外推的不確定性僅來自局部擬合，不包含模型選擇、硬體漂移和其他偏差。超出 [-1,1] 的外推保留原值並警告。

## IBM 真機（預設停用）

程式使用 Runtime 0.47.0 的 SamplerV2 API，requirements 固定 Qiskit 2.5.2 / Runtime 0.47.0。0.50+ 有新的 client-side import；升級時依官方遷移文件調整，勿直接改版本。

在啟動後端的終端設定環境變數：

```powershell
$env:IBM_ENABLE = 'true'
$env:IBM_QUANTUM_TOKEN = '<你的 IBM API key>'
$env:IBM_QUANTUM_INSTANCE = '<你的 instance CRN>'
$env:IBM_BACKEND = '<帳號可存取的 backend 名稱>'
```

重新啟動後端、重新整理前端，選 IBM 真機。按開始將真正提交任務、消耗帳號 QPU 額度。程式不會在 import 或測試時提交真機任務，token 不會傳給前端，也不會寫進 run JSON。

IBM 範例電路：2 qubits、Ry(arccos(0.9))、9 個 CX，讀取 qubit 1 的 Z 期望值。CX 自反，因此每個 CX 替換成 1 / 3 / 5 個 CX，理想結果仍是 0.9。每個 CX 後插入 barrier，optimization_level=0，三個版本固定相同 physical layout，提交前檢查轉譯後雙 qubit 閘數保留倍率。

這是 **手動 gate-folding + Sampler counts + Python 擬合**，不是宣稱 Sampler 有內建 ZNE。沒有啟用讀出緩解，讀出偏差會影響外推；教學真機的噪聲倍率只是放大設定，不保證所有噪聲精確放大。這個小電路用於展示接線流程，不保證有足夠訊號辨識不同模型，也不保證外推改善結果。

一個 IBM job 包含三個電路；每個倍率 shots 上限 10,000。背景 thread 提交、前端輪詢結果，job ID 與設定保存在 backend/data/，可在後端重啟後重新輪詢 queued/running job。若剛提交就重啟（submitting 狀態），需在 IBM Workloads 手動核對是否已提交；本原型未提供交易級恢復或取消。預設一次只允許一個 active IBM run。

本機單人原型，服務綁定 127.0.0.1。公開部署前需新增身分驗證、使用者隔離、真正的任務佇列、每人配額、取消及重試規則；CORS 不是身分驗證。

## 測試

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
cd frontend
npm run build
# 先啟動前後端，再執行瀏覽器測試：
npx playwright install chromium
npx playwright test
```

測試包含平均值換算、bitstring 位元順序、外推、無效輸入、API 完整流程、理想量子電路等價性、轉譯保留摺疊，以及 IBM 提交／結果解析 mock。測試不使用 token、不提交真機任務。

## IBM 官方參考

- https://quantum.cloud.ibm.com/docs/en/guides/get-started-with-sampler
- https://quantum.cloud.ibm.com/docs/en/guides/error-mitigation-and-suppression-techniques
- https://quantum.cloud.ibm.com/docs/en/guides/save-jobs

`backend/core.py`：資料與模型；`backend/ibm_adapter.py`：IBM 呼叫；`backend/app.py`：API；`frontend/src/main.jsx`：遊戲；`backend/tests/test_game.py`：後端測試；`frontend/tests/game.spec.js`：瀏覽器測試。
