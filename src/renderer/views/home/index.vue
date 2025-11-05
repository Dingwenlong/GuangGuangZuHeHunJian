<template>
  <div class="h-full flex flex-row justify-between">
    <div class="w-full h-full bg-white p-15">
      <Task />
    </div>
    <div class="min-w-3/12 max-w-3/12 bg-gray-100">
      <LogPanel :logs="logData" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref, onUnmounted } from 'vue';
import LogPanel from './components/log-panel.vue';
import Task from './components/task.vue';

const { ipcRendererChannel } = window;

const logData = ref<any[]>([]);

onMounted(() => {
  ipcRendererChannel.LogUpdate.on((_, arg) => {
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(now.getDate()).padStart(2, '0')} ${String(
      now.getHours()
    ).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(
      now.getSeconds()
    ).padStart(2, '0')}`;
    logData.value.push({
      time: timeStr,
      message: arg.message,
      type: arg.type,
    });
    if (logData.value.length > 1000) {
      logData.value.shift();
    }
  });
});

onUnmounted(() => {
  ipcRendererChannel.LogUpdate.removeAllListeners();
});
</script>

<style scoped></style>
