@echo off
REM Local dev on Windows: frees this project's ports, then starts the backend and frontend in their own windows.
REM Double-click this file, or run it from any terminal.
echo Freeing ports 8001 and 5174 ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\free-ports.ps1" 8001 5174
timeout /t 2 /nobreak >nul
start "Bill splitter backend :8001" cmd /k "cd /d %~dp0backend && call .venv\Scripts\activate.bat && uvicorn app.main:app --port 8001 --env-file .env"
start "Bill splitter frontend :5174" cmd /k "cd /d %~dp0frontend && npm run dev -- --port 5174 --strictPort"
echo Started. Backend: http://localhost:8001/docs   App: http://localhost:5174
