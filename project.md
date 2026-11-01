# Cấu Trúc Dự Án ABS Viewer (project.md)

## 1. Giới thiệu tổng quan

**ABS Viewer** là một ứng dụng giao diện trực quan hóa chuyên dụng (CAD/BIM viewer dạng nhẹ) dùng để đọc, kiểm tra, thống kê và mô phỏng trực quan dữ liệu cốt thép bê tông (Rebar) và lưới thép hàn (Mesh) theo chuẩn công nghiệp **BVBS 3.1** (định dạng tệp `.abs` phổ biến trong ngành xây dựng và gia công kết cấu thép).

Hệ thống hoạt động theo mô hình kép:
- **Ứng dụng Desktop:** Chạy thông qua wrapper Python **PyWebView** (cho phép tương tác với hệ thống tệp cục bộ trên máy tính).
- **Web App độc lập:** Hoạt động trực tiếp trên trình duyệt hiện đại (fallback tự động thông qua HTML5 File API nếu không có môi trường PyWebView).

---

## 2. Cây thư mục dự án

```text
ABSviewer/
├── index.html          # Khung giao diện chính (HTML layout, Vue template, liên kết assets)
├── README.md           # Giới thiệu tóm tắt dự án
├── THIRD-PARTY-NOTICES.md # Giấy phép & thông báo bản quyền các thư viện OSS (Three.js, Vue, PyWebView)
├── version.md          # Lịch sử phiên bản (Changelog) và tính năng sắp ra mắt
├── project.md          # [Tài liệu này] Mô tả tổng thể và cấu trúc dự án
├── connection.md       # Chi tiết kiến trúc liên kết, luồng dữ liệu và API
├── agent.md            # Sổ tay hướng dẫn và các lưu ý bắt buộc cho AI Agent
├── css/
│   └── style.css       # Toàn bộ mã định dạng giao diện, CSS variables, bố cục Grid/Flex
└── js/
    ├── app.js          # Logic toàn bộ ứng dụng (Parser BVBS, Viewer 2D, Three.js 3D, Vue 3)
    └── three.min.js    # Thư viện Three.js (r-bundle) dựng hình WebGL 3D
```

---

## 3. Chi tiết các thành phần tệp

### 3.1. `index.html`
- **Vai trò:** Điểm khởi nhập (Entry Point) của ứng dụng.
- **Thư viện nạp vào:**
  - `css/style.css`: Quy định toàn bộ style, biến màu, bố cục responsive.
  - `Vue 3` (bản Global Production từ CDN `https://unpkg.com/vue@3/dist/vue.global.prod.js`).
  - `js/three.min.js`: Thư viện lõi Three.js cho WebGL 3D.
  - Google Analytics Tag (gtag).
  - `js/app.js`: Script ứng dụng gắn kết Vue instance vào `#app`.
- **Cấu trúc DOM chính:**
  - `header.toolbar`: Thanh công cụ trên cùng (các nút Open ABS, Reload, Clear, Expand/Collapse, Tên dự án, Fit View, Bật/Tắt Dim, nút ℹ️ Giấy phép & Phiên bản).
  - `main.main-layout`:
    - `section.center-panel`: Bảng dữ liệu cốt thép trung tâm, hỗ trợ **kéo thả tệp `.abs` trực tiếp (Drag & Drop)** kèm lớp phủ `drop-overlay`, danh sách nhóm tệp (File Groups), bảng vị trí thép (`table.abs-table`), thumbnail canvas preview cho từng cây thép/lưới thép, cảnh báo chiều dài, cảnh báo mác thép, tổng kết footer.
    - `div.resizer-vertical-right-panel`: Thanh kéo co giãn chiều rộng thanh công cụ bên phải.
    - `section.right-panel`:
      - `div.viewer-tabs`: Chuyển đổi qua lại giữa chế độ xem 2D và 3D.
      - `div.viewer`: Chứa `<canvas id="viewer2d">` và `<div id="viewer3d"><div id="segment-labels"></div></div>`.
      - `div.resizer-horizontal-viewer`: Thanh kéo co giãn chiều cao của khung xem đồ họa.
      - `div.property-panel`: Bảng chi tiết thông số vị trí thép đang chọn (Pos badge, kích thước, khối lượng, mác thép, Coupler đầu/cuối, tên file).
  - `footer.statusbar`: Thanh trạng thái hiển thị tiến độ và tổng số vị trí đã nạp.
  - `div.modal-backdrop`: Hộp thoại Modal Popup xác nhận khi phát hiện tệp trùng tên trong thao tác kéo thả (Yes để thay thế dữ liệu & thêm mới, No để hủy thao tác).
  - `div.modal-backdrop` (info): Hộp thoại Modal Popup hiển thị giấy phép thư viện OSS (`THIRD-PARTY-NOTICES.md`) và lịch sử phiên bản (`version.md`) dạng Markdown preview, có 2 tab "Giấy phép" / "Phiên bản".

### 3.2. `css/style.css`
- **Vai trò:** Hệ thống stylesheet hoàn chỉnh không phụ thuộc CSS framework bên ngoài (không dùng Bootstrap hay Tailwind).
- **Điểm nổi bật:**
  - Định nghĩa biến toàn cục `:root`: Màu sắc (`--primary`, `--primary-dark`, `--danger`, `--success`), kích thước panel mặc định (`--right-width: 430px`, `--toolbar-height: 52px`), bo góc và bóng đổ.
  - Bố cục lưới linh hoạt `grid-template-columns: 1fr 5px var(--right-width)` cho phép co kéo độ rộng panel mượt mà.
  - Bảng dữ liệu kỹ thuật: highlight dòng chọn, phân biệt style cho thép tròn (`.pos-ellipse`) và lưới thép (`.pos-rect`, `.bfma-row`).
  - Đánh dấu cảnh báo trực quan: Thép dài 12m-14m (`.length-warn-1` màu cam), dài >14m (`.length-warn-2` màu đỏ), khác mác thép chủ đạo trong file (`.grade-diff`).
  - Style cho nhãn kích thước nổi 3D: `.segment-label` với thuộc tính absolute và chuyển đổi `translate(-50%, -50%)`.
  - Hiệu ứng kéo thả tệp: `.center-panel.drag-over`, `.drop-overlay`, `.drop-overlay-box`.
  - Hộp thoại Modal Popup: `.modal-backdrop`, `.modal-dialog`, `.duplicate-file-list`, `.btn-primary`, `.btn-secondary`.

### 3.3. `js/three.min.js`
- **Vai trò:** Thư viện WebGL 3D độc lập được lưu trữ nội bộ (local) để đảm bảo ứng dụng chạy offline ổn định trong môi trường Desktop PyWebView.
- **Lưu ý:** Đây là bản build rút gọn không kèm theo OrbitControls gốc của Three.js, do đó ứng dụng đã tự triển khai một bộ điều khiển OrbitControls riêng trong `js/app.js`.

### 3.4. `js/app.js`
- **Vai trò:** Trái tim logic của toàn bộ ứng dụng, được cấu trúc thành 7 phân hệ chính (Modules):
  1. **Tiện ích chung (Utilities):** Xử lý hình học cơ bản (`clamp`, `computeBounds`, `fmtLength`, `niceStep`), hiển thị thông báo `notify()` dạng toast và bộ cầu nối `getApi()` tới PyWebView.
  2. **Trình phân tích BVBS (ABS Parser):** Đọc chuẩn BVBS 3.1, trích xuất các khối H, G, A, M, X, Y, E, P, C; tính toán tọa độ đường bao (polyline) cho 2D/3D/Spiral/Mesh; kiểm tra mã checksum IP.
  3. **Bộ kết xuất hình thu nhỏ (Thumbnail Renderer):** Vẽ biểu diễn 2D thu nhỏ của thanh thép lên từng dòng bảng, kết hợp `IntersectionObserver` (chỉ vẽ khi cuộn vào tầm nhìn) và lưu bộ nhớ đệm (caching).
  4. **Khung nhìn 2D (Viewer 2D):** Sử dụng Canvas 2D HTML5, hỗ trợ zoom mượt quanh con trỏ chuột, rê chuột để pan, double-click fit view, vẽ lưới toạ độ thông minh, đường bao bounding box, đánh dấu múp nối (coupler), đường đo kích thước (dimension) tự đẩy ra ngoài tâm hình dạng, và hiển thị góc bẻ khác 90°.
  5. **Bộ điều khiển xoay 3D (Orbit Controls):** Triển khai tự chế, hỗ trợ xoay, pan (chuột giữa/phải), zoom (con lăn hoặc pinch 2 ngón tay trên màn hình cảm ứng).
  6. **Khung nhìn 3D (3D Viewer):** Dựng hình Three.js chân thực bằng `CylinderGeometry` từng đoạn thẳng (giữ đúng góc bẻ 90°, 135°...), gắn khớp nối cầu `SphereGeometry` chống hở, đánh dấu điểm đầu bằng khối cầu đỏ, và hiển thị nhãn kích thước từng đoạn thẳng dạng HTML overlay đồng bộ toạ độ 3D theo từng khung hình.
  7. **Khối ứng dụng Vue 3 (Vue Application):** Sử dụng Options API quản lý trạng thái, đồng bộ dữ liệu giữa bảng danh sách, thanh công cụ, bảng thuộc tính, hai khung nhìn 2D/3D, bộ xử lý **Drag & Drop** (`onDragEnter`, `onDragOver`, `onDragLeave`, `onDrop`, `handleDroppedFiles`, `replaceAndAddFiles`), và modal thông tin (giấy phép + phiên bản) với renderer Markdown `renderMarkdown()`.

---

## 4. Công nghệ & Thư viện sử dụng

| Công nghệ / Thư viện | Phiên bản | Cách tích hợp | Mục đích |
| :--- | :--- | :--- | :--- |
| **HTML5 / CSS3 / Vanilla JS** | ES6+ | Bản địa (Native) | Nền tảng cốt lõi, không cần công đoạn build/transpile |
| **Vue.js** | 3.x | CDN Global Script | Quản lý trạng thái giao diện phản ứng (Reactive UI) |
| **Three.js** | Minified bundle | Tệp cục bộ `js/three.min.js` | Dựng hình đồ hoạ không gian 3D WebGL |
| **PyWebView Bridge** | - | Nhúng qua `window.pywebview` | Tương tác với Python backend trên môi trường desktop |
| **HTML5 Drag & Drop API** | Native | Tích hợp vào `.center-panel` | Mở đồng thời nhiều tệp .abs bằng thao tác kéo thả chuột |
| **BVBS Specification** | 3.1 | Thuật toán tự phát triển | Phân tích cú pháp chuỗi chuẩn uốn thép công nghiệp |
| **HTML5 Canvas 2D** | Native | Trực tiếp qua JS Context | Render đồ họa 2D kỹ thuật chính xác cao & thumbnails |

---

## 5. Đặc tả định dạng dữ liệu BVBS được hỗ trợ

Hệ thống hỗ trợ đầy đủ các nhóm hình học chính (Obergruppen) theo quy chuẩn BVBS:
- **`BF2D`**: Thanh thép uốn phẳng 2D định nghĩa qua các cặp chiều dài thẳng (`l`), góc bẻ uốn (`w`), và bán kính cung uốn (`r`).
- **`BF3D`**: Thanh thép uốn không gian 3D cấu tạo từ chuỗi vector tương đối (`x`, `y`, `z`).
- **`BFWE`**: Thép uốn vòng tròn hoặc xoắn ốc (Spiral/Helix) định nghĩa từ đa giác đáy kết hợp số vòng xoắn (`n`) và bước xoắn (`g`).
- **`BFMA`**: Lưới thép hàn (Betonstahlmatte) dạng tấm phẳng (`l` x `b`) hoặc lưới uốn tạo hình qua các khối uốn con `Gx`/`Gy`.
- **`BFGT`**: Khung giàn tam giác (Lattice girder - Gitterträger) kích thước `l` x `h`.
- **`BFAU`**: Thanh kê/thanh chống định khoảng cách (Abstandhalter).
- **Khối nối Coupler / Muffler (`M`)**: Trích xuất nhà sản xuất và mã chủng loại cho đầu thanh (`a`, `b`) và cuối thanh (`n`, `o`).
- **Khối Kiểm tra Checksum (`C`)**: Thuật toán `IP = 96 - (sum(ASCII) mod 32)`.
