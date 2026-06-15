# A.P.E.X. — Advanced Prediction Engine Xperience for F1 Strategy

📌 **Project Overview**

A.P.E.X. is a full-stack F1 race strategy engine that combines machine learning, real-time telemetry ingestion, and a conversational AI assistant to simulate and predict pit stop decisions during a Grand Prix. Built by a 5-person capstone team at Arizona State University, the system pulls live race data, models tyre degradation, and surfaces strategy recommendations through an interactive React dashboard — all powered by a multi-source data pipeline and an XGBoost classifier trained on historical F1 sessions.

🌐 **Live Demo**: [apexf1strategy.netlify.app](https://apexf1strategy.netlify.app)

---

## 📂 Data Sources

A.P.E.X. ingests data from two complementary F1 APIs:

- **FastF1**: Historical lap-by-lap telemetry, tyre stints, and session metadata for model training.
- **OpenF1 API**: Live session data for real-time strategy inference during active race weekends.

Data covers lap times, compound types, stint lengths, tyre age, track conditions, and driver/constructor context across multiple seasons.

---

## 🛠️ Methodology

**Data Pipeline**
- `ingest_telemetry.py` handles multi-source ingestion, aligning FastF1 historical data with OpenF1 live feeds into a unified schema for downstream modeling.

**ML Pipeline (`ml_pipeline/`)**
- **Tyre Degradation Model**: Linear regression mapping tyre age and compound to lap time delta — used to estimate performance cliff and flag optimal pit windows.
- **Pit Stop Classifier**: XGBoost model trained on structured race features (stint length, gap to traffic, compound, position, track temp) to predict whether a pit stop is strategically optimal on a given lap.

**N.I.K.I. — Natural Intelligence for Kinetic Insights**
- Conversational AI assistant integrated into the dashboard.
- Combines NL-to-SQL querying over race session data with RAG-based retrieval for contextual strategy explanations.
- Handles natural language questions like *"When should Verstappen pit given current tyre age?"* or *"What's the undercut window on lap 35?"*

**Frontend (`src/`)**
- Built with React + TypeScript + Vite, styled with Tailwind CSS.
- Dashboard components include live stint visualizations, tyre degradation curves, pit window recommendations, and the N.I.K.I. chat interface.
- Deployed via Netlify with serverless functions (`netlify/functions/`) proxying backend API calls.

---

## 🚀 Results

| Metric | Value |
|---|---|
| Pit Stop Classifier Accuracy | **0.88** |
| Log Loss | **0.31** |
| Tyre Degradation R² | Compound-specific linear fits |
| Data Sources | FastF1 + OpenF1 (multi-season) |

The XGBoost model achieves 0.88 accuracy with a 0.31 log-loss on held-out race sessions, demonstrating strong predictive signal from lap-level telemetry features. Tyre degradation regression models are trained per-compound to capture the distinct wear profiles of Soft, Medium, and Hard tyres.

---

## 👥 Team

| Member | Role |
|---|---|
| Rishikrishnan Gurunathan | Tyre degradation model, React dashboard components, N.I.K.I. LLM assistant |
| Aakash Selvabaskar | ML pipeline, XGBoost classifier, Race Prediction Model, N.I.K.I. LLM assistant |
| Abnik Ahilasamy | Data ingestion & API integration, Supabase DB |
| Sharan Magesh | Backend & Netlify serverless functions |

---

## 💻 Installation & Usage

**Prerequisites**: Node.js 18+, Python 3.10+

**1. Clone the repository:**
```bash
git clone https://github.com/exceta/A.P.E.X---Advanced-Prediction-Engine-Xperience-for-F1-Strategy.git
cd A.P.E.X---Advanced-Prediction-Engine-Xperience-for-F1-Strategy
```

**2. Set up environment variables:**
```bash
cp .env.example .env
# Fill in your OpenF1 API key and LLM provider credentials
```

**3. Run the ML pipeline (Python):**
```bash
pip install -r ml_pipeline/requirements.txt
python ingest_telemetry.py
# Train models from ml_pipeline/
```

**4. Install frontend dependencies and run locally:**
```bash
npm install
npm run dev
```

**5. Deploy to Netlify:**
```bash
npm run build
# Connect repo to Netlify — netlify.toml handles function routing automatically
```

---

## 🏗️ Project Structure

```
├── ml_pipeline/          # XGBoost classifier + tyre degradation models
├── netlify/functions/    # Serverless API proxy functions
├── src/                  # React + TypeScript frontend
│   ├── components/       # Dashboard, N.I.K.I. chat, tyre viz
│   └── ...
├── public/               # Static assets
├── ingest_telemetry.py   # Multi-source data ingestion (FastF1 + OpenF1)
├── netlify.toml          # Netlify deployment config
└── .env.example          # Environment variable template
```

---

## 🔧 Tech Stack

| Layer | Technologies |
|---|---|
| ML / Data | Python, XGBoost, scikit-learn, FastF1, OpenF1 API, pandas |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| AI Assistant | LangChain, RAG, NL-to-SQL (N.I.K.I.) |
| Deployment | Netlify, Netlify Functions |
| CI/CD | GitHub Actions |
