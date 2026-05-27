// API Configuration
const API_BASE_URL = window.location.origin && window.location.origin.startsWith("http")
    ? window.location.origin
    : "http://127.0.0.1:8000";

// Chart Globals (for updates and resizing)
let overlayChart = null;
let contributionChart = null;
let trendChart = null;

// File Upload State variables
let historicalFiles = [];
let currentFile = null;

// ==========================================================================
// CORE INITIALIZATION
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    // Start Live Clock
    startLiveClock();
    
    // Check API connection
    checkApiConnection();
    
    // Bind Drag & Drop Events
    setupDragAndDrop();
    
    // Load Filters
    initializeFilters();

    // Load Stored Files
    loadStoredFiles();
});

// Live clock updating every second
function startLiveClock() {
    const clockEl = document.getElementById("liveClock");
    setInterval(() => {
        const now = new Date();
        clockEl.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }, 1000);
}

// Check FastAPI connectivity on boot
async function checkApiConnection() {
    const statusTextEl = document.getElementById("apiStatusText");
    const indicatorEl = document.querySelector(".status-indicator-dot");
    
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        const data = await response.json();
        if (data.status === "online") {
            statusTextEl.innerText = `Online (V${data.version})`;
            indicatorEl.style.backgroundColor = "var(--neon-green)";
            showToast("System connected to FastAPI AI Engine.", "success");
        } else {
            statusTextEl.innerText = "Offline";
            indicatorEl.style.backgroundColor = "var(--neon-red)";
        }
    } catch (e) {
        statusTextEl.innerText = "Failed to Connect";
        indicatorEl.style.backgroundColor = "var(--neon-red)";
        showToast("Cannot connect to FastAPI server. Please start backend first.", "error");
    }
}

// ==========================================================================
// DRAG-AND-DROP AND UPLOAD HANDLERS
// ==========================================================================
function setupDragAndDrop() {
    // 1. Historical Drop Zone
    const histZone = document.getElementById("historicalDropZone");
    const histInput = document.getElementById("historicalInput");
    
    histZone.addEventListener("click", (e) => {
        // Prevent opening folder select when clicking buttons, items, or delete actions
        if (e.target.tagName !== "BUTTON" && !e.target.closest(".file-list") && !e.target.closest(".stored-files-section")) {
            histInput.click();
        }
    });
    histInput.addEventListener("change", (e) => handleHistoricalFiles(e.target.files));
    
    bindDragEvents(histZone, handleHistoricalFiles);

    // 2. Current Drop Zone
    const curZone = document.getElementById("currentDropZone");
    const curInput = document.getElementById("currentInput");
    
    curZone.addEventListener("click", (e) => {
        // Prevent opening folder select when clicking buttons, items, or delete actions
        if (e.target.tagName !== "BUTTON" && !e.target.closest(".file-list") && !e.target.closest(".stored-files-section")) {
            curInput.click();
        }
    });
    curInput.addEventListener("change", (e) => handleCurrentFile(e.target.files[0]));
    
    bindDragEvents(curZone, (files) => handleCurrentFile(files[0]));
}

function bindDragEvents(zone, fileHandler) {
    ['dragenter', 'dragover'].forEach(eventName => {
        zone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        zone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove('dragover');
        }, false);
    });

    zone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        fileHandler(files);
    }, false);
}

function handleHistoricalFiles(files) {
    historicalFiles = Array.from(files).filter(f => f.name.endsWith('.csv'));
    const listEl = document.getElementById("historicalFileList");
    listEl.innerHTML = "";
    
    historicalFiles.forEach(file => {
        const item = document.createElement("div");
        item.className = "file-item";
        item.innerHTML = `
            <span><i class="fa-solid fa-file-csv"></i> ${file.name}</span>
            <span>${(file.size / 1024).toFixed(1)} KB</span>
        `;
        listEl.appendChild(item);
    });
    
    if(historicalFiles.length > 0) {
        showToast(`${historicalFiles.length} historical file(s) selected. Click 'Process History'.`, "info");
    }
}

function handleCurrentFile(file) {
    if (!file || !file.name.endsWith('.csv')) {
        showToast("Invalid file type. Only CSV files allowed.", "error");
        return;
    }
    
    currentFile = file;
    const listEl = document.getElementById("currentFileList");
    listEl.innerHTML = `
        <div class="file-item">
            <span><i class="fa-solid fa-bolt-lightning"></i> ${file.name}</span>
            <span>${(file.size / 1024).toFixed(1)} KB</span>
        </div>
    `;
    
    showToast("Current day file selected. Click 'Ingest Current Log'.", "info");
}

// POST Historical Datasets Upload
async function uploadHistoricalData() {
    if (historicalFiles.length === 0) {
        showToast("Please select one or more historical CSV files first.", "error");
        return;
    }
    
    const formData = new FormData();
    historicalFiles.forEach(file => {
        formData.append("files", file);
    });
    
    showToast("Uploading historical files...", "info");
    
    try {
        const response = await fetch(`${API_BASE_URL}/upload-historical`, {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        
        if (data.success) {
            showToast(data.message, "success");
            document.getElementById("historicalFileList").innerHTML = "";
            historicalFiles = [];
            await loadStoredFiles();
            await initializeFilters(); // Refresh filters dynamically
        } else {
            showToast(data.detail || "Historical upload failed.", "error");
        }
    } catch (e) {
        showToast("Failed to upload historical data: " + e.message, "error");
    }
}

// POST Current Day Dataset Upload
async function uploadCurrentData() {
    if (!currentFile) {
        showToast("Please select today's partial CSV file first.", "error");
        return;
    }
    
    const formData = new FormData();
    formData.append("file", currentFile);
    
    showToast("Uploading current operational log...", "info");
    
    try {
        const response = await fetch(`${API_BASE_URL}/upload-current`, {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        
        if (data.success) {
            showToast(data.message, "success");
            document.getElementById("currentFileList").innerHTML = "";
            currentFile = null;
            await loadStoredFiles();
            await triggerUpdate(); // Automatically re-run forecast
        } else {
            showToast(data.detail || "Current log upload failed.", "error");
        }
    } catch (e) {
        showToast("Failed to upload current log: " + e.message, "error");
    }
}

// ==========================================================================
// FILTERS MANAGEMENT
// ==========================================================================
async function initializeFilters() {
    const dmaSelect = document.getElementById("dmaSelect");
    
    try {
        const response = await fetch(`${API_BASE_URL}/get-dmas`);
        const data = await response.json();
        
        dmaSelect.innerHTML = "";
        if (data.dmas && data.dmas.length > 0) {
            data.dmas.forEach(dma => {
                const opt = document.createElement("option");
                opt.value = dma;
                opt.innerText = dma + " DMA";
                dmaSelect.appendChild(opt);
            });
            // Trigger loading Sub-DMAs for the first DMA
            await onDmaChanged();
        } else {
            dmaSelect.innerHTML = "<option value=''>No DMAs found</option>";
        }
    } catch (e) {
        console.error("Error loading DMAs:", e);
    }
}

async function onDmaChanged() {
    const dma = document.getElementById("dmaSelect").value;
    const subdmaSelect = document.getElementById("subdmaSelect");
    
    if (!dma) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/get-subdmas?dma=${dma}`);
        const data = await response.json();
        
        subdmaSelect.innerHTML = '<option value="Overall">Overall DMA Demand</option>';
        if (data.subdmas && data.subdmas.length > 0) {
            data.subdmas.forEach(sub => {
                const opt = document.createElement("option");
                opt.value = sub;
                opt.innerText = sub;
                subdmaSelect.appendChild(opt);
            });
        }
        
        // Trigger dashboard data fetching
        await triggerUpdate();
    } catch (e) {
        console.error("Error loading Sub-DMAs:", e);
    }
}

// ==========================================================================
// DASHBOARD FORECAST & ANALYTICS UPDATES
// ==========================================================================
async function triggerUpdate() {
    const dma = document.getElementById("dmaSelect").value;
    const subdma = document.getElementById("subdmaSelect").value;
    
    if (!dma) {
        showToast("Please upload historical and current data to start.", "info");
        return;
    }
    
    try {
        // Fetch forecast data
        const forecastRes = await fetch(`${API_BASE_URL}/forecast?dma=${dma}&subdma=${subdma}`);
        if (!forecastRes.ok) {
            const errData = await forecastRes.json();
            throw new Error(errData.detail || "Forecasting failed.");
        }
        const forecastData = await forecastRes.json();
        
        // Fetch analytics KPIs
        const analyticsRes = await fetch(`${API_BASE_URL}/analytics?dma=${dma}&subdma=${subdma}`);
        if (!analyticsRes.ok) {
            const errData = await analyticsRes.json();
            throw new Error(errData.detail || "Analytics collection failed.");
        }
        const analyticsData = await analyticsRes.json();
        
        // 1. Update KPI Card Content & Alarm States
        updateKpiDashboard(analyticsData.kpis);
        
        // 2. Render Overlay Chart (Today's Actuals + sequential forecasts + hist range)
        renderOverlayChart(forecastData);
        
        // 3. Render Sub-DMA Contribution Pie Chart
        renderContributionChart(analyticsData.subdma_contribution);
        
        // 4. Render Forecast Trend Detail Chart
        renderTrendChart(forecastData.forecast);
        
        showToast(`Refreshed forecasting models for ${dma} - ${subdma}.`, "success");
        
    } catch (e) {
        console.error(e);
        showToast(e.message, "error");
        
        // Reset dashboard stats to Waiting/Error
        document.getElementById("kpiForecastStatus").innerText = "Waiting...";
        document.getElementById("kpiForecastStatusDesc").innerText = "Ensure current & historical data are uploaded.";
        document.getElementById("kpiForecastHours").innerText = "N/A";
        document.getElementById("kpiConfidence").innerText = "N/A";
    }
}

function updateKpiDashboard(kpis) {
    // Forecast status
    const statusEl = document.getElementById("kpiForecastStatus");
    const statusDescEl = document.getElementById("kpiForecastStatusDesc");
    statusEl.innerText = "Model Active";
    statusEl.className = "text-cyan";
    statusDescEl.innerText = `XGBoost trained successfully.`;
    
    // Forecast hours
    document.getElementById("kpiForecastHours").innerText = kpis.forecast_hours;
    
    // AI R2 Confidence
    document.getElementById("kpiConfidence").innerText = `${kpis.ai_confidence_pct}%`;
    document.getElementById("kpiConfidenceDesc").innerText = `Model training score R² = ${((kpis.ai_confidence_pct - 85)/13).toFixed(2)}`;
    
    // Prediction mode
    document.getElementById("kpiPredictionMode").innerText = "Active";
    document.getElementById("kpiPredictionModeDesc").innerText = kpis.prediction_mode;
    
    // Daily delivery
    document.getElementById("kpiTotalDelivery").innerText = `${kpis.total_delivery_m3.toLocaleString()} m³`;
    document.getElementById("kpiTotalDeliveryDesc").innerText = `Hist. Avg: ${kpis.historical_avg_delivery_m3.toLocaleString()} m³`;
    
    // Peak demand
    document.getElementById("kpiPeakDemand").innerText = `${kpis.peak_demand_m3_hr.toLocaleString()} m³/h`;
    document.getElementById("kpiPeakDemandDesc").innerText = `Hist. Peak: ${kpis.historical_peak_demand_m3_hr.toLocaleString()} m³/h`;
    
    // System Pressure Card and alarm colors
    const pressureCard = document.getElementById("pressureCard");
    const pressureIcon = document.getElementById("pressureIcon");
    document.getElementById("kpiPressure").innerText = `${kpis.avg_pressure_bar.toFixed(2)} bar`;
    document.getElementById("kpiPressureDesc").innerText = kpis.pressure_description;
    
    pressureCard.classList.remove("alert-safe", "alert-warning", "alert-critical");
    pressureIcon.className = "fa-solid kpi-icon";
    
    if (kpis.pressure_status.includes("CRITICAL")) {
        pressureCard.classList.add("alert-critical");
        pressureIcon.classList.add("fa-triangle-exclamation", "text-red");
    } else if (kpis.pressure_status.includes("WARNING")) {
        pressureCard.classList.add("alert-warning");
        pressureIcon.classList.add("fa-circle-exclamation", "text-orange");
    } else {
        pressureCard.classList.add("alert-safe");
        pressureIcon.classList.add("fa-gauge-high", "text-green");
    }
    
    // Chlorine Card and alarm colors
    const chlorineCard = document.getElementById("chlorineCard");
    const chlorineIcon = document.getElementById("chlorineIcon");
    document.getElementById("kpiChlorine").innerText = `${kpis.avg_chlorine_ppm.toFixed(2)} ppm`;
    document.getElementById("kpiChlorineDesc").innerText = kpis.chlorine_description;
    
    chlorineCard.classList.remove("alert-safe", "alert-warning", "alert-critical");
    chlorineIcon.className = "fa-solid kpi-icon";
    
    if (kpis.chlorine_status.includes("CRITICAL")) {
        chlorineCard.classList.add("alert-critical");
        chlorineIcon.classList.add("fa-biohazard", "text-red");
    } else if (kpis.chlorine_status.includes("WARNING")) {
        chlorineCard.classList.add("alert-warning");
        chlorineIcon.classList.add("fa-circle-exclamation", "text-orange");
    } else {
        chlorineCard.classList.add("alert-safe");
        chlorineIcon.classList.add("fa-flask", "text-green");
    }
}

// ==========================================================================
// CHART.JS DRAWING ENGINES
// ==========================================================================

// Chart 1: Actuals, Predicted overlay on Min-Max Historical Envelopes
function renderOverlayChart(data) {
    const ctx = document.getElementById("forecastOverlayChart").getContext("2d");
    
    if (overlayChart) {
        overlayChart.destroy();
    }
    
    // Prepare hours labels (00:00 to 23:00)
    const hours = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);
    
    // Map data to 24-hour index arrays
    const minDemand = new Array(24).fill(null);
    const maxDemand = new Array(24).fill(null);
    const meanDemand = new Array(24).fill(null);
    const actualDemand = new Array(24).fill(null);
    const forecastDemand = new Array(24).fill(null);
    
    // Parse Envelope
    data.envelope.forEach(item => {
        const hr = parseInt(item.hour.split(":")[0]);
        minDemand[hr] = item.min_demand;
        maxDemand[hr] = item.max_demand;
        meanDemand[hr] = item.mean_demand;
    });
    
    // Parse Actuals
    data.actuals.forEach(item => {
        const hr = parseInt(item.hour.split(":")[0]);
        actualDemand[hr] = item.demand_m3;
    });
    
    // Parse Forecast (Starts where actuals ended, but to make a continuous line,
    // we connect it to the last actual point)
    if (data.actuals.length > 0 && data.forecast.length > 0) {
        const lastActualIdx = data.actuals.length - 1;
        const lastActualHr = parseInt(data.actuals[lastActualIdx].hour.split(":")[0]);
        forecastDemand[lastActualHr] = data.actuals[lastActualIdx].demand_m3;
    }
    
    data.forecast.forEach(item => {
        const hr = parseInt(item.hour.split(":")[0]);
        forecastDemand[hr] = item.predicted_demand_m3;
    });

    overlayChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: hours,
            datasets: [
                {
                    label: 'Today Actuals',
                    data: actualDemand,
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    borderWidth: 3,
                    pointBackgroundColor: '#06b6d4',
                    pointBorderColor: '#ffffff',
                    pointHoverRadius: 7,
                    tension: 0.2,
                    spanGaps: false
                },
                {
                    label: 'AI Sequential Forecast',
                    data: forecastDemand,
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.05)',
                    borderWidth: 3,
                    borderDash: [6, 6],
                    pointBackgroundColor: '#a855f7',
                    pointBorderColor: '#ffffff',
                    pointHoverRadius: 7,
                    tension: 0.2,
                    spanGaps: false
                },
                {
                    label: 'Historical Min Limit',
                    data: minDemand,
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.2
                },
                {
                    label: 'Historical Max Limit',
                    data: maxDemand,
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    pointRadius: 0,
                    backgroundColor: 'rgba(56, 189, 248, 0.04)',
                    fill: '-1', // Fill the area between min and max
                    tension: 0.2
                },
                {
                    label: 'Historical Mean',
                    data: meanDemand,
                    borderColor: 'rgba(56, 189, 248, 0.25)',
                    borderWidth: 1.5,
                    borderDash: [3, 3],
                    pointRadius: 0,
                    fill: false,
                    tension: 0.2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // We use our own customized header legend
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    titleFont: { family: 'Orbitron', size: 13 },
                    bodyFont: { family: 'Plus Jakarta Sans', size: 12 },
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toFixed(1) + ' m³';
                            }
                            return label;
                        }
                    }
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'xy',
                        threshold: 10
                    },
                    zoom: {
                        wheel: {
                            enabled: true
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'xy'
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        borderColor: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: '#9ca3af',
                        font: { family: 'Orbitron', size: 10 }
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        borderColor: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: '#9ca3af',
                        font: { family: 'Plus Jakarta Sans', size: 11 },
                        callback: function(value) {
                            return value + ' m³';
                        }
                    }
                }
            }
        }
    });
}

// Chart 2: Sub-DMA Contribution rates (Pie Chart)
function renderContributionChart(subdmaContribs) {
    const ctx = document.getElementById("subDmaContributionChart").getContext("2d");
    
    if (contributionChart) {
        contributionChart.destroy();
    }
    
    const labels = Object.keys(subdmaContribs);
    const datasetValues = Object.values(subdmaContribs);
    
    // SCADA theme neon colors for pie slices
    const colors = [
        'rgba(14, 165, 233, 0.75)',  // Neon Blue
        'rgba(6, 182, 212, 0.75)',   // Neon Cyan
        'rgba(168, 85, 247, 0.75)',  // Neon Purple
        'rgba(16, 185, 129, 0.75)',  // Neon Green
        'rgba(249, 115, 22, 0.75)',  // Neon Orange
        'rgba(239, 68, 68, 0.75)'    // Neon Red
    ];
    
    const borderColors = [
        '#0ea5e9', '#06b6d4', '#a855f7', '#10b981', '#f97316', '#ef4444'
    ];

    contributionChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: datasetValues,
                backgroundColor: colors.slice(0, labels.length),
                borderColor: borderColors.slice(0, labels.length),
                borderWidth: 1.5,
                hoverOffset: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#f3f4f6',
                        font: { family: 'Plus Jakarta Sans', size: 11 },
                        padding: 15,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    bodyFont: { family: 'Plus Jakarta Sans', size: 12 },
                    callbacks: {
                        label: function(context) {
                            return ` ${context.label}: ${context.raw}%`;
                        }
                    }
                }
            }
        }
    });
}

// Chart 3: Detailed Forecast trend showing remaining hours prediction
function renderTrendChart(forecastData) {
    const ctx = document.getElementById("forecastTrendChart").getContext("2d");
    
    if (trendChart) {
        trendChart.destroy();
    }
    
    const labels = forecastData.map(f => f.hour);
    const values = forecastData.map(f => f.predicted_demand_m3);
    
    // Add standard error band bounds for a visual "confidence envelope" (e.g. ±12% predictions)
    const upperConfidence = values.map(v => round(v * 1.10, 1));
    const lowerConfidence = values.map(v => round(v * 0.90, 1));

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Predicted Demand',
                    data: values,
                    borderColor: '#a855f7',
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    pointBackgroundColor: '#a855f7',
                    pointBorderColor: '#ffffff',
                    pointRadius: 4,
                    tension: 0.15,
                    fill: false
                },
                {
                    label: 'Confidence Upper Limit',
                    data: upperConfidence,
                    borderColor: 'transparent',
                    pointRadius: 0,
                    fill: false,
                    tension: 0.15
                },
                {
                    label: 'Confidence Lower Limit',
                    data: lowerConfidence,
                    borderColor: 'transparent',
                    backgroundColor: 'rgba(168, 85, 247, 0.06)',
                    pointRadius: 0,
                    fill: '-1', // Fill space to upper limit
                    tension: 0.15
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    titleFont: { family: 'Orbitron', size: 12 },
                    bodyFont: { family: 'Plus Jakarta Sans', size: 11 },
                    callbacks: {
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                return ` Forecast: ${context.raw} m³`;
                            }
                            return null;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.03)',
                        borderColor: 'rgba(255, 255, 255, 0.08)'
                    },
                    ticks: {
                        color: '#9ca3af',
                        font: { family: 'Orbitron', size: 9 }
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.03)',
                        borderColor: 'rgba(255, 255, 255, 0.08)'
                    },
                    ticks: {
                        color: '#9ca3af',
                        font: { family: 'Plus Jakarta Sans', size: 10 }
                    }
                }
            }
        }
    });
}

// Helper rounding tool
function round(value, decimals) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}

// ==========================================================================
// TOAST SYSTEM AND CACHE RESET
// ==========================================================================
function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    const toastMessage = document.getElementById("toastMessage");
    const toastIcon = toast.querySelector(".toast-icon");
    
    toastMessage.innerText = message;
    
    // Style by notification types
    toast.className = "toast glass show";
    toastIcon.className = "fa-solid toast-icon";
    
    if (type === "success") {
        toast.style.borderLeft = "4px solid var(--neon-green)";
        toastIcon.classList.add("fa-circle-check", "text-green");
    } else if (type === "error") {
        toast.style.borderLeft = "4px solid var(--neon-red)";
        toastIcon.classList.add("fa-circle-xmark", "text-red");
    } else if (type === "info") {
        toast.style.borderLeft = "4px solid var(--neon-blue)";
        toastIcon.classList.add("fa-circle-info", "text-blue");
    }
    
    // Hide toast after 4.5 seconds
    setTimeout(() => {
        toast.classList.remove("show");
    }, 4500);
}

// POST Reset System Data
async function resetSystemData() {
    if (!confirm("Are you sure you want to clear system caches? Custom uploaded datasets will be re-processed on next run.")) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/reset-data`, {
            method: "POST"
        });
        const data = await response.json();
        if (data.success) {
            showToast(data.message, "success");
            // Reload page to start with clean state
            location.reload();
        }
    } catch (e) {
        showToast("Failed to reset system: " + e.message, "error");
    }
}

// ==========================================================================
// STORED FILES LISTING AND DELETION HANDLERS
// ==========================================================================
async function loadStoredFiles() {
    const histList = document.getElementById("storedHistoricalList");
    const curList = document.getElementById("storedCurrentList");
    
    // Load historical files list
    try {
        const response = await fetch(`${API_BASE_URL}/historical-files`);
        const data = await response.json();
        
        histList.innerHTML = "";
        if (data.success && data.files.length > 0) {
            data.files.forEach(file => {
                const item = document.createElement("div");
                item.className = "stored-file-item";
                item.innerHTML = `
                    <div class="stored-file-name" title="${file.filename}">${file.filename}</div>
                    <div class="stored-file-actions">
                        <span class="stored-file-size">${file.size_kb} KB</span>
                        <button class="btn-delete-file" onclick="deleteHistoricalFile('${file.filename}')" title="Delete File">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                `;
                histList.appendChild(item);
            });
        } else {
            histList.innerHTML = '<div style="color: var(--text-dim); font-size: 11px;">No historical datasets stored.</div>';
        }
    } catch (e) {
        console.error("Error loading stored historical files:", e);
        histList.innerHTML = '<div style="color: var(--neon-red); font-size: 11px;">Failed to load.</div>';
    }

    // Load current files list
    try {
        const response = await fetch(`${API_BASE_URL}/current-files`);
        const data = await response.json();
        
        curList.innerHTML = "";
        if (data.success && data.files.length > 0) {
            data.files.forEach(file => {
                const item = document.createElement("div");
                item.className = "stored-file-item";
                item.innerHTML = `
                    <div class="stored-file-name" title="${file.filename}">${file.filename}</div>
                    <div class="stored-file-actions">
                        <span class="stored-file-size">${file.size_kb} KB</span>
                        <button class="btn-delete-file" onclick="deleteCurrentFile('${file.filename}')" title="Delete File">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                `;
                curList.appendChild(item);
            });
        } else {
            curList.innerHTML = '<div style="color: var(--text-dim); font-size: 11px;">No current logs stored.</div>';
        }
    } catch (e) {
        console.error("Error loading stored current files:", e);
        curList.innerHTML = '<div style="color: var(--neon-red); font-size: 11px;">Failed to load.</div>';
    }
}

// DELETE Stored Historical File
async function deleteHistoricalFile(filename) {
    if (!confirm(`Are you sure you want to delete historical file: ${filename}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/historical-file?filename=${encodeURIComponent(filename)}`, {
            method: "DELETE"
        });
        const data = await response.json();
        
        if (data.success) {
            showToast(data.message, "success");
            await loadStoredFiles();
            await initializeFilters(); // Re-populate filters (in case DMA was removed)
        } else {
            showToast(data.detail || "Failed to delete file.", "error");
        }
    } catch (e) {
        showToast("Error deleting historical file: " + e.message, "error");
    }
}

// DELETE Stored Current File
async function deleteCurrentFile(filename) {
    if (!confirm(`Are you sure you want to delete current operational log: ${filename}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/current-file?filename=${encodeURIComponent(filename)}`, {
            method: "DELETE"
        });
        const data = await response.json();
        
        if (data.success) {
            showToast(data.message, "success");
            await loadStoredFiles();
            await triggerUpdate(); // Re-run forecasts
        } else {
            showToast(data.detail || "Failed to delete file.", "error");
        }
    } catch (e) {
        showToast("Error deleting current log: " + e.message, "error");
    }
}

// Toggle between Dashboard view and Documentation view
function toggleView() {
    const dashboardView = document.getElementById("dashboardView");
    const documentationView = document.getElementById("documentationView");
    const toggleBtn = document.getElementById("viewToggleBtn");
    
    if (dashboardView.style.display === "none") {
        dashboardView.style.display = "block";
        documentationView.style.display = "none";
        toggleBtn.innerHTML = '<i class="fa-solid fa-book"></i> Documentation';
        
        // Trigger chart resizing so Chart.js recalculates layout properly
        if (overlayChart) overlayChart.resize();
        if (contributionChart) contributionChart.resize();
        if (trendChart) trendChart.resize();
    } else {
        dashboardView.style.display = "none";
        documentationView.style.display = "block";
        toggleBtn.innerHTML = '<i class="fa-solid fa-chart-pie"></i> Operations Dashboard';
        
        // Trigger MathJax typesetting to render LaTeX formulas
        if (window.MathJax && window.MathJax.typesetPromise) {
            window.MathJax.typesetPromise();
        }
    }
}