import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { platform } from 'os';

export interface FFmpegProgressEvent {
  progress: number;
  operation: string;
}

export interface VideoSegment {
  fragmentDuration: number;
  filePath: string;
}

export class FFmpegUtil extends EventEmitter {
  private static instance: FFmpegUtil;
  private ffmpegPath!: string;
  private ffprobePath!: string;

  private constructor() {
    super();
    this.setupPaths();
  }

  public static getInstance(): FFmpegUtil {
    if (!FFmpegUtil.instance) {
      FFmpegUtil.instance = new FFmpegUtil();
    }
    return FFmpegUtil.instance;
  }

  private setupPaths(): void {
    const isWindows = platform() === 'win32';
    const ext = isWindows ? '.exe' : '';

    // 开发环境路径 - 项目根目录下的 resources 文件夹
    const devResourcesPath = path.join(process.cwd(), 'resources');
    const devFFmpegPath = path.join(devResourcesPath, `ffmpeg${ext}`);
    const devFFprobePath = path.join(devResourcesPath, `ffprobe${ext}`);

    // 生产环境路径 - Electron 的 resources 目录
    const prodResourcesPath = process.resourcesPath || '';
    const prodFFmpegPath = path.join(prodResourcesPath, `ffmpeg${ext}`);
    const prodFFprobePath = path.join(prodResourcesPath, `ffprobe${ext}`);

    // 设置 ffmpeg 路径
    if (fs.existsSync(devFFmpegPath)) {
      this.ffmpegPath = devFFmpegPath;
    } else if (fs.existsSync(prodFFmpegPath)) {
      this.ffmpegPath = prodFFmpegPath;
    } else {
      // 尝试使用系统 PATH 中的 ffmpeg
      this.ffmpegPath = 'ffmpeg';
    }

    // 设置 ffprobe 路径
    if (fs.existsSync(devFFprobePath)) {
      this.ffprobePath = devFFprobePath;
    } else if (fs.existsSync(prodFFprobePath)) {
      this.ffprobePath = prodFFprobePath;
    } else {
      // 尝试使用系统 PATH 中的 ffprobe
      this.ffprobePath = 'ffprobe';
    }

    // 发送路径设置日志
    this.emit('log', {
      message: `FFmpeg路径设置为: ${this.ffmpegPath}`,
      type: 'info',
    });
    this.emit('log', {
      message: `FFprobe路径设置为: ${this.ffprobePath}`,
      type: 'info',
    });
  }

  /**
   * 标准化Windows路径，避免MAX_PATH限制问题
   */
  private normalizeWindowsPath(filePath: string): string {
    if (process.platform === 'win32') {
      // Windows绝对路径添加\\?\前缀
      if (/^[a-zA-Z]:\\/.test(filePath) && !filePath.startsWith('\\\\?\\')) {
        return '\\\\?\\' + filePath;
      }
    }
    return filePath;
  }

  /**
   * 执行FFmpeg命令
   */
  private executeFFmpegCommand(
    command: string,
    operationName: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.emit('log', {
        message: `执行FFmpeg命令: ${command}`,
        type: 'debug',
      });

      const childProcess = exec(command, (error, stdout, stderr) => {
        if (error) {
          this.emit('log', {
            message: `[FFmpeg错误] ${operationName} 失败: ${error.message}`,
            type: 'error',
          });
          reject(new Error(`FFmpeg处理失败: ${error.message}`));
          return;
        }

        this.emit('log', {
          message: `[FFmpeg完成] ${operationName} 操作成功完成`,
          type: 'debug',
        });
        resolve();
      });

      // 处理进度信息
      childProcess.stderr?.on('data', data => {
        const output = data.toString();

        // 尝试解析进度信息
        const progressMatch = output.match(
          /frame=\s*\d+\s+fps=\s*\d+(?:\.\d+)?\s+q=\s*\d+(?:\.\d+)?\s+size=\s*\d+(?:\.\d+)?\s+time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)\s+bitrate=\s*\d+(?:\.\d+)?kbits\/s/
        );

        if (progressMatch) {
          const hours = parseInt(progressMatch[1], 10);
          const minutes = parseInt(progressMatch[2], 10);
          const seconds = parseFloat(progressMatch[3]);
          const totalSeconds = hours * 3600 + minutes * 60 + seconds;

          // 这里需要知道总时长来计算百分比，但我们没有直接获取
          // 所以我们只发送时间信息，由调用者计算百分比
          this.emit('log', {
            message: `[FFmpeg进度] ${operationName}: 已处理时间=${hours}:${minutes}:${seconds.toFixed(
              2
            )}`,
            type: 'debug',
          });

          // 如果有总时长信息，可以计算并发送进度百分比
          // this.emit('progress', {
          //   progress: (totalSeconds / totalDuration) * 100,
          //   operation: operationName,
          // });
        }
      });
    });
  }

  /**
   * 获取视频时长
   */
  public getVideoDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.emit('log', {
        message: `开始获取视频时长: ${filePath}`,
        type: 'debug',
      });

      const command = `"${this.ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          const errorMsg = `获取视频时长失败: ${error.message}`;
          this.emit('log', {
            message: errorMsg,
            type: 'error',
          });
          reject(new Error(errorMsg));
          return;
        }

        const duration = parseFloat(stdout.trim());
        if (isNaN(duration)) {
          const errorMsg = '无法从视频元数据中获取时长';
          this.emit('log', {
            message: errorMsg,
            type: 'error',
          });
          reject(new Error(errorMsg));
          return;
        }

        this.emit('log', {
          message: `视频时长获取成功: ${duration}秒`,
          type: 'debug',
        });
        resolve(duration);
      });
    });
  }

  /**
   * 调整视频速度
   */
  public adjustSpeed(
    inputPath: string,
    outputPath: string,
    speed: number,
    operationName = '变速处理'
  ): Promise<void> {
    this.emit('log', {
      message: `开始${operationName}: 输入=${inputPath}, 输出=${outputPath}, 速度=${speed}`,
      type: 'info',
    });

    return new Promise((resolve, reject) => {
      const command = `"${this.ffmpegPath}" -i "${inputPath}" -vf "setpts=${
        1 / speed
      }*PTS" -an "${outputPath}"`;

      this.executeFFmpegCommand(command, operationName)
        .then(() => {
          this.emit('log', {
            message: `${operationName}完成: ${outputPath}`,
            type: 'info',
          });
          resolve();
        })
        .catch(error => {
          this.emit('log', {
            message: `${operationName}失败: ${error.message}`,
            type: 'error',
          });
          reject(error);
        });
    });
  }

  /**
   * 截取视频前N秒
   */
  public trimVideo(
    inputPath: string,
    outputPath: string,
    cutSeconds = 20,
    operationName = '截取处理'
  ): Promise<void> {
    this.emit('log', {
      message: `开始${operationName}: 输入=${inputPath}, 输出=${outputPath}, 截取时长=${cutSeconds}秒`,
      type: 'info',
    });

    return new Promise((resolve, reject) => {
      const command = `"${this.ffmpegPath}" -i "${inputPath}" -t ${cutSeconds} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -vf "scale=720:1280" -r 30 -movflags +faststart "${outputPath}"`;

      this.executeFFmpegCommand(command, operationName)
        .then(() => {
          this.emit('log', {
            message: `${operationName}完成: ${outputPath}`,
            type: 'info',
          });
          resolve();
        })
        .catch(error => {
          this.emit('log', {
            message: `${operationName}失败: ${error.message}`,
            type: 'error',
          });
          reject(error);
        });
    });
  }

  /**
   * 合并视频文件
   */
  public concatVideos(
    videoFiles: string[],
    outputPath: string,
    operationName = '合并进度'
  ): Promise<void> {
    this.emit('log', {
      message: `开始${operationName}: 输出=${outputPath}, 文件数量=${videoFiles.length}`,
      type: 'info',
    });

    return new Promise((resolve, reject) => {
      // 创建临时目录
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        this.emit('log', {
          message: `创建临时目录: ${tempDir}`,
          type: 'debug',
        });
      }

      // 创建 concat 列表文件
      const listPath = path.join(tempDir, `concat_list_${Date.now()}.txt`);
      const listContent = videoFiles
        .map(file => `file '${path.resolve(file)}'`)
        .join('\n');

      try {
        fs.writeFileSync(listPath, listContent);
        this.emit('log', {
          message: `创建concat列表文件: ${listPath}`,
          type: 'debug',
        });
      } catch (error) {
        const errorMsg = `创建列表文件失败: ${(error as Error).message}`;
        this.emit('log', {
          message: errorMsg,
          type: 'error',
        });
        reject(new Error(errorMsg));
        return;
      }

      // 执行合并命令
      const command = `"${this.ffmpegPath}" -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`;

      this.executeFFmpegCommand(command, operationName)
        .then(() => {
          // 清理临时文件
          try {
            if (fs.existsSync(listPath)) {
              fs.unlinkSync(listPath);
              this.emit('log', {
                message: `清理临时文件: ${listPath}`,
                type: 'debug',
              });
            }
          } catch (e) {
            const errorMsg = `清理临时文件失败: ${(e as Error).message}`;
            this.emit('log', {
              message: errorMsg,
              type: 'warn',
            });
          }
          this.emit('log', {
            message: `${operationName}完成: ${outputPath}`,
            type: 'info',
          });
          resolve();
        })
        .catch(error => {
          // 清理临时文件
          try {
            if (fs.existsSync(listPath)) {
              fs.unlinkSync(listPath);
              this.emit('log', {
                message: `清理临时文件: ${listPath}`,
                type: 'debug',
              });
            }
          } catch (e) {
            const errorMsg = `清理临时文件失败: ${(e as Error).message}`;
            this.emit('log', {
              message: errorMsg,
              type: 'warn',
            });
          }
          this.emit('log', {
            message: `${operationName}失败: ${error.message}`,
            type: 'error',
          });
          reject(error);
        });
    });
  }

  /**
   * 拆解视频文件 - 将长视频拆分为多个短视频
   */
  public splitVideo(
    inputPath: string,
    outputDir: string,
    segmentDuration: number = 20,
    operationName = '视频拆解'
  ): Promise<string[]> {
    this.emit('log', {
      message: `开始${operationName}: 输入=${inputPath}, 输出目录=${outputDir}, 片段时长=${segmentDuration}秒`,
      type: 'info',
    });

    return new Promise(async (resolve, reject) => {
      try {
        // 1. 获取视频总时长
        const totalDuration = await this.getVideoDuration(inputPath);
        this.emit('log', {
          message: `视频总时长: ${totalDuration}秒`,
          type: 'debug',
        });

        // 2. 计算需要拆分成多少段
        const segmentCount = Math.ceil(totalDuration / segmentDuration);
        this.emit('log', {
          message: `将拆分为 ${segmentCount} 个片段`,
          type: 'debug',
        });

        // 3. 创建输出目录
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
          this.emit('log', {
            message: `创建输出目录: ${outputDir}`,
            type: 'debug',
          });
        }

        // 4. 准备输出文件路径数组
        const outputFiles: string[] = [];

        // 5. 循环处理每一段
        for (let i = 0; i < segmentCount; i++) {
          const startTime = i * segmentDuration;
          // 最后一段使用剩余时长
          const duration =
            i === segmentCount - 1
              ? totalDuration - startTime
              : segmentDuration;

          // 生成输出文件名，使用3位数字序号
          const fileName = `part_${String(i + 1).padStart(3, '0')}.mp4`;
          const outputPath = path.join(outputDir, fileName);
          outputFiles.push(outputPath);

          this.emit('log', {
            message: `处理片段 ${
              i + 1
            }/${segmentCount}: 开始时间=${startTime}秒, 时长=${duration}秒, 输出=${outputPath}`,
            type: 'debug',
          });

          // 截取当前段
          await this.trimSegment(
            inputPath,
            outputPath,
            startTime,
            duration,
            `${operationName} - 段 ${i + 1}/${segmentCount}`
          );

          // 更新进度
          const progress = ((i + 1) / segmentCount) * 100;
          this.emit('progress', {
            progress,
            operation: operationName,
          });
        }

        this.emit('log', {
          message: `${operationName}完成: 生成${outputFiles.length}个片段`,
          type: 'info',
        });
        resolve(outputFiles);
      } catch (error) {
        this.emit('log', {
          message: `${operationName}失败: ${(error as Error).message}`,
          type: 'error',
        });
        reject(error);
      }
    });
  }

  /**
   * 根据片段信息拆解视频文件
   */
  public splitVideoBySegments(
    inputPath: string,
    segments: VideoSegment[],
    operationName = '按片段拆解视频'
  ): Promise<string[]> {
    this.emit('log', {
      message: `开始${operationName}: 输入=${inputPath}, 片段数量=${segments.length}`,
      type: 'info',
    });

    return new Promise(async (resolve, reject) => {
      try {
        // 1. 验证输入视频是否存在
        if (!fs.existsSync(inputPath)) {
          const errorMsg = `输入视频文件不存在: ${inputPath}`;
          this.emit('log', {
            message: errorMsg,
            type: 'error',
          });
          reject(new Error(errorMsg));
          return;
        }

        // 2. 获取视频总时长
        const totalDuration = await this.getVideoDuration(inputPath);
        this.emit('log', {
          message: `视频总时长: ${totalDuration}秒`,
          type: 'debug',
        });

        // 3. 验证片段信息
        if (!segments || segments.length === 0) {
          const errorMsg = '片段信息数组不能为空';
          this.emit('log', {
            message: errorMsg,
            type: 'error',
          });
          reject(new Error(errorMsg));
          return;
        }

        // 4. 计算所有片段的总时长
        const segmentsTotalDuration = segments.reduce(
          (sum, segment) => sum + segment.fragmentDuration,
          0
        );
        this.emit('log', {
          message: `片段总时长: ${segmentsTotalDuration}秒`,
          type: 'debug',
        });

        // 5. 验证片段总时长是否超过视频总时长
        if (segmentsTotalDuration > totalDuration) {
          const warnMsg = `片段总时长(${segmentsTotalDuration}秒)超过视频总时长(${totalDuration}秒)，将只处理视频时长范围内的部分`;
          this.emit('log', {
            message: warnMsg,
            type: 'warn',
          });
        }

        // 6. 准备输出文件路径数组
        const outputFiles: string[] = [];

        // 7. 循环处理每个片段
        let currentStartTime = 0;
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];

          // 如果当前开始时间已经超过视频总时长，则停止处理
          if (currentStartTime >= totalDuration) {
            const warnMsg = `已达到视频总时长，停止处理剩余片段`;
            this.emit('log', {
              message: warnMsg,
              type: 'warn',
            });
            break;
          }

          // 计算当前片段的实际时长（不超过剩余视频时长）
          const remainingDuration = totalDuration - currentStartTime;
          const actualDuration = Math.min(
            segment.fragmentDuration,
            remainingDuration
          );

          // 确保输出目录存在
          const outputDir = path.dirname(segment.filePath);
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
            this.emit('log', {
              message: `创建输出目录: ${outputDir}`,
              type: 'debug',
            });
          }

          this.emit('log', {
            message: `处理片段 ${i + 1}/${
              segments.length
            }: 开始时间=${currentStartTime}秒, 时长=${actualDuration}秒, 输出=${
              segment.filePath
            }`,
            type: 'debug',
          });

          // 截取当前片段
          await this.trimSegment(
            inputPath,
            segment.filePath,
            currentStartTime,
            actualDuration,
            `${operationName} - 片段 ${i + 1}/${segments.length}`
          );

          // 添加到输出文件列表
          outputFiles.push(segment.filePath);

          // 更新开始时间
          currentStartTime += actualDuration;

          // 更新进度
          const progress = ((i + 1) / segments.length) * 100;
          this.emit('progress', {
            progress,
            operation: operationName,
          });
        }

        this.emit('log', {
          message: `${operationName}完成: 生成${outputFiles.length}个片段`,
          type: 'info',
        });
        resolve(outputFiles);
      } catch (error) {
        this.emit('log', {
          message: `${operationName}失败: ${(error as Error).message}`,
          type: 'error',
        });
        reject(error);
      }
    });
  }

  /**
   * 截取视频片段
   */
  public trimSegment(
    inputPath: string,
    outputPath: string,
    startTime: number,
    duration: number,
    operationName: string
  ): Promise<void> {
    this.emit('log', {
      message: `开始${operationName}: 输入=${inputPath}, 输出=${outputPath}, 开始时间=${startTime}秒, 时长=${duration}秒`,
      type: 'debug',
    });

    return new Promise((resolve, reject) => {
      const command = `"${this.ffmpegPath}" -ss ${startTime} -i "${inputPath}" -t ${duration} -c copy -an "${outputPath}"`;

      this.executeFFmpegCommand(command, operationName)
        .then(() => {
          this.emit('log', {
            message: `${operationName}完成: ${outputPath}`,
            type: 'debug',
          });
          resolve();
        })
        .catch(error => {
          this.emit('log', {
            message: `${operationName}失败: ${error.message}`,
            type: 'error',
          });
          reject(error);
        });
    });
  }

  /**
   * 验证输出视频
   */
  public verifyOutputVideo(filePath: string): Promise<void> {
    this.emit('log', {
      message: `开始验证输出视频: ${filePath}`,
      type: 'debug',
    });

    return new Promise((resolve, reject) => {
      this.getVideoDuration(filePath)
        .then(duration => {
          if (Math.abs(duration - 20) > 1) {
            const errorMsg = `输出视频时长异常: ${duration}秒`;
            this.emit('log', {
              message: errorMsg,
              type: 'error',
            });
            reject(new Error(errorMsg));
          } else {
            this.emit('log', {
              message: `输出视频验证成功: ${filePath}, 时长=${duration}秒`,
              type: 'debug',
            });
            resolve();
          }
        })
        .catch(error => {
          this.emit('log', {
            message: `输出视频验证失败: ${error.message}`,
            type: 'error',
          });
          reject(error);
        });
    });
  }

  /**
   * 提取视频音频
   */
  public extractAudio(
    inputPath: string,
    outputPath: string,
    operationName = '音频分离'
  ): Promise<void> {
    this.emit('log', {
      message: `开始${operationName}: 输入=${inputPath}, 输出=${outputPath}`,
      type: 'info',
    });

    return new Promise((resolve, reject) => {
      const command = `"${this.ffmpegPath}" -i "${inputPath}" -acodec mp3 -b:a 192k "${outputPath}"`;

      this.executeFFmpegCommand(command, operationName)
        .then(() => {
          this.emit('log', {
            message: `${operationName}完成: ${outputPath}`,
            type: 'info',
          });
          resolve();
        })
        .catch(error => {
          this.emit('log', {
            message: `${operationName}失败: ${error.message}`,
            type: 'error',
          });
          reject(error);
        });
    });
  }

  /**
   * 添加字幕
   */
  public addSubtitles(
    inputPath: string,
    subtitlePath: string,
    outputPath: string,
    subtitleStyle: string,
    operationName = '添加字幕'
  ): Promise<void> {
    this.emit('log', {
      message: `开始${operationName}: 输入=${inputPath}, 字幕=${subtitlePath}, 输出=${outputPath}`,
      type: 'info',
    });

    return new Promise((resolve, reject) => {
      // 处理路径中的特殊字符，确保在命令中正确使用
      const srtFilterPath = subtitlePath
        .replace(/\\/g, '/')
        .replace(/:/g, '\\:');

      const command = `"${this.ffmpegPath}" -i "${inputPath}" -vf "subtitles='${srtFilterPath}':force_style='${subtitleStyle}'" -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}"`;

      this.executeFFmpegCommand(command, operationName)
        .then(() => {
          this.emit('log', {
            message: `${operationName}完成: ${outputPath}`,
            type: 'info',
          });
          resolve();
        })
        .catch(error => {
          this.emit('log', {
            message: `${operationName}失败: ${error.message}`,
            type: 'error',
          });
          reject(error);
        });
    });
  }

  /**
   * 添加图片水印
   */
  public addWatermark(
    inputPath: string,
    watermarkPath: string,
    outputPath: string,
    position: string = 'W-w-10:H-h-10',
    operationName = '添加水印'
  ): Promise<void> {
    this.emit('log', {
      message: `开始${operationName}: 输入=${inputPath}, 水印=${watermarkPath}, 输出=${outputPath}, 位置=${position}`,
      type: 'info',
    });

    return new Promise((resolve, reject) => {
      const command = `"${this.ffmpegPath}" -i "${inputPath}" -i "${watermarkPath}" -filter_complex "overlay=${position}" -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}"`;

      this.executeFFmpegCommand(command, operationName)
        .then(() => {
          this.emit('log', {
            message: `${operationName}完成: ${outputPath}`,
            type: 'info',
          });
          resolve();
        })
        .catch(error => {
          this.emit('log', {
            message: `${operationName}失败: ${error.message}`,
            type: 'error',
          });
          reject(error);
        });
    });
  }

  /**
   * 混合背景音乐
   */
  public mixBackgroundMusic(
    inputPath: string,
    bgmPath: string,
    outputPath: string,
    bgmVolume: number = 0.15,
    operationName = '混合背景音乐'
  ): Promise<void> {
    this.emit('log', {
      message: `开始${operationName}: 输入=${inputPath}, 背景音乐=${bgmPath}, 输出=${outputPath}, 音量=${bgmVolume}`,
      type: 'info',
    });

    return new Promise((resolve, reject) => {
      const command = `"${this.ffmpegPath}" -i "${inputPath}" -stream_loop -1 -i "${bgmPath}" -filter_complex "[0:a]volume=1.0[a0];[1:a]volume=${bgmVolume}[a1];[a0][a1]amix=inputs=2:duration=first[a]" -map 0:v -map "[a]" -c:v copy -shortest "${outputPath}"`;

      this.executeFFmpegCommand(command, operationName)
        .then(() => {
          this.emit('log', {
            message: `${operationName}完成: ${outputPath}`,
            type: 'info',
          });
          resolve();
        })
        .catch(error => {
          this.emit('log', {
            message: `${operationName}失败: ${error.message}`,
            type: 'error',
          });
          reject(error);
        });
    });
  }

  /**
   * 合并多个视频片段（使用concat方式）
   */
  public concatVideoSegments(
    inputPath: string,
    outputPath: string,
    operationName = '合并视频片段'
  ): Promise<void> {
    this.emit('log', {
      message: `开始${operationName}: 文件名=${inputPath};输出=${outputPath}`,
      type: 'info',
    });

    return new Promise((resolve, reject) => {
      // 执行合并命令
      const command = `"${this.ffmpegPath}" -f concat -safe 0 -i "${inputPath}" -c copy "${outputPath}"`;

      this.executeFFmpegCommand(command, operationName)
        .then(() => {
          this.emit('log', {
            message: `${operationName}完成: ${outputPath}`,
            type: 'info',
          });
          resolve();
        })
        .catch(error => {
          this.emit('log', {
            message: `${operationName}失败: ${error.message}`,
            type: 'error',
          });
          reject(error);
        });
    });
  }

  /**
   * 为视频添加音频（替换或添加音频轨道）
   */
  public addAudioToVideo(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    operationName = '添加音频到视频'
  ): Promise<void> {
    this.emit('log', {
      message: `开始${operationName}: 视频=${videoPath}, 音频=${audioPath}, 输出=${outputPath}`,
      type: 'info',
    });

    return new Promise((resolve, reject) => {
      const command = `"${this.ffmpegPath}" -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${outputPath}"`;

      this.executeFFmpegCommand(command, operationName)
        .then(() => {
          this.emit('log', {
            message: `${operationName}完成: ${outputPath}`,
            type: 'info',
          });
          resolve();
        })
        .catch(error => {
          this.emit('log', {
            message: `${operationName}失败: ${error.message}`,
            type: 'error',
          });
          reject(error);
        });
    });
  }
}
