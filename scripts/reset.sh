#!/bin/bash

#############################################################
# Cursor 编辑器试用期重置工具 (Linux/macOS Shell 版本)
# 
# 功能：通过重置设备ID，重新开始 Cursor 编辑器的试用期
# 适用系统：macOS 和 Linux
# 
# 作者: @isboyjc
# 创建时间: 2024-06-01
# 最后更新: 2024-06-11
#############################################################

#################################################
# 检查 Cursor 是否已安装
# 
# 根据不同操作系统检查 Cursor 的默认安装位置
# - macOS: 检查 /Applications/Cursor.app
# - Linux: 检查多个可能的安装位置
# 
# 返回值：无直接返回值，未安装时脚本会退出
#################################################
check_cursor_installed() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS系统：Cursor通常安装在应用程序目录
        if [ ! -d "/Applications/Cursor.app" ]; then
            echo "❌ 未检测到 Cursor 编辑器，请先安装 Cursor！"
            echo "下载地址：https://www.cursor.com/downloads"
            exit 1
        fi
    elif [[ "$OSTYPE" == "linux"* ]]; then
        # Linux系统：Cursor可能安装在多个位置，需要逐一检查
        if [ ! -d "/usr/share/cursor" ] && [ ! -d "/opt/cursor" ] && [ ! -d "$HOME/.local/share/cursor" ]; then
            echo "❌ 未检测到 Cursor 编辑器，请先安装 Cursor！"
            echo "下载地址：https://www.cursor.com/downloads"
            exit 1
        fi
    fi
    echo "✅ Cursor 编辑器已安装"
}

#################################################
# 检查 Cursor 是否在运行
# 
# 根据不同操作系统使用不同的命令检查进程
# - macOS: 使用 pgrep 命令查找 Cursor 和 Cursor Helper 进程
# - Linux: 使用 pgrep 命令查找 cursor 和 Cursor 进程
# 
# 返回值: 如果 Cursor 正在运行返回0(true)，否则返回非0值(false)
#################################################
check_cursor_running() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS系统下使用 pgrep 命令检查 Cursor 进程
        # -x 参数要求进程名完全匹配，|| 表示如果第一个命令失败，尝试第二个
        pgrep -x "Cursor" > /dev/null || pgrep -x "Cursor Helper" > /dev/null
    elif [[ "$OSTYPE" == "linux"* ]]; then
        # Linux系统下使用 pgrep 命令检查 cursor 进程
        # 同时检查 "cursor" 和 "Cursor"（考虑大小写）
        pgrep -x "cursor" > /dev/null || pgrep -x "Cursor" > /dev/null
    fi
    # 函数会返回最后一个命令的退出状态
    # pgrep 命令找到进程时返回 0，未找到时返回非 0
}

#################################################
# 关闭 Cursor 进程
# 
# 根据不同操作系统使用相应的命令关闭进程
# - macOS: 使用pkill命令发送SIGKILL信号强制结束进程
# - Linux: 使用pkill命令发送SIGKILL信号强制结束进程
# 
# 返回值: 无
#################################################
kill_cursor_process() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS系统下使用pkill命令，-9表示发送SIGKILL信号（强制终止）
        pkill -9 "Cursor"
    elif [[ "$OSTYPE" == "linux"* ]]; then
        # Linux系统下使用pkill命令
        pkill -9 "cursor"
    fi
    # 等待1.5秒，让进程有时间完全退出
    sleep 1.5
}

#################################################
# 获取配置文件路径
# 
# 根据不同操作系统返回配置文件的标准位置：
# - macOS: ~/Library/Application Support/Cursor
# - Linux: ~/.config/Cursor
# 
# 返回值: 配置目录的完整路径
#################################################
get_config_dir() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS下配置目录位于用户的Library/Application Support目录中
        echo "$HOME/Library/Application Support/Cursor"
    elif [[ "$OSTYPE" == "linux"* ]]; then
        # Linux下配置目录位于用户的.config目录中
        echo "$HOME/.config/Cursor"
    else
        # 不支持的操作系统
        echo "❌ 不支持的操作系统"
        exit 1
    fi
}

#################################################
# 生成随机设备 ID
# 
# 根据不同操作系统使用不同的命令生成UUID：
# - macOS: 使用uuidgen命令
# - Linux: 使用/proc/sys/kernel/random/uuid文件
# 
# 返回值: 生成的UUID字符串
#################################################
generate_device_id() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS系统使用uuidgen命令生成UUID
        echo $(uuidgen)
    else
        # Linux系统从/proc/sys/kernel/random/uuid文件读取UUID
        # 该文件每次读取时会生成一个新的随机UUID
        echo $(cat /proc/sys/kernel/random/uuid)
    fi
}

#################################################
# 备份配置文件
# 
# 创建配置文件的时间戳备份，文件名格式为：原文件名.时间戳.bak
# 
# 参数:
#   $1 - 需要备份的文件路径
# 
# 返回值: 备份文件的完整路径
#################################################
backup_config() {
    local config_file="$1"
    # 生成时间戳，格式为年月日时分秒毫秒
    local timestamp=$(date +"%Y%m%d%H%M%S%3N")
    # 构建备份文件路径
    local backup_file="${config_file}.${timestamp}.bak"
    # 复制原文件到备份路径
    cp "$config_file" "$backup_file"
    # 返回备份文件的完整路径
    echo "$backup_file"
}

#################################################
# 禁用 Cursor 自动更新
# 
# 通过删除更新目录并创建同名文件来阻止更新程序运行
# 这样可以防止Cursor自动更新到新版本，避免重置失效
# 
# 返回值: 成功返回0，失败返回1
#################################################
disable_cursor_update() {
    local updater_path=""
    # 根据不同操作系统，确定更新程序的路径
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS下更新程序路径
        updater_path="$HOME/Library/Application Support/Caches/cursor-updater"
    elif [[ "$OSTYPE" == "linux"* ]]; then
        # Linux下更新程序路径
        updater_path="$HOME/.config/cursor-updater"
    else
        # 不支持的操作系统
        echo "❌ 不支持的操作系统"
        return 1
    fi

    # 如果存在目录或文件，先删除
    if [ -e "$updater_path" ]; then
        rm -rf "$updater_path"
    fi

    # 创建空文件来阻止更新
    # 这会阻止更新程序创建同名目录，从而禁用自动更新
    touch "$updater_path"
    # 检查touch命令的退出状态
    if [ $? -eq 0 ]; then
        return 0
    else
        return 1
    fi
}

#################################################
# 主程序函数
# 
# 执行完整的重置流程：
# 1. 检查 Cursor 安装状态
# 2. 检查并关闭运行中的 Cursor 进程
# 3. 准备配置目录
# 4. 备份现有配置
# 5. 生成新的设备 ID
# 6. 保存新配置
# 7. 禁用自动更新
#################################################
main() {
    # 第一步：检查 Cursor 编辑器是否已安装
    echo "🔍 正在检查 Cursor 编辑器..."
    check_cursor_installed
    echo

    # 第二步：检查 Cursor 是否正在运行，如果是则提示用户关闭
    echo "🔍 检查 Cursor 是否在运行..."
    if check_cursor_running; then
        # Cursor 正在运行，询问用户是否自动关闭
        echo "检测到 Cursor 正在运行，是否自动关闭？ (y/N): "
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            # 用户同意自动关闭，尝试关闭进程
            echo "正在关闭 Cursor..."
            kill_cursor_process
            # 再次检查进程是否还在运行
            if check_cursor_running; then
                # 进程仍在运行，无法自动关闭
                echo "❌ 无法自动关闭 Cursor，请手动关闭后重试！"
                exit 1
            fi
            echo "✅ Cursor 已成功关闭"
        else
            # 用户不同意自动关闭，提示手动关闭后重试
            echo "❌ 请先关闭 Cursor 编辑器后再运行此工具！"
            exit 1
        fi
    else
        # Cursor 未运行，可以继续
        echo "✅ Cursor 编辑器已关闭"
    fi
    echo

    # 第三步：准备配置目录和文件路径
    CONFIG_DIR=$(get_config_dir)
    STORAGE_FILE="$CONFIG_DIR/User/globalStorage/storage.json"
    
    echo "📂 正在准备配置文件..."
    # 递归创建配置文件所在的目录树
    mkdir -p "$(dirname "$STORAGE_FILE")"
    echo "✅ 配置目录创建成功"
    echo

    # 第四步：备份现有配置文件（如果存在）
    if [ -f "$STORAGE_FILE" ]; then
        echo "💾 正在备份原配置..."
        BACKUP_FILE=$(backup_config "$STORAGE_FILE")
        # 只显示备份文件的文件名，而非完整路径
        echo "✅ 配置备份完成，备份文件路径：$(basename "$BACKUP_FILE")"
        echo
    fi

    # 第五步：生成新的随机设备ID
    echo "🎲 正在生成新的设备 ID..."
    MACHINE_ID=$(generate_device_id)
    MAC_MACHINE_ID=$(generate_device_id)
    DEV_DEVICE_ID=$(generate_device_id)

    # 第六步：创建新的配置对象并保存到文件
    # 使用Here Document (EOF)创建JSON格式的配置文件
    cat > "$STORAGE_FILE" << EOF
{
  "telemetry.machineId": "${MACHINE_ID}",
  "telemetry.macMachineId": "${MAC_MACHINE_ID}",
  "telemetry.devDeviceId": "${DEV_DEVICE_ID}"
}
EOF

    echo "✅ 新设备 ID 生成成功"
    echo
    echo "💾 正在保存新配置..."
    echo "✅ 新配置保存成功"
    echo
    echo "🎉 设备 ID 重置成功！新的设备 ID 为："
    echo
    # 显示保存的配置文件内容
    cat "$STORAGE_FILE"
    echo
    echo "📝 配置文件路径：$STORAGE_FILE"
    echo

    # 第七步：禁用Cursor自动更新功能
    echo "🔄 正在禁用自动更新..."
    if disable_cursor_update; then
        echo "✅ 自动更新已成功禁用"
    else
        echo "❌ 禁用自动更新失败"
    fi

    # 完成并显示提示信息
    echo
    echo "✨ 现在可以启动 Cursor 编辑器了"
    echo "⚠️ 提示：已禁用自动更新，如需更新请手动下载新版本"
}

# 执行主程序
main
