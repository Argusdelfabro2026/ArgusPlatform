# ARGUS Platform — Wave 3

> **Automated Bank Reconciliation System**  
> Delfabro Group · v3.0.0 · 2026 -  https://argusdelfabro2026.github.io/ArgusPlatform

```
■ ARGUS v3.0.0 ■ BANK RECONCILIATION ■ DELFABRO GROUP [root@argus:~$]
```

---

## What is ARGUS?

ARGUS is a web-based financial automation system that replaces hours of daily manual work. It processes bank statements from **12 accounts across 7 banks**, normalizes the data, detects human categorization errors, and generates ready-to-use reports — all in under 2 minutes.

### The problem it solves

Before ARGUS, the Delfabro finance team spent hours every day:
- Manually copying transactions from 11 separate Excel spreadsheets
- Assigning accounting categories by hand (40 possible categories)
- Building daily bank summaries
- Preparing exports for the Coliseo ERP system
- Manually detecting classification errors

**ARGUS does all of that automatically.**

---

## How to use it (User Guide)

### Access
```
https://argusdelfabro2026.github.io/ArgusPlatform/
```

No installation required. Just a web browser.

---

### STEP 1 — Bank Transactions

**What it does:** Normalizes and classifies all bank transactions.

1. Click **`+ NEW RUN`** in the top bar
2. In the **[1] MOVIMIENTOS** panel, click **"Seleccionar Movimientos.xlsx"**
3. Select the `Movimientos.xlsx` file (contains all bank accounts)
4. Click **▶ EXECUTE**
5. Watch the terminal stream in real time as each account is processed
6. When done, a **↓ DOWNLOAD** button appears to get the normalized Excel

**Output:** `argus_movimientos_normalizados_[date].xlsx`
- All transactions normalized, color-coded by company and type
- Human categorization errors highlighted
- Summary per bank account

---

### STEP 2 — Caja Digital Control

**What it does:** Compares Caja Digital records (canal=1 Transfer only) against categorized bank transactions from Step 1, generating a signed variance report by category.

> ⚠️ Requires Step 1 to be completed first.

1. Upload the Caja Digital Excel file
2. Click **▶ EXECUTE**

**Output:** `argus_control_caja_dir_[date].xlsx`
- Per category: Caja total (signed) | Bank total (signed) | Variance % | Status
- Status: `OK` (≤10%) / `ALERT` (10–25%) / `CRITICAL` (>25% or only in one source)

---

### STEP 3 — Caja Fábrica Digital *(optional)*

**What it does:** Generates entries ready to paste into the monthly cash register file.

> ⚠️ Requires Step 1 to be completed first.

1. Upload `Caja.xlsx` (monthly cash register file)
2. Click **▶ EXECUTE**

**Output:** `argus_export_caja_[date].xlsx`
- Cash register entries ready to paste into the monthly file

---

### Dashboard — Run History

From the **DASHBOARD** you can:
- View all previous runs (last 3 months)
- See transaction details for each run
- Re-download generated Excel files
- View stats: total transactions processed, alerts detected

---

### Supported Banks

| Company | Bank | Account |
|---|---|---|
| DD SRL | ICBC | ICBC dd srl |
| DD SRL | Mercado Pago | MP fondo azul |
| DD SRL | Mercado Pago | MP fondo blanco |
| DD SRL | BBVA | BBVA dd srl 486 |
| DD SRL | BBVA | BBVA dd srl 487 |
| DD SRL | Bancor | Bancor dd srl |
| DD SRL | Cresium | CRESIUM dd srl |
| D y CIA | Banco Nación | Nacion Y CIA |
| D y CIA | ICBC | ICBC y cia |
| D y CIA | BBVA | BBVA y cia 407 |
| D y CIA | BBVA | BBVA y cia 151 |
| D y CIA | Galicia | GALICIA y cia |

---

## Technical Architecture

### Stack

```
┌─────────────────────────────────────────────────────┐
│  FRONTEND                                           │
│  Next.js 14 (Static Export)                        │
│  GitHub Pages → argusdelfabro2026.github.io        │
│  Terminal UI · JetBrains Mono · Tailwind CSS       │
└──────────────────────┬──────────────────────────────┘
                       │ REST + Server-Sent Events (SSE)
┌──────────────────────▼──────────────────────────────┐
│  BACKEND                                            │
│  FastAPI (Python 3.11)                              │
│  HuggingFace Spaces → Argusdelfabro-argus-api.hf.space │
│  Processing pipeline · SSE streaming               │
└──────────────────────┬──────────────────────────────┘
                       │ supabase-py SDK
┌──────────────────────▼──────────────────────────────┐
│  DATABASE + STORAGE                                 │
│  Supabase (PostgreSQL + Storage)                   │
│  arjymhqzsdnktfojftpi.supabase.co                  │
│  Auto-purge: runs older than 3 months deleted      │
└─────────────────────────────────────────────────────┘
```

### CI/CD

```
git push origin main
        │
        ├── backend/** changed?
        │   └── GitHub Actions → push to HuggingFace Space → redeploy
        │
        └── frontend/** changed?
            └── GitHub Actions → npm run build → push to gh-pages branch → live
```

---

### Project Structure

```
ArgusPlatform/
├── backend/                        # FastAPI (Python)
│   ├── app/
│   │   ├── main.py                 # FastAPI app + CORS
│   │   ├── config.py               # Bank configs (12 accounts, 7 formats)
│   │   ├── api/routes/
│   │   │   ├── process.py          # SSE pipeline endpoints (Step 1, 2, 3)
│   │   │   ├── runs.py             # Run history endpoints
│   │   │   └── files.py            # Excel download endpoints
│   │   ├── core/
│   │   │   ├── supabase.py         # Supabase client
│   │   │   └── config.py           # Settings (env vars)
│   │   ├── db/queries.py           # All DB operations
│   │   ├── services/               # Core processing logic
│   │   │   ├── loader.py           # Excel file loader
│   │   │   ├── normalizer.py       # 7-format bank normalizer
│   │   │   ├── processor.py        # Pipeline orchestrator
│   │   │   ├── summary.py          # Daily summaries generator
│   │   │   ├── exporter.py         # Excel report generator
│   │   │   ├── caja_dir_loader.py  # Caja Digital loader (canal=1 filter)
│   │   │   ├── control_engine.py   # Caja Digital vs bank variance engine
│   │   │   └── reconciler.py       # ERP reconciliation (Wave 2)
│   │   └── models/                 # Dataclasses
│   ├── Dockerfile                  # HuggingFace deployment
│   ├── Procfile                    # uvicorn run command
│   ├── runtime.txt                 # python-3.11.0
│   └── requirements.txt
│
├── frontend/                       # Next.js 14
│   ├── app/
│   │   ├── page.tsx                # Dashboard (run history)
│   │   ├── run/page.tsx            # Pipeline (3-step + terminal)
│   │   └── globals.css             # Terminal aesthetic styles
│   ├── components/
│   │   ├── NavBar.tsx              # Top bar with uptime counter
│   │   ├── TerminalLog.tsx         # Real-time SSE log viewer
│   │   ├── StepPanel.tsx           # Pipeline step card
│   │   ├── ProgressBar.tsx         # Block-style progress [████──]
│   │   └── RunCard.tsx             # History card (ls -la style)
│   ├── lib/
│   │   ├── api.ts                  # REST client + SSE streaming
│   │   ├── types.ts                # TypeScript interfaces
│   │   └── useUptime.ts            # Live uptime hook
│   └── next.config.js
│
├── supabase/migrations/
│   └── 20260523000000_initial.sql  # Full schema + pg_cron purge
│
└── .github/workflows/
    ├── deploy-backend.yml          # → HuggingFace Spaces
    └── deploy-frontend.yml         # → GitHub Pages
```

---

### Database Schema

```sql
runs                 -- One per processing session
transactions         -- All normalized transactions (Step 1)
bank_summaries       -- Daily summary per account (Step 1)
reconciliation_lines -- ERP vs bank reconciliation (Wave 2)
caja_entries         -- Cash register entries (Step 3)
output_files         -- Generated Excel files (Storage paths)
```

**Retention:** All data is automatically deleted after 3 months via `pg_cron`.

---

### Bank Normalization

The heart of the system. Each bank exports in a different format:

| Bank | Key quirk |
|---|---|
| ICBC | Debits exported as NEGATIVE values |
| BBVA | Debits exported as NEGATIVE values |
| Galicia | ALL values positive (debits must be negated) |
| Mercado Pago | Single `Valor` column with sign (negative=debit) |
| Bancor | `Monto` column with sign + trailing-space headers |
| Banco Nación | `Importe` column with sign |
| Cresium | Data starts at row 8 (rows 6-7 empty), category in col 11 |

**Human error detection:**
- `Rule 0`: No category assigned → `⚠ FALTA CATEGORIZAR`
- `Rule A`: Debit with income category (25-30) → `⚠ ERROR HUMANO`
- `Rule B`: Credit with expense category (1-24, 31-38) → `⚠ ERROR HUMANO`
- **Exception:** MP fondo azul cat.37 on credits = valid (ML refunds)

---

## Local Setup (Development)

### Requirements
- Python 3.11+
- Node.js 20+
- Git

### Backend
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Fill in .env with Supabase credentials
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local
# NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
npm run dev
```

Open: `http://localhost:3000`

### Environment Variables

**Backend** (`backend/.env`):
```
SUPABASE_URL=https://arjymhqzsdnktfojftpi.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_...
SUPABASE_ANON_KEY=sb_publishable_...
FRONTEND_URL=http://localhost:3000
```

**Frontend** (`frontend/.env.local`):
```
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

---

## Deploy

Everything is automatic via GitHub Actions on every push to `main`.

| Component | Platform | Trigger |
|---|---|---|
| Backend | HuggingFace Spaces | Changes in `backend/**` |
| Frontend | GitHub Pages | Changes in `frontend/**` |

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `HF_TOKEN` | HuggingFace Access Token (write) |
| `NEXT_PUBLIC_BACKEND_URL` | Backend URL on HuggingFace |

### Production URLs

| | URL |
|---|---|
| **App** | https://argusdelfabro2026.github.io/ArgusPlatform/ |
| **API** | https://Argusdelfabro-argus-api.hf.space |
| **API Docs** | https://Argusdelfabro-argus-api.hf.space/docs |

---

## System Metrics

| Metric | Value |
|---|---|
| Bank accounts supported | 12 |
| Distinct bank formats | 7 |
| Companies | 2 (DD SRL + D y CIA) |
| Accounting categories | 40 |
| Transactions per run | ~2,773 |
| Processing time | < 2 minutes |
| Data retention | 3 months |

---

## Roadmap

| Wave | Status | Description |
|---|---|---|
| Wave 1 | ✅ Done | Normalization + Classification + Summaries + Caja |
| Wave 2 | ✅ Done | ERP Reconciliation (COBROS/PAGOS vs bank) |
| Wave 3 | ✅ Done | Web App (FastAPI + Next.js + Supabase) |
| Wave 4 | 🔜 Planned | Analytics dashboard · Charts · Trends |
| Wave 5 | 🔜 Planned | Automatic notifications · Email alerts |

---

## Team

| Role | Contact |
|---|---|
| Development | Max Ramos |
| Client | Delfabro Group |

---

*ARGUS v3.0.0 · Built with FastAPI, Next.js & Supabase · 2026*
