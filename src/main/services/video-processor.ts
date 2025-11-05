import { promises as fs } from 'fs';
import path from 'path';
import { FFmpegUtil } from '../lib/ffmpeg';

type LogFunction = (message: string) => void;
type StopCheckFunction = () => boolean;

// 辅助函数：获取目录下的随机文件（不搜索子目录）
async function getRandomFile(
  dirPath: string,
  ext: string
): Promise<string | null> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
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

// 主生成循环
export async function generateVideos(
  productDir: string,
  count: number,
  log: LogFunction,
  stopRequested: StopCheckFunction
) {
  const ffmpegUtil = FFmpegUtil.getInstance();

  for (let i = 1; i <= count; i++) {
    if (stopRequested()) {
      log('🚦 收到停止请求，已终止后续任务。');
      return;
    }
    log(`\n🎬 [${i}/${count}] 开始生成第 ${i} 条视频...`);
    try {
      await generateSingleVideo(productDir, i, log, ffmpegUtil);
      log(`✅ [${i}/${count}] 第 ${i} 条视频生成成功！`);
    } catch (error) {
      log(
        `❌ [${i}/${count}] 第 ${i} 条视频生成失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

async function generateSingleVideo(
  productDir: string,
  index: number,
  log: LogFunction,
  ffmpegUtil: FFmpegUtil
) {
  // 1. 初始化
  const productName = path.basename(productDir);
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const tempDir = path.join(productDir, `temp_${index}_${randomSuffix}`);
  await fs.mkdir(tempDir, { recursive: true });
  log(`[1/7] 创建临时目录: ${tempDir}`);

  const subtitleData: { text: string; duration: number }[] = [];
  let sceneIndex = 0;

  // 2. 场景视频合成
  log('[2/7] 开始处理场景视频...');
  const sceneDirs = (await fs.readdir(productDir, { withFileTypes: true }))
    .filter(d => d.isDirectory() && /^[A-Z]$/.test(d.name))
    .map(d => d.name)
    .sort();

  const processedVideoPaths: string[] = [];

  for (const scene of sceneDirs) {
    sceneIndex++;
    const scenePath = path.join(productDir, scene);
    const audioPath = await getRandomFile(scenePath, '.mp3');
    const videoPath = await getRandomFile(scenePath, '.mp4');

    if (!audioPath || !videoPath) {
      log(`  - 警告: 场景 ${scene} 缺少 MP3 或 MP4 文件，跳过。`);
      continue;
    }
    log(
      `  - 处理场景 ${scene} (音频: ${path.basename(
        audioPath
      )}, 视频: ${path.basename(videoPath)})`
    );

    const audioDuration = await ffmpegUtil.getVideoDuration(audioPath);
    const videoDuration = await ffmpegUtil.getVideoDuration(videoPath);

    const subtitleText = path.parse(audioPath).name;
    subtitleData.push({ text: subtitleText, duration: audioDuration });

    const processedVideoPath = path.join(tempDir, `process_${sceneIndex}.mp4`);
    processedVideoPaths.push(processedVideoPath);

    if (videoDuration < audioDuration) {
      const speed = videoDuration / audioDuration;
      // 使用ffmpegUtil调整视频速度
      await ffmpegUtil.adjustSpeed(
        videoPath,
        processedVideoPath,
        speed,
        `处理场景 ${scene} - 调整速度`
      );
    } else {
      const startTime = (videoDuration - audioDuration) / 2;
      // 使用ffmpegUtil截取视频片段
      await ffmpegUtil.trimSegment(
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
    await ffmpegUtil.addAudioToVideo(
      processedVideoPath,
      audioPath,
      addAudioPath,
      `为场景 ${scene} 添加音频`
    );
  }

  // 3. 合并所有场景
  log('[3/7] 合并所有场景视频...');
  const mergePath = path.join(tempDir, 'merge.mp4');

  if (processedVideoPaths.length === 0) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw new Error('没有可以合并的场景视频，请检查 A,B,C... 文件夹内的素材。');
  }

  // 使用ffmpegUtil合并视频片段
  await ffmpegUtil.concatVideoSegments(
    processedVideoPaths,
    mergePath,
    '合并场景视频'
  );

  // 4. 添加字幕
  log('[4/7] 生成并添加字幕...');
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
  await fs.writeFile(srtPath, srtContent);

  const subtitleStyle = [
    'Fontsize=9',
    'PrimaryColour=&HFFFFFF',
    'BorderStyle=1',
    'Outline=1',
    'OutlineColour=&H000000',
    'Alignment=2',
    'MarginL=20',
    'MarginR=20',
    'MarginV=60',
  ].join(',');
  const mergeSubtitlePath = path.join(tempDir, 'merge_subtitle.mp4');
  // 使用ffmpegUtil添加字幕
  await ffmpegUtil.addSubtitles(
    mergePath,
    srtPath,
    mergeSubtitlePath,
    subtitleStyle,
    '添加字幕'
  );

  // 5. 添加图片水印
  log('[5/7] 添加图片水印...');
  const watermarkFile = await getRandomFile(productDir, '.png');
  let watermarkPath = mergeSubtitlePath;
  if (watermarkFile) {
    watermarkPath = path.join(tempDir, 'merge_subtitle_watermark.mp4');
    // 使用ffmpegUtil添加水印
    await ffmpegUtil.addWatermark(
      mergeSubtitlePath,
      watermarkFile,
      watermarkPath,
      'W-w-10:H-h-10',
      '添加水印'
    );
  } else {
    log('  - 警告: 未在商品目录找到.png水印文件，跳过此步骤。');
  }

  // 6. 添加背景音乐并输出成品
  log('[6/7] 添加背景音乐并输出成品...');
  const chengpinDir = path.join(productDir, '成品');
  await fs.mkdir(chengpinDir, { recursive: true });

  const bgmFile = await getRandomFile(productDir, '.mp3');
  const existingFiles = await fs.readdir(chengpinDir);
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
    await ffmpegUtil.mixBackgroundMusic(
      watermarkPath,
      bgmFile,
      finalOutputPath,
      0.15,
      '混合背景音乐'
    );
  } else {
    log(
      '  - 警告: 未在商品目录找到.mp3背景音乐文件，将不添加背景音乐直接输出。'
    );
    await fs.copyFile(watermarkPath, finalOutputPath);
  }
  log(`  - 成品已输出到: ${finalOutputPath}`);

  // 7. 清理临时文件
  log('[7/7] 清理临时文件...');
  await fs.rm(tempDir, { recursive: true, force: true });
  log(`  - 已删除: ${tempDir}`);
}
