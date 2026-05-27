import os
import re
import pandas as pd
import numpy as np

def extract_dma_name(filename: str) -> str:
    """
    Extracts the DMA name from the filename.
    Example: 'Baliapanda - Hourly_Report - 16_05_2026.csv' -> 'Baliapanda'
    """
    basename = os.path.basename(filename)
    if " - " in basename:
        return basename.split(" - ")[0].strip()
    return "Baliapanda"

def detect_columns(df: pd.DataFrame):
    """
    Dynamically identifies columns for the main ESR (DMA) and the Sub-DMAs.
    Returns:
        esr_cols: dict containing level, flow, pressure, totalizer, delivery columns.
        subdma_mapping: dict mapping subdma_name to its flow, pressure, totalizer, and chlorine columns.
    """
    cols = df.columns.tolist()
    
    # 1. Main ESR detection
    esr_cols = {
        "level": next((c for c in cols if "ESR Level" in c), None),
        "flow": next((c for c in cols if "ESR Flow" in c), None),
        "pressure": next((c for c in cols if "ESR Pressure" in c), None),
        "totalizer": next((c for c in cols if "ESR Totalizer" in c), None),
        "delivery": next((c for c in cols if "ESR Total Delivery" in c), None)
    }
    
    # If delivery is missing, fall back to ESR Flow
    if not esr_cols["delivery"]:
        esr_cols["delivery"] = esr_cols["flow"]

    # 2. Sub-DMA detection
    # Sub-DMAs are identified from columns matching ".* Flow 1 (m³/hr)" or ".* Flow" that are not ESR
    subdma_mapping = {}
    
    for col in cols:
        # Match pattern: <SubDMA Name> Flow ...
        match = re.match(r"^(.*?)\s+Flow\s*(?:1)?\s*(?:\(.*\))?$", col, re.IGNORECASE)
        if match:
            subdma_name = match.group(1).strip()
            if subdma_name.upper() == "ESR":
                continue
                
            # Find related columns for this Sub-DMA
            flow_col = col
            pressure_col = next((c for c in cols if c.startswith(subdma_name) and "Pressure" in c), None)
            totalizer_col = next((c for c in cols if c.startswith(subdma_name) and "Totalizer" in c), None)
            chlorine_col = next((c for c in cols if c.startswith(subdma_name) and "Chlorine" in c), None)
            
            subdma_mapping[subdma_name] = {
                "flow": flow_col,
                "pressure": pressure_col,
                "totalizer": totalizer_col,
                "chlorine": chlorine_col
            }
            
    return esr_cols, subdma_mapping

def load_and_merge_datasets(directory: str) -> pd.DataFrame:
    """
    Loads all CSV files from a directory, parses datetimes, merges them,
    and returns a chronologically sorted DataFrame with duplicate datetimes removed.
    """
    if not os.path.exists(directory):
        return pd.DataFrame()
        
    csv_files = [f for f in os.listdir(directory) if f.endswith(".csv") and f != "merged_historical_data.csv"]
    if not csv_files:
        return pd.DataFrame()
        
    dfs = []
    for file in csv_files:
        path = os.path.join(directory, file)
        try:
            df = pd.read_csv(path)
            # Ensure Date Time is present
            if "Date Time" in df.columns:
                df["Date Time"] = pd.to_datetime(df["Date Time"])
                dfs.append(df)
        except Exception as e:
            print(f"Error reading file {file}: {e}")
            
    if not dfs:
        return pd.DataFrame()
        
    merged_df = pd.concat(dfs, ignore_index=True)
    merged_df = merged_df.drop_duplicates(subset=["Date Time"])
    merged_df = merged_df.sort_values(by="Date Time").reset_index(drop=True)
    return merged_df

def engineer_features(df: pd.DataFrame, target_col: str, prefix: str = "") -> pd.DataFrame:
    """
    Generates forecasting features: hour, weekday, lags, rolling averages, pressure, level.
    Modifies and returns a copy of the dataframe.
    """
    df = df.copy()
    
    # Ensure Date Time is parsed
    if not pd.api.types.is_datetime64_any_dtype(df["Date Time"]):
        df["Date Time"] = pd.to_datetime(df["Date Time"])
        
    # Time features
    df["hour"] = df["Date Time"].dt.hour
    df["weekday"] = df["Date Time"].dt.weekday
    
    # Target value lag features (using target_col)
    df["lag_1"] = df[target_col].shift(1)
    df["lag_2"] = df[target_col].shift(2)
    df["lag_24"] = df[target_col].shift(24)
    
    # Rolling averages (last 3 hours, closed='left' to prevent leakage of current value)
    df["rolling_mean_3"] = df[target_col].shift(1).rolling(window=3, min_periods=1).mean()
    df["rolling_std_3"] = df[target_col].shift(1).rolling(window=3, min_periods=1).std().fillna(0)
    
    return df
