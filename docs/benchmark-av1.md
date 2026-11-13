# ทดสอบ AV1 HLS บน GitHub Actions

## เริ่มรัน

1. Push workflow ขึ้น default branch ของ repo เพื่อให้ GitHub แสดงปุ่ม **Run workflow**
2. เตรียมลิงก์ HTTPS ที่ดาวน์โหลดไฟล์วิดีโอได้โดยตรง หากเป็นลิงก์ส่วนตัวหรือมี token ให้เพิ่ม repository secret ชื่อ `AV1_BENCHMARK_SOURCE_URL` ที่ **Settings → Secrets and variables → Actions**
3. ไปที่ **Actions → Benchmark AV1 HLS → Run workflow**
4. กรอก `source_url` สำหรับลิงก์สาธารณะ หรือเว้นว่างเพื่อใช้ secret
5. ตั้ง `sample_seconds` เป็น `30` สำหรับลอง 30 วินาทีแรก หรือ `0` เพื่อวัดทั้งคลิป จากนั้นกด **Run workflow**

## อ่านผล

เปิดรายการรันแล้วดู **Summary** เพื่ออ่านขนาด HLS และเวลาของแต่ละรอบแปลง ระดับ 360p กับ 480p ใช้รอบแปลงร่วมกัน เวลารวมจะนับรอบนี้ครั้งเดียว ส่วนเวลาดาวน์โหลดอยู่ใน log ขั้น **Download test source**

Workflow ใช้ SVT-AV1 preset 8 และ HLS fMP4 โดยอิงเกณฑ์เลือกความละเอียดและบิตเรตจาก worker ตัวจริง ตัวอย่างคลิป 1440×1080 จะได้ 144p, 360p, 480p, 720p และ 1080p หากต้องการวัดครบถึง 2160p ให้ใช้ต้นฉบับ 4K

เวลาในตารางครอบคลุมการเข้ารหัสและสร้าง HLS บน runner ระบบลบไฟล์ HLS ทดสอบหลังจบรอบแปลง การรันมีเพดาน 300 นาที และใช้คลิปจากลิงก์ที่ระบุโดยตรง
