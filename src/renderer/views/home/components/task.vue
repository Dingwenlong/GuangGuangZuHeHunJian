<template>
  <div
    class="w-full h-full grid overflow-auto"
    style="grid-template-rows: minmax(min-content, 120px) minmax(200px, 1fr)">
    <div class="mb-15 flex flex-row items-center flex-wrap gap-10">
      <div class="w-full flex justify-between flex-row items-center gap-10">
        <Input
          readonly
          v-model:value="task.taskDirectory"
          placeholder="点击选择商品目录文件夹"
          @click="selectDirectoryHandler" />
      </div>
      <div class="w-full flex flex-row justify-between gap-10">
        <div class="grid grid-cols-4 gap-10">
          <div class="h-32 text-[12px] text-gray-400 content-center text-right">
            生成条数
            <Input
              class="w-80! text-center"
              :readonly="task.running"
              v-model:value="task.generateCount" />
          </div>
          <div class="h-32 text-[12px] text-gray-400 content-center text-right">
            PlayResX
            <Input
              class="w-80! text-center"
              :readonly="task.running"
              v-model:value="task.PlayResX" />
          </div>
          <div class="h-32 text-[12px] text-gray-400 content-center text-right">
            PlayResY
            <Input
              class="w-80! text-center"
              :readonly="task.running"
              v-model:value="task.PlayResY" />
          </div>
          <div class="h-32 text-[12px] text-gray-400 content-center text-right">
            Fontsize
            <Input
              class="w-80! text-center"
              :readonly="task.running"
              v-model:value="task.Fontsize" />
          </div>
          <div class="h-32 text-[12px] text-gray-400 content-center text-right">
            MarginV
            <Input
              class="w-80! text-center"
              :readonly="task.running"
              v-model:value="task.MarginV" />
          </div>
          <div class="h-32 text-[12px] text-gray-400 content-center text-right">
            Outline
            <Input
              class="w-80! text-center"
              :readonly="task.running"
              v-model:value="task.Outline" />
          </div>
          <div class="h-32 text-[12px] text-gray-400 content-center text-right">
            OutlineColour
            <Input
              class="w-80! text-center"
              :style="
                'background-color:' +
                task.OutlineColour.replace('&H', '#').slice(0, 7)
              "
              :readonly="task.running"
              v-model:value="task.OutlineColour" />
          </div>
          <div class="h-32 text-[12px] text-gray-400 content-center text-right">
            PrimaryColour
            <Input
              class="w-80! text-center"
              :style="
                'background-color:' +
                task.PrimaryColour.replace('&H', '#').slice(0, 7)
              "
              v-model:value="task.PrimaryColour" />
          </div>
        </div>
        <div class="flex gap-10">
          <Button
            type="primary"
            v-show="task.running"
            :loading="task.stopping"
            :disabled="task.stopping"
            @click="stopHandler"
            >结束</Button
          >
          <Button
            type="primary"
            :loading="task.running"
            :disabled="!task.taskDirectory || task.running"
            @click="startHandler"
            >{{ task.running ? '运行中' : '开始' }}</Button
          >
        </div>
      </div>
    </div>
    <div class="mb-15 h-full overflow-auto">
      <Table
        :columns="columns"
        :data-source="tableData"
        :pagination="false"
        size="small"
        :scroll="{
          scrollToFirstRowOnChange: true,
        }"
        bordered>
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'second'">
            <p
              v-for="(item, index) in record.second"
              :key="index"
              style="margin: 4px 0">
              {{ item }}
            </p>
          </template>
          <template v-else-if="column.key === 'action'" class="text-center">
            <Button
              type="text"
              @click="
                openFolderHandler(task.taskDirectory + '\\' + record.first)
              "
              >打开文件夹</Button
            >
          </template>
        </template>
      </Table>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, reactive, watch } from 'vue';
import { Input, Table, Button, type TableColumnType } from 'ant-design-vue';

const { shell, ipcRendererChannel } = window;
const columns: TableColumnType[] = [
  {
    title: '一级目录',
    dataIndex: 'first',
    key: 'first',
    width: '30%',
    align: 'center',
  },
  {
    title: '二级目录',
    dataIndex: 'second',
    key: 'second',
    width: '50%',
    align: 'center',
  },
  {
    title: '操作',
    key: 'action',
    align: 'center',
    width: '20%',
  },
];
const task = reactive({
  taskDirectory: '',
  generateCount: 10,
  running: false,
  stopping: false,
  PlayResX: 1080,
  PlayResY: 1920,
  Fontsize: 55,
  PrimaryColour: '&HFFFFFF',
  Outline: 3,
  OutlineColour: '&H4100FF',
  MarginV: 300,
});
const tableData = ref<any[]>([]);

async function startHandler() {
  await ipcRendererChannel.StartProcessing.invoke({
    productDir: task.taskDirectory,
    count: task.generateCount,
    PlayResX: task.PlayResX,
    PlayResY: task.PlayResY,
    Fontsize: task.Fontsize,
    PrimaryColour: task.PrimaryColour,
    Outline: task.Outline,
    OutlineColour: task.OutlineColour,
    MarginV: task.MarginV,
  });
}

async function stopHandler() {
  if (task.stopping) return;

  await ipcRendererChannel.StopProcessing.invoke();
  task.stopping = true;
}

/**
 * 打开文件夹
 */
function openFolderHandler(dir: any) {
  shell.openPath(dir);
}

/**
 * 选择文件夹
 */
async function selectDirectoryHandler() {
  task.taskDirectory = await ipcRendererChannel.SelectDirectory.invoke();
}

watch(task, async (newValue, oldValue) => {
  if (newValue.taskDirectory != oldValue.taskDirectory)
    await ipcRendererChannel.StopMonitoringDirectory.invoke(
      oldValue.taskDirectory
    );
  if (newValue.taskDirectory)
    await ipcRendererChannel.StartMonitoringDirectory.invoke(
      newValue.taskDirectory
    );
});

onMounted(async () => {
  // task.taskDirectory =
  //   await ipcRendererChannel.GetDefaultTaskDirectory.invoke();
  ipcRendererChannel.MonitoringDirectoryCallback.on(
    (_, arg: { root: string; structure: any[] }) => {
      const { root, structure } = arg;
      if (root === task.taskDirectory) {
        tableData.value = structure
          .sort((a, b) => a.name.localeCompare(b.name))
          .filter(dir => dir.children && dir.name.indexOf('temp_') === -1)
          .map(dir => {
            return {
              first: dir.name,
              second: dir.children
                .sort((a: { name: string }, b: { name: any }) =>
                  a.name.localeCompare(b.name)
                )
                .map((file: { name: any }) => file.name),
            };
          });
      }
    }
  );
  ipcRendererChannel.ProcessingState.on((_, arg: { isProcessing: boolean }) => {
    task.running = arg.isProcessing;

    if (!task.running) {
      task.stopping = false;
    }
  });
});

onUnmounted(() => {
  // 移除文件夹变化监听事件
  ipcRendererChannel.MonitoringDirectoryCallback.removeAllListeners();
  ipcRendererChannel.ProcessingState.removeAllListeners();
});
</script>
