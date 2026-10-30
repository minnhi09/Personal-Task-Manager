# Triển khai VPS

Các file trong thư mục này là mẫu cấu hình cho VPS Ubuntu/Debian. Thay hostname, bucket S3 và đường dẫn cài đặt trước khi bật service.

1. Tạo user hệ thống `ptm`, thư mục `/opt/personal-task-manager` và `/var/lib/personal-task-manager`; cài Node.js 24 LTS, `pnpm`, `sqlite3`, AWS CLI và đặt quyền để chỉ user `ptm` đọc được file `.env` và database.
2. Build Web/API bằng `pnpm build`, đặt `VITE_ALLOW_REGISTRATION=false` khi build Web, copy source build lên VPS, chạy migration với `DATABASE_PATH` production rồi tạo tài khoản đầu tiên bằng `pnpm --filter @ptm/api db:create-user -- email@example.com`; lệnh sẽ hỏi mật khẩu. Có thể dùng `PTM_BOOTSTRAP_PASSWORD` trong môi trường quản trị tạm thời.
3. Copy `personal-task-manager-api.env.example` thành `/etc/personal-task-manager/api.env`, đặt `WEB_ORIGIN` là hostname DuckDNS thật và giữ `ALLOW_REGISTRATION=false`.
4. Cài `personal-task-manager-api.service` vào `/etc/systemd/system/`, sau đó `systemctl enable --now personal-task-manager-api`.
5. Copy `Caddyfile.example` thành `/etc/caddy/Caddyfile`, thay hostname và thư mục Web, rồi `systemctl reload caddy`. Caddy sẽ cấp HTTPS cho hostname công khai.
6. Tạo S3 bucket riêng tư, cấp instance role chỉ đủ quyền ghi backup, áp dụng `backup/s3-lifecycle.json` để tự xóa sau 30 ngày và bật timer backup. Kiểm tra khôi phục bằng một database tạm trước khi coi backup là hợp lệ.
7. Nếu VPS dùng IP động, điền `/etc/personal-task-manager/duckdns.env` rồi bật timer DuckDNS.

Không mở cổng API `3001` trên Security Group. Chỉ công khai 80/443 và giới hạn SSH theo IP quản trị.
