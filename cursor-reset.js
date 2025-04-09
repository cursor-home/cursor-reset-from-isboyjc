#!/usr/bin/env node

/**
 * Cursor Trial Reset Tool
 * 
 * 这是一个 Cursor 编辑器试用重置工具
 * 该脚本通过重置 Cursor 配置文件中的设备 ID 来生成新的随机设备 ID，从而重置试用期。
 * 支持 Windows、macOS 和 Linux 系统。
 * 
 * 主要功能：
 * - 自动检测并关闭运行中的 Cursor 进程
 * - 备份现有配置文件
 * - 生成新的随机设备 ID
 * - 统计重置历史记录
 * - 禁用自动更新功能
 * 
 * 仓库地址: https://github.com/isboyjc/cursor-reset
 * 作者: @isboyjc
 * 创建时间: 29/Dec/2024
 * 最后更新时间: 11/Feb/2025
 */

// 导入 fs 模块的 promises API，用于异步文件操作
const fs = require('fs').promises;
// 导入 path 模块，用于处理文件路径
const path = require('path');
// 导入 os 模块，用于获取操作系统信息
const os = require('os');
// 导入 crypto 模块，用于生成随机字符串和UUID
const crypto = require('crypto');
// 从 child_process 模块导入 execSync 函数，用于执行系统命令
const { execSync } = require('child_process');
// 导入 readline 模块，用于创建交互式命令行界面
const readline = require('readline');

/**
 * 等待用户按键
 * 在 Windows 系统下运行时，程序结束前等待用户按键
 * 这样可以防止在双击运行时窗口立即关闭
 * 
 * @returns {Promise<void>} 返回一个 Promise，在用户按键后解决
 */
function waitForKeypress() {
  // 判断是否在 Windows 系统下（无论 32 位还是 64 位）且不是在终端中运行
  if (process.platform === 'win32' && !process.env.TERM) {
    console.log('\n按任意键退出...');
    return new Promise(resolve => {
      // 创建一个 readline 接口，用于监听用户输入
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      // 清理函数：关闭 readline 接口并解决 Promise
      const cleanup = () => {
        rl.close();
        resolve();
      };

      // 设置输入流为原始模式，监听按键事件
      // 原始模式下可以捕获单个按键，无需回车确认
      process.stdin.setRawMode(true);
      // 恢复输入流，使其可以接收输入
      process.stdin.resume();
      // 监听一次数据事件，当用户按下任意键时触发
      process.stdin.once('data', () => {
        // 恢复输入流为正常模式
        process.stdin.setRawMode(false);
        cleanup();
      });

      // 如果用户关闭窗口，也要清理资源
      rl.once('close', cleanup);
    });
  }
  // 如果不是在 Windows 系统下或者是在终端中运行，直接返回已解决的 Promise
  return Promise.resolve();
}

/**
 * 用户确认提示
 * 显示一个 yes/no 提示，等待用户输入
 * 
 * @param {string} question 要显示给用户的问题
 * @returns {Promise<boolean>} 如果用户输入 'y' 或 'Y' 返回 true，否则返回 false
 */
async function confirm(question) {
  // 创建一个 readline 接口，用于获取用户输入
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // 返回一个 Promise，在用户回答后解决
  return new Promise(resolve => {
    // 显示问题，并等待用户输入
    // 默认选项是 'N'，所以用户直接按回车表示否定
    rl.question(question + ' (y/N): ', answer => {
      // 关闭 readline 接口
      rl.close();
      // 解决 Promise，如果用户输入 'y' 或 'Y' 返回 true，否则返回 false
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

/**
 * 获取 Windows 系统下运行的 Cursor 进程名
 * 使用 wmic 命令获取详细的进程信息，并过滤出 Cursor 相关进程
 * 
 * @returns {Promise<string|null>} 返回找到的第一个 Cursor 进程名，如果没找到则返回 null
 */
async function getWindowsCursorProcessName() {
  try {
    // 使用 wmic 命令获取所有进程的名称和进程ID信息，以CSV格式输出
    const result = execSync('wmic process get name,processid /format:csv', { encoding: 'utf-8' });
    // 按行分割命令结果，并去除每行首尾空白字符
    const lines = result.trim().split('\n').map(line => line.trim());
    
    // 移除CSV表头行
    if (lines.length > 1) {
      lines.shift();
    }
    
    // 获取当前脚本进程的进程ID
    const currentPid = process.pid;
    
    // 过滤处理进程列表：
    // 1. 筛选包含"cursor"但不包含"cursor-reset"的进程名
    // 2. 排除当前脚本进程
    // 3. 提取进程名
    const processes = lines
      .filter(line => {
        const [node, name, pid] = line.split(',').map(item => item.trim().toLowerCase());
        // 排除当前进程和其他非 Cursor 进程
        return name && 
               name.includes('cursor') && 
               !name.includes('cursor-reset') && // 排除我们的脚本
               parseInt(pid) !== currentPid; // 排除当前进程
      })
      .map(line => line.split(',')[1].trim());

    // 如果找到了符合条件的进程，返回第一个进程名
    if (processes.length > 0) {
      console.log('找到的 Cursor 进程：', processes);
      return processes[0];
    }
    // 如果没找到，返回 null
    return null;
  } catch (error) {
    // 如果执行过程中出错，打印错误信息并返回 null
    console.log('获取进程名时出错：', error.message);
    return null;
  }
}

/**
 * 检查 Cursor 是否正在运行
 * 根据不同操作系统使用不同的命令检查进程
 * - Windows: 使用 wmic 命令查询进程列表
 * - macOS: 使用 pgrep 命令查找 Cursor 和 Cursor Helper 进程
 * - Linux: 使用 pgrep 命令查找 cursor 和 Cursor 进程
 * 
 * @returns {boolean} 如果 Cursor 正在运行返回 true，否则返回 false
 */
function isCursorRunning() {
  try {
    // 获取当前操作系统平台
    const platform = process.platform;
    let result = '';
    
    if (platform === 'win32') {
      // Windows 系统下的进程检测逻辑
      // 使用 wmic 命令获取所有进程的名称和进程ID
      result = execSync('wmic process get name,processid /format:csv', { encoding: 'utf-8' });
      // 获取当前脚本的进程ID
      const currentPid = process.pid;
      
      // 处理命令结果，过滤出 Cursor 相关进程
      const processes = result.toLowerCase()
        .split('\n')
        .map(line => line.trim())
        .filter(line => {
          // 跳过空行和表头行
          if (!line || line.startsWith('node,name,processid')) return false;
          const [node, name, pid] = line.split(',').map(item => item.trim());
          // 筛选条件：包含"cursor"但不包含"cursor-reset"，且不是当前进程
          return name && 
                 name.includes('cursor') && 
                 !name.includes('cursor-reset') &&
                 parseInt(pid) !== currentPid;
        });
      
      // 打印检测到的进程信息，方便调试
      console.log('检测到的 Cursor 进程：', processes);
      // 如果列表不为空，说明 Cursor 正在运行
      return processes.length > 0;
    } else if (platform === 'darwin') {
      // macOS 系统下使用 pgrep 命令检查 Cursor 进程
      // -x 参数要求进程名完全匹配，|| 表示如果第一个命令失败，尝试第二个
      result = execSync('pgrep -x "Cursor" || pgrep -x "Cursor Helper"', { encoding: 'utf-8' });
      // 如果结果不为空，说明找到了 Cursor 相关进程
      return result.length > 0;
    } else if (platform === 'linux') {
      // Linux 系统下使用 pgrep 命令检查 cursor 进程
      // 同时检查 "cursor" 和 "Cursor"（考虑大小写）
      result = execSync('pgrep -x "cursor" || pgrep -x "Cursor"', { encoding: 'utf-8' });
      // 如果结果不为空，说明找到了 Cursor 相关进程
      return result.length > 0;
    } else {
      // 不支持的操作系统抛出错误
      throw new Error(`不支持的操作系统: ${platform}`);
    }
  } catch (error) {
    if (error.status === 1) {
      // pgrep 在没找到进程时返回状态码 1，这不是真正的错误
      // 而是表示没有找到匹配的进程，应该返回 false
      return false;
    }
    // 其他错误，打印错误信息并返回 false
    console.log('检查进程时出错：', error.message);
    return false;
  }
}

/**
 * 强制关闭 Cursor 进程
 * 根据不同操作系统使用相应的命令关闭进程：
 * - Windows: 使用taskkill命令强制结束进程及其子进程
 * - macOS: 使用pkill命令发送SIGKILL信号强制结束进程
 * - Linux: 使用pkill命令发送SIGKILL信号强制结束进程
 * 
 * @returns {Promise<boolean>} 成功关闭返回 true，失败返回 false
 */
async function killCursorProcess() {
  try {
    // 获取当前操作系统平台
    const platform = process.platform;
    let command = '';
    
    // 根据不同操作系统，构建不同的进程终止命令
    switch (platform) {
      case 'win32': {
        // Windows系统下，先获取Cursor进程名
        const processName = await getWindowsCursorProcessName();
        if (!processName) {
          // 如果没有找到进程，输出信息并返回true（视为已关闭）
          console.log('未找到需要关闭的 Cursor 进程');
          return true; // 如果没有找到进程，认为已经关闭
        }
        // 构建taskkill命令：/F强制关闭，/IM指定进程名，/T关闭所有子进程
        command = `taskkill /F /IM "${processName}" /T`;
        break;
      }
      case 'darwin':
        // macOS系统下使用pkill命令，-9表示发送SIGKILL信号（强制终止）
        command = 'pkill -9 "Cursor"';
        break;
      case 'linux':
        // Linux系统下使用pkill命令
        command = 'pkill -9 "cursor"';
        break;
      default:
        // 不支持的操作系统抛出错误
        throw new Error(`不支持的操作系统: ${platform}`);
    }

    // 输出将要执行的命令，便于调试
    console.log('执行关闭命令：', command);
    // 执行命令关闭进程
    execSync(command);
    
    // 等待1.5秒，让进程有时间完全退出
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // 再次检查进程是否真的关闭了
    if (isCursorRunning()) {
      // 如果进程仍在运行，抛出错误
      throw new Error('进程仍在运行');
    }
    
    // 成功关闭进程，返回true
    return true;
  } catch (error) {
    // 关闭进程出错，输出错误信息并返回false
    console.error('关闭 Cursor 进程时出错：', error.message);
    return false;
  }
}

/**
 * 格式化时间戳
 * 将日期对象转换为格式化的时间字符串
 * 格式：yyyyMMddHHmmssSSS（年月日时分秒毫秒）
 * 用于生成备份文件的唯一标识符
 * 
 * @param {Date} date 要格式化的日期对象
 * @returns {string} 格式化后的时间字符串
 */
function formatTimestamp(date) {
  // 定义填充函数，确保数字至少有指定的位数（默认2位）
  // 例如：pad(5) => "05", pad(123, 3) => "123"
  const pad = (num, len = 2) => String(num).padStart(len, '0');
  
  // 获取日期的各个部分
  const year = date.getFullYear();             // 年：4位数字
  const month = pad(date.getMonth() + 1);      // 月：2位数字（注意JavaScript月份从0开始）
  const day = pad(date.getDate());             // 日：2位数字
  const hours = pad(date.getHours());          // 时：2位数字
  const minutes = pad(date.getMinutes());      // 分：2位数字
  const seconds = pad(date.getSeconds());      // 秒：2位数字
  const milliseconds = pad(date.getMilliseconds(), 3); // 毫秒：3位数字

  // 组合所有部分，返回完整的时间戳字符串
  return `${year}${month}${day}${hours}${minutes}${seconds}${milliseconds}`;
}

/**
 * 备份配置文件
 * 创建配置文件的时间戳备份，文件名格式为：原文件名.时间戳.bak
 * 确保在修改配置文件前保存一份原始副本，以便在出现问题时恢复
 * 
 * @param {string} filePath 需要备份的文件路径
 * @returns {Promise<string>} 备份文件的完整路径
 * @throws {Error} 备份失败时抛出错误
 */
async function backupFile(filePath) {
  try {
    // 生成当前时间的格式化时间戳，作为备份文件名的一部分
    const timestamp = formatTimestamp(new Date());
    // 构建备份文件路径：原文件名.时间戳.bak
    const backupPath = `${filePath}.${timestamp}.bak`;
    // 复制原文件到备份路径
    await fs.copyFile(filePath, backupPath);
    // 返回备份文件的完整路径
    return backupPath;
  } catch (error) {
    // 备份过程中出错，抛出包含详细信息的错误
    throw new Error(`备份文件失败: ${error.message}`);
  }
}

/**
 * 检查 Cursor 是否已安装
 * 根据不同操作系统检查 Cursor 的默认安装位置
 * - Windows: 检查 %LOCALAPPDATA%\Programs\Cursor\Cursor.exe
 * - macOS: 检查 /Applications/Cursor.app
 * - Linux: 检查多个可能的安装位置
 * 
 * @returns {Promise<boolean>} Cursor 已安装返回 true，否则返回 false
 * @throws {Error} 不支持的操作系统时抛出错误
 */
async function isCursorInstalled() {
  // 获取当前操作系统平台
  const platform = process.platform;
  let cursorPath = '';

  // 根据不同操作系统，确定Cursor的默认安装路径
  switch (platform) {
    case 'win32':
      // Windows系统下，Cursor通常安装在本地应用程序目录
      cursorPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'Cursor', 'Cursor.exe');
      break;
    case 'darwin':
      // macOS系统下，Cursor通常安装在应用程序目录
      cursorPath = '/Applications/Cursor.app';
      break;
    case 'linux':
      // Linux系统可能有多个安装位置，需要逐一检查
      const linuxPaths = [
        '/usr/share/cursor',      // 系统共享目录
        '/opt/cursor',            // 可选应用目录
        path.join(os.homedir(), '.local/share/cursor') // 用户本地目录
      ];
      // 遍历所有可能的路径，找到第一个存在的路径
      for (const p of linuxPaths) {
        try {
          // 尝试访问路径，如果不抛出异常说明路径存在
          await fs.access(p);
          cursorPath = p;
          break;
        } catch {}
      }
      break;
    default:
      // 不支持的操作系统，抛出错误
      throw new Error(`不支持的操作系统: ${platform}`);
  }

  try {
    // 尝试访问确定的Cursor路径
    await fs.access(cursorPath);
    // 如果没有抛出异常，说明路径存在，Cursor已安装
    return true;
  } catch {
    // 路径不存在，说明Cursor未安装
    return false;
  }
}

/**
 * 获取 Cursor 存储文件路径
 * 根据不同操作系统返回配置文件的标准位置：
 * - Windows: %APPDATA%/Cursor/User/globalStorage/storage.json
 * - macOS: ~/Library/Application Support/Cursor/User/globalStorage/storage.json
 * - Linux: ~/.config/Cursor/User/globalStorage/storage.json
 * 这个文件存储了设备ID等重要配置信息
 * 
 * @returns {string} 配置文件的完整路径
 * @throws {Error} 不支持的操作系统时抛出错误
 */
function getStorageFile() {
  // 获取当前操作系统平台
  const platform = process.platform;
  // 获取用户主目录路径
  const homedir = os.homedir();

  // 根据不同操作系统，返回对应的配置文件路径
  switch (platform) {
    case 'win32': // Windows系统
      // Windows下配置文件通常存放在APPDATA环境变量指向的目录中
      return path.join(process.env.APPDATA, 'Cursor', 'User', 'globalStorage', 'storage.json');
    case 'darwin': // macOS系统
      // macOS下配置文件通常存放在用户的Library/Application Support目录中
      return path.join(homedir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'storage.json');
    case 'linux': // Linux系统
      // Linux下配置文件通常存放在用户的.config目录中
      return path.join(homedir, '.config', 'Cursor', 'User', 'globalStorage', 'storage.json');
    default:
      // 不支持的操作系统，抛出错误
      throw new Error(`不支持的操作系统: ${platform}`);
  }
}

/**
 * 生成新的随机设备标识
 * 生成三种不同的设备 ID：
 * - machineId: 32字节的随机十六进制字符串，用于主要设备识别
 * - macMachineId: 32字节的随机十六进制字符串，用于macOS设备识别
 * - devDeviceId: UUID v4格式的随机字符串，用于开发环境设备识别
 * 这些ID用于Cursor识别设备，重置这些ID可以重置试用期
 * 
 * @returns {object} 包含新生成的三个设备 ID 的对象
 */
function generateDeviceIds() {
  return {
    // 生成32字节的随机数据，并转换为十六进制字符串
    // 用于主要设备识别
    machineId: crypto.randomBytes(32).toString('hex'),
    
    // 生成32字节的随机数据，并转换为十六进制字符串
    // 用于macOS设备识别
    macMachineId: crypto.randomBytes(32).toString('hex'),
    
    // 生成符合UUID v4标准的随机标识符
    // 用于开发环境设备识别
    // UUID格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    // 其中y是8、9、A或B之一
    devDeviceId: crypto.randomUUID()
  };
}

/**
 * 获取配置文件的所有备份记录
 * 搜索指定目录下所有以 .bak 结尾的备份文件
 * 解析文件名中的时间戳并按时间倒序排列，以便查看重置历史
 * 
 * @param {string} configPath 配置文件路径
 * @returns {Promise<Array<{name: string, time: Date}>>} 备份文件信息数组，包含文件名和创建时间
 */
async function getBackupFiles(configPath) {
  try {
    // 获取配置文件所在的目录
    const dir = path.dirname(configPath);
    // 获取配置文件名（不含路径）
    const base = path.basename(configPath);
    // 读取目录中的所有文件
    const files = await fs.readdir(dir);
    
    // 筛选和处理备份文件：
    return files
      // 筛选出以配置文件名开头且包含.bak的文件
      .filter(file => file.startsWith(base) && file.includes('.bak'))
      // 将文件名转换为包含名称和时间的对象
      .map(file => {
        // 从文件名中提取时间戳（格式：filename.timestamp.bak）
        const timestamp = file.split('.')[1];
        // 解析时间戳各部分 (yyyyMMddHHmmssSSS)
        const year = timestamp.slice(0, 4);
        const month = timestamp.slice(4, 6);
        const day = timestamp.slice(6, 8);
        const hours = timestamp.slice(8, 10);
        const minutes = timestamp.slice(10, 12);
        const seconds = timestamp.slice(12, 14);
        const milliseconds = timestamp.slice(14);
        
        // 创建Date对象，JavaScript月份从0开始，需要减1
        const time = new Date(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
          parseInt(hours),
          parseInt(minutes),
          parseInt(seconds),
          parseInt(milliseconds)
        );
        
        // 返回包含文件名和时间的对象
        return {
          name: file,
          time: time
        };
      })
      // 按时间倒序排列（最新的备份在前）
      .sort((a, b) => b.time - a.time); 
  } catch (error) {
    // 获取备份文件列表时出错，输出错误信息并返回空数组
    console.error('获取备份文件列表时出错：', error);
    return [];
  }
}

/**
 * 禁用 Cursor 自动更新
 * 通过删除更新目录并创建同名文件来阻止更新程序运行
 * 这样可以防止Cursor自动更新到新版本，避免重置失效
 * 
 * @returns {Promise<boolean>} 成功返回 true，失败返回 false
 */
async function disableAutoUpdate() {
  try {
    // 获取当前操作系统平台
    const platform = process.platform;
    let updaterPath = '';

    // 根据不同操作系统，确定更新程序的路径
    switch (platform) {
      case 'win32':
        // Windows下更新程序路径
        updaterPath = path.join(process.env.LOCALAPPDATA, 'cursor-updater');
        break;
      case 'darwin':
        // macOS下更新程序路径
        updaterPath = path.join(os.homedir(), 'Library', 'Application Support', 'Caches','cursor-updater');
        break;
      case 'linux':
        // Linux下更新程序路径
        updaterPath = path.join(os.homedir(), '.config', 'cursor-updater');
        break;
      default:
        // 不支持的操作系统，抛出错误
        throw new Error(`不支持的操作系统: ${platform}`);
    }

    // 删除更新目录或文件（如果存在）
    try {
      // 获取路径的状态信息
      const stat = await fs.stat(updaterPath);
      if (stat.isDirectory()) {
        // 如果是目录，递归删除
        await fs.rm(updaterPath, { recursive: true, force: true });
      } else {
        // 如果是文件，直接删除
        await fs.unlink(updaterPath);
      }
    } catch (error) {
      // 如果路径不存在（ENOENT错误），忽略错误
      // 其他错误则抛出，中断执行
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // 创建同名空文件
    // 这会阻止更新程序创建同名目录，从而禁用自动更新
    await fs.writeFile(updaterPath, '', { flag: 'w' });
    
    // 更新禁用成功，返回true
    return true;
  } catch (error) {
    // 禁用自动更新时出错，输出错误信息并返回false
    console.error('禁用自动更新时出错：', error);
    return false;
  }
}

/**
 * 重置 Cursor 的设备标识
 * 执行完整的重置流程：
 * 1. 检查 Cursor 安装状态
 * 2. 检查并关闭运行中的 Cursor 进程
 * 3. 准备配置目录
 * 4. 备份现有配置
 * 5. 生成新的设备 ID
 * 6. 保存新配置
 * 7. 显示重置统计信息
 * 8. 禁用自动更新
 */
async function resetCursorId() {
  try {
    // 第一步：检查 Cursor 编辑器是否已安装
    console.log('🔍 正在检查 Cursor 编辑器...');
    if (!await isCursorInstalled()) {
      // 未检测到 Cursor，显示错误信息并提供下载链接
      console.error('❌ 未检测到 Cursor 编辑器，请先安装 Cursor！');
      console.error('下载地址：https://www.cursor.com/downloads');
      return;
    }
    console.log('✅ Cursor 编辑器已安装\n');

    // 第二步：检查 Cursor 是否正在运行，如果是则提示用户关闭
    console.log('🔍 检查 Cursor 是否在运行...');
    if (isCursorRunning()) {
      // Cursor 正在运行，询问用户是否自动关闭
      const shouldKill = await confirm('检测到 Cursor 正在运行，是否自动关闭？');
      if (shouldKill) {
        // 用户同意自动关闭，尝试关闭进程
        console.log('正在关闭 Cursor...');
        if (await killCursorProcess()) {
          console.log('✅ Cursor 已成功关闭\n');
        } else {
          // 自动关闭失败，提示用户手动关闭
          console.error('❌ 无法自动关闭 Cursor，请手动关闭后重试！');
          return;
        }
      } else {
        // 用户不同意自动关闭，提示手动关闭后重试
        console.error('❌ 请先关闭 Cursor 编辑器后再运行此工具！');
        return;
      }
    } else {
      // Cursor 未运行，可以继续
      console.log('✅ Cursor 编辑器已关闭\n');
    }

    // 第三步：准备配置目录，确保目录存在
    console.log('📂 正在准备配置文件...');
    const storageFile = getStorageFile();
    // 递归创建配置文件所在的目录树
    await fs.mkdir(path.dirname(storageFile), { recursive: true });
    console.log('✅ 配置目录创建成功\n');

    // 第四步：备份原配置文件，以便在出现问题时恢复
    console.log('💾 正在备份原配置...');
    const backupPath = await backupFile(storageFile);
    console.log(`✅ 配置备份完成，备份文件路径：${path.basename(backupPath)}\n`);

    // 第五步：读取配置文件，如果文件不存在则创建新的配置对象
    console.log('🔄 正在读取配置文件...');
    let data = {};
    try {
      // 尝试读取并解析现有配置文件
      const fileContent = await fs.readFile(storageFile, 'utf-8');
      data = JSON.parse(fileContent);
      console.log('✅ 配置文件读取成功\n');
    } catch (error) {
      // 文件不存在或其他错误，将创建新配置
      console.log('ℹ️ 未找到现有配置，将创建新配置\n');
    }

    // 第六步：生成新的随机设备ID
    console.log('🎲 正在生成新的设备 ID...');
    const newIds = generateDeviceIds();
    // 更新配置对象中的设备ID
    data['telemetry.machineId'] = newIds.machineId;
    data['telemetry.macMachineId'] = newIds.macMachineId;
    data['telemetry.devDeviceId'] = newIds.devDeviceId;
    console.log('✅ 新设备 ID 生成成功\n');

    // 第七步：保存新配置到文件
    console.log('💾 正在保存新配置...');
    // 将配置对象转换为JSON字符串并写入文件
    await fs.writeFile(storageFile, JSON.stringify(data, null, 2), 'utf-8');
    console.log('✅ 新配置保存成功\n');

    // 第八步：显示重置成功信息和新的设备ID
    console.log('🎉 设备 ID 重置成功！新的设备 ID 为：\n');
    console.log(JSON.stringify(newIds, null, 2));
    console.log(`\n📝 配置文件路径：${storageFile}`);

    // 第九步：获取备份历史并显示重置统计
    // 获取目录中所有的备份文件
    const backupFiles = await getBackupFiles(storageFile);
    // 备份文件数量等于重置次数
    const resetCount = backupFiles.length;

    // 显示重置统计信息
    console.log(`\n📊 重置统计：`);
    console.log(`   总计重置次数：${resetCount} 次`);
    // 如果有重置历史，显示详细的备份文件列表
    if (resetCount > 0) {
      console.log('\n📜 历史备份文件：');
      backupFiles.forEach((file, index) => {
        console.log(`   ${index + 1}. ${file.name}`);
      });
    }

    // 第十步：禁用Cursor自动更新功能
    console.log('\n🔄 正在禁用自动更新...');
    if (await disableAutoUpdate()) {
      console.log('✅ 自动更新已成功禁用！');
    } else {
      console.error('❌ 禁用自动更新失败！');
    }

    // 提示用户可以启动Cursor并注意更新已被禁用
    console.log('\n✨ 现在可以启动 Cursor 编辑器了');
    console.log('⚠️ 提示：已禁用自动更新，如需更新请手动下载新版本');

  } catch (error) {
    // 捕获并显示整个重置过程中的任何错误
    console.error('\n❌ 重置设备 ID 时出错：', error);
  }
}

/**
 * 主程序入口
 * 执行重置流程并处理异常
 * 确保在程序结束前等待用户确认（Windows）
 * 保证程序正常退出并返回适当的退出码
 */
async function main() {
  // 初始化退出代码为0（成功）
  let exitCode = 0;
  try {
    // 执行Cursor设备ID重置流程
    await resetCursorId();
  } catch (error) {
    // 捕获并显示主程序中的未处理异常
    console.error('\n❌ 程序执行出错：', error);
    // 设置退出代码为1（失败）
    exitCode = 1;
  } finally {
    // 无论成功还是失败，都等待用户按键后再退出
    // 这在Windows系统下双击运行脚本时特别有用，防止窗口立即关闭
    await waitForKeypress();
    // 使用设定的退出代码结束程序
    process.exit(exitCode);
  }
}

// 检查当前模块是否是直接运行的主模块
// 这确保了当脚本被直接执行时才运行main函数
// 当脚本被其他模块导入时，不会自动执行main函数
if (require.main === module) {
  // 执行main函数，并捕获任何未处理的Promise异常
  main().catch(error => {
    // 输出致命错误信息
    console.error('程序异常退出：', error);
    // 以失败状态码退出程序
    process.exit(1);
  });
}
