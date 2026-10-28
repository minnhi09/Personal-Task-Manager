# Personal Task Manager

Bản đầu tiên của ứng dụng quản lý công việc cá nhân theo SRS v0.3. Mốc này tập trung vào Web chạy local, gồm tài khoản, Project, Task và deadline. Android/Widget sẽ dùng lại API ở giai đoạn tiếp theo.

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
- Múi giờ mặc định của tài khoản: `Asia/Bangkok`.

Web cần kết nối API để ghi dữ liệu trong mốc đầu; cơ chế offline đầy đủ sẽ làm cùng Android cache ở giai đoạn sau.
