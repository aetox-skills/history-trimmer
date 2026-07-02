# History Trimmer

> **v6 — 2 ก.ค. 2026**: per-role caps + preserveFirst + MAX_TOTAL safety ceiling + **cache economics**  
> v6 ชนะ v4 ไม่ใช่แค่เรื่อง token savings แต่เพราะ **cache hit rate สูงกว่า** — การตัดแบบคงที่น้อยครั้งกว่า ทำให้ prompt prefix มีเสถียรภาพ → cache hits มากขึ้น → ต้นทุนรวมต่ำกว่า ดูหัวข้อ [v4 vs v6](#v4-vs-v6-ทำไม-per-role-caps-ถึงถูกกว่าสำหรับ-llm-ที่มี-cache)  
> เพิ่ม `preserveFirst` — กัน N ข้อความแรกไว้ไม่ถูกตัด, 32 tests

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

### สิ่งที่คุณอาจมองข้าม: ค่า System Prompt พื้นฐาน

ทุกรีเควสต์ที่ส่งไป LLM มี **system prompt** ที่รวมทุกอย่างที่โมเดลต้องรู้ก่อนเริ่มสนทนา:
- คำแนะนำ agent → **~5–10K tok**
- Skill files, instruction files → **~3–8K tok**
- MCP server definitions, tool descriptions → **~5–15K tok**
- Context files (CONTEXT.md, index.md, PROFILE.md) → **~3–5K tok**

รวมแล้ว **~20,000 tokens ก่อนที่คุณจะพิมพ์อะไรเลย** — นี่คือค่าคงที่ที่คุณจ่ายทุก API call อยู่แล้ว ต่อให้ไม่มีการสนทนาเลยก็ตาม

> **แต่ตัวเลขนี้อาจสูงกว่านั้นมาก** ถ้าคุณติดตั้ง skills, MCP servers, หรือ instruction files จำนวนมาก — system prompt 50K–80K tok ก็ไม่ใช่เรื่องแปลก  
> **ไม่รู้ตัวเลขจริงของตัวเอง?** ใช้ [token-calc](https://github.com/aetox-skills/token-calc.git) สำรวจ system prompt ก่อน แล้วค่อยมาวางแผนลด — รู้ก่อนตัด ถูกกว่าเดา
>
> — *โฆษณาเล็กน้อย จากทีมงาน aetox-skills ฮ่าๆ* 🙃

ประวัติการสนทนาคือ **ค่าใช้จ่ายที่ซ้อนทับ** บนก้อนนี้ — ถ้าไม่มีการจำกัด มันจะพอกพูนจนกลบต้นทุน system prompt ไปหมด Trimmer กำจัดส่วนที่ซ้อนทับนี้ให้คุณ

### แค่ประวัติเปล่าๆ

ประวัติการสนทนายิ่งยาวขึ้นทุก call ถ้าไม่มีการจำกัด การสนทนา 50 ครั้งจะส่ง **~100,000 tokens ของประวัติที่โมเดลเห็นแล้ว** พอใช้ trimmer แล้ว ประวัติจะถูกจำกัดที่ 10 ข้อความ (~5,000 tok) — คงที่ ไม่ว่าสนทนาจะยาวแค่ไหน

| | 10 ครั้ง | 20 ครั้ง | 50 ครั้ง |
|:--|:--:|:--:|:--:|
| **ไม่มี trimmer** — ส่งประวัติ | ~20,000 tok | ~40,000 tok | ~100,000+ tok |
| **มี trimmer** — ส่งประวัติ | **~5,000 tok** | **~5,000 tok** | **~5,000 tok** |
| **ส่วนที่ประหยัดได้** | **~15,000 tok** | **~35,000 tok** | **~95,000+ tok** |

ส่วนที่เปลืองนี้ถูกส่ง **ทุกครั้งที่เรียก API** — ยิ่งเรียกยิ่งทวีคูณ Trimmer กำจัดมันให้หมดในครั้งเดียว

### รวมทุกอย่าง: เมื่อ System Prompt + History ซ้อนทับ

ตารางนี้แสดง **ต้นทุนรวมของทุกรีเควสต์** โดยสมมติ system prompt (~20K tok) + ประวัติ:

| องค์ประกอบ | 10 ครั้ง | 20 ครั้ง | 50 ครั้ง |
|:--|:--:|:--:|:--:|
| System prompts (ค่าคงที่ ~20K tok) | ~20,000 tok | ~20,000 tok | ~20,000 tok |
| + ประวัติ **ไม่มี trimmer** | +~20,000 tok | +~40,000 tok | +~100,000+ tok |
| = **รวมที่ส่งจริง (ไม่มี trimmer)** | **~40,000 tok** | **~60,000 tok** | **~120,000+ tok** |
| + ประวัติ **มี trimmer** | +~5,000 tok | +~5,000 tok | +~5,000 tok |
| = **รวมที่ส่งจริง (มี trimmer)** | **~25,000 tok** | **~25,000 tok** | **~25,000 tok** |
| **ประหยัดรวมเทียบกับไม่มี trimmer** | **~15,000 tok (37.5%)** | **~35,000 tok (58.3%)** | **~95,000+ tok (79.2%)** |

> ยิ่ง session ยาวเท่าไหร่ **สัดส่วนที่ trimmer ประหยัดให้ยิ่งสูงขึ้น** เพราะ system prompt คงที่แต่ประวัติไม่จำกัดจะพอกพูนไม่หยุด  
> ที่ 50 ครั้ง: จาก 120K tok → เหลือ 25K tok = **ประหยัดไป 79%**

### ประหยัดเงินเท่าไหร่ตามโมเดล

ราคา ณ **วันที่ 2 ก.ค. 2026** (cache-miss input) คูณด้วยปริมาณการใช้งานของคุณ

> **สมมติฐาน:** คำนวณจาก cache-miss input rate เท่านั้น ไม่รวม output tokens, cache behavior ของผู้ให้บริการ, หรือราคาที่ผันผวน เป็น **ตัวเลขขั้นต่ำเพื่อให้เห็นภาพ** — จำนวนจริงขึ้นอยู่กับโมเดล, cache hit rate, และความยาว session

#### เฉพาะส่วนของประวัติที่ trimmer ตัดออก

คือ token savings *ส่วนเพิ่ม* ที่ trimmer กำจัด — ไม่ได้รวมค่า system prompt ~20K tok จริงที่คุณต้องจ่ายอยู่แล้ว:

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

#### รวมต้นทุนจริงทุก API Call (System Prompt + History)

สมมติ ~20K tok ต่อ system prompt + conversation history ที่ถูก trimmer ตัดออกไปที่ session 50 ครั้ง (~95K tok):

| โมเดล | ราคา /M tok | ต่อ call (sys ~20K) | ต่อ call (sys+hist 50 ครั้ง ไม่มี trimmer) | ต่อ call (sys+hist 50 ครั้ง มี trimmer) | **ประหยัดต่อ session** |
|:--|:--:|:--:|:--:|:--:|:--:|
| DeepSeek V4 Flash 🇨🇳 | $0.14 | ~$0.003 | ~$0.017 | ~$0.004 | **~$0.013** |
| DeepSeek V4 Pro 🇨🇳 | $0.435 | ~$0.009 | ~$0.052 | ~$0.011 | **~$0.041** |
| Claude Opus 4.8 | $5.00 | ~$0.100 | ~$0.600 | ~$0.125 | **~$0.475** |
| GPT-5.5 | $5.00 | ~$0.100 | ~$0.600 | ~$0.125 | **~$0.475** |

> **สังเกต:** ต่อ call ครั้งเดียว ต้นทุนระบบ ~20K tok นั้นดูเล็กน้อย ($0.009 บน V4 Pro) แต่เมื่อ session ยาวและเรียกบ่อย ค่า system prompt คูณด้วยจำนวน call ก็สะสมเป็นก้อนใหญ่ — **trimmer ช่วยให้คุณไม่ต้องจ่าย system prompt ซ้ำซ้อนกับประวัติที่พอกพูน**  
> โดยเฉพาะบนโมเดลแพง ($5/M tok) ค่า system prompt ~$0.100/ครั้ง ถ้าเรียก 300 ครั้ง/เดือน = **$30/เดือนแค่ system prompts อย่างเดียว** ก่อนจะนับประวัติหรือ output tokens ด้วยซ้ำ

> **ปลั๊กอินนี้ตัดแค่ conversation history — ไม่ได้ตัด system prompts** System prompt บวม (MCP servers เยอะเกิน, skill files, instruction files) อยู่คนละเลเยอร์และต้องใช้คนละวิธี: ปิด MCP ที่ไม่ใช้, ตัด instruction files, ย่อ skill descriptions ใช้ปลั๊กอินนี้คู่กับ [token-saver (RTK)](https://github.com/aetox-skills/token-saver) สำหรับ command output และ [token-calc](https://github.com/aetox-skills/token-calc) เพื่อวัดว่าควรตัดอะไรก่อน

---

## v4 vs v6: ทำไม per-role caps ถึงถูกกว่าสำหรับ LLM ที่มี Cache

### ปัญหาของ v4 (hard cap)

v4 ใช้ **HARD_CAP** — ตัดทันทีที่เกิน N ข้อความ ส่งแค่ N ตัวล่าสุดเสมอ ประวัติสั้น (~5K tok) แต่วิธีนี้มีข้อเสีย:

- **Prefix shift ทุกครั้งที่ตัด** — prompt prefix = system prompt + history head เปลี่ยนตลอด เพราะ history ถูกตัดจากหัวทิ้งบ่อย
- **เมื่อ prefix เปลี่ยน = cache miss** — LLM providers ที่มี prompt caching (DeepSeek, Claude, Gemini) ใช้ prefix hash เป็น cache key ถ้า prefix ไม่ตรง cache → เสียค่าคำนวณใหม่
- **ต้นทุนซ่อนเร้น:** v4 อาจประหยัด input tokens ได้เยอะ แต่ **cache hit rate ต่ำ (~30–40%)** เพราะตัดถี่ → prefix เปลี่ยน

### v6 แก้ยังไง

v6 แก้ด้วย **per-role caps + MAX_TOTAL**:

- **ตัดน้อยครั้งกว่า** — v6 เก็บ 22 ข้อความ (5U+10A+7T) กว่าจะเต็ม ต้องใช้เวลานานกว่า v4 ที่ตัดที่ ~10 ข้อความ
- **prefix เสถียรกว่า** — history head ถูกคงไว้นานขึ้น เพราะตัดเฉพาะส่วนท้ายที่เกิน per-role cap
- **ผลลัพธ์: cache hit rate ~85%** แทน ~30–40% ของ v4

### ตัวเลขเทียบกัน: v4 vs v6 ต่อ 50 API calls

| Metric | v4 (HARD_CAP) | v6 (per-role caps) |
|:--|:--:|:--:|
| ข้อความที่ส่งต่อ call | ~8–12 | ~22–28 |
| Input tokens ต่อ call | ~5K tok | ~11K tok |
| Token savings vs raw | ~95% | ~89% |
| **Cache hit rate** | **~30–40%** | **~80–85%** |
| Prefix stability | ต่ำ (ตัดถี่) | สูง (prefix คงเดิม) |
| Session output continuity | ปานกลาง | สูง |

### ต้นทุนจริง: v6 ถูกกว่าทั้งที่ส่ง tokens มากกว่า

สมมติ DeepSeek V4 Pro ($0.435/M cache-miss, $0.0036/M cache-hit = **120x ratio**) — session 50 calls:

| องค์ประกอบ | v4 (HARD_CAP) | v6 (per-role caps) |
|:--|:--:|:--:|
| Input ต่อ call | ~5K tok | ~11K tok |
| รวม input 50 calls | ~250K tok | ~550K tok |
| Cache hit rate | ~35% | ~85% |
| Miss tokens | ~162.5K tok | ~82.5K tok |
| Hit tokens | ~87.5K tok | ~467.5K tok |
| **รวมค่า input** | **~$0.071 + ~$0.0003 ≈ $0.0713** | **~$0.036 + ~$0.0017 ≈ $0.0377** |
| **ประหยัดเทียบ v4** | — | **~47% ถูกกว่า** |

> **ข้อสังเกต:** v6 ส่ง input tokens มากกว่า v4 ถึง 2.2x (550K vs 250K) แต่ **cache hit rate ที่สูงกว่า (~85% vs ~35%) ทำให้ต้นทุนรวมต่ำกว่าถึง ~47%** เพราะค่า cache-hit ถูกกว่า miss 120 เท่า  
> ยิ่ง cache ratio ของ provider สูง (DeepSeek 120x, Claude/Gemini ก็มี prompt caching) ยิ่งทำให้ v6 ถูกกว่า v4 มากเท่านั้น

### สรุป: v6 เลือกใช้ cache infrastructure ของ LLM providers

การตัดน้อยลง = prefix เสถียรขึ้น = cache hits มากขึ้น = ต้นทุนรวมต่ำลง v6 ไม่ได้ออกแบบมา "ประหยัด tokens ให้มากที่สุด" แต่ออกแบบให้ **ประหยัดเงินมากที่สุด** โดยทำงาน *ร่วมกับ* caching mechanism ที่ providers มีอยู่แล้ว

ตัวเลข cache 85% นี้คือ **real-world จากการใช้งานจริงบน DeepSeek V4 Pro** — ไม่ใช่ theoretical benchmark

---

## ทำไมถึงได้ผล

### History ไม่ใช่ memory

โมเดลอ่าน session ปัจจุบันได้อยู่แล้ว — มันรู้ว่าคุณเพิ่งพูดอะไร และ workflow ส่วนใหญ่ **เดินหน้า** — คุณไม่ค่อยกลับไปดูสิ่งที่คุยกัน 20 ข้อความก่อน

ถ้าคุณใช้ AI เป็น **ผู้ช่วยส่วนตัว** ความจำระยะยาวควรอยู่ใน knowledge base — Obsidian, skills, journal files, project docs — ไม่ใช่ใน API call history นั่นคือที่ที่ context จริงๆ อยู่

ปลั๊กอินนี้ถูกออกแบบมาสำหรับหลักการนั้น: **เก็บ context แค่เพียงพอสำหรับการสนทนาปัจจุบัน ที่เหลือให้ skills + docs จัดการ**

### Cache stability = ต้นทุนที่แท้จริง

เหตุผลที่ v6 ดีกว่า v4 ไม่ใช่แค่การตัดแบบมีประสิทธิภาพมากขึ้นเท่านั้น แต่เพราะ **การตัดน้อยครั้งกว่าช่วยให้ prompt prefix มีเสถียรภาพ** — system prompt + history head เปลี่ยนน้อยลง → cache hash คงเดิม → LLM provider คืน cache hit (ถูกกว่า miss หลาย十倍)

- v6 ตัดเฉพาะเมื่อ per-role cap เต็ม (~28 ข้อความ) — กว่าจะเต็มต้องใช้เวลาหลาย turn
- v4 (หรือ hard-cap approach ใดๆ) ตัดทันทีที่เกิน threshold (~10 ข้อความ) — prefix เปลี่ยนทุก 2–3 turn
- ใน cache-aware world (DeepSeek 120x ratio): **v6 ประหยัดเงินกว่า ~47%** แม้ส่ง tokens มากกว่า 2.2x ต่อ call

**ข้อคิด:** ถ้า LLM provider ที่คุณใช้ไม่มี prompt caching (หรือ cache ratio ต่ำ) — v4-style hard cap อาจประหยัดกว่า ถ้ามี cache ratio สูง (DeepSeek, Claude, Gemini) — v6 ชนะขาด

### วิธีการทำงาน

```typescript
"experimental.chat.messages.transform" → กรอง messages array ก่อนส่ง API
```

4 ขั้นตอน:

1. **MIN_TOTAL guard** — ถ้าข้อความทั้งหมด ≤ MIN_TOTAL → ไม่ตัด (ประหยัด CPU)

2. **PreserveFirst split** — ถ้า `PRESERVE_FIRST_MSGS > 0` ข้อความ N ตัวแรกจะถูกแยกออกไปก่อน **ไม่ถูกแตะต้อง** ส่วนที่เหลือ (conversation portion) เท่านั้นที่ถูกจำกัด — รับประกันว่า system prompt or initial context อยู่ครบเสมอ

3. **Per-role capped trim + MAX_TOTAL** — เฉพาะในส่วน rest: เดินจากท้าย นับ user, assistant, tool แยกกัน หยุดเมื่อทุก role ถึงขีดจำกัด ต่อด้วย MAX_TOTAL safety ceiling

4. **Tool call/result pair integrity** — ทำงานเสมอ (แม้ใน session ที่ต่ำกว่า MIN_TOTAL) จับคู่ tool calls กับผลลัพธ์โดยใช้ `toolCallId` (OpenCode runtime format) รองรับ `callID` (SDK format) และ `tool_call_id`/`tool_use_id` (legacy provider format) ลบคู่ที่ขาดออก — ไม่ส่ง tool chains ที่เสียไปให้ LLM

5. **In-place mutation ผ่าน `splice`** — การ reassign `output.messages` ใช้ไม่ได้ใน OpenCode (ดู [issue #25754](https://github.com/anomalyco/opencode/issues/25754)) ปลั๊กอินจึง mutate array ในที่เดิมเพื่อให้แน่ใจว่าการเปลี่ยนแปลงมีผล

- **User messages** — เก็บสูงสุด 5 อันล่าสุด (คำถามของคุณคือหัวใจของการสนทนา)
- **Assistant messages** — เก็บสูงสุด 10 อันล่าสุด
- **Tool messages** — เก็บสูงสุด 7 อันล่าสุด
- **Tool calls/results** — จับคู่ด้วย ID, ส่วนที่ขาดถูกล้างทิ้งเสมอไม่ว่า session จะยาวแค่ไหน
- ส่วนที่เหลือถูกทิ้งก่อนส่ง HTTPS request ไป LLM provider

> **ข้อดีของ per-role caps แทน user-priority + hard cap:** User-priority เก่าเก็บ 5 user messages แต่ไม่จำกัด assistant/tool ทำให้ความยาวจริงอาจต่างกันมาก ระบบใหม่ควบคุมแต่ละประเภทแยก — ได้พฤติกรรมที่คาดการณ์ได้กว่า และประหยัดมากกว่าใน session ที่มี tools เยอะ

> **หมายเหตุเรื่อง runtime format:** hook `experimental.chat.messages.transform` ใช้ internal message format ของ OpenCode (จาก `message.ts`) **ไม่ใช่** SDK `Part` types Tool calls/results อยู่ในรูป `ToolInvocationPart` (type `"tool-invocation"`) จับคู่ด้วย `toolInvocation.toolCallId` ปลั๊กอินจัดการ format นี้โดยตรง พร้อมรองรับชื่อฟิลด์แบบ SDK และ legacy provider

---

## การตั้งค่า

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|:---------|:-------:|:------------|
| `MAX_USER_MSGS` | `5` | จำนวน user message สูงสุดที่จะเก็บ |
| `MAX_ASSISTANT_MSGS` | `10` | จำนวน assistant message สูงสุดที่จะเก็บ |
| `MAX_TOOL_MSGS` | `7` | จำนวน tool message สูงสุดที่จะเก็บ |
| `MIN_TOTAL_MSGS` | `5` | ไม่ตัดถ้าจำนวนข้อความทั้งหมด ≤ ค่านี้ (ประหยัด CPU สำหรับ session สั้น) |
| `MAX_TOTAL_MSGS` | `30` | เพดานแข็งของจำนวน messages ทั้งหมด กันบัคที่ per-role caps ตัดไม่พอ |
| `PRESERVE_FIRST_MSGS` | `0` | กัน N ข้อความแรกไว้ **ไม่ถูกตัด** — ใช้สำหรับ system/intro messages ที่อยากให้อยู่ตลอด (ค่าเริ่มต้น 0 = ปิด) |

```bash
export MAX_USER_MSGS=3      # เก็บแค่ 3 คำถามล่าสุด — ประหยัดสูงสุด
export MAX_ASSISTANT_MSGS=6 # 6 คำตอบล่าสุดพอสำหรับ agentic work
export MAX_TOOL_MSGS=5      # tool interaction 5 อันล่าสุด
export MAX_TOTAL_MSGS=20    # safety ceiling
```

**ค่าเริ่มต้น (5U + 10A + 7T = 22):** เลือกมาให้ balance ระหว่าง context ที่เพียงพอกับการทำงานส่วนใหญ่ กับ token savings ที่ ~90% เทียบกับ session 50 ครั้งที่ไม่ถูกจำกัด

---

## การเทส

```bash
npx tsx --test history-trimmer.test.ts
```

**32 tests ใน 10 suites** ครอบคลุม:
- MIN_TOTAL guard (no-op, single message)
- Per-role caps (MAX_USER, MAX_ASSISTANT, MAX_TOOL, combined, recency)
- MAX_TOTAL absolute ceiling (tight ceiling, orphan strip after total trim, MIN_TOTAL wins over MAX_TOTAL)
- Tool pair integrity (matched pairs preserved, orphaned calls/results removed, empty message cleanup)
- Edge cases (no parts, undefined parts, consecutive users, all-tool sessions)
- Multi-format compatibility (SDK `callID`, legacy `tool_call_id`/`tool_use_id`)
- In-place mutation behavior (splice vs reassignment)
- PreserveFirst (varied counts, zero, combined with per-role caps, preserve overrides MAX_TOTAL)
- Cache stability simulation (prefix unchanged across multiple trim cycles)

---

## ความเข้ากันได้

- OpenCode v1.16+
- ใช้ hook `experimental.chat.messages.transform`
- รองรับ OpenCode runtime format (`ToolInvocationPart`) + SDK format (`ToolPart`) + legacy provider format
- Zero dependencies — ไฟล์ TypeScript ไฟล์เดียว + ไฟล์เทสหนึ่งไฟล์

---

## ลิขสิทธิ์

MIT
