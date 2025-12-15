const https = require('https');
const http = require('http');
const { shell } = require('electron');
const path = require('path');
const packageJson = require(path.join(__dirname, '..', 'package.json'));
const crypto = require('crypto');

class VersionManager {
  constructor(apiUrl = null) {
    // 使用 Object.defineProperty 防止版本号被修改
    Object.defineProperty(this, 'currentVersion', {
      value: packageJson.version,
      writable: false,  // 不可修改
      configurable: false,  // 不可重新配置
      enumerable: true
    });
    
    this.apiUrl = apiUrl || 'https://windsurf-api.crispvibe.cn/version_check.php';
    this.checkInterval = 24 * 60 * 60 * 1000; // 24小时检查一次（降低频率）
    this.lastCheckTime = 0;
    this.checkCount = 0; // 检测次数
    this.failureCount = 0; // 连续失败次数
    this.maxFailures = 3; // 最大连续失败次数
    this.checkHistory = []; // 检测历史记录
    this.isChecking = false; // 是否正在检测
    this.checkTimer = null; // 定时器引用
    this.onUpdateCallback = null; // 更新回调函数
    this.onMaintenanceCallback = null; // 维护模式回调
    this.onMaintenanceEndCallback = null; // 维护模式结束回调
    this.onApiUnavailableCallback = null; // API 无法访问回调
    this.isInMaintenance = false; // 当前是否处于维护模式
    
    // API 签名密钥（应该从服务器获取或加密存储）
    // 注意：这只是示例，实际应用中应该使用更安全的方式
    this.apiSecretKey = 'windsurf-tool-secret-key-2025';
    
    // CDN Token 鉴权配置（腾讯云 CDN TypeA）
    // 注意：必须与 CDN 控制台配置完全一致
    this.cdnAuthConfig = {
      enabled: true,  // 启用 CDN Token 鉴权
      primaryKey: '2rRYkOz4ClI8u32KxQHKZBVtzk05Gf2',  // 主鉴权密钥
      backupKey: 'Q133nD00MnwJ',  // 备鉴权密钥
      paramName: 'X-WsTool-Auth-9K7mP2nQ4vL8xR6jT3wY5zH1cF0bN',  // 鉴权参数名
      expireTime: 120  // 有效时长（秒）- 必须与 CDN 配置一致
    };
    
    // 从本地存储加载设置
    this.loadSettings();
  }

  /**
   * 从本地存储加载设置
   */
  loadSettings() {
    try {
      // 这里可以从文件或其他存储中加载设置
      // 暂时使用默认设置
      console.log('版本管理器设置已加载 - 检测间隔:', this.checkInterval / 1000 / 60, '分钟');
    } catch (error) {
      console.warn('加载版本管理器设置失败:', error.message);
    }
  }

  /**
   * 启动定时检测
   */
  startAutoCheck(callback = null, maintenanceCallback = null, maintenanceEndCallback = null, apiUnavailableCallback = null) {
    this.onUpdateCallback = callback;
    this.onMaintenanceCallback = maintenanceCallback;
    this.onMaintenanceEndCallback = maintenanceEndCallback;
    this.onApiUnavailableCallback = apiUnavailableCallback;
    
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }
    
    console.log(`🕐 启动定时版本检测 - 每${this.checkInterval / 1000 / 60}分钟检查一次`);
    
    this.checkTimer = setInterval(async () => {
      await this.performAutoCheck();
    }, this.checkInterval);
  }

  /**
   * 停止定时检测
   */
  stopAutoCheck() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
      console.log(' 已停止定时版本检测');
    }
  }

  /**
   * 执行自动检测
   */
  async performAutoCheck() {
    if (this.isChecking) {
      console.log(' 版本检测正在进行中，跳过本次检测');
      return;
    }

    try {
      this.isChecking = true;
      this.checkCount++;
      
      console.log(`🔍 执行第${this.checkCount}次自动版本检测...`);
      
      const updateInfo = await this.checkForUpdates();
      this.lastCheckTime = Date.now();
      
      // 记录检测历史
      this.checkHistory.push({
        time: new Date(),
        success: true,
        hasUpdate: updateInfo.hasUpdate,
        version: updateInfo.latestVersion
      });
      
      // 重置失败计数
      this.failureCount = 0;
      
      // 如果之前在维护模式，现在恢复了，触发恢复回调
      if (this.isInMaintenance) {
        console.log(' 维护模式已结束，服务恢复正常');
        this.isInMaintenance = false;
        if (this.onMaintenanceEndCallback) {
          this.onMaintenanceEndCallback();
        }
        // 恢复正常检测间隔
        this.setCheckInterval(3 * 60 * 1000); // 3分钟
      }
      
      // 如果有更新且设置了回调，调用回调函数
      if (updateInfo.hasUpdate && this.onUpdateCallback) {
        this.onUpdateCallback(updateInfo);
      }
      
      return updateInfo;
    } catch (error) {
      // 特殊处理维护模式
      if (error.isMaintenance) {
        console.warn('🔧 服务器维护模式:', error.maintenanceInfo.message);
        
        // 只在首次进入维护模式时触发回调
        if (!this.isInMaintenance) {
          this.isInMaintenance = true;
          if (this.onMaintenanceCallback) {
            this.onMaintenanceCallback(error.maintenanceInfo);
          }
        }
        
        // 记录维护模式历史
        this.checkHistory.push({
          time: new Date(),
          success: false,
          isMaintenance: true,
          maintenanceInfo: error.maintenanceInfo
        });
        
        // 维护模式不计入失败次数，但继续检测（间隔更短）
        console.log(' 维护模式期间，将缩短检测间隔到2分钟');
        this.setCheckInterval(2 * 60 * 1000); // 2分钟检查一次
        return;
      }
      
      this.failureCount++;
      console.error(` 自动版本检测失败 (${this.failureCount}/${this.maxFailures}):`, error.message);
      
      // 记录失败历史
      this.checkHistory.push({
        time: new Date(),
        success: false,
        error: error.message
      });
      
      // API 无法访问 - 触发回调阻止使用软件
      if (this.onApiUnavailableCallback) {
        console.error(' API 无法访问，触发阻止回调');
        this.onApiUnavailableCallback({
          error: error.message,
          message: '无法连接到服务器，请检查网络连接。如果开启了代理/VPN，请关闭后重试。'
        });
      }
      
      // 如果连续失败次数过多，增加检测间隔
      if (this.failureCount >= this.maxFailures) {
        const newInterval = this.checkInterval * 2;
        console.warn(` 连续失败${this.maxFailures}次，将检测间隔调整为${newInterval / 1000 / 60}分钟`);
        this.setCheckInterval(newInterval);
        this.failureCount = 0; // 重置失败计数
      }
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * 设置检测间隔
   */
  setCheckInterval(interval) {
    this.checkInterval = interval;
    
    // 如果定时器正在运行，重新启动
    if (this.checkTimer) {
      this.stopAutoCheck();
      this.startAutoCheck(this.onUpdateCallback);
    }
    
    console.log(` 检测间隔已设置为${interval / 1000 / 60}分钟`);
  }

  /**
   * 获取检测状态
   */
  getStatus() {
    return {
      isChecking: this.isChecking,
      checkCount: this.checkCount,
      failureCount: this.failureCount,
      lastCheckTime: this.lastCheckTime,
      checkInterval: this.checkInterval,
      isAutoCheckRunning: !!this.checkTimer,
      checkHistory: this.checkHistory.slice(-10) // 只返回最近10次记录
    };
  }

  /**
   * 获取当前版本
   */
  getCurrentVersion() {
    return this.currentVersion;
  }

  /**
   * 从自定义API获取最新版本信息
   */
  async getLatestVersion() {
    return new Promise((resolve, reject) => {
      const url = new URL(this.apiUrl);
      const platform = process.platform;
      const arch = process.arch;
      
      // 构建查询参数
      const queryParams = {
        version: this.currentVersion,
        platform: platform,
        arch: arch,
        timestamp: Date.now()
      };
      
      // 如果启用 CDN Token 鉴权，添加 Token
      if (this.cdnAuthConfig.enabled) {
        const cdnToken = this.generateCdnToken(url.pathname);
        queryParams[this.cdnAuthConfig.paramName] = cdnToken;
      }
      
      const params = new URLSearchParams(queryParams).toString();
      
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;
      
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}?${params}`,
        method: 'GET',
        headers: {
          'User-Agent': 'Windsurf-Tool-Version-Checker',
          'Accept': 'application/json'
        },
        timeout: 120000
      };

      const req = httpModule.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const response = JSON.parse(data);
              
              // 验证 API 响应完整性
              if (!this.validateApiResponse(response)) {
                reject(new Error('API 响应验证失败，可能存在安全风险'));
                return;
              }
              
              if (response.success) {
                resolve({
                  version: response.latest_version,
                  currentVersion: response.current_version || this.currentVersion,
                  hasUpdate: response.has_update,
                  forceUpdate: response.force_update,
                  isSupported: response.is_supported,
                  updateMessage: response.update_message,
                  serverInfo: response.server_info
                });
              } else {
                // 特殊处理维护模式
                if (response.error === 'MAINTENANCE' && response.maintenance) {
                  const maintenanceError = new Error('服务器维护中');
                  maintenanceError.isMaintenance = true;
                  maintenanceError.maintenanceInfo = {
                    enabled: response.maintenance.enabled,
                    message: response.maintenance.message || '服务器正在维护中，请稍后再试'
                  };
                  reject(maintenanceError);
                } else {
                  reject(new Error(response.message || response.error || '服务器返回错误'));
                }
              }
            } else {
              reject(new Error(`API返回错误: ${res.statusCode}`));
            }
          } catch (error) {
            reject(new Error(`解析API响应失败: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`网络请求失败: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      req.end();
    });
  }

  /**
   * 验证版本号格式是否合法
   * @param {string} version - 版本号
   * @returns {boolean} - 是否合法
   */
  isValidVersion(version) {
    // 版本号格式：x.y.z，每部分都是数字，且不能超过合理范围
    const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;
    const match = version.match(versionPattern);
    
    if (!match) {
      return false;
    }
    
    const [, major, minor, patch] = match;
    
    // 防止超大版本号（每部分不超过 100）
    if (parseInt(major) > 100 || parseInt(minor) > 100 || parseInt(patch) > 100) {
      console.warn(`  版本号数值异常: ${version}`);
      return false;
    }
    
    return true;
  }

  /**
   * 比较版本号
   * @param {string} version1 
   * @param {string} version2 
   * @returns {number} -1: version1 < version2, 0: 相等, 1: version1 > version2
   */
  compareVersions(version1, version2) {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);
    
    const maxLength = Math.max(v1Parts.length, v2Parts.length);
    
    for (let i = 0; i < maxLength; i++) {
      const v1Part = v1Parts[i] || 0;
      const v2Part = v2Parts[i] || 0;
      
      if (v1Part < v2Part) return -1;
      if (v1Part > v2Part) return 1;
    }
    
    return 0;
  }

  /**
   * 检查是否有新版本
   */
  async checkForUpdates() {
    try {
      console.log(`🔍 检查版本更新... 当前版本: ${this.currentVersion}`);
      
      const versionInfo = await this.getLatestVersion();
      
      // 验证服务器返回的版本号格式
      if (!this.isValidVersion(versionInfo.version)) {
        console.warn(` 服务器返回的版本号格式异常: ${versionInfo.version}`);
        console.warn(` 忽略异常版本号，软件继续正常使用`);
        
        // 返回一个安全的默认值，表示当前版本是最新的
        return {
          hasUpdate: false,
          forceUpdate: false,
          isSupported: true,
          currentVersion: this.currentVersion,
          latestVersion: this.currentVersion,
          updateMessage: '版本检测异常，已跳过更新检查',
          serverInfo: null
        };
      }
      
      // 客户端验证：使用本地版本比较作为双重保护
      const compareResult = this.compareVersions(this.currentVersion, versionInfo.version);
      const clientHasUpdate = compareResult < 0; // 当前版本 < 最新版本
      
      // 重要：如果服务端要求强制更新，绝对不能覆盖
      // 这可能是因为检测到非官方版本或其他安全问题
      if (versionInfo.forceUpdate) {
        console.warn('  服务端要求强制更新，可能检测到版本异常');
        // 保持服务端的所有设置，不做任何修改
      } else {
        // 只有在非强制更新的情况下，才使用客户端判断
        if (!clientHasUpdate) {
          versionInfo.hasUpdate = false;
          versionInfo.isSupported = true;
        } else if (versionInfo.hasUpdate !== clientHasUpdate) {
          // 如果需要更新但服务端判断不一致，以客户端为准
          versionInfo.hasUpdate = clientHasUpdate;
        }
      }
      
      console.log(` 最新版本: ${versionInfo.version}`);
      console.log(`强制更新: ${versionInfo.forceUpdate ? '是' : '否'}`);
      console.log(` 版本支持: ${versionInfo.isSupported ? '是' : '否'}`);
      
      if (versionInfo.hasUpdate) {
        console.log(`🆕 发现新版本: ${versionInfo.version}`);
      } else {
        console.log(` 当前版本已是最新`);
      }
      
      return {
        hasUpdate: versionInfo.hasUpdate,
        forceUpdate: versionInfo.forceUpdate,
        isSupported: versionInfo.isSupported,
        currentVersion: versionInfo.currentVersion,
        latestVersion: versionInfo.version,
        updateMessage: versionInfo.updateMessage,
        serverInfo: versionInfo.serverInfo
      };
    } catch (error) {
      console.error(' 检查版本更新失败:', error.message);
      throw error;
    }
  }

  /**
   * 检查维护模式状态
   */
  async checkMaintenanceMode() {
    try {
      console.log('🔧 检查服务器维护状态...');
      await this.getLatestVersion();
      return { inMaintenance: false };
    } catch (error) {
      if (error.isMaintenance) {
        console.warn('🔧 服务器处于维护模式:', error.maintenanceInfo.message);
        return {
          inMaintenance: true,
          maintenanceInfo: error.maintenanceInfo
        };
      }
      throw error;
    }
  }

  /**
   * 获取下载链接 - 使用 GitHub 固定链接
   */
  getDownloadUrl() {
    const platform = process.platform;
    const arch = process.arch;
    
    // 使用 GitHub latest release 固定链接
    const githubBaseUrl = 'https://github.com/crispvibe/Windsurf-Tool/releases/latest/download/';
    
    if (platform === 'win32') {
      return `${githubBaseUrl}Windsurf-Tool-Setup.exe`;
    } else if (platform === 'darwin') {
      if (arch === 'arm64') {
        return `${githubBaseUrl}Windsurf-Tool-arm64.zip`;
      } else {
        return `${githubBaseUrl}Windsurf-Tool-x64.zip`;
      }
    } else if (platform === 'linux') {
      return `${githubBaseUrl}Windsurf-Tool-x64.AppImage`;
    }
    
    // 默认返回 GitHub releases 页面
    return 'https://github.com/crispvibe/Windsurf-Tool/releases/latest';
  }

  /**
   * 打开下载页面
   */
  async openDownloadPage() {
    // 统一跳转到 GitHub releases 最新版本页面
    await shell.openExternal('https://github.com/crispvibe/Windsurf-Tool/releases/latest');
  }

  /**
   * 生成 CDN Token 鉴权参数（腾讯云 CDN TypeA）
   * @param {string} path - 请求路径（如 /version_check.php）
   * @returns {string} - 鉴权参数字符串
   */
  generateCdnToken(path) {
    try {
      // 当前时间戳（秒）
      const timestamp = Math.floor(Date.now() / 1000);
      
      // 过期时间戳（十进制）
      const expireTimestamp = timestamp + this.cdnAuthConfig.expireTime;
      
      // 生成随机字符串（10位随机字符，包含字母和数字）
      const rand = Math.random().toString(36).substring(2, 10);
      
      // 腾讯云 CDN TypeA 鉴权算法：
      // sign = md5(路径-时间戳-随机数-uid-密钥)
      // 注意：使用 - 连接，不是直接拼接
      const uid = 0;  // 用户ID，可选
      const signString = `${path}-${expireTimestamp}-${rand}-${uid}-${this.cdnAuthConfig.primaryKey}`;
      const md5Hash = crypto.createHash('md5').update(signString).digest('hex');
      
      // 返回鉴权参数值：timestamp-rand-uid-md5hash
      return `${expireTimestamp}-${rand}-${uid}-${md5Hash}`;
    } catch (error) {
      console.error('生成 CDN Token 失败:', error);
      return '';
    }
  }

  /**
   * 验证 API 响应签名
   * @param {Object} data - API 响应数据
   * @param {string} signature - 服务器返回的签名
   * @returns {boolean} - 签名是否有效
   */
  verifySignature(data, signature) {
    try {
      // 如果没有签名，暂时允许（向后兼容）
      if (!signature) {
        console.warn(' API 响应没有签名，建议服务端添加签名验证');
        return true;
      }
      
      // 创建数据的规范化字符串（排序后的 JSON）
      const canonicalData = JSON.stringify(data, Object.keys(data).sort());
      
      // 使用 HMAC-SHA256 计算签名
      const hmac = crypto.createHmac('sha256', this.apiSecretKey);
      hmac.update(canonicalData);
      const calculatedSignature = hmac.digest('hex');
      
      // 比较签名
      const isValid = calculatedSignature === signature;
      
      if (!isValid) {
        console.error(' API 响应签名验证失败！可能存在中间人攻击');
        console.error('预期签名:', calculatedSignature);
        console.error('实际签名:', signature);
      }
      
      return isValid;
    } catch (error) {
      console.error('签名验证失败:', error);
      return false;
    }
  }

  /**
   * 验证 API 响应的完整性
   * @param {Object} response - API 响应
   * @returns {boolean} - 响应是否有效
   */
  validateApiResponse(response) {
    // 检查 success 字段必须存在
    if (!('success' in response)) {
      console.error(` API 响应缺少必需字段: success`);
      return false;
    }
    
    // 如果 success 为 true，则必须有 latest_version
    if (response.success === true) {
      if (!('latest_version' in response)) {
        console.error(` API 响应缺少必需字段: latest_version`);
        return false;
      }
    }
    // 如果 success 为 false，则可能是维护模式或其他错误，不需要 latest_version
    
    // 验证签名（如果存在）
    if (response.signature) {
      const { signature, ...dataWithoutSignature } = response;
      if (!this.verifySignature(dataWithoutSignature, signature)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * 格式化发布说明
   */
  formatReleaseNotes(releaseNotes) {
    if (!releaseNotes) return '暂无更新说明';
    
    let formatted = '';
    
    if (releaseNotes.title) {
      formatted += ` ${releaseNotes.title}\n\n`;
    }
    
    if (releaseNotes.date) {
      formatted += `📅 发布日期: ${releaseNotes.date}\n\n`;
    }
    
    if (releaseNotes.features && releaseNotes.features.length > 0) {
      formatted += '✨ 新功能:\n';
      releaseNotes.features.forEach(feature => {
        formatted += `  ${feature}\n`;
      });
      formatted += '\n';
    }
    
    if (releaseNotes.fixes && releaseNotes.fixes.length > 0) {
      formatted += '🐛 修复:\n';
      releaseNotes.fixes.forEach(fix => {
        formatted += `  • ${fix}\n`;
      });
      formatted += '\n';
    }
    
    return formatted.trim();
  }

  /**
   * 获取平台显示名称
   */
  getPlatformName() {
    const platform = process.platform;
    switch (platform) {
      case 'darwin': return 'macOS';
      case 'win32': return 'Windows';
      case 'linux': return 'Linux';
      default: return platform;
    }
  }
}

module.exports = VersionManager;
