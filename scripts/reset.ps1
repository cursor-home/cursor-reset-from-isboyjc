#############################################################
# Cursor 编辑器试用期重置工具 (Windows PowerShell 版本)
# 
# 功能：通过重置设备ID和删除试用相关文件，重新开始 Cursor 编辑器的试用期
# 适用系统：Windows
# 
# 作者: @isboyjc
# 创建时间: 2024-06-01
# 最后更新: 2024-06-11
#############################################################

# 获取用户配置目录，Cursor 在 Windows 上的配置存储在 %APPDATA%\Cursor 目录下
$configDir = "$env:APPDATA\Cursor"

# 检查 Cursor 配置目录是否存在，如果不存在则可能未安装 Cursor 或从未运行过
if (-not (Test-Path $configDir)) {
    Write-Host "Cursor 配置目录不存在"
    exit 1
}

# 删除试用相关文件，这些文件存储了试用状态信息
# Local Storage 和 Session Storage 包含了应用状态和会话数据
# 使用 SilentlyContinue 参数忽略可能的错误（如文件不存在）
Remove-Item -Path "$configDir\Local Storage" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$configDir\Session Storage" -Recurse -Force -ErrorAction SilentlyContinue

<#
.SYNOPSIS
检查系统中是否已安装 Cursor 编辑器

.DESCRIPTION
检查默认安装路径中是否存在 Cursor.exe 可执行文件
如果未找到，则输出提示信息并退出脚本

.EXAMPLE
Check-CursorInstalled
#>
function Check-CursorInstalled {
    # 使用 Join-Path 构建 Cursor 可执行文件的完整路径
    $cursorPath = Join-Path $env:LOCALAPPDATA "Programs\Cursor\Cursor.exe"
    # 检查 Cursor 可执行文件是否存在
    if (-not (Test-Path $cursorPath)) {
        Write-Host "❌ 未检测到 Cursor 编辑器，请先安装 Cursor！"
        Write-Host "下载地址：https://www.cursor.com/downloads"
        exit 1
    }
    Write-Host "✅ Cursor 编辑器已安装"
}

<#
.SYNOPSIS
检查并获取当前运行中的 Cursor 进程

.DESCRIPTION
使用 WMI 查询获取所有包含 "cursor" 的进程
排除当前脚本进程和包含 "cursor-reset" 的进程

.OUTPUTS
返回找到的 Cursor 相关进程的集合，如果没有找到则返回 $null

.EXAMPLE
$processes = Get-CursorProcess
#>
function Get-CursorProcess {
    # 使用 WMI 查询获取所有进程信息
    $processes = Get-WmiObject -Class Win32_Process | Where-Object { 
        # 筛选条件：
        # 1. 进程名中包含 "cursor"
        # 2. 进程名中不包含 "cursor-reset"（排除本重置工具自身）
        # 3. 进程ID不是当前脚本的进程ID
        $_.Name -like "*cursor*" -and 
        $_.Name -notlike "*cursor-reset*" -and 
        $_.ProcessId -ne $PID 
    }
    return $processes
}

<#
.SYNOPSIS
强制关闭所有 Cursor 相关进程

.DESCRIPTION
获取所有 Cursor 相关进程并强制终止它们
结束进程后等待 1.5 秒确保进程完全退出

.EXAMPLE
Stop-CursorProcess
#>
function Stop-CursorProcess {
    # 获取所有 Cursor 相关进程
    $processes = Get-CursorProcess
    if ($processes) {
        # 遍历每个进程并强制终止
        $processes | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force
        }
        # 等待 1.5 秒确保进程完全退出
        Start-Sleep -Seconds 1.5
    }
}

<#
.SYNOPSIS
生成新的随机设备ID

.DESCRIPTION
使用 .NET 的 Guid 类生成一个新的 UUID/GUID 格式的设备ID

.OUTPUTS
返回一个新的随机 UUID 字符串

.EXAMPLE
$deviceId = New-DeviceId
#>
function New-DeviceId {
    # 使用 .NET Framework 的 Guid 类生成一个新的 UUID
    return [guid]::NewGuid().ToString()
}

<#
.SYNOPSIS
备份指定的配置文件

.DESCRIPTION
创建配置文件的时间戳备份，文件名格式为：原文件名.时间戳.bak

.PARAMETER ConfigFile
要备份的配置文件的完整路径

.OUTPUTS
返回备份文件的完整路径

.EXAMPLE
$backupPath = Backup-ConfigFile -ConfigFile "C:\path\to\config.json"
#>
function Backup-ConfigFile {
    param (
        [string]$ConfigFile
    )
    # 生成当前时间的格式化时间戳（年月日时分秒毫秒）
    $timestamp = Get-Date -Format "yyyyMMddHHmmssfff"
    # 构建备份文件路径
    $backupFile = "${ConfigFile}.${timestamp}.bak"
    # 复制原文件到备份路径
    Copy-Item -Path $ConfigFile -Destination $backupFile -Force
    # 返回备份文件的完整路径
    return $backupFile
}

<#
.SYNOPSIS
禁用 Cursor 自动更新功能

.DESCRIPTION
通过删除更新目录并创建同名文件来阻止更新程序运行
这样可以防止 Cursor 自动更新到新版本，避免重置失效

.OUTPUTS
成功返回 $true，失败返回 $false

.EXAMPLE
$result = Disable-CursorUpdate
#>
function Disable-CursorUpdate {
    # 在 Windows 系统上，Cursor 更新程序路径
    $updaterPath = Join-Path $env:LOCALAPPDATA "cursor-updater"
    
    try {
        # 如果存在目录或文件，先删除
        if (Test-Path $updaterPath) {
            Remove-Item -Path $updaterPath -Force -Recurse -ErrorAction Stop
        }
        
        # 创建同名空文件来阻止更新程序创建同名目录
        # Out-Null 抑制输出，避免在控制台显示创建结果
        New-Item -ItemType File -Path $updaterPath -Force | Out-Null
        return $true
    } catch {
        # 捕获任何异常并显示错误信息
        Write-Host "禁用自动更新时出错：$($_.Exception.Message)"
        return $false
    }
}

<#
.SYNOPSIS
重置 Cursor 试用期的主程序逻辑

.DESCRIPTION
执行完整的重置流程：
1. 检查 Cursor 安装状态
2. 检查并关闭运行中的 Cursor 进程
3. 准备配置目录
4. 备份现有配置
5. 生成新的设备 ID
6. 保存新配置
7. 禁用自动更新

.EXAMPLE
Main
#>
function Main {
    # 第一步：检查 Cursor 编辑器是否已安装
    Write-Host "🔍 正在检查 Cursor 编辑器..."
    Check-CursorInstalled
    Write-Host

    # 第二步：检查 Cursor 是否正在运行，如果是则询问是否自动关闭
    Write-Host "🔍 检查 Cursor 是否在运行..."
    $cursorProcess = Get-CursorProcess
    if ($cursorProcess) {
        # Cursor 正在运行，询问用户是否自动关闭
        $response = Read-Host "检测到 Cursor 正在运行，是否自动关闭？ (y/N)"
        if ($response -eq 'y' -or $response -eq 'Y') {
            # 用户同意自动关闭，尝试关闭进程
            Write-Host "正在关闭 Cursor..."
            Stop-CursorProcess
            # 再次检查进程是否还在运行
            $cursorProcess = Get-CursorProcess
            if ($cursorProcess) {
                # 进程仍在运行，无法自动关闭
                Write-Host "❌ 无法自动关闭 Cursor，请手动关闭后重试！"
                exit 1
            }
            Write-Host "✅ Cursor 已成功关闭"
        } else {
            # 用户不同意自动关闭，提示手动关闭后重试
            Write-Host "❌ 请先关闭 Cursor 编辑器后再运行此工具！"
            exit 1
        }
    } else {
        # Cursor 未运行，可以继续
        Write-Host "✅ Cursor 编辑器已关闭"
    }
    Write-Host

    # 第三步：准备配置目录和文件路径
    $configDir = Join-Path $env:APPDATA "Cursor"
    $storageFile = Join-Path $configDir "User\globalStorage\storage.json"
    
    Write-Host "📂 正在准备配置文件..."
    # 递归创建配置文件所在的目录树，使用 Out-Null 抑制输出
    New-Item -ItemType Directory -Path (Split-Path $storageFile -Parent) -Force | Out-Null
    Write-Host "✅ 配置目录创建成功"
    Write-Host

    # 第四步：备份现有配置文件（如果存在）
    if (Test-Path $storageFile) {
        Write-Host "💾 正在备份原配置..."
        $backupFile = Backup-ConfigFile -ConfigFile $storageFile
        # 只显示备份文件的文件名，而非完整路径
        Write-Host "✅ 配置备份完成，备份文件路径：$((Split-Path $backupFile -Leaf))"
        Write-Host
    }

    # 第五步：生成新的随机设备ID
    Write-Host "🎲 正在生成新的设备 ID..."
    $machineId = New-DeviceId
    $macMachineId = New-DeviceId
    $devDeviceId = New-DeviceId

    # 第六步：创建新的配置对象并保存到文件
    # 创建包含三个设备ID的哈希表
    $config = @{
        "telemetry.machineId" = $machineId       # 主要设备标识
        "telemetry.macMachineId" = $macMachineId # macOS设备标识（Windows系统也需要）
        "telemetry.devDeviceId" = $devDeviceId   # 开发环境设备标识
    }
    
    # 将哈希表转换为JSON格式，并写入配置文件
    $config | ConvertTo-Json | Set-Content -Path $storageFile -Encoding UTF8

    Write-Host "✅ 新设备 ID 生成成功"
    Write-Host
    Write-Host "💾 正在保存新配置..."
    Write-Host "✅ 新配置保存成功"
    Write-Host
    Write-Host "🎉 设备 ID 重置成功！新的设备 ID 为："
    Write-Host
    # 显示保存的配置文件内容
    Get-Content $storageFile
    Write-Host
    Write-Host "📝 配置文件路径：$storageFile"
    Write-Host

    # 第七步：禁用Cursor自动更新功能
    Write-Host "🔄 正在禁用自动更新..."
    if (Disable-CursorUpdate) {
        Write-Host "✅ 自动更新已成功禁用"
    } else {
        Write-Host "❌ 禁用自动更新失败"
    }

    # 完成并显示提示信息
    Write-Host
    Write-Host "✨ 现在可以启动 Cursor 编辑器了"
    Write-Host "⚠️ 提示：已禁用自动更新，如需更新请手动下载新版本"
}

# 运行主程序
Main
# 显示脚本执行完成的信息
Write-Host "✨ Cursor 试用期已重置"
Write-Host "🎉 重启 Cursor 编辑器即可开始新的试用期"
