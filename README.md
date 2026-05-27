---
title: Watco AI
emoji: 💧
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Smart Water Demand Forecasting System (WATCO)

An enterprise-grade AI-powered forecasting system for smart water networks. Built using FastAPI, XGBoost, and Chart.js.

## Running Locally

1. Install requirements:
   ```bash
   pip install -r backend/requirements.txt
   ```

2. Run the FastAPI server:
   ```bash
   python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
   ```

3. Open `frontend/index.html` in your browser.
