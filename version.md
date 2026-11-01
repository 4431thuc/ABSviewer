## v1.0.0 (10.08.2026)
- Đọc và phân tích chuẩn BVBS 3.1 (.abs) hỗ trợ đầy đủ thép thanh (BF2D, BF3D, BFWE), lưới thép hàn (BFMA), giàn (BFGT) và múp nối coupler.
- Bảng thống kê chi tiết theo từng tệp: số lượng, đường kính, chiều dài, khối lượng cùng cảnh báo chiều dài vượt chuẩn (>12m, >14m) và khác mác thép.
- Tự động sinh thumbnail 2D cho từng vị trí thanh thép với cơ chế lazy loading (IntersectionObserver) và in-memory cache tối ưu hiệu năng.
- Khung nhìn 2D Canvas tương tác mượt mà: zoom quanh con trỏ, pan, fit view, hiển thị đường đo kích thước thông minh tự đẩy ra ngoài tâm và nhãn góc bẻ.
- Khung nhìn 3D WebGL chân thực với Three.js: dựng hình từng đoạn ống trụ chuẩn góc bẻ, gắn khớp cầu che khe nứt và nhãn kích thước động nổi trên màn hình.
- Hỗ trợ môi trường kép linh hoạt: chạy mượt mà trên ứng dụng Desktop (PyWebView) lẫn trình duyệt web thông thường (HTML5 FileReader).
## v1.1.0 (01.11.2026)
- Mở tệp đa dạng: hỗ trợ nút bấm mở hộp thoại chọn nhiều tệp và tính năng kéo thả trực tiếp (drag & drop) nhiều tệp `.abs` vào vùng bảng dữ liệu trung tâm.
- Quản lý tệp thông minh: tự động phân tích tệp mới, phát hiện tệp trùng tên và hiển thị popup xác nhận thay thế dữ liệu hoặc hủy thao tác an toàn.

### Coming Soon
- Xuất bảng thống kê cốt thép và bảng tổng hợp khối lượng ra định dạng Excel (.xlsx) và báo cáo PDF.
- Hỗ trợ chỉnh sửa nhanh thông số các thanh thép trực tiếp trên bảng và xuất ngược ra file .abs chuẩn.
- Bổ sung công cụ đo khoảng cách tùy chọn (ruler / measurement) trực tiếp trên giao diện 2D và không gian 3D.
- Tích hợp thuật toán tối ưu hóa cắt thép (Cutting Stock Optimization) giúp giảm thiểu hao hụt phôi thép gia công.
