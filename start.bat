@echo off
echo ========================================
echo  PRINTO — Starting Demo Environment
echo ========================================

cd /d %~dp0

:: Install missing packages if needed
echo Installing/checking required packages...
pip install streamlit requests openpyxl --quiet

:: Load .env
for /f "tokens=1,2 delims==" %%a in (.env) do (
    if not "%%a"=="" if not "%%a:~0,1%"=="#" set %%a=%%b
)

echo.
echo Starting Backend API (port 8000)...
start "Printo Backend" cmd /k "cd backend && uvicorn main:app --reload --port 8000"

timeout /t 3 /nobreak >nul

echo Starting Frontend (port 8501)...
start "Printo Frontend" cmd /k "streamlit run frontend/app.py --server.port 8501"

echo.
echo ========================================
echo  Backend:  http://localhost:8000
echo  Frontend: http://localhost:8501
echo  API Docs: http://localhost:8000/docs
echo ========================================
echo.
echo Test drawings are in: test_drawings\
echo   - ground_floor_plan.png
echo   - first_floor_plan.png
echo   - basement_plan.png
echo.
pause
