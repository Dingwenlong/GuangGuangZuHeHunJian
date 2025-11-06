import { BrowserWindow } from 'electron';
import config from '@config/index';
import type MainInit from './window-manager';
import authManager from './auth-manager';
import { webContentSend } from './web-content-send';
import DirectoryMonitor from './directory-monitor';
import { VideoProcessor } from './video-processor';

/**
 * 自定义全局
 * @param mainInit
 */
export const ipcCustomGlobalHandlers = (mainInit: MainInit): IpcHandler[] => {
  return [
    {
      channel: 'GetLoginState',
      handler: async () =>
        config.IgnoreLogin || (await authManager.isLoggedIn()),
    },
    {
      channel: 'OpenDevTools',
      handler: async event => {
        event.sender?.openDevTools({
          mode: 'undocked',
          activate: true,
        });
      },
    },
  ];
};

/**
 * 自定义登录
 * @param mainInit
 * @returns
 */
export const ipcCustomLoginHandlers = (mainInit: MainInit): IpcHandler[] => {
  return [
    {
      channel: 'LoginSuccess',
      handler: async (
        _,
        arg: { userData: any; token: any; refreshToken: any }
      ) => {
        const { userData, token, refreshToken } = arg;
        await authManager.setLoginState(userData, token, refreshToken);

        BrowserWindow.getAllWindows().forEach(win => {
          win.close();
        });
        await mainInit.createMainWindow();
      },
    },
  ];
};

/**
 * 自定义主窗口
 * @param mainInit
 * @returns
 */
export const ipcCustomMainHandlers = (mainInit: MainInit): IpcHandler[] => {
  const mainWindow = mainInit.mainWindow!;
  const dirMonitors: DirectoryMonitor[] = [];
  const videoProcessor = new VideoProcessor();
  const log = (message: string, type: string = 'info') => {
    webContentSend.LogUpdate(mainWindow.webContents, {
      message,
      type,
    });
  };
  let isProcessing = false;
  let stopRequested = false;

  videoProcessor.on('log', (logEvent: { type: string; message: any }) => {
    log(`[${logEvent.type.toUpperCase()}] ${logEvent.message}`, logEvent.type);
  });

  return [
    {
      channel: 'GetDefaultTaskDirectory',
      handler: () => {
        return config.workBenchDefault.taskDirectory;
      },
    },
    {
      channel: 'StartProcessing',
      handler: async (event, arg: { productDir: string; count: number }) => {
        const { productDir, count } = arg;
        if (isProcessing) {
          log('错误：已经在处理中，请等待当前任务完成。', 'warning');
          return;
        }

        isProcessing = true;
        stopRequested = false;
        event.sender.send('ProcessingState', { isProcessing });

        log('任务已开始执行...');
        try {
          await videoProcessor.generateVideos(productDir, count);
          log('✅ 全部任务执行完成！');
        } catch (error) {
          log(
            `❌ 发生严重错误: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        } finally {
          isProcessing = false;
          stopRequested = false;
          log('✅ 全部任务已结束！');
          event.sender.send('ProcessingState', { isProcessing });
        }
      },
    },
    {
      channel: 'StopProcessing',
      handler: async () => {
        if (isProcessing) {
          stopRequested = true;
          log('🛑 已请求停止，将在当前视频处理完成后安全退出...');
        }
      },
    },
    //--------------------------文件夹监听（工作目录、发布目录）--------------------------
    {
      channel: 'StartMonitoringDirectory',
      handler: async (_, directory: string) => {
        // 当前文件夹已被监听
        if (
          dirMonitors.findIndex(
            monitor => monitor.monitorDirectory === directory
          ) > -1
        ) {
          return;
        }

        const dirMonitor = new DirectoryMonitor(directory, {
          maxDepth: 3, // 监控深度
          updateInterval: 30000, // 30秒更新一次
          debounceDelay: 500, // 500ms防抖延迟
        });
        dirMonitors.push(dirMonitor);

        dirMonitor.on('directoryStructure', ({ root, structure }) => {
          webContentSend.MonitoringDirectoryCallback(mainWindow.webContents, {
            root,
            structure,
          });
        });
        dirMonitor.on('log', ({ message, type }) => {
          log(message, type);
        });

        dirMonitor.start();
      },
    },
    {
      channel: 'StopMonitoringDirectory',
      handler: async (_, directory: string) => {
        const dirMonitor = dirMonitors.find(
          monitor => monitor.monitorDirectory === directory
        );
        if (dirMonitor) dirMonitor.stop();
      },
    },
    //--------------------------登录--------------------------
    {
      channel: 'Logout',
      handler: async () => {
        await authManager.clearLoginState();
        BrowserWindow.getAllWindows().forEach(win => {
          win.close();
        });
        await mainInit.createLoginWindow();
      },
    },
    {
      channel: 'GetLoginUserInfo',
      handler: async () => {
        return await authManager.getUserInfo();
      },
    },
    {
      channel: 'GetAuthInfo',
      handler: async () => {
        return await authManager.getAuthInfo();
      },
    },
  ];
};
