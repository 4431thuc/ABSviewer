# Hướng Dẫn Dành Riêng Cho AI Agent (agent.md)

> [!IMPORTANT]
> **ĐỌC KỸ TÀI LIỆU NÀY TRƯỚC KHI BẮT ĐẦU CHỈNH SỬA CODE!**  
> Dự án **ABS Viewer** có những đặc thù kỹ thuật rất riêng biệt về kiến trúc không build step, tính tương thích kép giữa desktop/web, sự tương tác nhạy cảm giữa Vue 3 và Three.js WebGL, và các quy chuẩn kỹ thuật nghiêm ngặt của định dạng BVBS. Hãy tuân thủ nghiêm ngặt các nguyên tắc dưới đây.

---

## 1. Bản Đồ Tổng Quan Cho Agent

| Thành phần | Đường dẫn tệp | Vai trò |
| :--- | :--- | :--- |
| **Giao diện & DOM** | `index.html` | Cấu trúc trang, nạp Vue 3 CDN, Three.js local, khai báo layout |
| **Định dạng & CSS** | `css/style.css` | Hệ thống biến `:root`, CSS Grid 3 cột, style bảng và nhãn 3D |
| **Thư viện WebGL** | `js/three.min.js` | Thư viện Three.js bản rút gọn nội bộ (không kèm OrbitControls) |
| **Logic Ứng Dụng** | `js/app.js` | Parser BVBS, Viewer 2D, Viewer 3D, OrbitControls, Vue 3 App |
| **Tài liệu dự án** | `project.md` | Cấu trúc chi tiết dự án |
| **Luồng dữ liệu** | `connection.md` | Sơ đồ liên kết, API PyWebView và luồng dữ liệu |

---

## 2. Các Quy Tắc Sống Còn Cần Tuân Thủ

### 2.1. Tuyệt đối không có "Build Step" (No NPM / Webpack / Vite)
- Dự án này chạy theo phương pháp **Vanilla Web cổ điển**: nạp trực tiếp script qua thẻ `<script src="...">`.
- **CẤM:** Không tự ý tạo `package.json`, không cài đặt `npm install`, không viết mã chuyển đổi sang cú pháp Vite/Webpack/ES Modules trừ khi người dùng yêu cầu rõ ràng.
- Mọi mã nguồn Javascript mới đều phải tương thích trực tiếp với trình duyệt hiện đại trong tệp `js/app.js`.

---

### 2.2. Xung đột giữa Vue 3 Reactivity và Three.js (Cực kỳ nguy hiểm)
- **Vấn đề cốt lõi:** Khi một đối tượng phức tạp của Three.js (như `THREE.Scene`, `THREE.PerspectiveCamera`, `THREE.WebGLRenderer`, `THREE.Mesh`, hoặc `THREE.Group`) được gán vào một thuộc tính trong `data()` của Vue 3, hệ thống Proxy phản ứng (Reactivity Proxy) của Vue sẽ bọc lấy đối tượng đó.
- **Hậu quả:** Proxy của Vue can thiệp vào các getter/setter nội bộ của Three.js, làm giảm mạnh tốc độ khung hình (frame drop nghiêm trọng), gây rò rỉ bộ nhớ hoặc ném lỗi ngoại lệ không thể render WebGL.
- **Quy tắc bắt buộc:**
  Bất cứ đối tượng Three.js nào được gán vào Vue component state BẮT BUỘC phải được bảo vệ bằng `Vue.markRaw`:
  ```javascript
  // ĐÚNG:
  const mark = Vue.markRaw;
  this.scene3D = mark(new THREE.Scene());
  this.group3D = mark(new THREE.Group());
  this.orbit3D = mark(Object.create(OrbitControls));

  // SAI (Tuyệt đối không làm):
  this.scene3D = new THREE.Scene();
  ```

---

### 2.3. Giải phóng tài nguyên đồ họa (Memory Cleanup & Dispose)
- Khi người dùng đổi vị trí thanh thép (`selectRecord`), bấm Clear, hoặc chuyển đổi chế độ xem, tài nguyên 3D cũ phải được dọn dẹp triệt để để tránh tràn RAM/VRAM GPU.
- **Quy tắc khi huỷ đối tượng 3D:**
  Duyệt qua nhóm hình học và gọi `.dispose()` trên cả `geometry` và `material`:
  ```javascript
  this.group3D.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
      }
  });
  ```
- Luôn gọi `cancelAnimationFrame(this.rafId)` khi component unmount hoặc dừng chế độ 3D.

---

### 2.4. Phân biệt Toạ độ Kỹ thuật Gốc vs Toạ độ Hiển thị Đồ họa
- **`record.geometry` (Tọa độ gốc):**
  - Giữ nguyên giá trị thiết kế kỹ thuật từ tệp `.abs`.
  - **Mọi phép tính:** Chiều dài đoạn thẳng, chiều dài tổng (`length`), góc uốn (`angles`), khối lượng (`weight`) BẮT BUỘC phải lấy từ `record.geometry`.
- **`record.preview` (Tọa độ hiển thị):**
  - Được sinh ra từ hàm `createDisplayGeometry()`.
  - Chức năng: Thêm độ lệch `DISPLAY_STIRRUP_OVERLAP_OFFSET = 30 mm` vào đoạn móc đai (stirrup) để người dùng có thể nhìn thấy rõ ràng hai đầu móc uốn trên màn hình 2D/3D thay vì bị vẽ đè lên nhau trùng khít.
  - **CẢNH BÁO:** Không bao giờ dùng `record.preview` để tính toán chiều dài hay bóc tách khối lượng thanh thép.

---

### 2.5. Giữ vững Kiến trúc Tương thích Kép (PyWebView vs Browser)
- Dự án vừa chạy dưới dạng ứng dụng Desktop (thông qua Python `pywebview`), vừa chạy trên trình duyệt web thông thường.
- Không bao giờ được giả định rằng `window.pywebview` luôn luôn tồn tại.
- Khi thêm hoặc sửa các hàm liên quan đến tệp hoặc cài đặt, phải luôn tuân thủ cấu trúc rẽ nhánh bảo vệ:
  ```javascript
  const api = getApi();
  if (api) {
      // Logic gọi qua Python PyWebView
      await api.some_method();
  } else {
      // Logic dự phòng trên trình duyệt web chuẩn (HTML5 APIs)
  }
  ```

---

### 2.6. Đặc tả Hình học Chuẩn BVBS 3.1
Khi can thiệp vào `ABSParser`:
1. **Quy tắc Checksum:** Khối `C<digits>@` được tính theo công thức:
   $$IP = 96 - (\sum ASCII \pmod{32})$$
   Giá trị sau chữ cái `C` phải trùng khớp với `IP`.
2. **Quy tắc BF3D:**
   Các trường `x`, `y`, `z` trong khối `G` của `BF3D` là **vector tương đối (relative offset)** từ điểm trước đến điểm sau, KHÔNG PHẢI tọa độ tuyệt đối.
   - Khi gặp một trường `x` mới, một vector chuyển vị mới được bắt đầu.
3. **Quy tắc Phân định Khối `Gx` / `Gy` trong Lưới thép (`BFMA`):**
   - Phân biệt cẩn thận giữa `Gx294@` (khối uốn G thường có trường tọa độ x = 294 trong BF3D) và `Gyl200@` (khối con định hình uốn uôn lưới thép bent mat trong BFMA).

---

### 2.7. Tối ưu Hiệu Năng (Performance Best Practices)
1. **Lazy Loading cho Thumbnail:**
   Bảng danh sách có thể có hàng trăm hoặc hàng ngàn dòng. Các thumbnail chỉ được vẽ khi đi vào tầm nhìn qua `IntersectionObserver`. Sau khi vẽ xong phải lưu vào `ThumbnailRenderer.cache` (`Map`). Không gọi vẽ lại nếu đã có trong cache.
2. **Bộ đệm tổng hợp (Pre-calculated Aggregates):**
   Các thông số tổng của file (`file.weight`, `file.rebarWeight`, `file.meshWeight`, `file.bars`) phải được tính một lần duy nhất tại thời điểm parse và gán vào object `file`. Tuyệt đối không dùng các hàm `computed` lồng `filter()` + `reduce()` lặp đi lặp lại trên toàn bộ mảng dữ liệu trong template Vue.
3. **Overlay Nhãn 3D (`#segment-labels`):**
   Các thẻ HTML nhãn kích thước được tạo một lần khi nạp record (`createSegmentLabels`). Trong vòng lặp `requestAnimationFrame`, chỉ cập nhật thuộc tính toạ độ `left`, `top`, `opacity`. Không tạo mới hoặc xoá thẻ DOM trong mỗi khung hình.

---

## 3. Quy Ước Bố Cục & Giao Diện (CSS / UI)

- Không thay đổi cứng kích thước bảng hay panel bằng pixel cố định trong Javascript trừ khi đang xử lý sự kiện kéo co giãn (`resizer`).
- Chiều rộng cột phải được điều khiển thông qua biến CSS:
  ```javascript
  document.documentElement.style.setProperty('--right-width', w + 'px');
  ```
- Tuân thủ bảng màu CSS variables sẵn có trong `:root`:
  - Thép tròn (Rebar): `--primary` (`#2d74ff`), bo viền badge `.pos-ellipse`.
  - Lưới thép hàn (Mesh): Cam đậm (`#c26c06`), bo viền badge `.pos-rect`.
  - Cảnh báo thép dài $12\text{m} - 14\text{m}$: `.length-warn-1` (cam).
  - Cảnh báo thép dài $> 14\text{m}$: `.length-warn-2` (đỏ).
  - Khác mác thép chuẩn: `.grade-diff` (nền vàng cam nhạt, chữ cam).

---

## 4. Danh Mục Kiểm Tra Cho Agent Trước Khi Bàn Giao (Checklist)

Mỗi khi thực hiện một thay đổi hoặc tính năng mới, Agent hãy tự rà soát danh sách sau:
- [ ] Ứng dụng có chạy được khi mở trực tiếp `index.html` trên trình duyệt mà không cần server backend không?
- [ ] Các đối tượng Three.js mới có được bọc qua `Vue.markRaw()` chưa?
- [ ] Có rò rỉ bộ nhớ WebGL nào chưa được `.dispose()` không?
- [ ] Phép tính độ dài hoặc kích thước có vô tình lấy từ toạ độ hiển thị (`preview`) thay vì toạ độ gốc (`geometry`) không?
- [ ] Các thanh kéo co giãn chiều rộng (`resizer-vertical-right-panel`) và chiều cao (`resizer-horizontal-viewer`) có còn hoạt động bình thường không?
- [ ] Thumbnail có giữ được tính năng vẽ lười (`IntersectionObserver`) và cache không?
- [ ] Checksum và cú pháp phân tích BVBS có được giữ nguyên vẹn không?

