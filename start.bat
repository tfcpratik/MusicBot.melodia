@echo off
color 1F
title MusicMaker - Bot Launcher
cd /d "%~dp0"

echo.
echo ==========================================
echo    MUSICMAKER BOT STARTING...
echo ==========================================
echo.

node index.js

echo.
echo ==========================================
echo    BOT STOPPED
echo ==========================================
echo.
pause
