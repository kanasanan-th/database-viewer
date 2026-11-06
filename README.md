<div align="center">

<img src="docs/banner.svg" alt="Pixel-art desk at night with a glowing CRT monitor, a steaming mug and light through window blinds" width="100%" />

# 🧩 Schema Studio

**ร่าง schema ด้วยข้อความ ดู ERD ทันที แล้ว export เป็นสคริปต์พร้อมใช้**

แอป Electron แบบ Open Source ทำงานในเครื่อง ไม่ต้องสมัครบัญชี

[![License: MIT](https://img.shields.io/badge/License-MIT-132bcc.svg)](LICENSE)
![Node](https://img.shields.io/badge/Node.js-22.12+-0d0d0e)
![Electron](https://img.shields.io/badge/Electron-desktop-0d0d0e)
![MCP](https://img.shields.io/badge/MCP-ready-bb6359)

[เริ่มต้นใช้งาน](#-เริ่มต้นใช้งาน) · [Syntax](#-syntax) · [เชื่อม AI Agent](#-เชื่อม-ai-agent-ผ่าน-mcp) · [สำหรับนักพัฒนา](#-สำหรับนักพัฒนา)

</div>

---

## ✨ ทำอะไรได้บ้าง

| เรื่อง                  | รายละเอียด                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| 📝 **เขียนเป็นข้อความ** | เขียน schema ใน Source แล้วดู ERD อัปเดตทันที (ลากการ์ด ซูม Fit view และ minimap)        |
| 📤 **Export**           | PostgreSQL, MySQL, SQLite, `mongosh` ของ MongoDB, Prisma Schema, DBML และภาพ ERD แบบ SVG |
| 🌱 **ข้อมูลตัวอย่าง**   | ใส่แถวตัวอย่างให้แต่ละตาราง แล้วรวมเป็น Seed ตอน export                                  |
| 🔄 **Import / Migrate** | Import SQL (DDL) และ DBML, Compare & migrate, ทดลอง query ใน SQL Sandbox                 |
| 🤖 **AI Agent (MCP)**   | เชื่อม Agent ผ่าน MCP โดย **คนตรวจและอนุมัติทุกการแก้ไขก่อนเสมอ**                        |
| 🔒 **ในเครื่อง**        | ข้อมูลอยู่ในเครื่อง ไม่ต้องสมัครบัญชี                                                    |

## 📑 สารบัญ

- [🚀 เริ่มต้นใช้งาน](#-เริ่มต้นใช้งาน)
- [🧭 ภาพรวมการใช้งาน](#-ภาพรวมการใช้งาน)
- [📋 ข้อมูลตัวอย่างในตาราง](#-ข้อมูลตัวอย่างในตาราง)
- [🧰 Schema tools](#-schema-tools)
- [📖 Syntax](#-syntax)
- [🤖 เชื่อม AI Agent ผ่าน MCP](#-เชื่อม-ai-agent-ผ่าน-mcp)
- [🔐 ความปลอดภัย](#-ความปลอดภัย)
- [🔧 สำหรับนักพัฒนา](#-สำหรับนักพัฒนา)
- [📄 License](#-license)

## 🚀 เริ่มต้นใช้งาน

ต้องใช้ **Node.js 22.12 ขึ้นไป**

```powershell
npm ci
npm start
```

1. แอปเริ่มด้วยตัวอย่าง PostgreSQL แก้ข้อความใน **Source** แล้วดู ERD ที่อัปเดตทันที
2. เลือก **Engine** ที่ต้องการจากเมนูด้านบน
3. ใช้แท็บ **Output** เพื่อดูหรือคัดลอกสคริปต์ (กล่องโค้ดมีปุ่ม Copy ที่หัวกล่อง)
4. กด **Export SQL** เพื่อบันทึกไฟล์ หรือ **Save draft** เพื่อเก็บงานเป็น `.schema`

> 💡 เลือก engine ใหม่ครั้งแรก แอปจะลองใช้ draft SQL ปัจจุบันและแจ้งชนิดข้อมูลที่ engine ใหม่ไม่รองรับ

## 🧭 ภาพรวมการใช้งาน

| ต้องการ                 | ทำอย่างไร                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| บันทึกงาน               | **Save draft** เก็บ `.schema` พร้อม engine, ข้อความ, แถวตัวอย่าง และตำแหน่งการ์ด (`layout`) แอปจำ draft ล่าสุดแยกตาม engine |
| เปิดงานเดิม             | **Open** เปิดไฟล์ `.schema` หรือไฟล์ข้อความ DSL                                                                             |
| จัดตำแหน่งการ์ด         | ลากการ์ดได้เอง ตำแหน่งถูกบันทึกกับ draft การ์ดใหม่จะวางใต้การ์ดเดิม กด **Auto layout** เพื่อลืมตำแหน่งที่จัดไว้             |
| ปรับขนาดแผง Source      | ลากเส้นคั่นระหว่างแผง Source กับไดอะแกรม (ลูกศรซ้าย/ขวาก็ได้, ดับเบิลคลิกเพื่อรีเซ็ต) ความกว้างถูกจำไว้                     |
| ส่งออกภาพ ERD           | **Export diagram** ได้ไฟล์ SVG ตามตำแหน่งที่จัดไว้                                                                          |
| ส่งไป dbdiagram.io      | ตั้ง Export format เป็น **DBML**                                                                                            |
| รวมแถวตัวอย่างในสคริปต์ | เลือก **Include preview rows** ข้างปุ่ม Export ใช้สคริปต์เดียวกันทั้ง Copy และ Export                                       |
| ดูคำแนะนำ syntax        | กด **Syntax hints** หรือ `Ctrl+Space` ใน Source แล้วเลือกด้วยลูกศร กด `Tab` หรือ `Enter` เพื่อแทรก                          |
| ดูชนิดข้อมูลที่รองรับ   | กดไอคอน **?** ข้างหัวข้อ Schema source                                                                                      |

## 📋 ข้อมูลตัวอย่างในตาราง

กด **Preview** บนการ์ด Table หรือ Collection เพื่อดู เพิ่ม แก้ไข หรือลบแถวตัวอย่าง

- ตารางแสดงข้อมูลแบบอ่านอย่างเดียว คอลัมน์ `#` และปุ่มแก้ไข/ลบตรึงไว้ขณะเลื่อน
- **ดับเบิลคลิกเซลล์** (หรือกด `Enter`) เพื่อเปิดฟอร์มแก้ไขแถวนั้น หรือกดไอคอนดินสอ
- ฟอร์มใช้ input ตามชนิดคอลัมน์ ตรวจค่าก่อนบันทึก และแจ้งข้อผิดพลาดใต้ช่อง
- คอลัมน์ที่ประกาศ `ref` เลือกค่าจากแถวตัวอย่างของตารางปลายทาง หากลบแถวปลายทาง เซลล์ที่อ้างถึงจะแสดง **Missing reference**
- **Save draft** เก็บแถวเหล่านี้ในไฟล์ `.schema` ด้วย ค่าในพรีวิวเก็บเป็นข้อความ

| ชนิดคอลัมน์                | Input ในฟอร์ม                                    |
| -------------------------- | ------------------------------------------------ |
| integer, bigint, …         | ช่องตัวเลข (ไม่รับจุดทศนิยม)                     |
| numeric(10,2), float, …    | ช่องตัวเลข step ตามจำนวนทศนิยม                   |
| boolean                    | dropdown True / False                            |
| date, time, datetime       | ตัวเลือกวันที่/เวลา (`timestamptz` เก็บเป็น UTC) |
| json, jsonb, array, object | ช่องโค้ด JSON ตรวจความถูกต้องสด พร้อมปุ่ม Format |
| text ยาว                   | textarea                                         |
| varchar(n)                 | ช่องข้อความ จำกัดความยาว n                       |
| uuid, ObjectId             | ช่องข้อความ พร้อมปุ่มสุ่มค่า                     |
| คอลัมน์ที่มี `ref`         | dropdown ค่าจากตารางที่อ้างอิง                   |

## 🧰 Schema tools

เปิดจากปุ่ม **Schema tools** ที่แถบด้านล่าง เมนูแบ่งเป็นกลุ่ม ช่องกรอกโค้ดทุกช่องมีสีไวยากรณ์ คำแนะนำขณะพิมพ์ และตัวอย่างให้กด **Insert example**

| กลุ่ม            | เครื่องมือ          | ทำอะไร                                                                                                                                         |
| ---------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Export**       | Export with data    | สคริปต์ที่รวม schema และแถวตัวอย่างจาก draft เดียวกัน แก้ค่าที่ขึ้นข้อผิดพลาดก่อนบันทึก                                                        |
| **Import**       | Import SQL          | รับไฟล์หรือข้อความ DDL (PostgreSQL, MySQL, SQLite) เช่น `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE … ADD FOREIGN KEY` แล้วแสดง draft ที่แปลง |
| **Import**       | Import DBML         | แปลง DBML จาก dbdiagram.io (`Table`, `Ref`, `indexes`, `Enum`, `Project`) พร้อมรายการที่ต้องปรับ เช่น enum กลายเป็น `varchar(64)`              |
| **Analyze**      | Compare & migrate   | สร้าง migration จาก draft เดิมไปยัง draft ที่เปิดอยู่ (ดูรายละเอียดด้านล่าง)                                                                   |
| **Analyze**      | Schema lint         | ตรวจตารางไม่มี primary key, ชนิด foreign key ไม่ตรง, foreign key ที่ไม่มี index และชื่อที่ผสมหลายรูปแบบ                                        |
| **Analyze**      | SQL Sandbox         | (Electron, SQLite) ทดลอง `SELECT`/`JOIN` ในฐานข้อมูลชั่วคราว สูงสุด 100 แถว หยุด query ที่เกิน 5 วินาที                                        |
| **Data**         | Sample data         | สร้างแถวตัวอย่างทุกตาราง (1–200 แถว) ตามชนิดข้อมูล ได้ผลเดิมทุกครั้ง                                                                           |
| **Agent review** | Review MCP proposal | ตรวจ Source/Seed ก่อน–หลัง ที่ Agent เสนอ แล้วอนุมัติหรือปฏิเสธ                                                                                |
| **Agent review** | MCP review history  | ดูเวลาและสรุปการตัดสินใจ เก็บ 100 รายการล่าสุดในเครื่อง                                                                                        |

<details>
<summary><b>รายละเอียด Compare &amp; migrate</b></summary>

รับไฟล์ `.schema` หรือข้อความของ draft เวอร์ชันเดิม โดยใช้ draft ที่เปิดอยู่เป็นเป้าหมาย สร้าง migration สำหรับการเพิ่มตาราง คอลัมน์ และ index บน PostgreSQL, MySQL และ SQLite

- ค่าเริ่มต้น **ไม่ใส่** การลบ เปลี่ยนชนิดข้อมูล หรือเปลี่ยน NOT NULL/UNIQUE ในสคริปต์
- เลือก **Include data-changing statements** เพื่อสร้าง `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN … TYPE` และ `MODIFY COLUMN` สคริปต์จะมีคำเตือนให้สำรองข้อมูลก่อน
- การแก้ primary key, foreign key และการเอา UNIQUE ออกยังต้องทำเอง
- SQLite เปลี่ยนชนิดหรือ NOT NULL ของคอลัมน์เดิมไม่ได้ในสคริปต์

</details>

## 📖 Syntax

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

| คำสั่ง                                            | ความหมาย                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `pk` / `primary (a, b)`                           | primary key (เดี่ยว / หลายคอลัมน์)                                    |
| `required`, `unique`                              | `NOT NULL`, unique constraint                                         |
| `default <ค่า>`                                   | JSON string, number, boolean, null หรือ `now` (= `CURRENT_TIMESTAMP`) |
| `ref ENTITY.FIELD`                                | foreign key คอลัมน์เดียว ไปยังคอลัมน์ที่เป็น unique key เดี่ยว        |
| `ondelete cascade\|restrict\|set_null\|no_action` | พฤติกรรมเมื่อลบแถวที่ถูกอ้างถึง                                       |
| `index [unique] NAME (a, b)`                      | ดัชนีคอลัมน์เดียวหรือหลายคอลัมน์                                      |
| `#` หรือ `//`                                     | comment เต็มบรรทัด                                                    |

> หนึ่งคำสั่งต่อบรรทัด ชื่อใช้ตัวอักษร ASCII ตัวเลข และขีดล่าง โดยขึ้นต้นด้วยตัวอักษรหรือขีดล่าง

### Engine ที่รองรับ

| Engine         | ตัวอย่างชนิดข้อมูล                                                       | ผลลัพธ์                                                                                                       |
| -------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL** | bigint, numeric(12,2), uuid, jsonb, text[], timestamptz, bytea           | `.sql` สำหรับ `psql` เริ่มจาก maintenance database เช่น `psql -d postgres -v ON_ERROR_STOP=1 -f commerce.sql` |
| **MySQL**      | bigint, varchar(255), decimal(12,2), json, datetime, varbinary(32)       | `.sql` พร้อม `CREATE DATABASE` และ `USE`                                                                      |
| **SQLite**     | integer, text, numeric, real, blob                                       | `.sql` สำหรับไฟล์ฐานข้อมูล SQLite ที่เลือก พร้อมเปิด foreign keys ใน session ที่รันสคริปต์                    |
| **MongoDB**    | objectId, string, bool, int, long, decimal, date, object, array, binData | `.js` สำหรับ `mongosh --file commerce.js` พร้อม collection, BSON validator และ index                          |

<details>
<summary><b>MongoDB: ใช้ <code>collection</code> แทน <code>table</code></b></summary>

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

</details>

<details>
<summary><b>MySQL: charset และ collation</b></summary>

ตั้งค่าระดับฐานข้อมูลในบรรทัดแรกได้ เช่น

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

</details>

## 🤖 เชื่อม AI Agent ผ่าน MCP

Agent อ่าน draft และ **เสนอ** การแก้ไขได้ แต่ทุกอย่างต้องผ่านการตรวจและอนุมัติของคุณในแอปก่อนเสมอ

### ต่อ Agent แบบ HTTP (แนะนำ)

1. ใน Electron เปิด **MCP setup → Start MCP connection** เพื่อเปิด endpoint แบบ Streamable HTTP บนเครื่องนี้
2. เลือก client แล้วคัดลอกค่าที่ต้องใช้

   | Client          | วิธีเชื่อม                                                                 |
   | --------------- | -------------------------------------------------------------------------- |
   | **Claude Code** | **Copy command** แล้วรันในเทอร์มินัล (`claude mcp add --transport http …`) |
   | **Gemini CLI**  | **Copy command** แล้วรันในเทอร์มินัล (`gemini mcp add --transport http …`) |
   | **Codex**       | **Copy configuration** แล้ววางใน `config.toml`                             |

   ปุ่ม **Copy URL** และ **Copy token** แยกให้ด้วย หน้าจอซ่อน token ไว้ (กด **Show token** เพื่อดู) แต่ปุ่ม Copy ใช้ค่าเต็มเสมอ

3. กด **Close connection** เมื่อเสร็จ เมื่อ Start อีกครั้งจะได้ URL และ token ชุดใหม่ ต้องคัดลอกใหม่

### การแจ้งเตือนเมื่อ Agent เข้ามา

เมื่อ Agent เชื่อมต่อ อ่าน draft หรือส่งข้อเสนอ แอปจะ

- แสดงแจ้งเตือนมุมล่างขวา และบันทึกใน **Agent activity**
- ถ้าเป็นข้อเสนอที่ต้องตรวจ จะมีปุ่ม **Review** และตัวเลขบนปุ่ม **Schema tools**
- แจ้งเตือนจากระบบปฏิบัติการเมื่อแอปไม่ได้อยู่หน้าจอ

### ต่อแบบ stdio

เปิด **Independent stdio configuration** ในแอปเพื่อดู path ของโปรเจกต์ MCP client จะเป็นผู้เปิดและปิดโปรเซสเอง ใช้ได้หลัง `npm ci` แม้ปิดหน้าต่างแอปอยู่ (แบบ stdio ไม่มี `get_active_draft`, `submit_draft_edits` และ `import_preview_rows`)

```json
{
  "mcpServers": {
    "schema-studio": {
      "command": "node",
      "args": ["/absolute/path/to/database-viewer/mcp.mjs"]
    }
  }
}
```

### Tools

| Tool                          | ทำอะไร                                                                                         | ใช้กับ  |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ------- |
| `schema_syntax`               | ส่งคืนคู่มือและตัวอย่าง                                                                        | ทั้งหมด |
| `validate_schema`             | รับ `source` และ `dialect` ส่งคืนโครงสร้างหรือตำแหน่งข้อผิดพลาด                                | ทั้งหมด |
| `format_schema`               | จัดย่อหน้าของ Source ให้สม่ำเสมอ                                                               | ทั้งหมด |
| `export_schema`               | ส่งคืน SQL หรือ mongosh script (ส่ง `preview` เพื่อรวมแถวเป็น Seed)                            | ทั้งหมด |
| `lint_schema`                 | ตรวจปัญหาการออกแบบ ส่งคืนรายการพร้อมระดับความรุนแรง                                            | ทั้งหมด |
| `generate_sample_data`        | สร้างแถวตัวอย่าง (`rows` 1–200) ในรูป preview                                                  | ทั้งหมด |
| `import_dbml` / `export_dbml` | แปลง DBML ↔ Source พร้อมคำเตือน                                                                | ทั้งหมด |
| `propose_schema`              | รับ `base`, `source`, `dialect` ส่งคืน JSON สำหรับหน้าตรวจข้อเสนอ                              | ทั้งหมด |
| `propose_draft_edits`         | รองรับ operations ชุดเดียวกับ `submit_draft_edits` ส่งคืน JSON ให้นำไป Review เอง              | ทั้งหมด |
| `get_active_draft`            | อ่าน Source, Engine และ Seed ของ draft ที่เปิดอยู่ รวมการแก้ที่ยังไม่ได้ Save พร้อม `revision` | HTTP    |
| `submit_draft_edits`          | ส่ง `revision` พร้อม `operations` เข้าคิวรอตรวจในแอป                                           | HTTP    |
| `import_preview_rows`         | ส่ง `revision`, `entity`, `rows` เข้าคิวเพิ่มแถวเพียงตารางเดียว                                | HTTP    |

ค่า `dialect` คือ `postgresql`, `mysql`, `sqlite` หรือ `mongodb`

<details>
<summary><b>Operations ที่รองรับ</b></summary>

| Operation        | ความหมาย                                                                   |
| ---------------- | -------------------------------------------------------------------------- |
| `replace_source` | แทนที่ Source (database, table, collection, column, index และความสัมพันธ์) |
| `format_source`  | จัดรูปแบบ Source                                                           |
| `add_entity`     | เพิ่ม table หรือ collection                                                |
| `add_field`      | เพิ่ม field                                                                |
| `append_rows`    | เพิ่มแถวตัวอย่าง                                                           |
| `replace_rows`   | แทนแถวของตาราง (ส่ง `rows: []` เพื่อล้างเฉพาะตาราง)                        |
| `clear_preview`  | ล้าง Seed ทั้ง draft                                                       |

ค่าของแถวใช้ข้อความ เช่น `{"id":"1","email":"seed@example.test"}` หากต้องการแทนที่ทั้ง draft ให้ใช้ `replace_source`, `clear_preview` แล้ว `append_rows` ให้แต่ละตารางหรือ collection

</details>

### ขั้นตอนตรวจข้อเสนอ

1. Agent เรียก `get_active_draft` แล้วส่ง `revision` ที่ได้พร้อม `operations` ให้ `submit_draft_edits` (ถ้า draft เปลี่ยน ให้อ่านใหม่และทำข้อเสนอใหม่)
2. เปิด **Schema tools → Review MCP proposal → Pending MCP proposals** แล้วกด **Review proposal**
3. ดู Source และ Seed ก่อน–หลัง จากนั้นเลือก **Approve and apply** หรือ **Reject proposal**
4. ผลที่อนุมัติอยู่ใน draft และบันทึกเป็น `.schema` ได้ ดูประวัติที่ **MCP review history**

คิวข้อเสนออยู่ในหน่วยความจำของ Electron ถ้า Source หรือแถว Preview เปลี่ยนหลังสร้างข้อเสนอ แอปจะให้สร้างข้อเสนอใหม่ หากได้ JSON จาก `propose_schema` หรือ `propose_draft_edits` ให้วางในหน้า Review MCP proposal เพื่อตรวจเองได้

## 🔐 ความปลอดภัย

- MCP HTTP เปิดที่ `127.0.0.1` เท่านั้น ต้องใช้ Bearer token ที่สร้างใหม่ทุกครั้งที่ Start และตรวจ Host/Origin
- Agent **แก้ draft โดยตรงไม่ได้** ทุกการแก้ต้องรอคุณอนุมัติ
- หน้าต่างแอปรันแบบ sandbox + context isolation, จำกัดสิทธิ์ด้วย CSP และปิดการนำทางออกนอกแอป
- SQL Sandbox ใช้ฐานข้อมูลในหน่วยความจำ จำกัดให้อ่านอย่างเดียว และมี timeout
- สคริปต์ที่ export จัดการชื่อและค่าตามกฎของแต่ละ engine เพื่อกัน injection จาก draft ที่ไม่น่าเชื่อถือ

## 🔧 สำหรับนักพัฒนา

| คำสั่ง                 | ใช้ทำอะไร                                           |
| ---------------------- | --------------------------------------------------- |
| `npm start`            | build แล้วเปิดแอป Electron                          |
| `npm run dev`          | Vite dev server ที่ `127.0.0.1` (เปิดในเบราว์เซอร์) |
| `npm test`             | รันเทสต์ (`node --test`)                            |
| `npm run build`        | build ด้วย Vite                                     |
| `npm run mcp`          | เปิด MCP แบบ stdio                                  |
| `npm run format`       | จัดรูปแบบโค้ดด้วย Prettier                          |
| `npm run format:check` | ตรวจรูปแบบโดยไม่แก้ไฟล์                             |

```text
desktop/   โปรเซสหลักของ Electron, preload, MCP HTTP endpoint, SQL sandbox
src/       UI (React), parser/exporter ของ schema, MCP server และ tools
test/      เทสต์ด้วย node:test
mcp.mjs    ตัวเปิด MCP แบบ stdio
```

## 📄 License

เผยแพร่ภายใต้ [MIT License](LICENSE) ใช้ แก้ไข และแจกจ่ายต่อได้ โดยคงประกาศลิขสิทธิ์และข้อความ license ไว้
