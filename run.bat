@echo off
setlocal

:: 1. 切换到当前目录
cd /d "%~dp0"

:: 2. 设置标题
title Git 智能管理工具

:: 3. 尝试查找 Git Bash 的安装位置
set "GIT_BASH=%ProgramFiles%\Git\git-bash.exe"

if not exist "%GIT_BASH%" (
    set "GIT_BASH=%ProgramFiles(x86)%\Git\git-bash.exe"
)

if not exist "%GIT_BASH%" (
    echo [错误] 找不到 git-bash.exe。
    echo 请确认你已经安装了 Git，并且安装在默认路径。
    echo.
    echo 尝试直接运行: sh git_tool.sh
    echo.
    pause
    exit /b
)

:: 4. 调用 Bash 脚本
:: 注意：这里不需要 "./"，Git Bash 会自动理解
"%GIT_BASH%" -c "sh git_tool.sh"

:: 脚本运行结束后关闭窗口
exit