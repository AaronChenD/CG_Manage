#!/bin/bash

# =======================================================
# Git 智能助手 (V4.0 Clean Manual Edition)
# =======================================================

# --- 1. 基础定义 ---
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
CYAN='\033[36m'
RESET='\033[0m'

# 基础优化：仅增加缓存区大小，防止大文件因 buffer 不够报错（不涉及代理）
git config --global http.postBuffer 524288000
git config --global --add safe.directory "$(pwd)" 2>/dev/null

# --- 2. 模块：网络代理管理 (完全手动) ---
function menu_proxy_manual() {
    while true; do
        echo -e "\n${CYAN}--- 🌐 手动网络代理设置 ---${RESET}"
        
        # 显示当前状态
        CURRENT_HTTP=$(git config --global http.proxy)
        if [ -z "$CURRENT_HTTP" ]; then
            echo -e "当前状态: ${GREEN}未配置代理 (直连)${RESET}"
        else
            echo -e "当前状态: ${YELLOW}已配置代理 -> $CURRENT_HTTP${RESET}"
        fi

        echo -e "-----------------------------"
        echo -e "1. 设置/修改 代理端口"
        echo -e "2. 清除/关闭 代理 (恢复直连)"
        echo -e "0. 返回主菜单"
        echo -e "-----------------------------"
        read -p "请选择: " proxy_opt

        case $proxy_opt in
            1)
                read -p "请输入代理端口 (例如 7890): " port
                if [[ "$port" =~ ^[0-9]+$ ]]; then
                    git config --global http.proxy http://127.0.0.1:$port
                    git config --global https.proxy http://127.0.0.1:$port
                    echo -e "${GREEN}✅ 已设置代理为 127.0.0.1:$port${RESET}"
                else
                    echo -e "${RED}❌ 输入错误，请输入数字端口号。${RESET}"
                fi
                ;;
            2)
                git config --global --unset http.proxy
                git config --global --unset https.proxy
                echo -e "${GREEN}✅ 已清除代理配置，恢复直连模式。${RESET}"
                ;;
            0)
                return
                ;;
            *)
                echo -e "${RED}无效选择${RESET}"
                ;;
        esac
    done
}

# --- 3. 模块：常规同步 ---
function run_sync() {
    echo -e "\n${CYAN}>>> 启动同步流程...${RESET}"

    # 检测是否为 Git 仓库
    if [ ! -d ".git" ]; then
        echo -e "${YELLOW}[初始化新项目]${RESET}"
        git init
        git branch -M main
        read -p "请输入远程仓库地址: " REMOTE_URL
        git remote add origin "$REMOTE_URL"
        git add .
        git commit -m "Initial commit"
        git push -u origin main
        return
    fi

    BRANCH=$(git branch --show-current)
    if [ -z "$BRANCH" ]; then BRANCH="main"; fi

    # 1. 尝试拉取 (仅记录错误，不中断流程)
    echo -e "${YELLOW}⬇️  尝试拉取远程更新...${RESET}"
    git pull origin "$BRANCH" 2>/tmp/git_pull_log
    
    # 检查拉取结果
    if [ $? -ne 0 ]; then
        ERR_MSG=$(cat /tmp/git_pull_log)
        if [[ "$ERR_MSG" == *"unrelated histories"* ]]; then
            echo -e "${RED}⚠️  提示：本地与远程历史不一致 (因为你可能刚重置了历史)。${RESET}"
            echo -e "${YELLOW}👉 稍后推送时请选择 '强制推送'。${RESET}"
        else
            echo -e "${RED}⚠️  拉取遇到冲突或网络波动，将尝试继续提交。${RESET}"
        fi
    else
        echo -e "${GREEN}✅ 拉取成功。${RESET}"
    fi
    rm -f /tmp/git_pull_log

    # 2. 提交
    echo -e "\n${CYAN}请输入提交说明 (回车默认 'Update'):${RESET}"
    read -r MSG
    if [ -z "$MSG" ]; then MSG="Update"; fi

    git add .
    git commit -m "$MSG"

    # 3. 推送 (带错误处理)
    echo -e "\n${YELLOW}🚀 正在推送到 GitHub...${RESET}"
    if git push origin "$BRANCH"; then
        echo -e "${GREEN}✅ 同步完成！${RESET}"
    else
        echo -e "\n${RED}❌ 普通推送失败！${RESET}"
        echo -e "------------------------------------------------"
        echo -e "原因分析："
        echo -e "1. 刚清理了历史 -> 需要强制推送"
        echo -e "2. 远程有冲突   -> 需要强制推送或手动合并"
        echo -e "3. 网络不稳定   -> 需检查网络或设置代理"
        echo -e "------------------------------------------------"
        echo -e "1. [强制推送] 覆盖远程 (Force Push)"
        echo -e "2. [取消] 返回主菜单"
        echo -e "------------------------------------------------"
        read -p "请选择: " fix_opt

        if [ "$fix_opt" == "1" ]; then
            echo -e "${YELLOW}🌊 正在强制推送...${RESET}"
            git push -f origin "$BRANCH" && echo -e "${GREEN}✅ 强制推送成功！${RESET}"
        else
            echo "操作已取消。"
        fi
    fi
}

# --- 4. 模块：清理历史 ---
function run_clean_history() {
    echo -e "\n${RED}!!! 高危操作警告 !!!${RESET}"
    echo -e "此操作将删除所有旧的历史记录，不可恢复！"
    read -p "确认执行? (输入 yes 继续): " confirm
    if [ "$confirm" != "yes" ]; then return; fi

    echo -e "${YELLOW}⏳ 正在重置本地历史...${RESET}"
    BRANCH=$(git branch --show-current)
    if [ -z "$BRANCH" ]; then BRANCH="main"; fi

    # 孤儿分支逻辑
    git checkout --orphan temp_clean_branch
    git add -A
    git commit -m "Reset History"
    git branch -D "$BRANCH"
    git branch -m "$BRANCH"
    
    echo -e "${GREEN}✅ 本地历史已清空。${RESET}"
    echo -e "${CYAN}提示：下一步必须执行强制推送才能生效。${RESET}"
    
    read -p "是否立即强制推送? (y/n): " push_now
    if [ "$push_now" == "y" ]; then
        echo -e "${YELLOW}🚀 强制推送中...${RESET}"
        git push -f origin "$BRANCH"
        
        # 垃圾回收
        echo -e "${YELLOW}🧹 清理缓存垃圾...${RESET}"
        git reflog expire --expire=now --all
        git gc --prune=now --aggressive
        echo -e "${GREEN}🎉 完成！${RESET}"
    fi
}

# --- 5. 主菜单 ---
while true; do
    echo -e "\n${CYAN}====== Git 智能助手 (纯净版) ======${RESET}"
    echo -e "1. 🚀 开始同步 (Sync)"
    echo -e "2. 🧹 清空历史 (Reset History)"
    echo -e "3. 🌐 手动代理设置 (Proxy Settings)"
    echo -e "q. ❌ 退出"
    echo -e "${CYAN}====================================${RESET}"
    read -p "请选择: " choice

    case $choice in
        1) run_sync ;;
        2) run_clean_history ;;
        3) menu_proxy_manual ;;
        q|Q) exit 0 ;;
        *) echo "无效选择" ;;
    esac
    
    echo -e "\n按回车键继续..."
    read dummy
    clear
done