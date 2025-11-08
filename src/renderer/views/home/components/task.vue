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
        <div class="w-7/10 grid grid-cols-4 gap-10">
          <div
            class="inline-flex text-nowrap items-center h-32 gap-6 text-[12px] text-gray-400 content-center text-right">
            生成条数
            <Input
              class="text-center"
              :readonly="task.running"
              v-model:value="task.generateCount" />
          </div>
          <div
            class="inline-flex text-nowrap items-center h-32 gap-6 text-[12px] text-gray-400 content-center text-right">
            PlayResX
            <Input
              class="text-center"
              :readonly="task.running"
              v-model:value="task.PlayResX" />
          </div>
          <div
            class="inline-flex text-nowrap items-center h-32 gap-6 text-[12px] text-gray-400 content-center text-right">
            PlayResY
            <Input
              class="text-center"
              :readonly="task.running"
              v-model:value="task.PlayResY" />
          </div>
          <div
            class="inline-flex text-nowrap items-center h-32 gap-6 text-[12px] text-gray-400 content-center text-right">
            Fontsize
            <Input
              class="text-center"
              :readonly="task.running"
              v-model:value="task.Fontsize" />
          </div>
          <div
            class="col-span-4 inline-flex text-nowrap items-center h-32 gap-6 text-[12px] text-gray-400 content-center text-right">
            Fontname
            <Select
              class="w-full text-center"
              :readonly="task.running"
              v-model:value="task.Fontname">
              <SelectOption value="思源黑体 CN">思源黑体 CN</SelectOption>
              <SelectOption value="思源宋体 CN Heavy"
                >思源宋体 CN Heavy</SelectOption
              >
              <SelectOption value="文悦新青年体 (非商用) W8"
                >文悦新青年体 (非商用) W8</SelectOption
              >
              <SelectOption value="阿里巴巴普惠体 3.0 105 Heavy"
                >阿里巴巴普惠体 3.0 105 Heavy</SelectOption
              >
            </Select>
          </div>
          <div
            class="inline-flex text-nowrap items-center h-32 gap-6 text-[12px] text-gray-400 content-center text-right">
            MarginV
            <Input
              class="text-center"
              :readonly="task.running"
              v-model:value="task.MarginV" />
          </div>
          <div
            class="inline-flex text-nowrap items-center h-32 gap-6 text-[12px] text-gray-400 content-center text-right">
            Outline
            <Input
              class="text-center"
              :readonly="task.running"
              v-model:value="task.Outline" />
          </div>
          <div
            class="inline-flex text-nowrap items-center h-32 gap-6 text-[12px] text-gray-400 content-center text-right">
            OutlineColour
            <Input
              class="text-center"
              :readonly="task.running"
              v-model:value="task.OutlineColour" />
          </div>
          <div
            class="inline-flex text-nowrap items-center h-32 gap-6 text-[12px] text-gray-400 content-center text-right">
            PrimaryColour
            <Input
              class="text-center"
              :readonly="task.running"
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
import {
  Input,
  Select,
  SelectOption,
  Table,
  Button,
  type TableColumnType,
} from 'ant-design-vue';

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
  Fontname: '思源黑体 CN',
  Fontsize: 55,
  PrimaryColour: '&HFFFFFF',
  Outline: 3,
  OutlineColour: '&H4100FF',
  MarginV: 300,
});
const tableData = ref<any[]>([]);

async function startHandler() {
  const config = Object.assign(
    { productDir: task.taskDirectory, count: task.generateCount },
    { ...task }
  );
  await ipcRendererChannel.StartProcessing.invoke(config);
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
