# Game quiz nhiều người chơi

Câu hỏi hiện ở trên, sàn chia 4 ô A/B/C/D. Mỗi người điều khiển nhân vật chạy, nhảy vào ô đáp án. Hết giờ nhân vật đứng ở ô nào thì tính đáp án ô đó.

## Chạy

```bash
npm install
cp .env.example .env   # tuỳ chọn: đặt mật khẩu quản trị, chọn cách lưu câu hỏi…
npm start              # hoặc: npm run dev (tự khởi động lại khi sửa code)
```

Terminal sẽ in ra các địa chỉ:

- `/editor`: soạn bộ câu hỏi
- `/host`: chọn bộ câu hỏi, tạo phòng, chiếu mã QR và PIN, bấm Bắt đầu
- `/`: trang người chơi (quét QR là vào thẳng trang này)

Điện thoại phải dùng **chung mạng Wi-Fi** với máy chạy server. Nếu muốn chơi qua Internet (ngrok, deploy...), đặt biến `PUBLIC_URL` để QR trỏ đúng địa chỉ:

```bash
PUBLIC_URL=https://abc.ngrok.app npm start
```

## Nhập / xuất bộ câu hỏi

Ở trang `/editor`:

- **⬆ Nhập từ file** (hoặc kéo thả file vào trang): `.xlsx`, `.csv`, `.json`. Trước khi nhập sẽ hiện bảng xem trước, dòng lỗi được đánh dấu kèm lý do và bị bỏ qua. Có thể tạo bộ mới hoặc thêm vào cuối bộ đang mở. Câu hỏi được đưa vào trình soạn ở trạng thái chưa lưu.
- **⬇ Xuất file**: tải bộ đang mở (kể cả phần chưa lưu) ra Excel, CSV hoặc JSON.
- **Tải file mẫu**: link dưới nút Nhập.

Định dạng (một dòng là một câu hỏi):

| Câu hỏi | Đáp án A | Đáp án B | Đáp án C | Đáp án D | Đáp án đúng | Thời gian (giây) |
|---|---|---|---|---|---|---|
| Thủ đô Việt Nam? | Hà Nội | Huế | Đà Nẵng | TP.HCM | A | 15 |

- Tiêu đề cột nhận có dấu, không dấu hoặc tiếng Anh, theo thứ tự bất kỳ. Không có dòng tiêu đề thì đọc theo thứ tự cột như bảng trên.
- **Đáp án đúng**: `A`–`D`, `1`–`4`, hoặc gõ đúng nội dung đáp án. **Thời gian** để trống thì mặc định 15 giây.
- CSV tự nhận dấu phân cách `,` `;` Tab, và tự đọc được file lưu bằng bảng mã Windows-1258 (Excel đời cũ).
- Google Sheets: *Tệp → Tải xuống → .xlsx* rồi nhập file đó.

## Cấu hình

Cấu hình bằng biến môi trường (xem `.env.example`):

- `ADMIN_PASSWORD`: mật khẩu cho `/host` và `/editor`. Người chơi không cần mật khẩu. Bỏ trống thì không cần đăng nhập (chỉ dùng khi dev). **Bắt buộc đặt khi đưa lên Internet.**
- `STORAGE=file` (mặc định): lưu bộ câu hỏi thành file trong `data/quizzes/`.
- `STORAGE=postgres` + `DATABASE_URL` (+ `DATABASE_SSL_CA` cho RDS): lưu trong PostgreSQL. Bảng được tự tạo khi server khởi động (`src/db/schema.sql`).
- `npm run import-quizzes`: chép các file trong `data/quizzes/` vào database đang cấu hình.

## Triển khai lên AWS

Xem **[docs/deploy-aws.md](docs/deploy-aws.md)** (EC2 + RDS PostgreSQL + HTTPS miễn phí với Caddy và sslip.io).

## Cấu trúc

```
server.js                 khởi động Express + Socket.IO
src/config.js             hằng số: cổng, kích thước sân, điểm, thời gian
src/quizStore.js          kiểm tra bộ câu hỏi + chọn kho lưu theo STORAGE
src/stores/               fileStore.js (file JSON), pgStore.js (PostgreSQL)
src/db/schema.sql         bảng quizzes, questions
src/auth.js               đăng nhập quản trị (cookie ký HMAC)
src/routes/quizzes.js     REST API /api/quizzes
src/game/Room.js          logic một phòng chơi (không phụ thuộc Socket.IO)
src/game/sockets.js       sự kiện Socket.IO → Room
src/utils/network.js      IP LAN, link tham gia cho QR
public/js/lib/            constants.js, arena.js (vẽ sân), ui.js (DOM, bảng xếp hạng)
public/js/pages/          player.js, host.js, editor.js
public/css/               base.css, game.css, host.css, editor.css
scripts/import-quizzes.js chép file JSON vào database
docs/deploy-aws.md        hướng dẫn triển khai AWS
test/                     npm test (thêm TEST_DATABASE_URL=... để test cả PostgreSQL)
```

## Luật tính điểm

- Đúng: 500 điểm, cộng tối đa 500 điểm thưởng nếu chạy vào ô sớm (tính từ lần cuối cùng đổi ô)
- Đứng yên từ đầu đến cuối, dù đúng ô, chỉ được 500 điểm cơ bản
- Sai: 0 điểm

## Trong trận

- Mỗi câu: **câu hỏi → đáp án đúng (4 giây) → bảng xếp hạng tạm thời (5 giây)** có ▲▼ thay đổi hạng; người bằng điểm thì đồng hạng.
- Câu cuối đi thẳng tới màn **công bố kết quả**: hạng thấp hiện trước, rồi bục hạng 3 → 2 → 1, kèm confetti.
- Host điều khiển trận ở góc dưới bên phải:
  - **⏸ Tạm dừng / ▶ Tiếp tục** (phím **P**): đồng hồ, thử thách và nhân vật đứng yên; thời gian dừng không tính vào điểm tốc độ.
  - **⏭ Bỏ qua** (phím **N**): câu hỏi → hiện đáp án ngay; đáp án / bảng xếp hạng → sang bước tiếp.
  - **⏹ Kết thúc**: công bố kết quả ngay, câu đang dở không tính điểm.

## Thử thách trong trận

Host chọn mức **Tắt / Dễ / Vừa / Khó** khi tạo phòng. Thử thách chỉ xuất hiện sau 2 giây đầu và dừng 1 giây trước khi hết giờ:

- ☄️ **Thiên thạch**: vệt đỏ trên sàn báo trước chỗ sắp rơi. Bị trúng sẽ choáng 1,5 giây và bị hất văng, có thể văng sang ô khác. Nhảy đúng lúc thì né được.
- 🌬️ **Gió**: đẩy mọi người về một phía trong 3 giây. Chạy ngược gió vẫn đi được nhưng chậm.
- 🧊 **Sàn băng**: một ô trở nên trơn, khó dừng đúng chỗ.
- 🛡️ **Khiên**: ai chạm vào trước thì nhặt được, đỡ được một lần thiên thạch (giữ qua các câu cho tới khi dùng).

Bị trúng không bị trừ điểm. Cái giá là có thể bị đẩy sang ô sai.

Lịch thử thách do server tạo (`src/game/hazards.js`) nên mọi người thấy giống nhau. Mỗi máy tự kiểm tra nhân vật của mình có bị trúng không (`public/js/pages/player.js`), còn server quyết định ai được khiên và khiên có đỡ được hay không.

## Điều khiển

- Máy tính: ← → hoặc A D để chạy, Space, ↑ hoặc W để nhảy
- Điện thoại: nút trên màn hình (nên xoay ngang)

## Reload trang / rớt mạng

- **Người chơi** reload hoặc rớt mạng sẽ tự vào lại đúng nhân vật, giữ nguyên điểm và khiên. Phiên được lưu theo từng tab, nên một máy mở nhiều tab vẫn là nhiều người chơi khác nhau.
- **Host** reload hoặc rớt mạng: phòng được giữ 60 giây (`HOST_GRACE_MS`) để host quay lại, ván chơi vẫn tiếp tục chạy trong lúc đó.
- Host bấm "Chọn bộ khác" thì phòng đóng hẳn.
- Phòng chỉ nằm trong bộ nhớ server: **khởi động lại server là mất hết phòng đang chơi**. Bộ câu hỏi thì không mất.
