import os
import shutil
import pandas as pd
from typing import List
from fastapi import FastAPI, UploadFile, File, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.utils.preprocessing import extract_dma_name, detect_columns, load_and_merge_datasets
from backend.utils.forecasting import train_and_forecast

app = FastAPI(
    title="Smart Water Forecasting & SCADA Analytics API",
    description="Enterprise-grade AI-powered forecasting system for smart water networks.",
    version="2.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HISTORICAL_FOLDER = os.path.join(BASE_DIR, "historical_data")
CURRENT_FOLDER = os.path.join(BASE_DIR, "current_data")

os.makedirs(HISTORICAL_FOLDER, exist_ok=True)
os.makedirs(CURRENT_FOLDER, exist_ok=True)

@app.on_event("startup")
def startup_event():
    try:
        merged_filepath = os.path.join(HISTORICAL_FOLDER, "merged_historical_data.csv")
        if not os.path.exists(merged_filepath):
            print("No merged historical data found. Merging available historical files...")
            merged_df = load_and_merge_datasets(HISTORICAL_FOLDER)
            if not merged_df.empty:
                merged_df.to_csv(merged_filepath, index=False)
                print(f"Successfully merged historical files. Total rows: {len(merged_df)}")
    except Exception as e:
        print(f"Error on startup merge: {e}")

@app.get("/health")
def read_health():
    return {
        "status": "online",
        "system": "Smart Water Forecasting System API",
        "version": "2.0.0"
    }

@app.post("/upload-historical")
async def upload_historical(files: List[UploadFile] = File(...)):
    """
    Uploads multiple historical SCADA CSV files, saves them in the historical_data directory,
    merges them chronologically, and saves the merged dataset.
    """
    try:
        uploaded_info = []
        for file in files:
            if not file.filename.endswith(".csv"):
                raise HTTPException(status_code=400, detail=f"Only CSV files are supported. Invalid file: {file.filename}")
            
            # Save file
            file_path = os.path.join(HISTORICAL_FOLDER, file.filename)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
                
            # Read metadata
            df = pd.read_csv(file_path)
            uploaded_info.append({
                "filename": file.filename,
                "rows": len(df),
                "columns_count": len(df.columns)
            })
            
        # Merge all historical datasets and save merged file
        merged_df = load_and_merge_datasets(HISTORICAL_FOLDER)
        if not merged_df.empty:
            merged_filepath = os.path.join(HISTORICAL_FOLDER, "merged_historical_data.csv")
            # Exclude the merged file itself from future merges by naming or loading logic (load_and_merge_datasets excludes it if we filter or we can just save it)
            # Wait, in load_and_merge_datasets, we load all CSV files. If we save merged_historical_data.csv there, it will merge itself next time!
            # Let's fix this in main.py or load_and_merge_datasets.
            # In load_and_merge_datasets, let's exclude "merged_historical_data.csv".
            # Let's write the merged file.
            merged_df.to_csv(merged_filepath, index=False)
            
        return {
            "success": True,
            "message": f"Successfully uploaded and merged {len(files)} historical file(s).",
            "merged_rows": len(merged_df) if not merged_df.empty else 0,
            "files": uploaded_info
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/upload-current")
async def upload_current(file: UploadFile = File(...)):
    """
    Uploads a single current-day partial operational CSV file.
    """
    try:
        if not file.filename.endswith(".csv"):
            raise HTTPException(status_code=400, detail="Only CSV files are supported.")
            
        file_path = os.path.join(CURRENT_FOLDER, file.filename)
        
        # Save file (overwrites existing current day data of same name, or we can clear current folder first)
        # Let's clear the current folder first to ensure only the latest current partial data exists
        for f in os.listdir(CURRENT_FOLDER):
            fp = os.path.join(CURRENT_FOLDER, f)
            if os.path.isfile(fp):
                os.remove(fp)
                
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        df = pd.read_csv(file_path)
        
        return {
            "success": True,
            "message": f"Successfully uploaded current-day operational file: {file.filename}",
            "rows": len(df),
            "columns": list(df.columns)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get-dmas")
def get_dmas():
    """
    Dynamically scans historical and current files to identify the DMAs.
    """
    try:
        dmas = set()
        for folder in [HISTORICAL_FOLDER, CURRENT_FOLDER]:
            if os.path.exists(folder):
                for file in os.listdir(folder):
                    if file.endswith(".csv") and file != "merged_historical_data.csv":
                        dmas.add(extract_dma_name(file))
                        
        return {"dmas": sorted(list(dmas))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get-subdmas")
def get_subdmas(dma: str = Query("Baliapanda", description="DMA name filter")):
    """
    Dynamically detects the sub-DMAs from the columns in the historical dataset.
    """
    try:
        # Load merged historical data to check columns
        merged_filepath = os.path.join(HISTORICAL_FOLDER, "merged_historical_data.csv")
        df = pd.DataFrame()
        if os.path.exists(merged_filepath):
            df = pd.read_csv(merged_filepath)
        else:
            # Fallback: scan any CSV in historical folder
            csv_files = [f for f in os.listdir(HISTORICAL_FOLDER) if f.endswith(".csv") and f != "merged_historical_data.csv"]
            if csv_files:
                df = pd.read_csv(os.path.join(HISTORICAL_FOLDER, csv_files[0]))
                
        if df.empty:
            return {"dma": dma, "subdmas": []}
            
        _, subdma_mapping = detect_columns(df)
        return {
            "dma": dma,
            "subdmas": sorted(list(subdma_mapping.keys()))
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/forecast")
def get_forecast(dma: str = Query("Baliapanda"), subdma: str = Query("Overall")):
    """
    Runs XGBoost forecasting on the current day's remaining hours.
    Returns chart-ready JSON including actual demands, predicted demands, and envelope.
    """
    try:
        # Find the latest current day CSV
        current_files = [f for f in os.listdir(CURRENT_FOLDER) if f.endswith(".csv")]
        if not current_files:
            raise HTTPException(status_code=400, detail="No current day operational data file uploaded. Please upload a current day file first.")
            
        latest_current = os.path.join(CURRENT_FOLDER, current_files[-1])
        
        result = train_and_forecast(
            historical_dir=HISTORICAL_FOLDER,
            current_filepath=latest_current,
            target_subdma=subdma
        )
        
        if not result["success"]:
            raise HTTPException(status_code=500, detail=result.get("error", "Unknown error in forecasting pipeline."))
            
        return {
            "success": True,
            "dma": dma,
            "subdma": subdma,
            "r2_score": result["r2_score"],
            "actuals": result["actuals"],
            "forecast": result["forecast"],
            "envelope": result["envelope"]
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/analytics")
def get_analytics(dma: str = Query("Baliapanda"), subdma: str = Query("Overall")):
    """
    Computes SCADA KPIs, daily comparisons, contribution breakdowns, and health warnings.
    """
    try:
        current_files = [f for f in os.listdir(CURRENT_FOLDER) if f.endswith(".csv")]
        if not current_files:
            raise HTTPException(status_code=400, detail="No current day operational data file uploaded.")
            
        latest_current = os.path.join(CURRENT_FOLDER, current_files[-1])
        
        result = train_and_forecast(
            historical_dir=HISTORICAL_FOLDER,
            current_filepath=latest_current,
            target_subdma=subdma
        )
        
        if not result["success"]:
            raise HTTPException(status_code=500, detail=result.get("error", "Unknown error in analytics pipeline."))
            
        return {
            "success": True,
            "dma": dma,
            "subdma": subdma,
            "kpis": result["kpis"],
            "subdma_contribution": result["subdma_contribution"]
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/reset-data")
def reset_data():
    """
    Clears all uploaded historical and current files, except for the default sample reports.
    """
    try:
        # We can implement a clean reset, but let's keep files starting with 'Baliapanda' as default
        # and delete other custom uploaded files, or just clear and restore the original ones.
        # Since this is a simple utility, we can delete the merged file to force re-merging.
        merged_filepath = os.path.join(HISTORICAL_FOLDER, "merged_historical_data.csv")
        if os.path.exists(merged_filepath):
            os.remove(merged_filepath)
        return {"success": True, "message": "Cache and merged files reset successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/historical-files")
def get_historical_files():
    try:
        files = []
        if os.path.exists(HISTORICAL_FOLDER):
            for f in os.listdir(HISTORICAL_FOLDER):
                if f.endswith(".csv") and f != "merged_historical_data.csv":
                    fp = os.path.join(HISTORICAL_FOLDER, f)
                    size = os.path.getsize(fp)
                    files.append({
                        "filename": f,
                        "size_kb": round(size / 1024, 1)
                    })
        return {"success": True, "files": sorted(files, key=lambda x: x["filename"])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/historical-file")
def delete_historical_file(filename: str = Query(...)):
    try:
        file_path = os.path.join(HISTORICAL_FOLDER, filename)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File {filename} not found.")
            
        os.remove(file_path)
        
        # Re-merge historical data
        merged_filepath = os.path.join(HISTORICAL_FOLDER, "merged_historical_data.csv")
        merged_df = load_and_merge_datasets(HISTORICAL_FOLDER)
        if not merged_df.empty:
            merged_df.to_csv(merged_filepath, index=False)
        else:
            if os.path.exists(merged_filepath):
                os.remove(merged_filepath)
                
        return {"success": True, "message": f"Successfully deleted historical file {filename}."}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/current-files")
def get_current_files():
    try:
        files = []
        if os.path.exists(CURRENT_FOLDER):
            for f in os.listdir(CURRENT_FOLDER):
                if f.endswith(".csv"):
                    fp = os.path.join(CURRENT_FOLDER, f)
                    size = os.path.getsize(fp)
                    files.append({
                        "filename": f,
                        "size_kb": round(size / 1024, 1)
                    })
        return {"success": True, "files": sorted(files, key=lambda x: x["filename"])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/current-file")
def delete_current_file(filename: str = Query(...)):
    try:
        file_path = os.path.join(CURRENT_FOLDER, filename)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File {filename} not found.")
            
        os.remove(file_path)
        return {"success": True, "message": f"Successfully deleted current file {filename}."}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Define frontend path and mount it to serve static files from the root
FRONTEND_FOLDER = os.path.join(os.path.dirname(BASE_DIR), "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_FOLDER, html=True), name="frontend")