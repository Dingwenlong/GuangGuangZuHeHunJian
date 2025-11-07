import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { FFmpegUtil } from '../lib/ffmpeg';
import { writeLog, type LogEvent } from '@main/utils/log';

export class VideoProcessor extends EventEmitter {
  private ffmpegUtil: FFmpegUtil;
  private stopRequested: boolean = false;
  private config = {
    PlayResX: 1080,
    PlayResY: 1920,
    Fontsize: 55,
    PrimaryColour: '&HFFFFFF',
    Outline: 3,
    OutlineColour: '&H4100FF',
    MarginV: 300,
  };
  private fontsDir: string;

  constructor() {
    super();
    this.ffmpegUtil = FFmpegUtil.getInstance();
    this.setupFFmpegEventListeners();
    const devResourcesPath = path.join(process.cwd(), 'resources');
    const devFontsPath = path.join(devResourcesPath, 'Fonts');

    const prodResourcesPath = process.resourcesPath || '';
    const prodFontsPath = path.join(prodResourcesPath, 'Fonts');

    if (fs.existsSync(devFontsPath)) {
      this.fontsDir = devFontsPath;
    } else if (fs.existsSync(prodFontsPath)) {
      this.fontsDir = prodFontsPath;
    } else {
      this.fontsDir = '';
    }
  }

  /**
   * 设置 FFmpeg 事件监听器
   */
  private setupFFmpegEventListeners(): void {
    this.ffmpegUtil.on('log', (event: LogEvent) => {
      this.writeLog(event.message, event.type);
    });
  }

  public setConfig(config: Partial<typeof VideoProcessor.prototype.config>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * 请求停止处理
   */
  public requestStop(): void {
    this.stopRequested = true;
    this.writeLog('🚦 收到停止请求，处理将在当前任务完成后终止。');
  }

  /**
   * 重置停止请求状态
   */
  public resetStopRequest(): void {
    this.stopRequested = false;
  }

  /**
   * 生成视频的主方法
   */
  public async generateVideos(
    productDir: string,
    count: number
  ): Promise<void> {
    this.resetStopRequest();
    this.writeLog(`🎬 开始生成 ${count} 条视频...`);

    for (let i = 1; i <= count; i++) {
      if (this.stopRequested) {
        this.writeLog('🚦 收到停止请求，已终止后续任务。');
        return;
      }

      this.writeLog(`\n🎬 [${i}/${count}] 开始生成第 ${i} 条视频...`);
      try {
        await this.generateSingleVideo(productDir, i);
        this.writeLog(`✅ [${i}/${count}] 第 ${i} 条视频生成成功！`);
      } catch (error) {
        this.writeLog(
          `❌ [${i}/${count}] 第 ${i} 条视频生成失败: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    this.writeLog('🎉 所有视频生成任务完成！');
  }

  /**
   * 生成单个视频
   */
  private async generateSingleVideo(
    productDir: string,
    index: number
  ): Promise<void> {
    // 1. 初始化
    const productName = path.basename(productDir);
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const tempDir = path.join(productDir, `temp_${index}_${randomSuffix}`);
    await fs.promises.mkdir(tempDir, { recursive: true });
    this.writeLog(`[1/7] 创建临时目录: ${tempDir}`);

    const subtitleData: { text: string; duration: number }[] = [];
    let sceneIndex = 0;

    // 2. 场景视频合成
    this.writeLog('[2/7] 开始处理场景视频...');
    const sceneDirs = (
      await fs.promises.readdir(productDir, { withFileTypes: true })
    )
      .filter(d => d.isDirectory() && /^[A-Z]$/.test(d.name))
      .map(d => d.name)
      .sort();

    for (const scene of sceneDirs) {
      sceneIndex++;
      const scenePath = path.join(productDir, scene);
      const audioPath = await this.getRandomFile(scenePath, '.mp3');
      const videoPath = await this.getRandomFile(scenePath, '.mp4');

      if (!audioPath || !videoPath) {
        this.writeLog(`  - 警告: 场景 ${scene} 缺少 MP3 或 MP4 文件，跳过。`);
        continue;
      }

      this.writeLog(
        `  - 处理场景 ${scene} (音频: ${path.basename(
          audioPath
        )}, 视频: ${path.basename(videoPath)})`
      );

      const audioDuration = await this.ffmpegUtil.getVideoDuration(audioPath);
      const videoDuration = await this.ffmpegUtil.getVideoDuration(videoPath);

      const subtitleText = path.parse(audioPath).name;
      subtitleData.push({ text: subtitleText, duration: audioDuration });

      const processedVideoPath = path.join(
        tempDir,
        `process_${sceneIndex}.mp4`
      );

      if (videoDuration < audioDuration) {
        const speed = videoDuration / audioDuration;
        // 使用ffmpegUtil调整视频速度
        await this.ffmpegUtil.adjustSpeed(
          videoPath,
          processedVideoPath,
          speed,
          `处理场景 ${scene} - 调整速度`
        );
      } else {
        const startTime = (videoDuration - audioDuration) / 2;
        // 使用ffmpegUtil截取视频片段
        await this.ffmpegUtil.trimSegment(
          videoPath,
          processedVideoPath,
          startTime,
          audioDuration,
          `处理场景 ${scene} - 截取片段`
        );
      }

      // 为处理后的视频添加音频
      const addAudioPath = path.join(
        tempDir,
        `add_audio_${String(sceneIndex).padStart(3, '0')}.mp4`
      );
      await this.ffmpegUtil.addAudioToVideo(
        processedVideoPath,
        audioPath,
        addAudioPath,
        `为场景 ${scene} 添加音频`
      );
    }

    // 3. 合并所有场景
    this.writeLog('[3/7] 合并所有场景视频...');
    const concatListPath = path.join(tempDir, 'filelist.txt');
    const filesToConcat = (await fs.promises.readdir(tempDir))
      .filter(f => f.startsWith('add_audio_') && f.endsWith('.mp4'))
      .sort();
    if (filesToConcat.length === 0) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      throw new Error(
        '没有可以合并的场景视频，请检查 A,B,C... 文件夹内的素材。'
      );
    }
    const fileListContent = filesToConcat
      .map(f => `file '${path.resolve(tempDir, f).replace(/\\/g, '/')}'`)
      .join('\n');
    await fs.promises.writeFile(concatListPath, fileListContent);
    const mergePath = path.join(tempDir, 'merge.mp4');

    // 使用ffmpegUtil合并视频片段
    await this.ffmpegUtil.concatVideoSegments(
      concatListPath,
      mergePath,
      '合并场景视频'
    );

    // 4. 添加字幕
    this.writeLog('[4/7] 生成并添加字幕...');
    let srtContent = '';
    let currentTime = 0;
    subtitleData.forEach((item, idx) => {
      const start = currentTime + 0.2;
      const end = start + item.duration - 0.2;
      const formatTime = (sec: number) =>
        new Date(sec * 1000).toISOString().substr(11, 12).replace('.', ',');
      srtContent += `${idx + 1}\n${formatTime(start)} --> ${formatTime(end)}\n${
        item.text
      }\n\n`;
      currentTime = end; // 加上间隔
    });
    const srtPath = path.join(tempDir, 'subtitles.srt');
    await fs.promises.writeFile(srtPath, srtContent);

    const subtitleStyle = [
      `PlayResX=${this.config.PlayResX}`,
      `PlayResY=${this.config.PlayResY}`,
      'Fontname=SourceHanSansCN-Bold',
      `Fontsize=${this.config.Fontsize}`,
      `PrimaryColour=${this.config.PrimaryColour}`,
      `Outline=${this.config.Outline}`,
      `OutlineColour=${this.config.OutlineColour}`,
      'Alignment=2',
      'MarginL=20',
      'MarginR=20',
      `MarginV=${this.config.MarginV}`,
    ].join(',');
    const mergeSubtitlePath = path.join(tempDir, 'merge_subtitle.mp4');
    // 使用ffmpegUtil添加字幕
    await this.ffmpegUtil.addSubtitles(
      mergePath,
      srtPath,
      mergeSubtitlePath,
      this.fontsDir,
      `${this.config.PlayResX}:${this.config.PlayResY}`,
      subtitleStyle,
      '添加字幕'
    );

    // 5. 添加图片水印
    this.writeLog('[5/7] 添加图片水印...');
    const watermarkFile = await this.getRandomFile(productDir, '.png');
    let watermarkPath = mergeSubtitlePath;
    if (watermarkFile) {
      watermarkPath = path.join(tempDir, 'merge_subtitle_watermark.mp4');
      // 使用ffmpegUtil添加水印
      await this.ffmpegUtil.addWatermark(
        mergeSubtitlePath,
        watermarkFile,
        watermarkPath,
        'W-w-10:H-h-10',
        '添加水印'
      );
    } else {
      this.writeLog('  - 警告: 未在商品目录找到.png水印文件，跳过此步骤。');
    }

    // 6. 添加背景音乐并输出成品
    this.writeLog('[6/7] 添加背景音乐并输出成品...');
    const chengpinDir = path.join(productDir, '成品');
    await fs.promises.mkdir(chengpinDir, { recursive: true });

    const bgmFile = await this.getRandomFile(productDir, '.mp3');
    const existingFiles = await fs.promises.readdir(chengpinDir);
    const maxNum = existingFiles
      .map(f => parseInt(f.split('--')[0]))
      .filter(n => !isNaN(n))
      .reduce((max, n) => Math.max(max, n), 0);
    const finalOutputPath = path.join(
      chengpinDir,
      `${String(maxNum + 1).padStart(3, '0')}--${productName}.mp4`
    );

    if (bgmFile) {
      // 使用ffmpegUtil混合背景音乐
      await this.ffmpegUtil.mixBackgroundMusic(
        watermarkPath,
        bgmFile,
        finalOutputPath,
        0.15,
        '混合背景音乐'
      );
    } else {
      this.writeLog(
        '  - 警告: 未在商品目录找到.mp3背景音乐文件，将不添加背景音乐直接输出。'
      );
      await fs.promises.copyFile(watermarkPath, finalOutputPath);
    }
    this.writeLog(`  - 成品已输出到: ${finalOutputPath}`);

    // 7. 清理临时文件
    this.writeLog('[7/7] 清理临时文件...');
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    this.writeLog(`  - 已删除: ${tempDir}`);
  }

  /**
   * 获取目录下的随机文件（不搜索子目录）
   */
  private async getRandomFile(
    dirPath: string,
    ext: string
  ): Promise<string | null> {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const filteredFiles = entries
      .filter(
        entry =>
          entry.isFile() && entry.name.toLowerCase().endsWith(ext.toLowerCase())
      )
      .map(entry => entry.name);

    if (filteredFiles.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * filteredFiles.length);
    return path.join(dirPath, filteredFiles[randomIndex]);
  }

  private writeLog(message: string, type: LogEvent['type'] = 'info') {
    if (!message) {
      console.error('writeLog called with empty message');
      return;
    }

    writeLog.call(this, message, type);
  }
}
