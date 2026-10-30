# Android App

Ứng dụng dùng Kotlin, Jetpack Compose, Room, WorkManager và Glance; `minSdk` là 29 (Android 10). Dữ liệu Room được gắn với `userId` để không trộn cache giữa tài khoản. Dữ liệu đã đồng bộ được xem khi offline, còn tạo/sửa/xóa yêu cầu mạng.

Bản hiện tại hỗ trợ đăng nhập mobile token, tạo/sửa/xóa Task, hoàn thành/mở lại Task, tạo/sửa/xóa Project, deadline ngày hoặc ngày giờ theo múi giờ tài khoản, đồng bộ nền và deep link từ widget vào Task.

Mở thư mục `apps/android` bằng Android Studio, cài Android SDK 35 và JDK 17. Trong Gradle properties của bản build, đặt `apiBaseUrl` thành URL API production (hoặc truyền property khi chạy Gradle):

```bash
gradle assembleRelease -PapiBaseUrl=https://your-subdomain.duckdns.org/api/v1
```

Có thể dùng **Build > Generate Signed Bundle/APK** trong Android Studio nếu máy chưa có lệnh `gradle`. APK release nằm ở `app/build/outputs/apk/release/`. Keystore ký APK phải đặt ngoài repository. Widget tự làm mới sau mỗi lần đồng bộ và WorkManager chạy định kỳ khoảng một giờ.
