# Personal Task Manager

Bản đầu tiên của ứng dụng quản lý công việc cá nhân theo SRS v0.4. Web/API đã sẵn sàng cho local và production; Android/Widget dùng lại API chung ở giai đoạn tiếp theo.

## Yêu cầu

- Node.js 24 LTS trở lên (Node 26 cũng được hỗ trợ)
- pnpm 12

## Chạy local

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:3001

## Kiểm tra

```bash
pnpm typecheck
pnpm test
pnpm build
```

Dữ liệu local nằm trong thư mục `data/`. Không commit thư mục này.

## Phạm vi mốc đầu

- Đăng ký, đăng nhập, đăng xuất bằng email và mật khẩu.
- Project cơ bản.
- Task với trạng thái TODO / IN_PROGRESS / DONE.
- Deadline không có hạn, chỉ có ngày, hoặc có ngày giờ.
- Lọc theo trạng thái deadline, tìm kiếm và lọc theo Project.
- Cập nhật có kiểm tra `version` để tránh ghi đè âm thầm khi hai trình duyệt cùng sửa.
- Múi giờ mặc định của tài khoản: `Asia/Ho_Chi_Minh` (UTC+07:00).
- Lịch Web theo ngày, tuần và tháng; tạo phiên làm việc cho Task, sự kiện riêng, kéo thả và đổi thời lượng theo lưới 15 phút.
- Sự kiện có thể lặp theo ngày, tuần hoặc tháng; hỗ trợ sửa/xóa một lần lặp hoặc cả chuỗi và cảnh báo mục bị trùng giờ.
- Web hỗ trợ giao diện Sáng, Tối và Hệ thống; lựa chọn được lưu riêng theo trình duyệt.

Web cần kết nối API để ghi dữ liệu trong mốc đầu; cơ chế offline đầy đủ sẽ làm cùng Android cache ở giai đoạn sau.

## Android và production

- API production dùng mobile token tại `/api/v1/auth/mobile/login` và `/api/v1/auth/mobile/logout`.
- Cấu hình VPS, Caddy, DuckDNS và sao lưu S3 nằm trong [`deploy/README.md`](deploy/README.md).
- Android source nằm trong [`apps/android`](apps/android); URL backend được truyền bằng `-PapiBaseUrl` khi build APK.
