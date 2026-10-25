# StudyFlow

**Học đúng kế hoạch, hoàn thành đúng hạn.**

StudyFlow là ứng dụng web giúp sinh viên chia nhỏ bài tập và mục tiêu ôn thi thành kế hoạch học hằng ngày theo deadline, kết hợp đồng hồ Pomodoro để ghi nhận thời gian tập trung.

Ứng dụng miễn phí, không cần tài khoản, backend hoặc cài đặt thư viện.

## Tính năng

### Hôm nay

- Hiển thị thời gian tập trung đã ghi nhận hôm nay, thời lượng học gợi ý và số nhiệm vụ đang mở.
- Sắp xếp nhiệm vụ theo deadline gần nhất, hiển thị riêng nhiệm vụ quá hạn và nhiệm vụ đã đủ thời lượng.
- Chuyển sang Pomodoro với nhiệm vụ được chọn sẵn.
- Tự cập nhật kế hoạch khi nhiệm vụ, phiên học hoặc ngày địa phương thay đổi.

### Nhiệm vụ

- Thêm, sửa, xóa, xác nhận hoàn thành và mở lại nhiệm vụ.
- Nhập môn học, tên công việc, deadline và thời lượng dự kiến bằng giờ, phút.
- Tìm kiếm theo tên hoặc môn học; lọc theo trạng thái.
- Hiển thị tiến độ dựa trên các phiên tập trung đã ghi nhận.
- Xác nhận trước khi xóa; giữ lịch sử phiên học sau khi nhiệm vụ bị xóa.

### Pomodoro

- Mặc định 25 phút tập trung và 5 phút nghỉ; tùy chỉnh lần lượt trong khoảng 1–180 và 1–60 phút.
- Bắt đầu, tạm dừng, tiếp tục, kết thúc sớm hoặc hủy phiên.
- Giữ trạng thái timer khi chuyển màn hình, đổi tab hoặc tải lại trang.
- Tự ghi nhận phiên tập trung hoàn tất vào đúng nhiệm vụ, mỗi phiên một lần.
- Không tự bắt đầu phiên tiếp theo.

Giao diện hoàn toàn bằng tiếng Việt, hỗ trợ desktop và mobile, có biểu mẫu được gắn nhãn và modal hỗ trợ bàn phím.

## Chạy ứng dụng

### Mở trực tiếp

Mở `index.html` bằng trình duyệt hiện đại có bật JavaScript. Không cần chạy lệnh build hoặc cài đặt dependency.

### Dùng static server

Nếu máy đã có Python 3, chạy lệnh sau trong thư mục dự án:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Truy cập [http://127.0.0.1:8000](http://127.0.0.1:8000). Nhấn `Ctrl+C` trong Terminal để dừng server.

Lần đầu sử dụng, chọn **Thêm nhiệm vụ đầu tiên** hoặc chủ động chọn **Dùng dữ liệu mẫu**. Dữ liệu mẫu có deadline tính tương đối theo ngày hiện tại và không tạo phiên học giả.

## Cách chia kế hoạch

Với mỗi nhiệm vụ đang mở và chưa quá hạn:

```text
Thời lượng còn lại = max(0, thời lượng dự kiến − thời gian đã ghi nhận)
Số ngày học = số ngày từ hôm nay đến deadline, tính cả hai ngày
Thời lượng gợi ý hôm nay = thời lượng còn lại / số ngày học
```

Ví dụ: nhiệm vụ cần học 6 giờ, deadline sau 2 ngày, có 3 ngày học bao gồm hôm nay. StudyFlow gợi ý **2 giờ hôm nay**. Sau khi ghi nhận phiên học, ứng dụng tính lại theo thời lượng còn lại.

Nhiệm vụ quá hạn hiển thị riêng cùng thời lượng còn lại. Tiến độ tối đa hiển thị 100%, nhưng người dùng vẫn cần xác nhận hoàn thành nhiệm vụ. Đây là phân bổ thời lượng gợi ý, chưa phải lịch đặt khung giờ học cụ thể.

## Quy tắc ghi nhận thời gian

- Timer tính bằng timestamp và `Date.now()`, không đếm số lần interval chạy.
- Thời lượng được lưu bằng giây, chỉ làm tròn khi hiển thị.
- Kết thúc sớm chỉ ghi nhận thời gian tập trung thực tế; thời gian tạm dừng và nghỉ không được cộng.
- Hủy phiên không ghi nhận thời gian.
- Chỉ một timer hoạt động tại một thời điểm. Cần kết thúc hoặc hủy phiên trước khi xóa hay hoàn thành nhiệm vụ đang học.
- Khi mở lại sau giờ kết thúc, chỉ phiên đã bắt đầu được xử lý, không tự tạo thêm các chu kỳ học.

## Cấu trúc dự án

```text
StudyFlow/
├── index.html   # Cấu trúc giao diện, biểu mẫu và SVG
├── styles.css   # Giao diện và bố cục responsive
├── app.js       # Dữ liệu, lập kế hoạch, timer, render và sự kiện
└── README.md    # Tài liệu dự án
```

Sản phẩm dùng HTML, CSS và JavaScript thuần, không có framework, CDN, API hoặc build tool.

## Lưu trữ và giới hạn

Dữ liệu được lưu bằng `localStorage` với khóa `studyflow.v1`, gồm `schemaVersion`, `tasks`, `sessions`, `settings` và `activeTimer`.

- Dữ liệu lưu cục bộ trong trình duyệt, chưa đồng bộ giữa các thiết bị. Các địa chỉ truy cập khác nhau có thể sử dụng vùng lưu trữ khác nhau.
- Xóa dữ liệu trang web trong trình duyệt sẽ xóa dữ liệu StudyFlow tại địa chỉ đó.
- Nếu bộ nhớ bị chặn hoặc đầy, ứng dụng hiển thị thông báo và tiếp tục hoạt động với dữ liệu tạm trong phiên hiện tại.
- Đồng bộ nhiều thiết bị và thống kê nâng cao thuộc định hướng Pro tương lai, chưa triển khai.

## Kiểm tra nhanh

1. Thêm nhiệm vụ cần 6 giờ với deadline sau 2 ngày; kiểm tra gợi ý 2 giờ/ngày.
2. Thử để trống tên, nhập thời lượng bằng 0 hoặc tạo deadline trước hôm nay; kiểm tra thông báo lỗi.
3. Sửa, tìm kiếm, lọc, hoàn thành và xóa nhiệm vụ; tải lại trang để kiểm tra dữ liệu được giữ.
4. Bắt đầu phiên tập trung, tạm dừng, tiếp tục và kết thúc sớm; kiểm tra thời gian được cộng đúng nhiệm vụ.
5. Chạy một phiên nghỉ hoặc hủy phiên tập trung; kiểm tra tiến độ không tăng.
6. Tải lại khi timer chạy và sau khi phiên hết giờ; kiểm tra phiên chỉ được ghi nhận một lần.
7. Kiểm tra nhiệm vụ quá hạn, nhiệm vụ đã đủ thời lượng và giao diện ở chiều rộng 375px.
