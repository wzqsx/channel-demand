<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElSelect,
  ElOption,
  ElInputNumber,
  ElMessage,
  ElTag,
} from 'element-plus';
import { useChannelStore } from '../stores/channel';
import { useWarehouseStore } from '../stores/warehouse';
import { useCompanyStore } from '../stores/company';
import type { Channel } from '../types';

const channelStore = useChannelStore();
const warehouseStore = useWarehouseStore();
const companyStore = useCompanyStore();
const channels = ref<Channel[]>([]);
const warehouses = ref<any[]>([]);
const companies = ref<any[]>([]);
const dialogVisible = ref(false);
const isEdit = ref(false);
const form = ref({
  name: '',
  warehouseIds: [] as string[],
  priority: 100,
  companyId: '',
});
const editId = ref('');

onMounted(() => {
  channelStore.initChannels();
  warehouseStore.initWarehouses();
  companyStore.initCompanies();
  channels.value = channelStore.channels;
  warehouses.value = warehouseStore.warehouses;
  companies.value = companyStore.companies;
});

const openDialog = (channel?: Channel) => {
  if (channel) {
    isEdit.value = true;
    editId.value = channel.id;
    form.value = {
      name: channel.name,
      warehouseIds: [...channel.warehouseIds],
      priority: channel.priority || 100,
      companyId: channel.companyId || '',
    };
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = {
      name: '',
      warehouseIds: [],
      priority: 100,
      companyId: '',
    };
  }
  dialogVisible.value = true;
};

const handleSubmit = () => {
  if (!form.value.name) {
    ElMessage.error('请填写渠道名称');
    return;
  }

  if (!form.value.companyId) {
    ElMessage.error('请选择所属主体');
    return;
  }

  if (form.value.warehouseIds.length === 0) {
    ElMessage.error('请至少选择一个仓库');
    return;
  }

  // 验证仓库是否属于同一主体
  const companyWarehouses = warehouseStore.getWarehousesByCompany(form.value.companyId);
  const companyWarehouseIds = companyWarehouses.map(w => w.id);
  const invalidWarehouses = form.value.warehouseIds.filter(id => !companyWarehouseIds.includes(id));
  if (invalidWarehouses.length > 0) {
    ElMessage.error('所选仓库必须属于同一主体');
    return;
  }

  if (isEdit.value) {
    channelStore.updateChannel(editId.value, form.value);
    ElMessage.success('修改成功');
  } else {
    channelStore.addChannel(form.value);
    ElMessage.success('添加成功');
  }

  channels.value = channelStore.channels;
  dialogVisible.value = false;
};

const handleDelete = (id: string) => {
  channelStore.deleteChannel(id);
  channels.value = channelStore.channels;
  ElMessage.success('删除成功');
};

const getWarehouseNames = (ids: string[]) => {
  return ids.map(id => {
    const warehouse = warehouseStore.getWarehouseById(id);
    return warehouse ? warehouse.name : '';
  }).join(', ');
};

const getCompanyName = (id: string) => {
  const company = companyStore.getCompanyById(id);
  return company ? company.name : '';
};

const getPriorityLabel = (priority: number) => {
  if (priority <= 3) return `P${priority}（高）`;
  if (priority <= 10) return `P${priority}（中）`;
  return `P${priority}（低）`;
};

// 根据选择的主体过滤仓库
const filteredWarehouses = (companyId: string) => {
  if (!companyId) return warehouses.value;
  return warehouseStore.getWarehousesByCompany(companyId);
};
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2>渠道管理</h2>
      <div class="header-actions">
        <ElButton type="primary" @click="openDialog()">添加渠道</ElButton>
      </div>
    </div>

    <ElTable :data="channels" border>
      <ElTableColumn prop="name" label="渠道名称" />
      <ElTableColumn label="所属主体" width="120">
        <template #default="scope">
          {{ getCompanyName(scope.row.companyId) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="允许选择的仓库">
        <template #default="scope">
          {{ getWarehouseNames(scope.row.warehouseIds) }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="优先级" width="120">
        <template #default="scope">
          <ElTag :type="scope.row.priority <= 3 ? 'danger' : scope.row.priority <= 10 ? 'warning' : 'info'">
            {{ getPriorityLabel(scope.row.priority) }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作">
        <template #default="scope">
          <ElButton size="small" @click="openDialog(scope.row as Channel)">编辑</ElButton>
          <ElButton size="small" type="danger" @click="handleDelete((scope.row as Channel).id)">删除</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>

    <ElDialog v-model="dialogVisible" :title="isEdit ? '编辑渠道' : '添加渠道'" width="550px">
      <ElForm :model="form" label-width="120px">
        <ElFormItem label="渠道名称">
          <ElInput v-model="form.name" />
        </ElFormItem>
        <ElFormItem label="所属主体">
          <ElSelect v-model="form.companyId" placeholder="请选择所属主体">
            <ElOption
              v-for="company in companies"
              :key="company.id"
              :label="company.name"
              :value="company.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="允许选择的仓库">
          <ElSelect v-model="form.warehouseIds" multiple placeholder="请选择仓库">
            <ElOption
              v-for="warehouse in filteredWarehouses(form.companyId)"
              :key="warehouse.id"
              :label="warehouse.name"
              :value="warehouse.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="优先级">
          <ElInputNumber v-model="form.priority" :min="1" />
          <span style="margin-left: 8px; color: #999; font-size: 12px;">数字越小优先级越高</span>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="handleSubmit">确定</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.page-container {
  padding: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

:deep(.el-select) {
  width: 100%;
}

:deep(.el-input-number) {
  width: 100%;
}
</style>