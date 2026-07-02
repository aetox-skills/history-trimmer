# History Trimmer

> **v4 — 2 ก.ค. 2026**: แก้บัคสำคัญ (splice in-place mutation), เพิ่ม type safety ตอน runtime, รับประกัน tool pair integrity, เพิ่ม 20 unit tests

**ทุกครั้งที่คุณส่งข้อความหา LLM — ประวัติการสนทนาทั้งหมดตั้งแต่ต้นจะถูกส่งไปด้วย รวมถึงข้อความเมื่อ 50 ครั้งที่แล้ว คุณจ่ายเงินเพื่อ token เหล่านั้นทุกครั้ง ทั้งที่ส่วนใหญ่ไม่เกี่ยวข้องกับสิ่งที่คุณถามตอนนี้เลย**

นี่ไม่ใช่ปัญหาของ OpenCode ไม่ใช่ปัญหาของ Claude Code ไม่ใช่ปัญหาของ Codex **นี่คือวิธีการทำงานของ API-based LLM ทุกเจ้า** — ประวัติทั้งหมดถูกส่งไปทุก request ยิ่งโมเดลใหญ่เท่าไหร่ ยิ่งเปลืองเท่านั้น

ปลั๊กอินนี้แก้ปัญหานี้ให้ **OpenCode** โดยใช้ `experimental.chat.messages.transform` — มันจะตัดประวัติให้เหลือ N ข้อความก่อนที่ request จะออกจากเครื่องคุณ ช่วยประหยัด token ได้ทันที

> **ไม่ได้ใช้ OpenCode?** *หลักการ* นี้ใช้ได้กับทุก ADE (Aider, Kilo, Claude Code, Codex, Cursor, ZCode ฯลฯ) — ทุกตัวมีปัญหาเดียวกัน และมีวิธีตัดหรือย่อประวัติในแบบของตัวเอง หาวิธีของเครื่องมือที่คุณใช้ แล้วใช้หลักการเดียวกัน: **จำกัดสิ่งที่ส่งไป เก็บแต่สิ่งที่จำเป็น**

---

## ติดตั้งใน 10 วินาที

```bash
# Linux / macOS (bash)
bash -c "$(curl -fsSL https://raw.githubusercontent.com/aetox-skills/history-trimmer/main/install.sh)"
```

```powershell
# Windows (PowerShell 5+) / cross-platform pwsh
irm https://raw.githubusercontent.com/aetox-skills/history-trimmer/main/install.ps1 | iex
```

รีสตาร์ท OpenCode → ปลั๊กอินโหลดอัตโนมัติ ไม่ต้องตั้งค่าอะไร ไม่มี dependency ไม่ต้องติดตั้งอะไรเพิ่ม

---

## เมื่อไหร่ที่ไม่ควรใช้

การตัดประวัติเป็นการแลก deep context กับ token savings **ในกรณีทั่วไปนี่คือ optimization ที่ไร้ต้นทุน** แต่มีบางกรณีที่อาจส่งผลเสีย:

- **การวางแผนสถาปัตยกรรมระยะยาว** — ที่โมเดลต้องอ้างอิงข้อจำกัดที่คุยกันเมื่อ 20 ข้อความก่อน
- **การ debug ที่อาศัย error log หรือ tool output เก่า** — แต่ละ call สร้างจาก call ก่อนหน้า
- **Agent workflow ที่ผลลัพธ์จาก tool ก่อนหน้าถูกอ้างอิงซ้ำ** — เช่น agent พูด "อย่างที่เราเห็นเมื่อกี้"
- **งานด้านกฎหมาย / การแพทย์ / การเงิน** — ที่ต้องการ trace context ครบถ้วน

สำหรับกรณีเหล่านี้ ให้เพิ่ม `HISTORY_KEEP` (หรือปิดปลั๊กอินไปเลย) แล้วยอมรับต้นทุน token ที่สูงขึ้น การเทรดออฟนี้ถูกควบคุมได้ ไม่ได้สุ่ม

---

## คุณประหยัดเท่าไหร่

ประวัติการสนทนายิ่งยาวขึ้นทุก call ถ้าไม่มีการจำกัด การสนทนา 50 ครั้งจะส่ง **~100,000 tokens ของประวัติที่โมเดลเห็นแล้ว** พอใช้ trimmer แล้ว ประวัติจะถูกจำกัดที่ 10 ข้อความ (~5,000 tok) — คงที่ ไม่ว่าสนทนาจะยาวแค่ไหน

| | 10 ครั้ง | 20 ครั้ง | 50 ครั้ง |
|:--|:--:|:--:|:--:|
| **ไม่มี trimmer** — ส่งประวัติ | ~20,000 tok | ~40,000 tok | ~100,000+ tok |
| **มี trimmer** — ส่งประวัติ | **~5,000 tok** | **~5,000 tok** | **~5,000 tok** |
| **ส่วนที่ประหยัดได้** | **~15,000 tok** | **~35,000 tok** | **~95,000+ tok** |

ส่วนที่เปลืองนี้ถูกส่ง **ทุกครั้งที่เรียก API** — ยิ่งเรียกยิ่งทวีคูณ Trimmer กำจัดมันให้หมดในครั้งเดียว

### ประหยัดเงินเท่าไหร่ตามโมเดล

ราคา ณ **วันที่ 2 ก.ค. 2026** (cache-miss input) คูณด้วยปริมาณการใช้งานของคุณ

> **สมมติฐาน:** คำนวณจาก cache-miss input rate เท่านั้น ไม่รวม output tokens, cache behavior ของผู้ให้บริการ, หรือราคาที่ผันผวน เป็น **ตัวเลขขั้นต่ำเพื่อให้เห็นภาพ** — จำนวนจริงขึ้นอยู่กับโมเดล, cache hit rate, และความยาว session

| โมเดล | ราคา /M tok | 10 ครั้ง | 20 ครั้ง | ต่อ Session (~100K) | **ต่อเดือน** |
|:--|:--:|:--:|:--:|:--:|:--:|
| DeepSeek V4 Flash 🇨🇳 | $0.14 | ~$0.003 | ~$0.006 | ~$0.01 | **~$0.42** |
| DeepSeek V4 Pro 🇨🇳 | $0.435 | ~$0.01 | ~$0.02 | ~$0.04 | **~$1.30** |
| GLM-5 🇨🇳 | $1.00 | ~$0.02 | ~$0.04 | ~$0.10 | **~$3.00** |
| Claude Haiku 4.5 | $1.00 | ~$0.02 | ~$0.04 | ~$0.10 | **~$3.00** |
| Qwen3 Max 🇨🇳 | $1.20 | ~$0.02 | ~$0.05 | ~$0.12 | **~$3.60** |
| GPT-5 | $1.25 | ~$0.03 | ~$0.05 | ~$0.13 | **~$3.75** |
| Gemini 2.5 Pro | $1.25 | ~$0.03 | ~$0.05 | ~$0.13 | **~$3.75** |
| Claude Sonnet 4.5 | $3.00 | ~$0.06 | ~$0.12 | ~$0.30 | **~$9.00** |
| GPT-5.5 | $5.00 | ~$0.10 | ~$0.20 | ~$0.50 | **~$15.00** |
| Claude Opus 4.8 | $5.00 | ~$0.10 | ~$0.20 | ~$0.50 | **~$15.00** |

> **ยิ่งโมเดลแพงเท่าไหร่ ปลั๊กอินนี้ยิ่งคุ้มค่ามากเท่านั้น**  
> บน Opus 4.8 หรือ GPT-5.5: **$15/เดือน** — จากไฟล์ TypeScript 20 บรรทัด

> **ปลั๊กอินนี้ตัดแค่ conversation history — ไม่ได้ตัด system prompts** System prompt บวม (MCP servers เยอะเกิน, skill files, instruction files) อยู่คนละเลเยอร์และต้องใช้คนละวิธี: ปิด MCP ที่ไม่ใช้, ตัด instruction files, ย่อ skill descriptions ใช้ปลั๊กอินนี้คู่กับ [token-saver (RTK)](https://github.com/aetox-skills/token-saver) สำหรับ command output และ [token-calc](https://github.com/aetox-skills/token-calc) เพื่อวัดว่าควรตัดอะไรก่อน

---

## ทำไมถึงได้ผล

### History ไม่ใช่ memory

โมเดลอ่าน session ปัจจุบันได้อยู่แล้ว — มันรู้ว่าคุณเพิ่งพูดอะไร และ workflow ส่วนใหญ่ **เดินหน้า** — คุณไม่ค่อยกลับไปดูสิ่งที่คุยกัน 20 ข้อความก่อน

ถ้าคุณใช้ AI เป็น **ผู้ช่วยส่วนตัว** ความจำระยะยาวควรอยู่ใน knowledge base — Obsidian, skills, journal files, project docs — ไม่ใช่ใน API call history นั่นคือที่ที่ context จริงๆ อยู่

ปลั๊กอินนี้ถูกออกแบบมาสำหรับหลักการนั้น: **เก็บ context แค่เพียงพอสำหรับการสนทนาปัจจุบัน ที่เหลือให้ skills + docs จัดการ**

### วิธีการทำงาน

```typescript
"experimental.chat.messages.transform" → กรอง messages array ก่อนส่ง API
```

3 ขั้นตอน:

1. **User-priority capped trim** — เก็บ user message ล่าสุดสูงสุด 5 อัน, hard cap ที่ 10 ข้อความรวมทั้งหมด เดินจากท้ายประวัติ นับ user messages ตัดทุกอย่างก่อนจุดตัด

2. **Tool call/result pair integrity** — ทำงานเสมอ (แม้ใน session ที่ต่ำกว่า HARD_CAP) จับคู่ tool calls กับผลลัพธ์โดยใช้ `toolCallId` (OpenCode runtime format) รองรับ `callID` (SDK format) และ `tool_call_id`/`tool_use_id` (legacy provider format) ลบคู่ที่ขาดออก — ไม่ส่ง tool chains ที่เสียไปให้ LLM

3. **In-place mutation ผ่าน `splice`** — การ reassign `output.messages` ใช้ไม่ได้ใน OpenCode (ดู [issue #25754](https://github.com/anomalyco/opencode/issues/25754)) ปลั๊กอินจึง mutate array ในที่เดิมเพื่อให้แน่ใจว่าการเปลี่ยนแปลงมีผล

- **User messages** — เก็บสูงสุด 5 อันล่าสุด (คำถามของคุณคือหัวใจของการสนทนา)
- **Assistant messages** — เก็บคู่กับ user message, ถูกตัดก่อนถ้าเกิน cap
- **Tool calls/results** — จับคู่ด้วย ID, ส่วนที่ขาดถูกล้างทิ้งเสมอไม่ว่า session จะยาวแค่ไหน
- ส่วนที่เหลือถูกทิ้งก่อนส่ง HTTPS request ไป LLM provider

> **หมายเหตุเรื่อง runtime format:** hook `experimental.chat.messages.transform` ใช้ internal message format ของ OpenCode (จาก `message.ts`) **ไม่ใช่** SDK `Part` types Tool calls/results อยู่ในรูป `ToolInvocationPart` (type `"tool-invocation"`) จับคู่ด้วย `toolInvocation.toolCallId` ปลั๊กอินจัดการ format นี้โดยตรง พร้อมรองรับชื่อฟิลด์แบบ SDK และ legacy provider

---

## การตั้งค่า

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|:---------|:-------:|:------------|
| `MAX_USER_MSGS` | `5` | จำนวน user message สูงสุดที่จะเก็บ (คำถามของคุณมีความสำคัญสูงสุด) |
| `HISTORY_KEEP` | `10` | เพดานแข็งของจำนวน non-system messages ทั้งหมด |

```bash
export MAX_USER_MSGS=8     # เก็บ 8 คำถามล่าสุดแทน 5
export HISTORY_KEEP=15     # ยืดหยุ่นสำหรับ deep agentic sessions
```

**ค่าเริ่มต้น (5 user + 10 total):** เก็บ 5 คำถามล่าสุด + คำตอบของมัน เพียงพอสำหรับการสนทนากลับไปกลับมา ขณะที่ยังประหยัด ~97% เทียบกับประวัติไม่จำกัด

---

## การเทส

```bash
npx tsx --test history-trimmer.test.ts
```

**20 tests ใน 7 suites** ครอบคลุม:
- การตัดพื้นฐาน (cap enforcement, recency)
- User-priority trimming (MAX_USER, HARD_CAP interaction)
- Boundary conditions (HARD_CAP < MAX_USER, consecutive user messages)
- Tool pair integrity (matched pairs preserved, orphaned calls/results removed, empty message cleanup)
- Edge cases (no parts, undefined parts, all-assistant sessions, single message)
- Multi-format compatibility (SDK `callID`, legacy `tool_call_id`/`tool_use_id`)
- In-place mutation behavior (splice vs reassignment)

---

## ความเข้ากันได้

- OpenCode v1.16+
- ใช้ hook `experimental.chat.messages.transform`
- รองรับ OpenCode runtime format (`ToolInvocationPart`) + SDK format (`ToolPart`) + legacy provider format
- Zero dependencies — ไฟล์ TypeScript ไฟล์เดียว + ไฟล์เทสหนึ่งไฟล์

---

## ลิขสิทธิ์

MIT
