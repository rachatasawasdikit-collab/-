# ใช้งานกับ Google Apps Script (ไม่ต้องเปิดคอมทิ้งไว้)

โฟลเดอร์นี้มี backend สำหรับรันบน Google Apps Script แทน `server/index.js`
ข้อมูลทั้งหมดเก็บใน Google Sheets และไฟล์แนบเก็บใน Google Drive
หน้าเว็บเดิม (`public/app.js`) ใช้ได้เหมือนเดิมทุกหน้า เพราะ `demo/bridge.js`
แปลงคำขอให้เข้ากับ Apps Script

## ขั้นตอนติดตั้ง (ทำครั้งเดียว)

1. เปิด <https://script.google.com> → **New project**
2. ลบโค้ดเดิมใน `Code.gs` แล้ววางเนื้อหาจาก [`Code.gs`](Code.gs) ทั้งไฟล์
3. เปิด **Project Settings** → ติ๊ก **Show "appsscript.json" manifest file in editor**
   แล้ววางเนื้อหาจาก [`appsscript.json`](appsscript.json)
4. กด **Run** ฟังก์ชัน `setup` หนึ่งครั้ง แล้วอนุญาตสิทธิ์ (Spreadsheet + Drive)
   - ระบบจะสร้างสเปรดชีตชื่อ **ตรวจใบกิจกรรม · ฐานข้อมูล** ใน Drive ของคุณ
   - ถ้าต้องการข้อมูลตัวอย่าง (ครู `teacher` / `123456`, ห้อง `SCI501`) ให้ `setup` สร้างให้อัตโนมัติเมื่อยังไม่มีผู้ใช้
5. **Deploy → New deployment → Web app**
   - Description: `activity-check`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - กด **Deploy** แล้วคัดลอก URL ที่ลงท้ายด้วย `/exec`
6. นำ URL ไปตั้งค่าให้หน้าเว็บ (เลือกทางใดทางหนึ่ง)
   - **ทางที่แนะนำ:** สร้าง `docs/config.json`:
     ```json
     { "api": "https://script.google.com/macros/s/XXXX/exec", "mode": "apps-script" }
     ```
     แล้ว commit/push ขึ้น GitHub Pages
   - หรือเปิดเว็บ → ปุ่ม **เชื่อมเซิร์ฟเวอร์** มุมล่างซ้าย → วาง URL (จำค่าไว้เฉพาะเบราว์เซอร์นั้น)
   - หรือแชร์ลิงก์ `<pages-url>?api=https://script.google.com/macros/s/XXXX/exec` ให้นักเรียนเปิดครั้งแรก

หลังตั้งค่าแล้ว ปุ่ม/ข้อมูลทั้งหมดจะทำงานกับ Google Sheets โดยไม่ต้องเปิดคอมพิวเตอร์

## ข้อมูลเก็บที่ไหน

| แท็บในสเปรดชีต | เก็บอะไร |
| --- | --- |
| `users` | บัญชีครู/นักเรียน (รหัสผ่านแฮช SHA-256 + salt) |
| `sessions` | token ของผู้ที่เข้าสู่ระบบ (อายุ 30 วัน) |
| `classes`, `members` | ห้องเรียนและรายชื่อนักเรียน |
| `activities`, `rubric_items` | ใบกิจกรรมและหัวข้อให้คะแนน |
| `submissions`, `submission_scores` | งานที่ส่ง ผลตรวจ และคะแนน |
| `sheet_exports` | ลิงก์ชีตที่ export ไปแล้ว |

ไฟล์แนบอยู่ในโฟลเดอร์ Drive ชื่อ **ตรวจใบกิจกรรม · ไฟล์แนบ**

## คำสั่งที่มีให้ใน editor

| ฟังก์ชัน | ใช้ทำอะไร |
| --- | --- |
| `setup()` | สร้างสเปรดชีต/ตาราง และข้อมูลตัวอย่างถ้ายังว่าง |
| `seedSampleData()` | ใส่ข้อมูลตัวอย่าง (เฉพาะเมื่อยังไม่มีผู้ใช้) |
| `clearAllData()` | ล้างข้อมูลทุกตาราง (ไฟล์แนบเดิมยังอยู่ใน Drive) |

ถ้าลบสเปรดชีตทิ้ง ให้ลบ property `SPREADSHEET_ID` ใน Project Settings → Script properties
แล้วรัน `setup()` ใหม่

## ข้อควรรู้

- **CORS:** Apps Script ไม่รองรับ preflight จึงต้องใช้ simple request (`GET` หรือ `POST` แบบ `text/plain`)
  และส่ง token ผ่าน query/body — `demo/bridge.js` จัดการให้แล้ว ห้ามใส่ header `Authorization` เอง
- **สิทธิ์:** ทุกคนที่มี URL `/exec` เรียก API ได้ แต่ endpoints ที่ต้องล็อกอินจะตรวจ token
  และแยกข้อมูลตามบทบาท/ห้องเรียน เหมาะกับใช้ในห้องเรียน ไม่ควรใส่ข้อมูลอ่อนไหว
- **โควตา:** Apps Script จำกัดเวลารันต่อคำขอและจำนวนคำขอต่อวัน (เหมาะกับงานห้องเรียนขนาดปกติ)
  ไฟล์แนบจำกัด 15 MB ต่อไฟล์
- **รหัสผ่าน:** ใช้ SHA-256 + salt หลายรอบ (ไม่ใช่ scrypt เหมือนเซิร์ฟเวอร์ Node)
  ถ้าต้องการความปลอดภัยสูงกว่านี้ ให้ใช้เซิร์ฟเวอร์ Node แทน
- **การแก้โค้ด:** ถ้าแก้ `Code.gs` ต้อง **Deploy → Manage deployments → Edit → New version**
  แล้วกด Deploy อีกครั้ง URL เดิมยังใช้ได้
- **ทดสอบในเครื่อง:** `npm run test:apps-script` (จำลอง Apps Script ทั้งหมด)
  และ `npm run mock:apps-script` เพื่อเปิดเว็บในเครื่องต่อกับ API จำลอง
