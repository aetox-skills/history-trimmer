# Model-Adaptive Config Calculator

> ปรับ preset ของ History Trimmer ตามโมเดล LLM ที่คุณใช้  
> เพราะ cache economics ของแต่ละโมเดลไม่เหมือนกัน — config ที่ดีที่สุดจึงไม่ใช่ค่าเดียว

---

## หลักคิด

Breakeven ratio (`R = miss_price / hit_price`) บอกว่า **1 miss token แพงเท่า 1 hit token กี่เท่า**

- **R สูง** (120×) → ราคา miss แพงมาก → ยอมแบก context เยอะขึ้นเพื่อหลบ miss
- **R ต่ำ** (50×) → ราคา miss ยังแพงกว่า แต่ไม่เท่า → ตัด history หนักขึ้นได้

นี่คือตัวแปรเดียวที่เปลี่ยนพฤติกรรมการตั้งค่าทั้งหมด

---

## สูตรปรับ Config (1-factor model)

```
R = miss_price / hit_price
factor = clamp(R / 120, 0.5, 1.5)

MAX_ASSISTANT = max(10, round(14 × factor))
MAX_TOOL      = max(8,  round(14 × factor))
MAX_TOTAL     = 10 + MAX_ASSISTANT + MAX_TOOL + 6 (buffer)
```

| Parameter | Baseline (R=120) | สูตร |
|:----------|:----------------:|:-----|
| `PRESERVE_FIRST_MSGS` | 2 | คงที่ — ไม่ขึ้นกับ R |
| `MAX_USER_MSGS` | 10 | คงที่ — user คือหัวใจ |
| `MAX_ASSISTANT_MSGS` | 14 | `max(10, round(14 × factor))` |
| `MAX_TOOL_MSGS` | 14 | `max(8, round(14 × factor))` |
| `MIN_TOTAL_MSGS` | 8 | คงที่ — safety guard |
| `MAX_TOTAL_MSGS` | 44 | `10 + MAX_ASSISTANT + MAX_TOOL + 6` |

> **floor:** 10/10/8 (assistant/tool/total) — ต่ำกว่านี้ conversation coherence พัง  
> **ceiling:** 16/16/48 — สูงกว่านี้ cache hit ratio ไม่เพิ่มขึ้นมากพอให้คุ้ม

---

## Lookup Table — ทุกโมเดลหลัก

คำนวณจาก official pricing ณ 1 ก.ค. 2026

| โมเดล | Miss $/M | Hit $/M | R | Output $/M | factor | **MAX_ASST** | **MAX_TOOL** | **MAX_TOTAL** |
|:--|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **DeepSeek V4 Pro** 🇨🇳 | $0.435 | $0.003625 | **120×** | $0.87 | 1.00 | **14** | **14** | **44** |
| DeepSeek V4 Flash 🇨🇳 | $0.14 | $0.0028 | **50×** | $0.28 | 0.50 → 0.5 | **10** | **10** | **36** |
| Claude Opus 4.8 | $5.00 | $0.10 | **50×** | $15.00 | 0.50 → 0.5 | **10** | **10** | **36** |
| Claude Sonnet 4.5 | $3.00 | $0.06 | **50×** | $15.00 | 0.50 → 0.5 | **10** | **10** | **36** |
| Claude Haiku 4.5 | $1.00 | $0.02 | **50×** | $5.00 | 0.50 → 0.5 | **10** | **10** | **36** |
| GPT-5.5 | $5.00 | $0.10 | **50×** | $20.00 | 0.50 → 0.5 | **10** | **10** | **36** |
| GPT-5 | $1.25 | $0.03 | **42×** | $5.00 | 0.35 → 0.5 | **10** | **10** | **36** |
| Gemini 2.5 Pro | $1.25 | $0.03125 | **40×** | $5.00 | 0.33 → 0.5 | **10** | **10** | **36** |
| Gemini 2.5 Flash | $0.075 | $0.001875 | **40×** | $0.30 | 0.33 → 0.5 | **10** | **10** | **36** |
| GLM-5 🇨🇳 | $1.00 | $0.02 | **50×** | $4.00 | 0.50 → 0.5 | **10** | **10** | **36** |
| Qwen3 Max 🇨🇳 | $1.20 | $0.03 | **40×** | $4.80 | 0.33 → 0.5 | **10** | **10** | **36** |

> **หมายเหตุ:** Claude และ Gemini ทุกตัวจะ R ≈ 50× หรือต่ำกว่า เพราะ cache hit discount ของ provider เหล่านี้ไม่ได้สูงเท่า DeepSeek Pro  
> Provider ที่ cache hit discount น้อย (R ≤ 60×) → ใช้ aggressive preset `10/10/10/8/36`  
> Provider ที่ cache hit discount สูงมาก (R > 100×) → ใช้ conservative preset `10/14/14/8/44` หรือสูงกว่า

---

## 2-factor model (แม่นยำกว่า)

ถ้าต้องการความละเอียดขึ้น — คิดทั้ง miss/hit ratio **และ** output/hit ratio:

```
f_miss  = min(R_miss_hit / 120, 2.0)   # คิด 60%
f_retry = min(R_output_hit / 240, 2.0) # คิด 40%

factor = f_miss × 0.6 + f_retry × 0.4
```

| โมเดล | R miss/hit | f_miss | R output/hit | f_retry | factor (weighted) | หลัง clamp | MAX_ASST | MAX_TOOL |
|:--|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| DeepSeek V4 Pro | 120× | 1.000 | 240× | 1.000 | 1.000 → **1.00** | 1.00 | 14 | 14 |
| DeepSeek V4 Flash | 50× | 0.417 | 100× | 0.417 | 0.417 → **0.50** | 0.50 | 10 | 10 |
| Claude Opus 4.8 | 50× | 0.417 | 150× | 0.625 | 0.500 → **0.50** | 0.50 | 10 | 10 |
| GPT-5.5 | 50× | 0.417 | 200× | 0.833 | 0.583 → **0.58** | 0.58 | 10 | 10 |

> Output/hit ratio มีผลต่อ retry cost — ถ้า output แพงกว่า hit มาก (เช่น 240×) การ retry แต่ละครั้งจะแพงมาก → ยิ่งควรเก็บ history ไว้เยอะขึ้น  
> แต่ในทางปฏิบัติ 1-factor model ก็เพียงพอสำหรับการตัดสินใจ — 2-factor ให้ความละเอียดขึ้นเล็กน้อยสำหรับ tuning ขั้นสูง

---

## วิธีใช้

### กรณีรู้ชื่อโมเดล

เปิดตาราง lookup → ใช้ค่าจาก `MAX_ASST` / `MAX_TOOL` / `MAX_TOTAL`

```bash
# DeepSeek V4 Flash
export MAX_ASSISTANT_MSGS=10
export MAX_TOOL_MSGS=10
export MAX_TOTAL_MSGS=36
```

### กรณีรู้ราคาแต่ไม่รู้โมเดล

```text
R = 0.14 / 0.0028 = 50
factor = max(0.5, min(50/120, 1.5)) = 0.5

MAX_ASSISTANT = max(10, round(14 × 0.5)) = 10
MAX_TOOL      = max(8,  round(14 × 0.5)) = 10
MAX_TOTAL     = 10 + 10 + 10 + 6 = 36
```

### กรณีโมเดลใหม่ที่เพิ่งออก

1. หา pricing: `miss_price`, `hit_price` (per 1M tokens)
2. คำนวณ: `R = miss_price / hit_price`
3. คำนวณ: `factor = clamp(R / 120, 0.5, 1.5)`
4. หาค่า caps จากสูตรด้านบน

---

## ตารางสรุปผลกระทบ

| ค่า R | หมวดหมู่ | กลยุทธ์ | MAX_ASST | MAX_TOOL | MAX_TOTAL |
|:-----:|:--------|:--------|:--------:|:--------:|:---------:|
| 120×+ | Ultra-high | Conservative — เก็บ history เยอะ | 14–16 | 14–16 | 44–48 |
| 80–120× | High | Balanced — v8 default | 12–14 | 12–14 | 40–44 |
| 50–80× | Medium | Moderate — trim บ้าง | 10–12 | 10–12 | 36–40 |
| < 50× | Low | Aggressive — trim หนัก | 10 | 10 | 36 |

---

## เปรียบเทียบ: 1 session (50 calls) — DeepSeek Pro vs Flash

| Metric | Pro (120×) config 14/14/44 | Flash (50×) config 10/10/36 |
|:-------|:--------------------------:|:---------------------------:|
| Messages/trim | ~28–30 | ~20–22 |
| Input/call | ~12K tok | ~8K tok |
| Total input (50 calls) | ~600K tok | ~400K tok |
| Target cache hit | ~85% | ~75% |
| Miss tokens | ~90K tok | ~100K tok |
| Hit tokens | ~510K tok | ~300K tok |
| **Input cost** | **~$0.041** | **~$0.029** |
| **ต่างกัน** | baseline | **~29% ถูกกว่า** |

> Flash cache hit rate ต่ำกว่าเพราะตัด history มากกว่า → prefix ขยับบ่อยขึ้น  
> แต่ถึงอย่างนั้น Flash ก็ยังถูกกว่า Pro ถึง ~29% ต่อ session เพราะ hit/miss ratio ต่ำกว่า — **Flash ยอมให้ตัด history หนักกว่าเพราะค่าเสียหายต่อ miss ต่ำกว่า**

---

## ข้อควรจำ

1. **ยิ่ง R สูง → ยิ่งควรยอมแบก context** — DeepSeek Pro 120× = ยอมแบก hit 120K tokens เพื่อหลบ miss 1K tokens
2. **ตารางนี้จะเปลี่ยนเมื่อราคาเปลี่ยน** — ถ้า provider ลดราคา miss หรือเพิ่ม hit discount → R เปลี่ยน → config ต้องเปลี่ยน
3. **2-factor model**: output/hit ratio สำคัญรองลงมา — ใช้เมื่อ tuning จริงจัง
4. **floor = 10/10/36**: ต่ำกว่านี้ไม่คุ้ม — ประหยัด tokens แต่เสียความสามารถทำงาน → ถ้าต้องการ aggressive กว่านี้ให้ลด MAX_USER หรือใช้ hard cap แทน
5. **ceiling = 16/16/48**: สูงกว่านี้ cache hit ratio ไม่เพิ่มขึ้นอีก — เหนือ point of diminishing returns

---

> ดูรายละเอียด Cache Economics ทั้งหมดได้ที่ [`CACHE_ECONOMICS.md`](./CACHE_ECONOMICS.md)
