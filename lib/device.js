/**
 * Tabbit CDP - 设备仿真模块
 * 视口控制、UA 仿真、地理定位、设备参数
 */

class DeviceManager {
  constructor(cdpSession) {
    this.session = cdpSession;
  }

  // ─── 预设设备 ────────────────────────────────────────

  static DEVICES = {
    'iphone-14': {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
    },
    'iphone-14-pro-max': {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 430, height: 932, deviceScaleFactor: 3, mobile: true },
    },
    'ipad-pro': {
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true },
    },
    'pixel-7': {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      viewport: { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true },
    },
    'galaxy-s23': {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      viewport: { width: 360, height: 780, deviceScaleFactor: 3, mobile: true },
    },
    'desktop-1080': {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
    },
    'desktop-1440': {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false },
    },
  };

  /** 仿真为指定设备 */
  async emulateDevice(deviceName) {
    const device = DeviceManager.DEVICES[deviceName];
    if (!device) throw new Error(`未知设备: ${deviceName}，可用: ${Object.keys(DeviceManager.DEVICES).join(', ')}`);

    await this.session.send('Emulation.setUserAgentOverride', { userAgent: device.userAgent });
    await this.session.send('Emulation.setDeviceMetricsOverride', {
      width: device.viewport.width,
      height: device.viewport.height,
      deviceScaleFactor: device.viewport.deviceScaleFactor,
      mobile: device.viewport.mobile,
    });
    return device;
  }

  /** 自定义视口 */
  async setViewport(width, height, options = {}) {
    await this.session.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: options.deviceScaleFactor || 1,
      mobile: options.mobile || false,
    });
  }

  /** 恢复默认视口 */
  async resetViewport() {
    await this.session.send('Emulation.clearDeviceMetricsOverride');
  }

  /** 设置自定义 UA */
  async setUserAgent(ua) {
    await this.session.send('Emulation.setUserAgentOverride', { userAgent: ua });
  }

  // ─── 地理定位 ────────────────────────────────────────

  /** 设置地理定位 */
  async setGeolocation(latitude, longitude, accuracy = 100) {
    await this.session.send('Emulation.setGeolocationOverride', {
      latitude,
      longitude,
      accuracy,
    });
  }

  /** 清除地理定位 */
  async clearGeolocation() {
    await this.session.send('Emulation.clearGeolocationOverride');
  }

  // ─── 触摸/传感器 ─────────────────────────────────────

  /** 启用触摸仿真 */
  async enableTouchEmulation(enabled = true) {
    await this.session.send('Emulation.setTouchEmulationEnabled', { enabled });
  }

  /** 设置时区 */
  async setTimezone(timezoneId) {
    await this.session.send('Emulation.setTimezoneOverride', { timezoneId });
  }

  /** 设置语言 */
  async setLocale(locale) {
    await this.session.send('Emulation.setLocaleOverride', { locale });
  }

  /** 设置深色模式 */
  async setDarkMode(enabled = true) {
    await this.session.send('Emulation.setEmulatedMedia', {
      features: [{
        name: 'prefers-color-scheme',
        value: enabled ? 'dark' : 'light',
      }],
    });
  }

  /** 模拟视口缩放 */
  async setPageScale(factor) {
    await this.session.send('Emulation.setPageScaleFactor', { pageScaleFactor: factor });
  }
}

module.exports = { DeviceManager };
