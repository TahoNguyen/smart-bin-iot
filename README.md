# Smart Bin v4

Đồ án IoT của Nhóm 06 mô phỏng thùng rác tự mở nắp, đo mức rác ở hai vùng A/B và gửi cảnh báo qua Telegram. Bộ điều khiển C++ dùng chung cho firmware ESP32 và mô phỏng web. MQTT chuyển dữ liệu đến Node-RED để hiển thị và xử lý cảnh báo.

## Chạy demo trên web

1. Trên Windows 10/11 x64, cài [Node.js 24 có npm](https://nodejs.org/en/download) và [Zig 0.13.0](https://ziglang.org/download/#release-0.13.0). Thêm thư mục chứa `zig.exe` vào `Path`.
2. Chạy `CAI-DAT.cmd` để cài thư viện, biên dịch bộ mô phỏng và chạy kiểm thử C++.
3. Chạy `CHAY-DO-AN.cmd`. Mở [web demo](http://127.0.0.1:8765/) và bấm **Chạy demo báo đầy** để xem các mốc 80%, 90% và 100%. [Dashboard Node-RED](http://127.0.0.1:1882/bin) hiển thị trạng thái và lệnh điều khiển.

## Wokwi và Telegram

- **Wokwi độc lập:** mở thư mục dự án trong VS Code, cài PlatformIO và Wokwi, chạy `pio run -e esp32dev` rồi chạy **Wokwi: Start Simulator**. Giữ **H** để mô phỏng đưa tay vào. Dùng **S** để thử thay túi.
- **Telegram:** dừng phiên demo cũ rồi chạy `CHAY-DO-AN-TELEGRAM.cmd`. Chọn **1** để chạy demo trên web hoặc **2** để lấy dữ liệu từ Wokwi. Nhập Bot Token và Chat ID trong cửa sổ lệnh.
- **Wokwi nối web:** biên dịch bằng `pio run -e esp32-wokwi-local`, chọn `wokwi-local/wokwi.toml` qua **Wokwi: Select Config File** rồi bật **Private Gateway** sau khi chạy mô phỏng. Để xem dữ liệu cục bộ, dùng `CHAY-DO-AN.cmd --wokwi`. Để nhận Telegram, dùng chế độ **2** ở trên.

## Kiểm thử

Sau khi cài đặt, chạy các lệnh sau từ thư mục dự án:

```powershell
node --test tests/flows.test.cjs
node tests/integration.cjs
node tests/simulator.integration.cjs
```

Các bài kiểm thử tự động dùng dữ liệu mô phỏng. Bài tích hợp gửi thử tới API Telegram giả lập trên máy.
