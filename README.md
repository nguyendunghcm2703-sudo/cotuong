# Cờ tướng 3D online

Game cờ tướng 3D cho hai người chơi từ xa. Mở link là chơi, không cần cài đặt.
Chạy hoàn toàn trên Cloudflare: một Worker vừa phục vụ trang web vừa giữ phòng cờ (Durable Object).

## Deploy lên Cloudflare qua GitHub

1. **Đưa code lên GitHub.** Tạo repo mới (ví dụ `co-tuong-3d`), rồi tải toàn bộ nội dung thư mục này lên
   (nút *Add file → Upload files*, kéo cả các thư mục `public`, `worker`, `tests` và các file ở ngoài).
   Hoặc dùng git: `git init`, `git add .`, `git commit`, `git remote add origin ...`, `git push -u origin main`.
2. **Kết nối với Cloudflare.** Vào dashboard Cloudflare → *Workers & Pages* → tạo mới và chọn
   nhập từ repository GitHub (Import a repository). Cho phép ứng dụng Cloudflare truy cập repo vừa tạo.
3. **Cấu hình build:**
   - Tên project: `co-tuong-3d` (nên trùng với `name` trong `wrangler.jsonc`).
   - Build command: để trống.
   - Deploy command: `npx wrangler deploy` (mặc định).
4. **Lưu và deploy.** Xong, trang chạy ở địa chỉ dạng `https://co-tuong-3d.<tên-của-bạn>.workers.dev`.
   Từ giờ mỗi lần `push` lên nhánh `main`, Cloudflare tự build và deploy lại.

Không cần tạo Durable Object hay cấu hình thêm gì ở dashboard: file `wrangler.jsonc` đã khai báo sẵn.

## Cách chơi

1. Một người mở trang, chọn bên (Đỏ, Đen hoặc ngẫu nhiên), bấm **Tạo phòng và mời bạn**.
2. Bấm **Mời bạn** để gửi link (trên điện thoại sẽ mở bảng chia sẻ, trên máy tính sẽ sao chép link).
3. Người kia mở link là vào đúng phòng và nhận bên còn lại. Người thứ ba vào sẽ là khán giả.
4. Rớt mạng hoặc khóa màn hình: game tự nối lại, ván cờ và chỗ ngồi được giữ nguyên.
   Mở lại link ở tab mới cũng lấy lại được chỗ ngồi.
5. Xin hòa, xin thua, chơi lại (hai bên đổi quân) đều có trên thanh nút.

Nút ☰/✕ ở góc phải để ẩn hoặc hiện toàn bộ thanh nút (camera, cài đặt), lựa chọn được nhớ lần sau.
Nút **Toàn màn hình** dùng được trên máy tính và Android. iPhone không hỗ trợ: bấm Chia sẻ rồi *Thêm vào MH chính*
để mở như một ứng dụng toàn màn hình.

## Chạy thử trên máy

```
npm install
npm run dev
```

Mở `http://localhost:8787`. Thử hai người trên một máy bằng cách mở hai tab hoặc hai trình duyệt
(mỗi tab là một người chơi riêng).

Trên Windows PowerShell nếu báo "running scripts is disabled", dùng `npm.cmd install` và `npm.cmd run dev`.

Chạy test: `npm test` (cần Node 20 trở lên).

## Cấu trúc

```
public/            trang web (Cloudflare phục vụ thẳng thư mục này)
  index.html
  client/          giao diện, cảnh 3D, kết nối mạng
  shared/xiangqi.js  luật cờ tướng, dùng chung cho client và server
worker/            server
  index.js         định tuyến /ws/<MÃ> tới đúng phòng
  room.js          Durable Object: giữ kết nối và lưu ván cờ
  room-logic.js    luật phòng (chỗ ngồi, nước đi, hòa, thua, chơi lại)
tests/             test luật cờ, logic phòng, Durable Object giả
wrangler.jsonc     cấu hình Cloudflare
```

## Giới hạn gói Cloudflare miễn phí

Durable Objects chạy được trên gói free (chỉ loại lưu trữ SQLite, game này dùng đúng loại đó).
Hạn mức tính theo ngày và reset lúc 00:00 UTC (7 giờ sáng giờ Việt Nam); vượt hạn mức thì thao tác đó báo lỗi
chứ không bị tính tiền. Với hai người chơi, lượng dùng rất nhỏ. Xem trang giá của Cloudflare để biết số hiện tại.

Phòng không có hoạt động 24 giờ sẽ tự bị xóa.

## Chưa có

Đồng hồ cờ, chiếu liên tục/đuổi liên tục, đấu với máy, chat, cài thành ứng dụng (PWA).
Thư viện Three.js đang tải từ CDN jsDelivr nên cần có mạng.
