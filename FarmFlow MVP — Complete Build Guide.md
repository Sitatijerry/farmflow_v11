# FarmFlow MVP — Complete Build Guide

## Overview

**FarmFlow** is a web-based Agricultural Decision Support System for **Farm to Feed Kenya** (45 smallholder farms, Kiambu/Murang'a/Nyeri counties). The system ingests climate + soil data → runs rules + ML → pushes actionable recommendations to farm managers via a mobile-first FarmWorker dashboard and a desktop FarmManager portal.

This guide integrates:
- **FarmWorker Mobile Dashboard** (React 19 + Vite + Tailwind CSS)
- **FarmManager Desktop Portal** (Next.js 14 + Recharts)
- **Unified Backend** (FastAPI + Python scripts)
- **Database** (Supabase PostgreSQL + RLS)

---

## Tech Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| **Backend API** | FastAPI (Python) | REST API for recommendations, simulations, classifications |
| **Crop Simulation** | AquaCrop-OSPy v0.6 | Water stress index (WSI) + ET0 calculations |
| **ML Models** | XGBoost + scikit-learn | Crop recommendations (3 models: kale, tomatoes, maize) |
| **Database** | Supabase (PostgreSQL + RLS) | Farms, fields, climate records, recommendations, audit logs |
| **Data Ingestion** | Plain Python scripts | Cron/manual execution (replaces Airflow) |
| **Frontend - Worker** | React 19 + Vite + Tailwind CSS 4 | Mobile-first FarmWorker dashboard |
| **Frontend - Manager** | Next.js 14 + Recharts + Leaflet.js | Desktop FarmManager portal |
| **Authentication** | Supabase Auth + JWT | Role-based access (manager/worker/admin) |
| **Deployment** | Vercel (frontend) + Railway (backend) | Scalable, containerized |

---

## Database Schema (Supabase PostgreSQL)

### Tables

```sql
-- Core farm structure
CREATE TABLE farms (
  farm_id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  manager_id UUID REFERENCES auth.users(id),
  manager_phone VARCHAR(20),
  county VARCHAR(100),
  geojson JSONB,  -- GeoJSON polygon of farm boundary
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE fields (
  field_id UUID PRIMARY KEY,
  farm_id UUID REFERENCES farms(farm_id),
  field_name VARCHAR(255),
  soil_class VARCHAR(50),  -- e.g., "clay loam", "sandy"
  crop_type VARCHAR(100),  -- e.g., "French beans", "kale", "tomatoes"
  crop_start_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Climate data ingestion
CREATE TABLE climate_records (
  id UUID PRIMARY KEY,
  field_id UUID REFERENCES fields(field_id),
  timestamp TIMESTAMP,
  temp_anomaly FLOAT,  -- deviation from normal (°C)
  rainfall_mm FLOAT,
  humidity FLOAT,
  source VARCHAR(50),  -- "Open-Meteo" or "KilimoStat"
  data_quality VARCHAR(20) DEFAULT 'NOMINAL',  -- "NOMINAL" or "DEGRADED"
  created_at TIMESTAMP DEFAULT NOW()
);

-- Simulation outputs
CREATE TABLE simulation_results (
  id UUID PRIMARY KEY,
  field_id UUID REFERENCES fields(field_id),
  wsi FLOAT,  -- Water Stress Index (0-1)
  et0 FLOAT,  -- Reference evapotranspiration
  yield_t_ha FLOAT,  -- Projected yield (tonnes/hectare)
  data_quality VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Rule engine outputs
CREATE TABLE recommendations (
  id UUID PRIMARY KEY,
  field_id UUID REFERENCES fields(field_id),
  rule_id VARCHAR(50),  -- e.g., "R-01", "R-02"
  urgency VARCHAR(20),  -- "LOW", "MEDIUM", "HIGH", "CRITICAL"
  rationale TEXT,  -- ≤240 chars, human-readable action
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

-- Audit log (INSERT-only, for GlobalGAP compliance)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY,
  field_id UUID REFERENCES fields(field_id),
  event_type VARCHAR(100),  -- "rule_evaluated", "recommendation_created"
  rule_id VARCHAR(50),
  result JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Worker activity tracking (for FarmWorker dashboard)
CREATE TABLE worker_activities (
  id UUID PRIMARY KEY,
  worker_id UUID REFERENCES auth.users(id),
  field_id UUID REFERENCES fields(field_id),
  activity_type VARCHAR(100),  -- "irrigation", "fertilization", "harvest"
  hours_logged FLOAT,
  notes TEXT,
  location POINT,  -- GPS coordinates
  created_at TIMESTAMP DEFAULT NOW()
);

-- Activity photos
CREATE TABLE activity_photos (
  id UUID PRIMARY KEY,
  activity_id UUID REFERENCES worker_activities(id),
  photo_url VARCHAR(500),
  caption TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Task assignments
CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  field_id UUID REFERENCES fields(field_id),
  assigned_to UUID REFERENCES auth.users(id),
  title VARCHAR(255),
  description TEXT,
  status VARCHAR(50) DEFAULT 'pending',  -- "pending", "in-progress", "done"
  due_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  title VARCHAR(255),
  content TEXT,
  notification_type VARCHAR(50),  -- "task_assigned", "deadline_approaching", "recommendation"
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Row-Level Security (RLS) Policies

```sql
-- Farm managers see only their farms
CREATE POLICY farm_manager_access ON farms
  FOR SELECT USING (manager_id = auth.uid());

-- Workers see only their assigned fields
CREATE POLICY worker_field_access ON fields
  FOR SELECT USING (
    farm_id IN (
      SELECT farm_id FROM farms WHERE manager_id = auth.uid()
    )
  );

-- Admins see all data
CREATE POLICY admin_access ON farms
  FOR ALL USING (
    auth.jwt() ->> 'role' = 'admin'
  );
```

---

## Rule Engine — 5 Rules (`rules.json`)

All thresholds sourced from FAOSTAT. Evaluated every script run against latest `climate_records`.

```json
{
  "rules": [
    {
      "id": "R-01",
      "name": "Water Stress Management",
      "trigger": "WSI > 0.70 AND groundwater_share > 50%",
      "urgency": "HIGH",
      "action": "Suppress irrigation, switch to micro-drip",
      "rationale": "High water stress with groundwater dependency requires immediate intervention"
    },
    {
      "id": "R-02",
      "name": "Fertilization Timing",
      "trigger": "N/P_ratio > 3.5 AND rain_forecast_36h",
      "urgency": "HIGH",
      "action": "Delay fertilisation 3–5 days",
      "rationale": "Upcoming rain will leach nutrients; wait for better absorption"
    },
    {
      "id": "R-03",
      "name": "Integrated Pest Management",
      "trigger": "temp_anomaly > 2.0 AND insecticide_growth > 10%",
      "urgency": "CRITICAL",
      "action": "IPM intervention required",
      "rationale": "Temperature spike + pest pressure indicates imminent infestation"
    },
    {
      "id": "R-04",
      "name": "Harvest Timing (Standard)",
      "trigger": "temp_anomaly > 1.5 AND days_to_maturity <= 14",
      "urgency": "HIGH",
      "action": "Advance harvest 3–5 days",
      "rationale": "Heat stress near maturity reduces yield; early harvest preserves quality"
    },
    {
      "id": "R-04b",
      "name": "Harvest Timing (Critical)",
      "trigger": "temp_anomaly > 2.0 AND days_to_maturity <= 10",
      "urgency": "CRITICAL",
      "action": "Immediate field inspection",
      "rationale": "Severe heat stress imminent; inspect for damage and plan emergency harvest"
    },
    {
      "id": "R-05",
      "name": "Soil Moisture Optimization",
      "trigger": "rainfall_mm < 20 AND soil_moisture < 40%",
      "urgency": "MEDIUM",
      "action": "Increase irrigation frequency",
      "rationale": "Low rainfall and soil moisture; supplement with controlled irrigation"
    }
  ]
}
```

---

## Backend Architecture (FastAPI + Python Scripts)

### File Structure

```
farmflow-backend/
├── main.py                          # FastAPI app entry point
├── requirements.txt                 # Python dependencies
├── Dockerfile                       # Container for Railway deployment
├── .env.example                     # Environment variables template
│
├── routers/
│   ├── __init__.py
│   ├── simulate.py                  # POST /api/simulate/{field_id}
│   ├── recommend.py                 # POST /api/recommend/{field_id}
│   ├── classify.py                  # POST /api/classify/{field_id}
│   ├── tasks.py                     # Task management endpoints
│   ├── activities.py                # Worker activity logging
│   └── notifications.py             # Notification endpoints
│
├── services/
│   ├── __init__.py
│   ├── rule_engine.py               # Rule evaluation logic
│   ├── aquacrop_service.py          # AquaCrop-OSPy wrapper
│   ├── ml_classifier.py             # XGBoost inference
│   ├── supabase_client.py           # Supabase connection
│   └── weather_service.py           # Open-Meteo + KilimoStat integration
│
├── scripts/
│   ├── fetch_climate.py             # Fetch weather data
│   ├── fetch_kilimostats.py         # Fetch KilimoStat data
│   ├── run_simulation.py            # Run AquaCrop simulations
│   ├── run_rules.py                 # Evaluate rules
│   ├── run_ml.py                    # Run ML classifier
│   └── run_pipeline.py              # Orchestrate all scripts
│
├── ml_models/
│   ├── french_beans.pkl             # XGBoost model
│   ├── kale.pkl
│   ├── tomatoes.pkl
│   ├── capsicum.pkl
│   └── courgette.pkl
│
├── config/
│   ├── __init__.py
│   ├── settings.py                  # Configuration management
│   └── rules.json                   # Rule definitions
│
└── utils/
    ├── __init__.py
    ├── logger.py                    # Logging setup
    └── validators.py                # Input validation
```

### Python Dependencies

```txt
# requirements.txt
fastapi==0.104.1
uvicorn==0.24.0
python-dotenv==1.0.0
supabase==2.3.0
aquacrop==0.6.0
xgboost==2.0.0
scikit-learn==1.3.2
requests==2.31.0
pandas==2.1.3
numpy==1.26.2
pydantic==2.5.0
pydantic-settings==2.1.0
```

### Core FastAPI Application

```python
# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from routers import simulate, recommend, classify, tasks, activities, notifications
from config.settings import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("🚀 FarmFlow Backend Starting...")
    yield
    # Shutdown
    print("🛑 FarmFlow Backend Shutting Down...")

app = FastAPI(
    title="FarmFlow API",
    description="Agricultural Decision Support System",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(simulate.router, prefix="/api", tags=["Simulation"])
app.include_router(recommend.router, prefix="/api", tags=["Recommendations"])
app.include_router(classify.router, prefix="/api", tags=["Classification"])
app.include_router(tasks.router, prefix="/api", tags=["Tasks"])
app.include_router(activities.router, prefix="/api", tags=["Activities"])
app.include_router(notifications.router, prefix="/api", tags=["Notifications"])

@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "1.0.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

### Data Ingestion Pipeline

```bash
# Run daily via cron or manually
python scripts/run_pipeline.py

# Or step-by-step:
python scripts/fetch_climate.py && \
python scripts/run_simulation.py && \
python scripts/run_rules.py && \
python scripts/run_ml.py
```

---

## Frontend Architecture

### FarmWorker Mobile Dashboard (React 19 + Vite)

**Purpose:** Farm workers log activities, view assigned tasks, check schedules, and receive notifications.

**Routes:**
```
/                    → Home (Dashboard with daily summary)
/tasks               → Task List (pending, in-progress, done)
/tasks/:id           → Task Details
/fields              → Field Activities (logging with photos)
/fields/:id          → Activity Details + Photo Gallery
/schedule            → Weekly Schedule View
/profile             → Worker Profile + Work History
/notifications       → Notifications & Alerts
/login               → Login Page
```

**Key Components:**
- `BottomNavigation` - 5-tab mobile navigation
- `PhotoUploader` - Capture/upload field photos
- `PhotoGallery` - Display activity photos
- `TaskCard` - Task display with status
- `ScheduleCalendar` - Weekly view
- `NotificationBadge` - Unread count

**Design:**
- Mobile-first responsive
- Deep green (#2d5016) primary + amber (#f59e0b) accent
- Agricultural aesthetic
- Tailwind CSS 4 + shadcn/ui components

### FarmManager Desktop Portal (Next.js 14)

**Purpose:** Farm managers view recommendations, monitor field status, assign tasks, and access analytics.

**Routes:**
```
/                    → Dashboard (Overview)
/farms               → Farm Management
/farms/[farm_id]     → Farm Details + Field Map
/fields              → Field List
/recommendations     → Recommendations Feed
/workers             → Worker Management
/analytics           → Reports & Analytics
/settings            → Settings
/login               → Login Page
```

**Key Components:**
- `RecommendationCard` - Urgency badge + rationale + action
- `FieldMap` - Leaflet.js map with field polygons + alerts
- `WeatherWidget` - 72-hr Open-Meteo forecast
- `WaterUsageGauge` - Recharts gauge vs GlobalGAP threshold
- `ProductionChart` - Bar chart (forecast vs actual)
- `ComplianceTable` - Farm status table

**Design:**
- Desktop-first responsive
- Professional, data-focused
- Recharts for visualizations
- Leaflet.js for mapping

---

## Data Flow

### Core MVP Loop

```
1. Python Script (fetch_climate.py)
   ↓ Fetches weather from Open-Meteo/KilimoStat
   ↓ Inserts into climate_records table

2. Python Script (run_simulation.py)
   ↓ Runs AquaCrop-OSPy for each field
   ↓ Calculates WSI, ET0, yield
   ↓ Writes to simulation_results table

3. Python Script (run_rules.py)
   ↓ Evaluates R-01 to R-05 against latest climate_records
   ↓ Writes matching recommendations to recommendations table
   ↓ Logs to audit_log (GlobalGAP compliance)

4. Python Script (run_ml.py)
   ↓ Runs XGBoost inference
   ↓ Generates crop recommendations with confidence scores

5. Frontend - FarmManager Portal
   ↓ Reads recommendations from Supabase
   ↓ Displays RecommendationCard with urgency badge
   ↓ Shows FieldMap with alert overlays
   ↓ Displays WeatherWidget

6. Frontend - FarmWorker Dashboard
   ↓ Workers see assigned tasks
   ↓ Log field activities with photos
   ↓ Receive notifications for new tasks/deadlines
   ↓ View work schedule
```

---

## Build Order (Day 1 MVP)

### Phase 1: Database & Infrastructure
- [ ] Set up Supabase project
- [ ] Create all tables (schema.sql)
- [ ] Configure RLS policies
- [ ] Set up authentication (Supabase Auth)

### Phase 2: Backend Core
- [ ] FastAPI app skeleton (main.py)
- [ ] Supabase client integration
- [ ] Environment configuration (.env)
- [ ] Health check endpoint

### Phase 3: Data Ingestion
- [ ] `fetch_climate.py` - Open-Meteo integration
- [ ] `fetch_kilimostats.py` - KilimoStat integration
- [ ] `run_simulation.py` - AquaCrop-OSPy wrapper
- [ ] Test data pipeline end-to-end

### Phase 4: Rule Engine
- [ ] `rules.json` - Define all 5 rules with thresholds
- [ ] `services/rule_engine.py` - Rule evaluation logic
- [ ] `scripts/run_rules.py` - Orchestration script
- [ ] Test rule triggering with sample data

### Phase 5: API Endpoints
- [ ] POST `/api/recommend/{field_id}` - Get recommendations
- [ ] POST `/api/simulate/{field_id}` - Run simulation
- [ ] POST `/api/classify/{field_id}` - Get crop recommendations
- [ ] GET `/api/tasks` - List tasks
- [ ] POST `/api/activities` - Log activity
- [ ] GET `/api/notifications` - List notifications

### Phase 6: FarmWorker Frontend
- [ ] React 19 + Vite setup
- [ ] Bottom navigation (5 tabs)
- [ ] Home page (dashboard)
- [ ] Tasks page (list + status)
- [ ] Fields page (activity logging + photo upload)
- [ ] Schedule page (weekly view)
- [ ] Profile page (worker info)
- [ ] Notifications page
- [ ] Login integration (Supabase Auth)

### Phase 7: FarmManager Frontend
- [ ] Next.js 14 setup
- [ ] Dashboard page
- [ ] Recommendations feed
- [ ] FieldMap (Leaflet.js)
- [ ] WeatherWidget (72-hr forecast)
- [ ] WaterUsageGauge (Recharts)
- [ ] ProductionChart (forecast vs actual)
- [ ] ComplianceTable (farm status)
- [ ] Login integration (Supabase Auth)

### Phase 8: ML & Advanced Features
- [ ] Train/load XGBoost models
- [ ] `services/ml_classifier.py`
- [ ] `scripts/run_ml.py`
- [ ] Crop recommendation inference

### Phase 9: Deployment
- [ ] Dockerize FastAPI backend
- [ ] Deploy to Railway
- [ ] Deploy FarmWorker to Vercel
- [ ] Deploy FarmManager to Vercel
- [ ] Set up cron for data pipeline

### Phase 10: Testing & Hardening
- [ ] Unit tests (backend)
- [ ] Integration tests (API + database)
- [ ] E2E tests (frontend)
- [ ] Load testing
- [ ] Security audit

---

## Environment Variables

### Backend (.env)

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# FastAPI
ENVIRONMENT=development
DEBUG=true
SECRET_KEY=your-secret-key

# Data Sources
OPENMETEO_API_URL=https://api.open-meteo.com/v1
KILIMOSTATS_API_KEY=your-kilimostats-key

# ML Models
ML_MODELS_PATH=./ml_models

# CORS
CORS_ORIGINS=["http://localhost:3000", "http://localhost:5173", "https://farmflow.vercel.app"]
```

### FarmWorker Frontend (.env.local)

```env
VITE_API_URL=http://localhost:8000/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_APP_TITLE=FarmFlow Worker
VITE_APP_LOGO=https://your-logo-url.png
```

### FarmManager Frontend (.env.local)

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_APP_TITLE=FarmFlow Manager
NEXT_PUBLIC_APP_LOGO=https://your-logo-url.png
```

---

## Key Features

### FarmWorker Dashboard
✅ Mobile-first responsive design
✅ Task management (view, update status)
✅ Field activity logging with photo uploads
✅ Weekly schedule view
✅ Worker profile and work history
✅ Real-time notifications
✅ GPS location tagging
✅ Offline-capable (with service workers)

### FarmManager Portal
✅ Desktop-first responsive design
✅ Real-time recommendation feed
✅ Interactive field map (Leaflet.js)
✅ 72-hr weather forecast
✅ Water usage monitoring
✅ Production forecasting
✅ Farm compliance tracking
✅ Worker management
✅ Analytics & reporting

### Backend
✅ Rule-based recommendation engine
✅ AquaCrop-OSPy crop simulation
✅ XGBoost ML classification
✅ Automated data ingestion pipeline
✅ Supabase RLS for data security
✅ Audit logging (GlobalGAP compliance)
✅ RESTful API with FastAPI
✅ JWT authentication

---

## Deployment

### Backend (FastAPI + Railway)

```dockerfile
# Dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Deploy to Railway:**
```bash
railway link
railway up
```

### FarmWorker Frontend (Vercel)

```bash
cd frontend-worker
vercel deploy
```

### FarmManager Frontend (Vercel)

```bash
cd frontend-manager
vercel deploy
```

---

## Testing Strategy

### Backend
- Unit tests for rule engine
- Integration tests for API endpoints
- Data pipeline tests (mock weather APIs)
- ML model inference tests

### Frontend
- Component tests (Vitest + React Testing Library)
- E2E tests (Playwright or Cypress)
- Mobile responsiveness tests

### Integration
- Full data flow tests (weather → simulation → rules → UI)
- Authentication flow tests
- Permission & RLS tests

---

## Monitoring & Logging

### Backend
- FastAPI logging (request/response)
- Script execution logs (cron output)
- Error tracking (Sentry integration optional)
- Database query logs

### Frontend
- Console logging (development)
- Error boundary logging
- User interaction tracking (optional analytics)

### Database
- Audit log queries (GlobalGAP compliance)
- Query performance monitoring
- Backup & recovery procedures

---

## Business Rules & Constraints

1. **Recommendations written to Supabase within 30 seconds** of script run
2. **SMS fires automatically** for HIGH/CRITICAL recommendations (future: Africa's Talking API)
3. **All evaluations logged** to `audit_log` (INSERT-only, CSV exportable for GlobalGAP)
4. **Data quality flag** = `NOMINAL` or `DEGRADED` (degraded when KilimoStat unavailable)
5. **Farm managers see only their farms** (Supabase RLS); **admins see all 45**
6. **Workers see only assigned tasks/fields** (Supabase RLS)
7. **Recommendations expire after 7 days** (configurable)
8. **Activity photos stored in Supabase Storage** (with signed URLs)

---

## Success Metrics (MVP)

- ✅ All 5 rules evaluate correctly
- ✅ Recommendations appear in UI within 30 seconds of script run
- ✅ Farm managers can view field map + weather
- ✅ Workers can log activities + upload photos
- ✅ Authentication & RLS working correctly
- ✅ Data pipeline runs daily without errors
- ✅ Audit log complete for GlobalGAP compliance

---

## Next Steps (Post-MVP)

1. **SMS Integration** - Africa's Talking API for HIGH/CRITICAL alerts
2. **Advanced ML** - Fine-tune models with more historical data
3. **Mobile App** - Native iOS/Android (React Native)
4. **Real-time Updates** - WebSocket for live recommendations
5. **Offline Support** - Service workers for FarmWorker dashboard
6. **Advanced Analytics** - Predictive yield forecasting
7. **Integration** - Connect to external data sources (soil sensors, IoT)
8. **Scaling** - Multi-region deployment, caching layer

---

## Quick Reference

### Data Pipeline Cron
```bash
# Run daily at 6 AM Kenya time
0 6 * * * cd /path/to/farmflow && python scripts/run_pipeline.py >> logs/pipeline.log 2>&1
```

### API Health Check
```bash
curl http://localhost:8000/health
```

### Database Connection
```bash
psql postgresql://user:password@host:5432/farmflow
```

### Frontend Development
```bash
# FarmWorker
cd frontend-worker && pnpm dev

# FarmManager
cd frontend-manager && npm run dev
```

---

## Support & Resources

- **Supabase Docs:** https://supabase.com/docs
- **FastAPI Docs:** https://fastapi.tiangolo.com
- **AquaCrop Docs:** https://www.fao.org/aquacrop
- **Next.js Docs:** https://nextjs.org/docs
- **React Docs:** https://react.dev
- **Recharts Docs:** https://recharts.org
- **Leaflet Docs:** https://leafletjs.com

---

**Version:** 1.0.0 MVP
**Last Updated:** May 10, 2026
**Status:** Ready for Day 1 Build
