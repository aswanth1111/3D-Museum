@echo off
title 3D Virtual Museum Server
echo ========================================================
echo   🏛️ Starting 3D Virtual Art Museum...
echo   Open your browser at: http://localhost:8080/
echo ========================================================
start http://localhost:8080/
powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
