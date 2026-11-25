@echo off
setlocal
cd /d "%~dp0"
set "SMARTBIN_TELEGRAM_TARGET=%~1"

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -Command ^
  "$target = $env:SMARTBIN_TELEGRAM_TARGET;" ^
  "if ($target -eq '--choose-demo') {" ^
  "  Write-Host '1. Demo tu dong tren web + Telegram';" ^
  "  Write-Host '2. Dieu khien tren Wokwi, xem tren web + Telegram';" ^
  "  do {" ^
  "    $mode = (Read-Host 'Nhap 1 hoac 2 roi nhan Enter (Q de thoat)').Trim();" ^
  "    if ($mode -eq 'Q') { exit 0 }" ^
  "  } while ($mode -notin '1','2');" ^
  "  $target = if ($mode -eq '1') { '--web-demo' } else { '--wokwi-demo' };" ^
  "  $env:TELEGRAM_BOT_TOKEN = '';" ^
  "  $env:TELEGRAM_CHAT_ID = '';" ^
  "}" ^
  "while ($env:TELEGRAM_BOT_TOKEN -notmatch '^[0-9]+:[A-Za-z0-9_-]+$') {" ^
  "  $tokenInput = Read-Host 'Bot Token (dan token, an ky tu, sau do nhan Enter)' -AsSecureString;" ^
  "  $env:TELEGRAM_BOT_TOKEN = [System.Net.NetworkCredential]::new('', $tokenInput).Password.Trim();" ^
  "  if ($env:TELEGRAM_BOT_TOKEN -eq 'Q') { exit 0 }" ^
  "  if ($env:TELEGRAM_BOT_TOKEN -notmatch '^[0-9]+:[A-Za-z0-9_-]+$') { Write-Host 'Token trong hoac sai dinh dang. Dan lai token cua BotFather (hoac nhap Q de thoat).' }" ^
  "}" ^
  "if (-not $env:TELEGRAM_CHAT_ID) {" ^
  "  $env:TELEGRAM_CHAT_ID = (Read-Host 'Chat ID (press Enter to look it up)').Trim();" ^
  "  if (-not $env:TELEGRAM_CHAT_ID) {" ^
  "    $chats = @{};" ^
  "    $api = 'https://api.telegram.org/bot' + $env:TELEGRAM_BOT_TOKEN;" ^
  "    try {" ^
  "      $bot = Invoke-RestMethod -Uri ($api + '/getMe') -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop;" ^
  "      Write-Host ('Bot: @{0} ({1})' -f $bot.result.username, $bot.result.first_name);" ^
  "      while ($chats.Count -eq 0) {" ^
  "        $reply = Read-Host 'Send a NEW message (e.g. test) to the bot above, then press Enter. Type Q to quit';" ^
  "        if ($reply -eq 'Q') { exit 0 }" ^
  "        $updates = Invoke-RestMethod -Uri ($api + '/getUpdates?timeout=10') -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop;" ^
  "        foreach ($update in $updates.result) {" ^
  "          $chat = $update.message.chat;" ^
  "          if ($chat.id) { $chats[[string]$chat.id] = $chat }" ^
  "        }" ^
  "        if ($chats.Count -eq 0) { Write-Host 'No new chat was found. Check the bot username and send another message.' }" ^
  "      }" ^
  "      foreach ($chatId in $chats.Keys) {" ^
  "        $chat = $chats[$chatId];" ^
  "        Write-Host ('{0}  {1}  {2}' -f $chatId, $chat.type, ($chat.title + $chat.username));" ^
  "      }" ^
  "    } catch {" ^
  "      $status = [int]$_.Exception.Response.StatusCode;" ^
  "      if ($status -eq 409) { Write-Host 'Telegram HTTP 409. Another program is receiving updates for this bot.' }" ^
  "      elseif ($status -in 401,404) { Write-Host 'Telegram rejected the token. Copy it again from BotFather.' }" ^
  "      else { Write-Host ('Telegram lookup failed (HTTP {0}). Check the connection or enter a known Chat ID.' -f $status) }" ^
  "      exit 1;" ^
  "    }" ^
  "    $env:TELEGRAM_CHAT_ID = (Read-Host 'Enter the Chat ID you want to use').Trim();" ^
  "  }" ^
  "}" ^
  "if ($env:TELEGRAM_CHAT_ID -notmatch '^-?[1-9][0-9]*$') { Write-Host 'Invalid Chat ID. Include the minus sign if shown.'; exit 1 }" ^
  "$env:TELEGRAM_ENABLED = 'true';" ^
  "if ($target -eq '--wokwi-demo') { & '.\CHAY-DO-AN.cmd' '--send-telegram' '--wokwi'; exit $LASTEXITCODE }" ^
  "if ($target -eq '--web-demo') { & '.\CHAY-DO-AN.cmd' '--send-telegram'; exit $LASTEXITCODE }" ^
  "& '.\start-node-red.cmd' '--no-pause'; exit $LASTEXITCODE"

if errorlevel 1 (
  pause
  exit /b 1
)
