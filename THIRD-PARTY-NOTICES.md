# Third-Party Notices

File này liệt kê các thư viện mã nguồn mở (open-source) được sử dụng trong dự án **ABS Viewer**, kèm theo giấy phép và thông báo bản quyền tương ứng.

---

## 1. Three.js

- **Tên:** Three.js
- **Phiên bản:** r160 (build `three.min.js`)
- **Nguồn:** https://threejs.org/
- **Vị trí trong dự án:** `js/three.min.js`
- **Giấy phép:** MIT License
- **Copyright:** Copyright 2010-2023 Three.js Authors

### MIT License (Three.js)

```
MIT License

Copyright 2010-2023 Three.js Authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> Ghi chú: File `js/three.min.js` trong kho mã nguồn đã giữ nguyên khối header `@license` chứa thông báo bản quyền và SPDX-License-Identifier: MIT. Không được xóa hoặc chỉnh sửa khối header này khi cập nhật/minify lại thư viện.

---
## 2. Vue.js

- **Tên:** Vue.js
- **Phiên bản:** 3.x (global production build)
- **Nguồn:** https://vuejs.org/
- **Vị trí trong dự án:** Nạp qua CDN `https://unpkg.com/vue@3/dist/vue.global.prod.js` trong `index.html`
- **Giấy phép:** MIT License
- **Copyright:** Copyright (c) 2018-present, Yuxi (Evan) You

### MIT License (Vue.js)

```
MIT License

Copyright (c) 2018-present, Yuxi (Evan) You and Vue contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 3. PyWebView

- **Tên:** PyWebView
- **Phiên bản:** (phụ thuộc môi trường desktop, không cố định trong repo)
- **Nguồn:** https://pywebview.flowrl.com/
- **Vị trí trong dự án:** Wrapper desktop chạy Python backend, giao tiếp qua `window.pywebview.api` (chỉ trong môi trường desktop, không bundle vào web)
- **Giấy phép:** BSD 3-Clause License
- **Copyright:** Copyright (c) 2014-2024, Roman Sirokov

### BSD 3-Clause License (PyWebView)

```
BSD 3-Clause License

Copyright (c) 2014-2024, Roman Sirokov
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## Ghi chú tuân thủ (Compliance Notes)

- Three.js và Vue.js đều theo giấy phép **MIT**: bắt buộc giữ nguyên thông báo bản quyền (copyright) và giấy phép khi phân phối lại. Vì `js/three.min.js` được bundle trực tiếp trong repo, header license ở đầu file **phải được giữ nguyên**.
- PyWebView theo **BSD-3-Clause**: bắt buộc giữ copyright notice, điều kiện và disclaimer; không được dùng tên tác giả để quảng bá sản phẩm phái sinh.
- Các thư viện trên là giấy phép permissive: **không** bắt buộc công bố mã nguồn của ABS Viewer, nhưng bắt buộc ghi nhận (attribution) đúng như trên.
- Nếu dự án thêm thư viện mới (ví dụ thư viện xuất Excel/PDF theo roadmap trong `version.md`), vui lòng cập nhật file này tương ứng.
- Google Analytics (gtag.js) không phải thư viện mã nguồn mở và không thuộc phạm vi file này; việc sử dụng cần tuân thủ chính sách bảo mật dữ liệu người dùng (GDPR/cookie) nếu phân phối công khai.

---

*Cập nhật lần cuối: 2026-11-01*

