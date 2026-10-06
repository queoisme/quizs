# Triển khai lên AWS (EC2 + RDS PostgreSQL)

Hướng dẫn tự làm từng bước trên AWS Console. Mỗi bước có giải thích **tại sao**, để vừa làm vừa học.

## Kiến trúc

```
 Điện thoại / máy chiếu
        │  HTTPS (443)  https://54-12-34-56.sslip.io
        ▼
┌───────────────── VPC mặc định ─────────────────────────────────┐
│  EC2 (Amazon Linux 2023)          sg: quiz-web-sg               │
│  ┌──────────┐   http://localhost:3000   ┌──────────────────┐    │
│  │  Caddy   │ ────────────────────────► │ Node.js (server) │    │
│  │ HTTPS tự │                           │ systemd: quiz-game│   │
│  │ động     │                           └────────┬─────────┘    │
│  └──────────┘                                    │ 5432 (SSL)   │
│                                                  ▼              │
│                          RDS PostgreSQL     sg: quiz-db-sg      │
│                          (không mở ra Internet)                 │
└─────────────────────────────────────────────────────────────────┘
```

- **Caddy** nhận HTTPS từ Internet, tự xin chứng chỉ Let's Encrypt, rồi chuyển request (kể cả WebSocket) vào Node ở cổng 3000.
- **Node** chỉ nghe trong máy, Internet không gọi thẳng vào cổng 3000 được.
- **RDS** không có IP công khai. Chỉ máy nào thuộc `quiz-web-sg` mới kết nối được. Đây là ý nghĩa của việc dùng security group làm "nguồn" (source).
- Phòng chơi nằm trong bộ nhớ của Node, nên **chỉ chạy 1 máy EC2**. Muốn chạy nhiều máy thì phải đưa trạng thái phòng ra Redis, việc đó để sau.

> Trong hướng dẫn này IP mẫu là `54.12.34.56`. Hãy thay bằng Elastic IP thật của bạn ở mọi chỗ.

---

## 0. Chuẩn bị (làm trước tiên)

1. **Chọn region** ở góc phải trên Console: **Asia Pacific (Singapore) `ap-southeast-1`**, gần Việt Nam nên độ trễ thấp. Mọi thứ phía dưới đều tạo **cùng một region**.
2. **Đặt cảnh báo chi phí**: *Billing and Cost Management → Budgets → Create budget → Use a template → Monthly cost budget*, đặt khoảng 5–10 USD và nhập email của bạn. Học AWS mà quên tắt tài nguyên là chuyện rất hay gặp, cảnh báo này sẽ cứu bạn.
3. **Chi phí tham khảo** (thay đổi theo thời điểm và loại tài khoản, hãy xem trang *Billing → Free tier*):
   - EC2 `t3.micro` và RDS `db.t4g.micro`/`db.t3.micro`: thường nằm trong free tier hoặc credit của tài khoản mới.
   - **IPv4 công khai (kể cả Elastic IP) bị tính phí theo giờ** (khoảng 0,005 USD/giờ, tức ~3,6 USD/tháng), kể cả khi trong free tier.
   - RDS ngoài free tier: khoảng 12–15 USD/tháng nếu để chạy liên tục.

---

## 1. Security group: "tường lửa" cho từng tài nguyên

*VPC → Security groups → Create security group*, chọn VPC mặc định (default).

**`quiz-web-sg`** (gắn cho EC2), Inbound rules:

| Type  | Port | Source  | Tại sao |
|-------|------|---------|---------|
| HTTP  | 80   | 0.0.0.0/0 | Let's Encrypt kiểm tra tên miền qua cổng 80; Caddy tự chuyển HTTP → HTTPS |
| HTTPS | 443  | 0.0.0.0/0 | Người chơi truy cập |
| SSH   | 22   | **My IP** | Chỉ máy bạn được SSH vào. Đổi mạng (về nhà, lên trường) thì cập nhật lại |

**`quiz-db-sg`** (gắn cho RDS), Inbound rules:

| Type       | Port | Source | Tại sao |
|------------|------|--------|---------|
| PostgreSQL | 5432 | chọn security group **`quiz-web-sg`** | Chỉ EC2 của game được nói chuyện với database, không mở cho bất kỳ IP nào |

Outbound giữ mặc định (cho phép tất cả).

---

## 2. Tạo database RDS PostgreSQL

*RDS → Databases → Create database*

- **Standard create** → Engine: **PostgreSQL** (phiên bản 16 hoặc 17)
- Templates: **Free tier** (nếu có), không thì **Sandbox/Dev/Test**
- DB instance identifier: `quiz-db`
- Master username: `quizadmin`
- Credentials management: **Self managed**, tự đặt mật khẩu.
  > Chỉ dùng **chữ và số** (ví dụ 24 ký tự ngẫu nhiên) để khỏi phải mã hoá ký tự đặc biệt trong `DATABASE_URL`. Ghi lại mật khẩu này.
- Instance: `db.t4g.micro` (hoặc `db.t3.micro`)
- Storage: gp3, 20 GiB, **bỏ chọn** *Enable storage autoscaling*
- Connectivity:
  - Compute resource: **Don't connect to an EC2 compute resource** (mình tự nối bằng security group ở bước 1 để hiểu rõ)
  - VPC: default
  - **Public access: No**, vì database không cần ra Internet.
  - VPC security group: **Choose existing → `quiz-db-sg`** (bỏ `default`)
- **Additional configuration → Initial database name: `quizgame`**
  > Nếu quên mục này thì RDS chỉ tạo database `postgres`, khi đó trong `DATABASE_URL` dùng `/postgres` thay cho `/quizgame`.
- Backup retention: 1 ngày là đủ để học

Bấm **Create database** và chờ khoảng 5–10 phút cho đến khi Status là *Available*. Mở database đó và ghi lại **Endpoint**, dạng `quiz-db.xxxxxxxx.ap-southeast-1.rds.amazonaws.com`.

> **SSL:** PostgreSQL trên RDS (bản 15 trở lên) **bắt buộc kết nối có mã hoá**. App sẽ dùng file chứng chỉ CA của AWS (`global-bundle.pem`) để vừa mã hoá vừa **xác minh** đúng là đang nói chuyện với RDS thật.

---

## 3. Tạo máy EC2

*EC2 → Instances → Launch instances*

- Name: `quiz-game`
- AMI: **Amazon Linux 2023** (x86_64)
- Instance type: `t3.micro`
- Key pair: **Create new key pair** → tên `quiz-key`, RSA, `.pem` → tải file về và giữ kỹ. Mất file này là mất cách SSH vào máy.
- Network settings → Edit: VPC default, **Auto-assign public IP: Enable**, **Select existing security group → `quiz-web-sg`**
- Storage: 8 GiB gp3 (mặc định) là đủ

**Gắn IP cố định (Elastic IP).** Nếu không gắn, mỗi lần stop/start máy là IP đổi, kéo theo link sslip.io và mã QR cũng đổi:
*EC2 → Elastic IPs → Allocate Elastic IP address → Allocate*, sau đó *Actions → Associate Elastic IP address* → chọn instance `quiz-game`.

Tên miền của bạn sẽ là IP với dấu chấm đổi thành gạch ngang: `54.12.34.56` → **`54-12-34-56.sslip.io`**.

---

## 4. SSH vào máy và cài phần mềm

Trên máy bạn:

```bash
chmod 400 ~/Downloads/quiz-key.pem
ssh -i ~/Downloads/quiz-key.pem ec2-user@54.12.34.56
```

Trên EC2:

```bash
sudo dnf update -y
sudo dnf install -y git

# Node.js 22 từ NodeSource
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
node -v    # v22.x

# User riêng để chạy app: nếu app bị khai thác lỗi thì kẻ xấu cũng không có quyền root
sudo useradd --system --home /opt/quiz-game --shell /sbin/nologin quiz
sudo mkdir -p /opt/quiz-game
sudo chown ec2-user:ec2-user /opt/quiz-game
```

---

## 5. Đưa code lên máy

**Cách A: qua GitHub** (nên dùng, cập nhật về sau dễ hơn). Đưa project lên một repo **private** trên GitHub, rồi trên EC2:

```bash
git clone https://github.com/<ban>/<repo>.git /opt/quiz-game
```

> Repo private thì cần đăng nhập: dùng *Personal access token* (GitHub → Settings → Developer settings) thay cho mật khẩu, hoặc tạo *deploy key* SSH cho repo.

**Cách B: chép thẳng từ máy bạn bằng rsync** (chạy trên máy bạn, trong thư mục project):

```bash
rsync -av --exclude node_modules --exclude .env --exclude '*.pem' \
  -e "ssh -i ~/Downloads/quiz-key.pem" ./ ec2-user@54.12.34.56:/opt/quiz-game/
```

Sau đó trên EC2:

```bash
cd /opt/quiz-game
npm ci --omit=dev

# Chứng chỉ CA của RDS để kết nối SSL có xác minh
curl -o /opt/quiz-game/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

---

## 6. Cấu hình (biến môi trường)

Các thông tin bí mật **không** nằm trong code mà nằm trong một file chỉ root đọc được:

```bash
openssl rand -hex 32          # copy kết quả làm SESSION_SECRET
sudo nano /etc/quiz-game.env
```

```ini
PORT=3000
PUBLIC_URL=https://54-12-34-56.sslip.io
ADMIN_PASSWORD=dat-mot-mat-khau-manh
SESSION_SECRET=<kết quả openssl ở trên>
STORAGE=postgres
DATABASE_URL=postgres://quizadmin:<mật khẩu RDS>@<endpoint RDS>:5432/quizgame
DATABASE_SSL_CA=/opt/quiz-game/global-bundle.pem
```

```bash
sudo chmod 600 /etc/quiz-game.env
```

**Kiểm tra kết nối database và chép bộ câu hỏi mẫu lên** (bước này cũng tự tạo các bảng):

```bash
cd /opt/quiz-game
sudo node --env-file=/etc/quiz-game.env scripts/import-quizzes.js
# ✓ Bộ mẫu – ... (6 câu)
# Đã import 1/1 bộ câu hỏi vào postgres
```

Muốn chép các bộ bạn đã soạn trên máy mình thì chép thư mục `data/quizzes/` lên (rsync) rồi chạy lại lệnh trên. Chạy lại nhiều lần không bị trùng.

> Bị treo rồi báo timeout thì gần như chắc chắn do security group: kiểm tra `quiz-db-sg` đã cho phép `quiz-web-sg` vào cổng 5432 chưa, và EC2 có đang gắn `quiz-web-sg` không.

---

## 7. Chạy app như một dịch vụ (systemd)

systemd giúp app **tự chạy khi máy khởi động** và **tự bật lại khi bị crash**.

```bash
sudo nano /etc/systemd/system/quiz-game.service
```

```ini
[Unit]
Description=Quiz game (Node.js)
After=network-online.target
Wants=network-online.target

[Service]
User=quiz
WorkingDirectory=/opt/quiz-game
EnvironmentFile=/etc/quiz-game.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now quiz-game
sudo systemctl status quiz-game          # phải thấy "active (running)"
journalctl -u quiz-game -f               # xem log trực tiếp, Ctrl+C để thoát
curl -I http://localhost:3000            # HTTP/1.1 200 OK
```

---

## 8. HTTPS với Caddy

```bash
# Tải Caddy (bản x86_64) và tạo user riêng cho nó
curl -L -o caddy "https://caddyserver.com/api/download?os=linux&arch=amd64"
sudo install -m 755 caddy /usr/local/bin/caddy && rm caddy
caddy version

sudo groupadd --system caddy
sudo useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /sbin/nologin caddy
sudo mkdir -p /etc/caddy
sudo nano /etc/caddy/Caddyfile
```

```caddy
54-12-34-56.sslip.io {
	encode gzip
	reverse_proxy localhost:3000
}
```

Chỉ vậy thôi: Caddy tự xin chứng chỉ, tự gia hạn, tự chuyển HTTP sang HTTPS và tự chuyển tiếp WebSocket.

```bash
sudo nano /etc/systemd/system/caddy.service
```

```ini
[Unit]
Description=Caddy web server
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
# Cho phép user thường mở cổng 80/443 (vốn chỉ root mới được)
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now caddy
journalctl -u caddy -f        # chờ dòng "certificate obtained successfully"
```

---

## 9. Kiểm tra

1. Mở `https://54-12-34-56.sslip.io/host` → sẽ chuyển sang trang **đăng nhập** → nhập `ADMIN_PASSWORD`.
2. Tạo phòng. Mã QR phải trỏ tới `https://54-12-34-56.sslip.io/?pin=...`, không phải `192.168...`.
3. Dùng điện thoại **bằng 4G** (khác mạng) quét QR, vào chơi được là thành công 🎉
4. Vào `/editor` tạo một bộ câu hỏi, rồi `sudo systemctl restart quiz-game`. Bộ câu hỏi vẫn còn, vì giờ nó nằm trong RDS chứ không nằm trên máy EC2.

---

## Cập nhật code về sau

```bash
cd /opt/quiz-game
git pull                      # hoặc rsync lại như bước 5
npm ci --omit=dev
sudo systemctl restart quiz-game
```

> ⚠ Khởi động lại app sẽ **xoá các phòng đang chơi** (phòng nằm trong bộ nhớ). Đừng cập nhật giữa buổi chơi.

---

## Tiết kiệm chi phí / dọn dẹp

- Không dùng trong vài ngày: **Stop** EC2 và **Stop** RDS. RDS chỉ cho dừng tối đa 7 ngày, sau đó sẽ **tự bật lại**. Elastic IP vẫn bị tính phí khi máy dừng.
- Không dùng nữa: xoá theo thứ tự **EC2 instance → Release Elastic IP → RDS database** (có thể bỏ chọn tạo final snapshot) **→ 2 security group**. Kiểm tra lại trang *Billing* sau 1–2 ngày.

---

## Gặp lỗi?

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Trình duyệt báo không kết nối được | `quiz-web-sg` chưa mở 80/443; Caddy chưa chạy (`systemctl status caddy`) |
| Caddy không xin được chứng chỉ | Tên sslip.io không khớp Elastic IP; cổng 80 bị chặn |
| `502 Bad Gateway` | App Node đang chết → `journalctl -u quiz-game -n 50` |
| App báo `timeout` khi kết nối database | Security group (xem cuối bước 6) |
| `password authentication failed` | Sai mật khẩu, hoặc mật khẩu có ký tự đặc biệt chưa mã hoá trong `DATABASE_URL` |
| `self-signed certificate` / lỗi SSL | Sai đường dẫn `DATABASE_SSL_CA`, hoặc chưa tải `global-bundle.pem` |
| `database "quizgame" does not exist` | Quên *Initial database name* → dùng `/postgres` trong `DATABASE_URL` |
| Đăng nhập xong lại bị đẩy về trang đăng nhập | Mở bằng `http://` thay vì `https://` (cookie chỉ gửi qua HTTPS) |

---

## Học tiếp (khi đã chạy ổn)

- **AWS Secrets Manager + IAM role cho EC2**: không còn để mật khẩu database trong file. EC2 tự lấy bí mật bằng quyền của role, không cần khoá truy cập.
- **CloudWatch Logs**: gom log của `journalctl` lên CloudWatch để xem mà không cần SSH.
- **Session Manager (SSM)**: vào máy không cần mở cổng 22 và không cần file `.pem`.
- **Infrastructure as Code** (CloudFormation / Terraform / CDK): tạo lại toàn bộ hạ tầng ở trên chỉ bằng một lệnh.
- **Tên miền thật + Route 53**: thay sslip.io. Chỉ cần sửa `Caddyfile` và `PUBLIC_URL`.
