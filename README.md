# Schema Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

แอป Electron แบบ Open Source สำหรับร่าง schema ด้วยข้อความ ดูความสัมพันธ์แบบ ERD ใน React Flow และ export เป็นสคริปต์เดียวต่อฐานข้อมูล

## ทำอะไรได้บ้าง

- เขียน schema เป็นข้อความ แล้วดู ERD อัปเดตทันที (ลากการ์ด ซูม Fit view และ minimap)
- Export เป็น SQL ของ PostgreSQL, MySQL, SQLite, สคริปต์ `mongosh` ของ MongoDB หรือ Prisma Schema
- ใส่แถวตัวอย่างให้แต่ละตาราง และรวมเป็น Seed ตอน export
- Import SQL (DDL), Compare & migrate และทดลอง query ใน SQL Sandbox
- เชื่อม AI Agent ผ่าน MCP โดยคนตรวจและอนุมัติการแก้ไขก่อนเสมอ
- ทำงานในเครื่อง ไม่ต้องสมัครบัญชี

## เปิดแอป

ต้องใช้ Node.js 22.12 ขึ้นไป

```powershell
npm ci
npm start
```

แอปเริ่มด้วยตัวอย่าง PostgreSQL แก้ข้อความใน **Source** แล้วดู ERD ที่อัปเดตทันที ใช้ **Output** เพื่อดูหรือคัดลอกสคริปต์ และ **Export SQL** เพื่อบันทึกไฟล์ สามารถลากการ์ด ซูม หรือกด Fit view เพื่อจัดมุมมองได้

**Save draft** บันทึกไฟล์ `.schema` พร้อม engine และข้อความ ส่วน **Open** เปิดไฟล์ดังกล่าวหรือไฟล์ข้อความ DSL ได้ แอปเก็บ draft ล่าสุดแยกตาม engine ในเครื่อง เมื่อเลือก SQL engine ใหม่ครั้งแรก แอปจะลองใช้ draft SQL ปัจจุบันและแจ้งชนิดข้อมูลที่ engine ใหม่ไม่รองรับ

กด **Preview** บนการ์ด Table หรือ Collection ใน ERD เพื่อดู เพิ่ม แก้ไข หรือลบแถวตัวอย่าง **Save draft** จะเก็บแถวเหล่านี้ในไฟล์ `.schema` ด้วย ค่าในพรีวิวเก็บเป็นข้อความ และคำสั่ง Export สร้างสคริปต์โครงสร้างฐานข้อมูลตาม schema

ดับเบิลคลิกเซลล์ที่ประกาศ `ref` เพื่อเลือกค่าจากแถวตัวอย่างของตารางปลายทาง หากลบแถวปลายทาง เซลล์ที่อ้างถึงจะแสดง **Missing reference**

เลือก **Include preview rows** ข้างปุ่ม Export เพื่อรวมแถวตัวอย่างเป็น Seed ในสคริปต์เดียวกับ schema รายการจะแสดงใน **Output** และใช้สคริปต์เดียวกันทั้งตอน Copy และ Export

ลากการ์ดในแผนภาพเพื่อจัดตำแหน่งเอง ตำแหน่งถูกเก็บในเครื่องและบันทึกลงไฟล์ `.schema` พร้อมกับ **Save draft** (ฟิลด์ `layout`) เมื่อ **Open** ไฟล์นั้นการ์ดจะกลับมาอยู่ที่เดิม การ์ดที่เพิ่มใหม่ภายหลังจะวางไว้ใต้การ์ดเดิม กด **Auto layout** เพื่อลืมตำแหน่งที่จัดไว้ และ **Export diagram** เพื่อบันทึกแผนภาพเป็นไฟล์ SVG ตามตำแหน่งที่จัด ส่วนเมนู Export format มีตัวเลือก **DBML** สำหรับส่ง schema ไปใช้กับ dbdiagram.io

เปิด **Schema tools** จากแถบด้านล่างเพื่อใช้คำสั่งเพิ่มเติม

- **Export with data** แสดงสคริปต์ที่รวม schema และแถวตัวอย่างจาก draft เดียวกัน แก้ค่าหรือการอ้างอิงที่ขึ้นข้อผิดพลาดก่อนบันทึกสคริปต์
- **Compare & migrate** รับไฟล์ `.schema` หรือข้อความของ draft เวอร์ชันเดิม และใช้ draft ที่เปิดเป็นเป้าหมาย สร้าง migration สำหรับการเพิ่มตาราง คอลัมน์ และ index บน PostgreSQL, MySQL และ SQLite โดยค่าเริ่มต้นการลบ เปลี่ยนชนิดข้อมูล หรือเปลี่ยน NOT NULL/UNIQUE จะไม่ถูกใส่ในสคริปต์ เลือก **Include data-changing statements** เพื่อสร้าง `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN … TYPE` และ `MODIFY COLUMN` สคริปต์จะมีคำเตือนให้สำรองข้อมูลก่อน ส่วนการแก้ primary key, foreign key และการเอา UNIQUE ออกยังต้องทำเอง และ SQLite เปลี่ยนชนิดหรือ NOT NULL ของคอลัมน์เดิมไม่ได้ในสคริปต์
- **Import DBML** แปลง DBML จาก dbdiagram.io (`Table`, `Ref`, `indexes`, `Enum`, `Project`) เป็น draft แสดงรายการสิ่งที่ต้องปรับ เช่น enum กลายเป็น `varchar(64)` ก่อนให้กด **Apply to draft**
- **Schema lint** ตรวจ draft เช่น ตารางไม่มี primary key, ชนิดของ foreign key ไม่ตรงกับคอลัมน์ที่อ้างถึง, foreign key ที่ไม่มี index และชื่อที่ผสมหลายรูปแบบ
- **Sample data** สร้างแถวตัวอย่างให้ทุกตารางหรือ collection (1–200 แถว) ค่าเป็นไปตามชนิดข้อมูล foreign key อ้างถึงแถวที่มีอยู่ และได้ผลเดิมทุกครั้ง แล้วนำไปใช้เป็น Seed ได้
- **Import SQL** รับไฟล์หรือข้อความ DDL สำหรับ PostgreSQL, MySQL และ SQLite เช่น `CREATE TABLE`, `CREATE INDEX` และ `ALTER TABLE … ADD FOREIGN KEY` แสดง draft ที่แปลงแล้วก่อนให้กด **Apply to draft** และรายงานคำสั่งที่แปลงไม่ได้
- **Review MCP proposal** รับ JSON จาก `propose_schema` แสดง Source ปัจจุบันและ Source ที่เสนอ พร้อมรายการเปลี่ยนแปลง ข้อเสนอจะเปิดให้ Apply เมื่ออ้างอิง draft เวอร์ชันปัจจุบัน
- **SQL Sandbox** ใช้ในแอป Electron เมื่อเลือก SQLite เปิด draft ในฐานข้อมูลชั่วคราวเพื่อทดลอง `SELECT` หรือ `JOIN` เปิด **Include preview rows** เพื่อโหลด Seed ด้วย แต่ละครั้งเริ่มจากฐานข้อมูลใหม่ แสดงผลได้สูงสุด 100 แถว และหยุด query ที่ใช้เวลาเกิน 5 วินาที

## Syntax

```text
database commerce

table customers {
  id bigint pk
  email varchar(255) required unique
}

table orders {
  id bigint pk
  customer_id bigint required ref customers.id ondelete cascade
  status varchar(30) default "new"
  total numeric(12,2) required
  index by_customer (customer_id)
  index unique customer_status (customer_id, status)
}
```

- ใช้หนึ่งคำสั่งต่อบรรทัด ชื่อใช้ตัวอักษร ASCII ตัวเลข และขีดล่าง โดยขึ้นต้นด้วยตัวอักษรหรือขีดล่าง
- ใช้ `pk` หรือ `primary (field_a, field_b)` สำหรับ primary key, `required` สำหรับ NOT NULL และ `unique` สำหรับ unique constraint
- ค่า `default` ใช้ JSON string, number, boolean, null หรือ `now` สำหรับ CURRENT_TIMESTAMP
- `ref ENTITY.FIELD` รองรับ foreign key แบบคอลัมน์เดียว และ `ondelete cascade|restrict|set_null|no_action` อ้างอิง SQL ไปยังคอลัมน์ที่เป็น unique key เดี่ยว
- `index [unique] NAME (field_a, field_b)` รองรับดัชนีคอลัมน์เดียวและหลายคอลัมน์
- ใช้ `#` หรือ `//` สำหรับ comment เต็มบรรทัด

| Engine     | ตัวอย่างชนิดข้อมูล                                                       | ผลลัพธ์                                                                                                       |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | bigint, numeric(12,2), uuid, jsonb, text[], timestamptz, bytea           | `.sql` สำหรับ `psql` เริ่มจาก maintenance database เช่น `psql -d postgres -v ON_ERROR_STOP=1 -f commerce.sql` |
| MySQL      | bigint, varchar(255), decimal(12,2), json, datetime, varbinary(32)       | `.sql` พร้อม CREATE DATABASE และ USE                                                                          |
| SQLite     | integer, text, numeric, real, blob                                       | `.sql` สำหรับไฟล์ฐานข้อมูล SQLite ที่เลือก พร้อมเปิด foreign keys ใน session ที่รันสคริปต์                    |
| MongoDB    | objectId, string, bool, int, long, decimal, date, object, array, binData | `.js` สำหรับ `mongosh --file commerce.js` พร้อม collection, BSON validator และ index                          |

สำหรับ MongoDB ใช้ `collection` แทน `table` เช่น

```text
database commerce
collection orders {
  _id objectId pk
  status string required
  items array required
  index by_status (status)
}
```

MongoDB ใช้ `_id` เป็น primary key โดยอัตโนมัติ ส่วน `ref` ใช้วาดความสัมพันธ์ใน ERD ตัว export มุ่งสร้างฐานข้อมูลหรือ schema ใหม่จาก draft การรองรับชนิดข้อมูลเป็นไปตามรายการของแต่ละ engine และตัวฐานข้อมูลเป็นผู้ตรวจข้อจำกัดเฉพาะ เช่น ขนาด index, type compatibility ของ foreign key และความเข้ากันได้ของค่า default

### Syntax hints และ charset ของ MySQL

เลือก Engine จากเมนูด้านบนก่อนพิมพ์หรือ Export ใช้ **Syntax hints** หรือกด `Ctrl+Space` ใน Source เพื่อเปิดคำแนะนำ ณ ตำแหน่งเคอร์เซอร์ รายการจะแสดงขณะพิมพ์ด้วย ใช้ลูกศรเลือกแล้วกด Tab หรือ Enter เพื่อแทรก หรือคลิกคำแนะนำโดยตรง เปิด **?** เพื่อดูรายชื่อชนิดข้อมูลที่แอปรองรับสำหรับ Engine นั้น

ตั้งค่า charset และ collation ระดับฐานข้อมูลสำหรับ MySQL ในบรรทัดแรกได้ เช่น

```text
database commerce charset utf8mb4 collate utf8mb4_0900_ai_ci
```

| Charset   | Collation ที่แอปรองรับ                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `utf8mb4` | `utf8mb4_0900_ai_ci`, `utf8mb4_0900_as_cs`, `utf8mb4_unicode_ci`, `utf8mb4_general_ci`, `utf8mb4_bin` |
| `latin1`  | `latin1_swedish_ci`, `latin1_general_ci`, `latin1_bin`                                                |
| `ascii`   | `ascii_general_ci`, `ascii_bin`                                                                       |
| `tis620`  | `tis620_thai_ci`, `tis620_bin`                                                                        |

ถ้าใส่เฉพาะ charset เซิร์ฟเวอร์จะเลือก collation เริ่มต้นของ charset นั้น ถ้าใช้เพียง `database commerce` เซิร์ฟเวอร์จะใช้ค่าเริ่มต้นของเซิร์ฟเวอร์ Collation ที่มี `0900` ต้องใช้ MySQL 8.0 ขึ้นไป

## เชื่อม AI Agent ผ่าน MCP

ใน Electron เปิด **MCP setup → Start MCP connection** เพื่อเปิด endpoint แบบ Streamable HTTP บนเครื่องนี้ แล้วเลือก client (Claude Code, Codex, Gemini CLI) จากนั้นกด **Copy command** (Claude Code / Gemini CLI รันในเทอร์มินัลได้ทันที), **Copy configuration** (Codex ใส่ใน `config.toml`), หรือ **Copy URL** / **Copy token** แยกกัน หน้าจอซ่อน token ไว้ (กด **Show token** เพื่อดู) แต่ปุ่ม Copy ใช้ค่าเต็มเสมอ ใช้ **Close MCP connection** เพื่อหยุด endpoint และตัดการเชื่อมต่อ เมื่อ Start อีกครั้งให้ใช้ URL และ token ชุดใหม่

เมื่อ Agent เชื่อมต่อ อ่าน draft หรือส่งข้อเสนอเข้ามา แอปจะแสดงแจ้งเตือนมุมล่างขวาและบันทึกใน **Agent activity** ถ้าเป็นข้อเสนอที่ต้องตรวจ จะมีปุ่ม **Review**, ตัวเลขบนปุ่ม **Schema tools** และแจ้งเตือนจากระบบปฏิบัติการเมื่อแอปไม่ได้อยู่หน้าจอ

สำหรับ stdio ให้เปิด **Independent stdio configuration** ในแอปเพื่อดู path ของโปรเจกต์ MCP client จะเป็นผู้เปิดและปิดโปรเซส stdio เอง

```json
{
  "mcpServers": {
    "schema-studio": {
      "command": "node",
      "args": ["C:/Project/database-viewer/mcp.mjs"]
    }
  }
}
```

- `schema_syntax` ส่งคืนคู่มือและตัวอย่าง
- `validate_schema` รับ `source` และ `dialect` แล้วส่งคืนโครงสร้างหรือตำแหน่งข้อผิดพลาด
- `export_schema` รับอินพุตเดียวกันและส่งคืน SQL หรือ mongosh script เป็นข้อความ
- `propose_schema` รับ `base` เป็น Source ปัจจุบัน พร้อม `source` เป็น Source ที่เสนอ และ `dialect` แล้วส่งคืน JSON สำหรับหน้าตรวจข้อเสนอในแอป
- `format_schema` รับ `source` และ `dialect` แล้วจัดย่อหน้าของ Source ให้สม่ำเสมอ
- `lint_schema` ตรวจปัญหาการออกแบบและส่งคืนรายการพร้อมระดับความรุนแรง
- `generate_sample_data` รับ `source`, `dialect` และ `rows` (1–200) แล้วส่งคืนแถวตัวอย่างในรูป preview ใช้กับ `export_schema` หรือ operation `append_rows`/`replace_rows` ได้
- `import_dbml` แปลง DBML เป็น Source พร้อมคำเตือน และ `export_dbml` แปลง Source เป็น DBML
- ให้ Agent เรียก `get_active_draft` ผ่าน MCP แบบ HTTP เพื่ออ่าน Source, Engine และ Seed ของ draft ที่เปิดอยู่ รวมถึงการแก้ที่ยังไม่ได้ Save แล้วส่ง `revision` ที่ได้พร้อม `operations` ให้ `submit_draft_edits` หรือส่งพร้อม `entity` และ `rows` ให้ `import_preview_rows` ถ้า draft เปลี่ยน ให้เรียกอ่านใหม่และจัดทำข้อเสนอใหม่
- เปิด **Schema tools → Review MCP proposal → Pending MCP proposals** แล้วกด **Review proposal** เพื่อดู Source และ Seed ก่อน–หลัง จากนั้นจึงอนุมัติหรือปฏิเสธ คิวอยู่ในหน่วยความจำของ Electron ผลที่อนุมัติอยู่ใน draft และบันทึกเป็น `.schema` ได้
- Operations ที่รองรับ: `replace_source` (รวมถึง database, table, collection, column, index และความสัมพันธ์), `format_source`, `add_entity`, `add_field`, `append_rows`, `replace_rows` (ส่ง `rows: []` เพื่อล้างเฉพาะตาราง) และ `clear_preview` (ล้าง Seed ทั้ง draft) หากแทนที่ทั้งหมด ใช้ `replace_source`, `clear_preview` แล้ว `append_rows` ให้แต่ละตารางหรือ collection ค่าของแถวใช้ข้อความ เช่น `{"id":"1","email":"seed@example.test"}`
- `propose_draft_edits` รองรับ operations ชุดเดียวกันและคืน JSON สำหรับนำไป Review เอง ส่วน `import_preview_rows` ยังใช้เข้าคิวเพิ่มแถวเพียงตารางเดียวผ่าน HTTP ได้

นำ JSON ที่ `propose_draft_edits` ส่งคืนไปเปิดใน **Schema tools → Review MCP proposal** เพื่อดูการเปลี่ยนแปลงและแถวที่จะเพิ่ม เลือก **Approve and apply** หรือ **Reject proposal** แล้วดูเวลาและสรุปการตัดสินใจได้ใน **MCP review history** แอปเก็บ 100 รายการล่าสุดในเครื่อง ถ้า Source หรือแถว Preview เปลี่ยนหลังสร้างข้อเสนอ แอปจะให้สร้างข้อเสนอใหม่ ส่ง `preview` ให้ `export_schema` เมื่อต้องการรวมแถวเป็น Seed ในสคริปต์

ค่า `dialect` คือ `postgresql`, `mysql`, `sqlite` หรือ `mongodb` Agent ส่ง draft เป็นข้อความผ่าน tool call โดยตรง MCP ทำงานแยกจากหน้าต่าง Electron และใช้ได้หลัง `npm ci` แม้ปิดหน้าต่างแอปอยู่

## ตรวจสอบ

```powershell
npm test
npm run build
```

## License

เผยแพร่ภายใต้ [MIT License](LICENSE) ใช้ แก้ไข และแจกจ่ายต่อได้ โดยคงประกาศลิขสิทธิ์และข้อความ license ไว้
