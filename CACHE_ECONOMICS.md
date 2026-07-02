# Cache Economics — History Trimmer for DeepSeek

> หลักคิด: **ยอมแบก `CACHE HIT` ได้ ตราบใดที่การแบกนั้นช่วยลด `CACHE MISS`, ลด retry, หรือรักษาหลักฐานสำคัญไว้**
> แต่ถ้า hit ที่แบกเพิ่มไม่ได้ช่วยอะไร มันคือไขมัน ไม่ใช่กล้ามเนื้อ

---

## ราคา DeepSeek Official

จาก [DeepSeek API Pricing](https://api-docs.deepseek.com/quick_start/pricing)

| รุ่น | Input Cache Hit | Input Cache Miss | Output |
|:--|--:|--:|--:|
| **V4 Flash** | $0.0028/M | $0.14/M | $0.28/M |
| **V4 Pro** | $0.003625/M | $0.435/M | $0.87/M |

### Ratio เปรียบเทียบ

| Ratio | Flash | Pro | แปลความ |
|:--|:-:|:-:|:--|
| Miss ÷ Hit | **50×** | **120×** | 1 miss token แพงเท่า N hit tokens |
| Output ÷ Hit | **100×** | **240×** | 1 output token แพงเท่า N hit tokens |
| Output ÷ Miss | **2×** | **2×** | output แพงกว่า miss 2 เท่า |

---

## สูตรที่ 1 — Breakeven Ratio

**คำถาม:** กี่ hit tokens ที่ยอมแบกเพิ่มเพื่อหนี 1 miss token?

```text
Breakeven Ratio = miss_price / hit_price

Flash: 0.14 / 0.0028 = 50
Pro:   0.435 / 0.003625 = 120
```

### วิธีใช้กับ History Trimmer

```text
max_extra_hit_tokens = avoided_miss_tokens × breakeven_ratio
```

ถ้า config ใหม่ช่วยลด miss ได้ 500 tokens ต่อ call:
- Pro: แบก hit เพิ่มได้ถึง 500 × 120 = **60,000 tokens** ก่อนเริ่มไม่คุ้ม
- Flash: แบก hit เพิ่มได้ถึง 500 × 50 = **25,000 tokens**

60K tokens ≈ 200 messages → แสดงว่าเรามี headroom มหาศาลสำหรับ Pro

### สรุป

| เงื่อนไข | Flash | Pro |
|:--|:-:|:-:|
| ถ้าเก็บ hit เพิ่ม 50K → ต้องลด miss ได้เกิน | 1K | 417 |
| ถ้าเก็บ hit เพิ่ม 100K → ต้องลด miss ได้เกิน | 2K | 834 |
| ถ้าเก็บ hit เพิ่ม 250K → ต้องลด miss ได้เกิน | 5K | 2,084 |

---

## สูตรที่ 2 — Total Cost Per Call (Master Formula)

**คำถาม:** Config ไหนใช้เงินถูกกว่ากัน?

```text
total_cost =
  input_hit_tokens × hit_price
  + input_miss_tokens × miss_price
  + output_tokens × output_price
```

### วิธีใช้

ใช้สูตรนี้เทียบ 2 configs ก่อน deploy — ใส่ token estimates จาก session จริง

### ตัวอย่าง Pro

| Component | Tokens | Rate | Cost |
|:--|--:|:--|--:|
| Cache hit input | 35,000 | $0.003625/M | $0.000127 |
| Cache miss input | 15,000 | $0.435/M | $0.006525 |
| Output | 4,000 | $0.87/M | $0.003480 |
| **รวมต่อ call** | **54,000** | | **$0.01013** |

---

## สูตรที่ 3 — Retry Cost Threshold

**คำถาม:** aggressive tuning ที่เพิ่ม retry คุ้มรึเปล่า?

```text
saving_per_call = tokens_cut × price_per_token
retry_cost_per_call = retry_prob_increase × avg_cost_per_call

คุ้มเมื่อ: saving_per_call > retry_cost_per_call
```

### วิธีใช้

ทุก 1% retry ที่เพิ่มขึ้น ต้องมี token saving มหาศาลมาชดเชย

### ตัวอย่าง Pro

ตัด 4 tool messages (1,200 tokens) ที่เป็น cache hit:
```text
saving  = 1,200 × $0.003625/M = $0.000004
retry_risk = 2% × $0.02 = $0.0004
ขาดทุน = $0.000396 ❌
```

**บทเรียน:** อย่าตัด tool evidence — แม้โอกาส retry แค่ 0.02% ก็ทำลาย savings หมด

### Quick Reference

| Retry เพิ่ม | Pro ต้องประหยัดต่อ call | Flash ต้องประหยัดต่อ call |
|:-:|:-:|:-:|
| 1% | $0.0002 | $0.00007 |
| 2% | $0.0004 | $0.00014 |
| 5% | $0.0010 | $0.00035 |
| 10% | $0.0020 | $0.00070 |

เทียบกับ: 1 tool message (350 tok at hit) = $0.0000013 → **ไม่คุ้มเลย**

---

## สูตรที่ 4 — Output Bloat Tax

**คำถาม:** context ที่เพิ่มขึ้นทำให้ output ยาวขึ้น — คุ้มไหม?

```text
extra_output_cost = extra_output_tokens × output_price
extra_hit_cost = extra_hit_tokens × hit_price

output_is_bloating = extra_output_cost > extra_hit_cost
```

### วิธีใช้

Output ratio: Pro **240×** hit, Flash **100×** hit

ถ้าเก็บ 10 tool messages (3,500 hit tokens = $0.000013) แล้ว output เพิ่ม 20 tokens ($0.000017):
→ output bloat แพงกว่า hit ที่เพิ่มแล้ว ❌

### 3 อาการที่ควรสังเกต

| อาการ | สาเหตุ | วิธีแก้ |
|:--|:--|:--|
| Model ตอบยาว ซ้ำประเด็น | มี context เก่าเยอะเกิน | ลด MAX_TOTAL |
| Model อ้างอิง tool result เก่า | tool messages กองรวม | เพิ่ม MAX_TOOL แต่ลด MAX_ASSISTANT |
| Model summarize history ทุกครั้ง | context ยาวเกินไป trigger recapitulation | ปรับ PRESERVE_FIRST ให้ดี |

---

## สูตรที่ 5 — MAX_TOTAL Sizing

**คำถาม:** MAX_TOTAL ควรเป็นเท่าไหร่?

```text
MAX_TOTAL = sum(per_role_caps) + buffer
buffer = estimated_tool_overflow + safety_margin (4-8)
```

### วิธีใช้

ตั้ง MAX_TOTAL ให้สูงกว่าผลรวม per-role caps เล็กน้อย เพื่อให้ per-role caps เป็นตัวตัดหลัก ไม่ใช่ MAX_TOTAL บีบคอ

| Per-role caps | Sum | Buffer | MAX_TOTAL |
|:--|:-:|:-:|:-:|
| 10U+16A+12T = 38 | +2P | 4-6 | **44-46** |
| 10U+16A+14T = 40 | +2P | 4-6 | **46-48** |
| 10U+16A+16T = 42 | +2P | 4-6 | **48-50** |

ถ้า `sum + buffer > MAX_TOTAL` → MAX_TOTAL เป็น active constraint → ตัด oldest messages เพิ่ม
ถ้า `sum + buffer ≤ MAX_TOTAL` → per-role caps เป็นตัวตัด → MAX_TOTAL แค่ safety ceiling

---

## สูตรที่ 6 — Preset Selector

**คำถาม:** ควรใช้ config ไหนกับ workload แบบไหน?

```text
tool_ratio = tool_calls_in_window / total_messages_in_window

ถ้า tool_ratio > 0.3 → DEBUG preset (MAX_TOOL=14-16)
ถ้า tool_ratio < 0.1 → CHAT preset  (MAX_TOOL=7-8)
อื่นๆ               → BALANCED      (MAX_TOOL=12)
```

### Recommended Presets

#### A) Chat / Research (tool-light)

```env
PRESERVE_FIRST_MSGS=2
MAX_USER_MSGS=10
MAX_ASSISTANT_MSGS=14
MAX_TOOL_MSGS=8
MIN_TOTAL_MSGS=6
MAX_TOTAL_MSGS=36
```

เหมาะกับ: ถาม-ตอบ, search, อ่าน docs, อภิปราย
ธีม: lean — ไม่ต้องเก็บ tool เยอะ เพราะใช้ tool น้อย

#### B) Balanced (default)

```env
PRESERVE_FIRST_MSGS=2
MAX_USER_MSGS=10
MAX_ASSISTANT_MSGS=16
MAX_TOOL_MSGS=12
MIN_TOTAL_MSGS=8
MAX_TOTAL_MSGS=42
```

เหมาะกับ: งานทั่วไป, coding ปานกลาง
ธีม: สมดุล — ทุกอย่างมีที่ทาง

#### C) Debug / Build (tool-heavy)

```env
PRESERVE_FIRST_MSGS=2
MAX_USER_MSGS=10
MAX_ASSISTANT_MSGS=16
MAX_TOOL_MSGS=16
MIN_TOTAL_MSGS=8
MAX_TOTAL_MSGS=50
```

เหมาะกับ: debug chain, refactor, multi-step build
ธีม: conservative — เก็บ tool evidence ไว้ให้มากที่สุด
**นี่คือ preset ที่ใช้อยู่ตอนนี้ (v7.1)**

---

## วิธีเลือกค่าที่ดีที่สุด

### Step 1: วัดความยาว token จริงของ session

```bash
# ใน PowerShell, เก็บ metrics ต่อ session:
# - total_input_tokens
# - cache_hit_tokens
# - cache_miss_tokens
# - output_tokens
# - messages_before_trim, messages_after_trim
# - retry_count
```

### Step 2: ใช้ Master Formula คำนวณต้นทุน

```text
cost = hit × hit_price + miss × miss_price + output × output_price
```

### Step 3: ปรับ config → rerun → เทียบ cost

ลดค่าที่ต่ำที่สุด = config ที่ดีที่สุดสำหรับ workload นั้น

### Step 4: เช็ค Retry Rate

```text
retry_rate = retry_count / total_calls
```

ถ้า retry_rate > 5% → ลด aggressiveness (เพิ่ม caps)
ถ้า retry_rate < 1% → อาจ aggressive ขึ้นได้

---

## ตัวอย่างการคำนวณ: v7.1 (10/16/16/8/50/2) vs Balanced (10/16/12/8/40/2)

### Setup

| Parameter | v7.1 | Balanced |
|:--|:-:|:-:|
| MAX_TOOL | 16 | 12 |
| MAX_TOTAL | 50 | 40 |
| Per-role sum + preserve | 44 | 40 |
| Buffer | 6 | 0 |

### สำคัญ: tool overflow 4 messages

v7.1 เก็บ tool ได้ 16, Balanced เก็บได้ 12 ต่อ session ที่ tool เยอะ > 12

ส่วนต่าง 4 tool messages:
- 4 × 350 tok avg = **1,400 tokens** (input miss)
- Cost: 1,400 × $0.435/M = **$0.000609** ต่อ call

ถาม: $0.000609 ต่อ call คุ้มที่จะกัน retry ไหม?

จาก Retry Cost Threshold:
- 1% retry risk = $0.0002
- 2% retry risk = $0.0004
- $0.000609 / $0.02 = 3.04% → ถ้า tool evidence ป้องกัน retry 3%+ → **คุ้ม**

สำหรับ debug session ที่ tool evidence หลุดแล้วต้องรันใหม่แน่นอน → **v7.1 คุ้มกว่า**

---

## License

MIT — ส่วนหนึ่งของ [history-trimmer](https://github.com/aetox-skills/history-trimmer)
