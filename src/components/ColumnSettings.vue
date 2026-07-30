<script setup lang="ts">
import { ref } from 'vue';
import { ElButton, ElCheckbox, ElPopover } from 'element-plus';
import type { ColumnMeta } from '../composables/useTableColumnPrefs';

defineProps<{
  columns: ColumnMeta[];
  isVisible: (key: string) => boolean;
}>();

const emit = defineEmits<{
  toggle: [key: string, visible: boolean];
  move: [fromIndex: number, toIndex: number];
  reset: [];
  showAll: [];
}>();

const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);

const onDragStart = (index: number, e: DragEvent) => {
  dragFrom.value = index;
  e.dataTransfer?.setData('text/plain', String(index));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
};

const onDragOver = (index: number, e: DragEvent) => {
  e.preventDefault();
  dragOver.value = index;
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
};

const onDrop = (index: number, e: DragEvent) => {
  e.preventDefault();
  const from = dragFrom.value;
  dragFrom.value = null;
  dragOver.value = null;
  if (from == null || from === index) return;
  emit('move', from, index);
};

const onDragEnd = () => {
  dragFrom.value = null;
  dragOver.value = null;
};
</script>

<template>
  <ElPopover placement="bottom-end" :width="300" trigger="click">
    <template #reference>
      <ElButton size="small">列设置</ElButton>
    </template>
    <div class="col-set">
      <div class="col-set__head">
        <span>拖拽调整顺序 · 勾选显隐</span>
        <div class="col-set__actions">
          <ElButton link type="primary" size="small" @click="emit('showAll')">全显</ElButton>
          <ElButton link size="small" @click="emit('reset')">重置</ElButton>
        </div>
      </div>
      <div class="col-set__list">
        <div
          v-for="(col, index) in columns"
          :key="col.key"
          class="col-set__row"
          :class="{
            over: dragOver === index,
            dragging: dragFrom === index,
          }"
          draggable="true"
          @dragstart="onDragStart(index, $event)"
          @dragover="onDragOver(index, $event)"
          @drop="onDrop(index, $event)"
          @dragend="onDragEnd"
        >
          <span class="col-set__handle" title="拖拽排序">⋮⋮</span>
          <ElCheckbox
            :model-value="isVisible(col.key)"
            :disabled="!!col.required"
            @change="(v: string | number | boolean) => emit('toggle', col.key, !!v)"
          >
            {{ col.label }}
          </ElCheckbox>
          <span v-if="col.required" class="col-set__tag">固定</span>
        </div>
      </div>
    </div>
  </ElPopover>
</template>

<style scoped>
.col-set__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--erp-text-muted, #909399);
}
.col-set__actions {
  display: flex;
  gap: 4px;
}
.col-set__list {
  max-height: 360px;
  overflow-y: auto;
}
.col-set__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  border-radius: 4px;
  cursor: grab;
  user-select: none;
}
.col-set__row:hover {
  background: #f5f7fa;
}
.col-set__row.over {
  background: #e8f1fb;
  outline: 1px dashed var(--erp-primary, #409eff);
}
.col-set__row.dragging {
  opacity: 0.45;
}
.col-set__handle {
  flex-shrink: 0;
  width: 16px;
  color: #c0c4cc;
  font-size: 12px;
  letter-spacing: -2px;
  line-height: 1;
}
.col-set__tag {
  margin-left: auto;
  font-size: 11px;
  color: var(--erp-text-muted, #909399);
}
:deep(.el-checkbox) {
  flex: 1;
  min-width: 0;
}
:deep(.el-checkbox__label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
