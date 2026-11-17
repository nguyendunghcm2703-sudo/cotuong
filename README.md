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
   - Build command: `npm run build` (gộp và làm rối mã JS, kết quả ghi vào `dist/`).
   - Deploy command: `npx wrangler deploy` (mặc định).
4. **Lưu và deploy.** Xong, trang chạy ở địa chỉ dạng `https://co-tuong-3d.<tên-của-bạn>.workers.dev`.
   Từ giờ mỗi lần `push` lên nhánh `main`, Cloudflare tự build và deploy lại.

Không cần tạo Durable Object hay cấu hình thêm gì ở dashboard: file `wrangler.jsonc` đã khai báo sẵn.

## Cách chơi

1. Một người mở trang, chọn bên (Đỏ, Đen hoặc ngẫu nhiên), đặt **mật khẩu phòng** (để trống thì máy tự sinh),
   rồi bấm **Tạo phòng và mời bạn**.
2. Bấm **Mời bạn** để gửi link (trên điện thoại mở bảng chia sẻ, trên máy tính sao chép link).
   Link đã kèm mật khẩu sau dấu `#` (phần này không gửi lên server và được xóa khỏi thanh địa chỉ).
3. Người kia mở link là vào đúng phòng và nhận bên còn lại. Nếu vào bằng tay thì nhập mã phòng và mật khẩu.
   Người thứ ba biết mật khẩu vào sẽ là khán giả. Sai mật khẩu 5 lần thì phòng khóa 1 phút.
4. Rớt mạng hoặc khóa màn hình: game tự nối lại, ván cờ và chỗ ngồi được giữ nguyên.
   Mở lại link ở tab mới cũng lấy lại được chỗ ngồi.
5. Xin hòa, xin thua, chơi lại (hai bên đổi quân) đều có trên thanh nút.

Quân bị ăn được đặt ra khay hai bên bàn. Nút **Xoay** mặc định khóa: bật lên mới kéo để xoay camera,
nhờ vậy chạm trượt quân không làm xoay bàn. **Chế độ: 3D/2D** đổi giữa 3D và 2D nhìn từ trên
(máy không hỗ trợ 3D tự dùng 2D). Nút ☰/✕ ở góc phải ẩn hoặc hiện thanh nút (trên điện thoại ngang mặc định ẩn).
Nút **Toàn màn hình** dùng được trên máy tính và Android; iPhone: Chia sẻ rồi *Thêm vào MH chính*.

## Riêng tư

Đây là game dùng riêng với bạn bè: không tài khoản, không thu thập số điện thoại hay thông tin cá nhân,
không thu phí, không quảng cáo. Trang có `noindex`, `robots.txt` và header `X-Robots-Tag` để Google không lập chỉ mục.
Server chỉ lưu bản băm mật khẩu (SHA-256 có muối), không lưu mật khẩu gốc. Phòng không hoạt động 24 giờ tự bị xóa.
Đây không phải tư vấn pháp lý; nếu mở rộng cho đông người hoặc thu phí, hãy tìm hiểu quy định về trò chơi điện tử trực tuyến (G1).

## Chạy thử trên máy

```
npm install
npm run dev
```

`npm run dev` chạy bản không làm rối (`build:plain`) để dễ sửa lỗi. `npm run build` tạo bản làm rối giống như trên Cloudflare.

Mở `http://localhost:8787`. Thử hai người trên một máy bằng cách mở hai tab hoặc hai trình duyệt
(mỗi tab là một người chơi riêng).

Trên Windows PowerShell nếu báo "running scripts is disabled", dùng `npm.cmd install` và `npm.cmd run dev`.

Chạy test: `npm test` (cần Node 20 trở lên).

## Cấu trúc

```
public/            mã nguồn trang web (build.mjs gộp, làm rối rồi ghi ra dist/ để Cloudflare phục vụ)
  index.html
  client/          giao diện, cảnh 3D (board3d.js), chế độ 2D (board2d.js), khay quân, kết nối mạng
  shared/xiangqi.js  luật cờ tướng, dùng chung cho client và server
worker/            server
  index.js         định tuyến /ws/<MÃ> tới đúng phòng
  room.js          Durable Object: giữ kết nối và lưu ván cờ
  room-logic.js    luật phòng (chỗ ngồi, nước đi, hòa, thua, chơi lại)
tests/             test luật cờ, logic phòng, Durable Object giả
build.mjs          gộp + làm rối mã client (esbuild + javascript-obfuscator)
wrangler.jsonc     cấu hình Cloudflare
```

## Giới hạn gói Cloudflare miễn phí

Durable Objects chạy được trên gói free (chỉ loại lưu trữ SQLite, game này dùng đúng loại đó).
Hạn mức tính theo ngày và reset lúc 00:00 UTC (7 giờ sáng giờ Việt Nam); vượt hạn mức thì thao tác đó báo lỗi
chứ không bị tính tiền. Với hai người chơi, lượng dùng rất nhỏ. Xem trang giá của Cloudflare để biết số hiện tại.

Phòng không có hoạt động 24 giờ sẽ tự bị xóa.

## Chưa có

Đồng hồ cờ, chiếu liên tục/đuổi liên tục, đấu với máy, chat, chơi offline.
Thư viện Three.js đang tải từ CDN jsDelivr nên cần có mạng.

## Cài lên màn hình chính (điện thoại)

Trang có manifest và biểu tượng nên Android (Chrome: ⋮ → *Cài đặt ứng dụng*) và iPhone (Chia sẻ → *Thêm vào MH chính*)
mở được như ứng dụng toàn màn hình. Có service worker nhỏ ưu tiên mạng nên luôn nhận bản mới khi online.

## Làm rối mã

Mã client được làm rối ở mức vừa (đổi tên biến, mã hóa chuỗi, chèn mã thừa nhẹ), không bật các tùy chọn làm chậm game.
Đây chỉ làm người khác khó đọc hơn, không phải bảo mật thật sự: luật cờ và mật khẩu phòng vẫn do server kiểm tra.
Nên để repo GitHub ở chế độ riêng tư (private) vì mã nguồn gốc nằm ở đó.
