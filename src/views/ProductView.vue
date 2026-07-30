<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
  ElTag,
  ElCheckbox,
  ElSelect,
  ElOption,
} from 'element-plus';
import type { TableInstance } from 'element-plus';
import PageShell from '../components/PageShell.vue';
import HelpTip from '../components/HelpTip.vue';
import { useProductStore } from '../stores/product';
import { useWarehouseStockStore } from '../stores/warehouseStock';
import { useRequisitionStore } from '../stores/requisition';
import { bootstrapStores } from '../stores/bootstrap';
import type { Product } from '../types';
import { readExcelFromEvent, exportRows, downloadTemplate, cell, cellNum } from '../utils/excel';
import {
  boxesToBottles,
  formatProductQtyFull,
  formatWarningBoxesDisplay,
  splitProductQty,
} from '../utils/qtyDisplay';

const store = useProductStore();
const stockStore = useWarehouseStockStore();
const requisitionStore = useRequisitionStore();
const { products } = storeToRefs(store);
const dialogVisible = ref(false);
const isEdit = ref(false);
const keyword = ref('');
const form = ref({
  code: '',
  name: '',
  spec: '',
  bottleUnit: '瓶',
  boxUnit: '箱',
  bottlesPerBox: 24,
  stock: 0,
  /** 预警按箱录入，保存时换算为瓶 */
  warningBoxes: 5,
  isCombined: false,
  combineProductCode: '',
  combineRatio: 0,
});
const editId = ref('');
const showWarning = ref(false);
const importRef = ref<HTMLInputElement | null>(null);
const tableRef = ref<TableInstance>();
const selectedRows = ref<Product[]>([]);

const batchVisible = ref(false);
const batchForm = ref({
  /** 勾选后才应用 */
  applyWarning: true,
  warningBoxes: 5,
  applyBottlesPerBox: false,
  bottlesPerBox: 24,
  applyBottleUnit: false,
  bottleUnit: '瓶',
  applyBoxUnit: false,
  boxUnit: '箱',
});

const listRows = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return products.value;
  return products.value.filter(
    p =>
      p.code.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (p.spec || '').toLowerCase().includes(q),
  );
});

const PRODUCT_HEADERS = [
  '商品编码', '商品名称', '规格', '瓶单位', '箱单位', '每箱瓶数',
  '预警阈值(瓶)', '预警阈值(箱)',
  '是否组合(是/否)', '组合基础编码', '组合比例',
] as const;

const parseCombined = (row: Record<string, unknown>) => {
  const v = cell(row, '是否组合(是/否)', '是否组合', 'isCombined');
  return v === '是' || v === 'true' || v === '1' || v === 'yes' || v === 'Y';
};

onMounted(() => {
  bootstrapStores();
  if (store.warningCount > 0) showWarning.value = true;
});

const onSelectionChange = (rows: Product[]) => {
  selectedRows.value = rows;
};

const openDialog = (product?: Product) => {
  if (product) {
    isEdit.value = true;
    editId.value = product.id;
    form.value = {
      code: product.code,
      name: product.name,
      spec: product.spec,
      bottleUnit: product.bottleUnit,
      boxUnit: product.boxUnit,
      bottlesPerBox: product.bottlesPerBox,
      stock: product.stock,
      warningBoxes: (() => {
        const per = Math.max(1, product.bottlesPerBox || 1);
        return Math.max(0, Math.round(product.warningThreshold / per));
      })(),
      isCombined: product.isCombined || false,
      combineProductCode: product.combineProductCode || '',
      combineRatio: product.combineRatio || 0,
    };
  } else {
    isEdit.value = false;
    editId.value = '';
    form.value = {
      code: '',
      name: '',
      spec: '',
      bottleUnit: '瓶',
      boxUnit: '箱',
      bottlesPerBox: 24,
      stock: 0,
      warningBoxes: 5,
      isCombined: false,
      combineProductCode: '',
      combineRatio: 0,
    };
  }
  dialogVisible.value = true;
};

const formWarningBottles = computed(() =>
  boxesToBottles(form.value.warningBoxes, form.value.bottlesPerBox),
);

/** 组合品：每箱瓶数必须与换算比例一致（1 箱规单位 = N 瓶规） */
watch(
  () => form.value.isCombined,
  combined => {
    if (combined) {
      if (form.value.combineRatio > 0) {
        form.value.bottlesPerBox = form.value.combineRatio;
      } else if (form.value.bottlesPerBox > 0) {
        form.value.combineRatio = form.value.bottlesPerBox;
      }
    }
  },
);

watch(
  () => form.value.combineRatio,
  ratio => {
    if (form.value.isCombined && ratio > 0) {
      form.value.bottlesPerBox = ratio;
    }
  },
);

const handleSubmit = () => {
  if (!form.value.code || !form.value.name) {
    ElMessage.error('请填写商品编码和名称');
    return;
  }

  if (form.value.isCombined && (!form.value.combineProductCode || form.value.combineRatio <= 0)) {
    ElMessage.error('组合商品必须设置基础商品编码和换算比例');
    return;
  }

  if (form.value.isCombined) {
    const baseProduct = store.getProductByCode(form.value.combineProductCode);
    if (!baseProduct) {
      ElMessage.error('基础商品编码不存在');
      return;
    }
    if (baseProduct.isCombined) {
      ElMessage.error('基础商品不能是组合商品');
      return;
    }
    // 强制一致，避免箱数展示/折算各用一套数
    form.value.bottlesPerBox = form.value.combineRatio;
  }

  const normUnit = (u: string) => {
    const s = String(u || '').trim();
    if (s === '瓶子') return '瓶';
    if (s === '盒子') return '盒';
    if (s === '箱子') return '箱';
    return s || '瓶';
  };

  const payload = {
    code: form.value.code.trim(),
    name: form.value.name.trim(),
    spec: form.value.spec,
    bottleUnit: normUnit(form.value.bottleUnit),
    boxUnit: normUnit(form.value.boxUnit) || '箱',
    bottlesPerBox: form.value.isCombined
      ? form.value.combineRatio
      : Math.max(1, form.value.bottlesPerBox),
    stock: form.value.stock,
    warningThreshold: formWarningBottles.value,
    isCombined: form.value.isCombined,
    combineProductCode: form.value.isCombined ? form.value.combineProductCode : '',
    combineRatio: form.value.isCombined ? form.value.combineRatio : 0,
  };

  if (isEdit.value) {
    store.updateProduct(editId.value, payload);
    ElMessage.success('修改成功');
  } else {
    store.addProduct(payload);
    ElMessage.success('添加成功');
  }

  dialogVisible.value = false;
};

const handleDelete = async (id: string) => {
  const product = store.products.find(p => p.id === id);
  const code = product?.code || '';
  const stockN = code
    ? stockStore.stocks.filter(s => s.productCode === code).length
    : 0;
  const reqN = code
    ? requisitionStore.requisitions.filter(r => r.items.some(i => i.productCode === code)).length
    : 0;
  const packN = code
    ? store.products.filter(p => p.isCombined && p.combineProductCode === code).length
    : 0;
  if (stockN || reqN || packN) {
    ElMessage.warning(
      `该商品仍被 ${stockN} 条库存、${reqN} 张要货、${packN} 个箱规引用，请先处理后再删`,
    );
    return;
  }
  try {
    await ElMessageBox.confirm('确认删除该商品？', '删除商品', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  store.deleteProduct(id);
  ElMessage.success('删除成功');
};

const openBatchDialog = () => {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先勾选要批量编辑的商品');
    return;
  }
  batchForm.value = {
    applyWarning: true,
    warningBoxes: 5,
    applyBottlesPerBox: false,
    bottlesPerBox: 24,
    applyBottleUnit: false,
    bottleUnit: '瓶',
    applyBoxUnit: false,
    boxUnit: '箱',
  };
  batchVisible.value = true;
};

const batchPreview = computed(() => {
  if (!batchForm.value.applyWarning) return [];
  return selectedRows.value.slice(0, 8).map(p => {
    const per = batchForm.value.applyBottlesPerBox
      ? batchForm.value.bottlesPerBox
      : p.bottlesPerBox;
    const bottles = boxesToBottles(batchForm.value.warningBoxes, per);
    return {
      code: p.code,
      name: p.name,
      from: p.warningThreshold,
      to: bottles,
      per,
    };
  });
});

const handleBatchSubmit = () => {
  const { applyWarning, applyBottlesPerBox, applyBottleUnit, applyBoxUnit } = batchForm.value;
  if (!applyWarning && !applyBottlesPerBox && !applyBottleUnit && !applyBoxUnit) {
    ElMessage.warning('请至少勾选一项要修改的内容');
    return;
  }
  if (applyWarning && batchForm.value.warningBoxes < 0) {
    ElMessage.error('预警箱数不能为负');
    return;
  }

  const n = store.batchUpdate(
    selectedRows.value.map(r => r.id),
    p => {
      const patch: Partial<Product> = {};
      if (applyBottleUnit) patch.bottleUnit = batchForm.value.bottleUnit.trim() || p.bottleUnit;
      if (applyBoxUnit) patch.boxUnit = batchForm.value.boxUnit.trim() || p.boxUnit;
      if (applyBottlesPerBox) {
        const per = Math.max(1, batchForm.value.bottlesPerBox);
        patch.bottlesPerBox = per;
        // 组合品同步换算比例，避免两套数
        if (p.isCombined) patch.combineRatio = per;
      }
      if (applyWarning) {
        const per = applyBottlesPerBox
          ? batchForm.value.bottlesPerBox
          : (patch.bottlesPerBox ?? p.bottlesPerBox);
        patch.warningThreshold = boxesToBottles(batchForm.value.warningBoxes, per);
      }
      return patch;
    },
  );
  tableRef.value?.clearSelection();
  selectedRows.value = [];
  batchVisible.value = false;
  ElMessage.success(`已批量更新 ${n} 个商品`);
};

const handleExport = () => {
  exportRows(
    products.value.map(p => ({
      商品编码: p.code,
      商品名称: p.name,
      规格: p.spec,
      瓶单位: p.bottleUnit,
      箱单位: p.boxUnit,
      每箱瓶数: p.bottlesPerBox,
      '预警阈值(瓶)': p.warningThreshold,
      '预警阈值(箱)': Math.round(
        p.warningThreshold / Math.max(1, p.bottlesPerBox || 1),
      ),
      '是否组合(是/否)': p.isCombined ? '是' : '否',
      组合基础编码: p.combineProductCode,
      组合比例: p.combineRatio,
    })),
    '商品',
  );
  ElMessage.success('已导出');
};

const handleTemplate = () => {
  downloadTemplate([...PRODUCT_HEADERS], '商品导入模板');
};

const handleImport = async (event: Event) => {
  const rows = await readExcelFromEvent(event);
  let n = 0;
  rows.forEach(row => {
    const code = cell(row, '商品编码', 'code');
    const name = cell(row, '商品名称', 'name');
    if (!code || !name) return;

    const existing = store.getProductByCode(code);
    const isCombined = parseCombined(row);
    const combineProductCode = cell(row, '组合基础编码', 'combineProductCode', '基础商品编码');
    const bottlesPerBoxRaw = cellNum(row, '每箱瓶数', '每箱数量', 'bottlesPerBox') || 24;
    let combineRatio = isCombined
      ? cellNum(row, '组合比例', 'combineRatio', '换算比例')
      : 0;
    // 组合品：每箱瓶数必须与换算比例一致；有比例用比例，否则用每箱瓶数
    let bottlesPerBox = bottlesPerBoxRaw;
    if (isCombined) {
      if (combineRatio > 0) bottlesPerBox = combineRatio;
      else {
        combineRatio = bottlesPerBoxRaw;
        bottlesPerBox = bottlesPerBoxRaw;
      }
    }

    let warningThreshold = cellNum(row, '预警阈值(瓶)', '预警阈值', 'warningThreshold');
    const warningBoxes = cellNum(row, '预警阈值(箱)', '预警箱数', 'warningBoxes');
    if (warningBoxes > 0) {
      warningThreshold = boxesToBottles(warningBoxes, bottlesPerBox);
    } else if (!warningThreshold) {
      warningThreshold = existing?.warningThreshold ?? 100;
    }

    store.upsertByCode({
      code,
      name,
      spec: cell(row, '规格', 'spec'),
      bottleUnit: cell(row, '瓶单位', 'bottleUnit') || '瓶',
      boxUnit: cell(row, '箱单位', 'boxUnit') || '箱',
      bottlesPerBox,
      stock: existing?.stock ?? 0,
      warningThreshold,
      isCombined,
      combineProductCode: isCombined ? combineProductCode : '',
      combineRatio: isCombined ? combineRatio : 0,
    });
    n += 1;
  });
  ElMessage.success(`导入完成 ${n} 条（按编码覆盖；组合品已强制每箱瓶数=换算比例）`);
};

const getStockStatus = (product: Product) => {
  if (product.stock <= product.warningThreshold) {
    return { type: 'danger' as const, text: '库存预警' };
  }
  return { type: 'success' as const, text: '库存充足' };
};

const tableRowClassName = ({ row }: { row: Product }) =>
  store.isWarning(row) ? 'product-row--warning' : '';

const getCombineInfo = (product: Product) => {
  if (!product.isCombined || !product.combineProductCode) return '';
  const baseProduct = store.getProductByCode(product.combineProductCode);
  const baseName = baseProduct ? baseProduct.name : product.combineProductCode;
  return `${product.code} = ${product.combineRatio} × ${baseName}`;
};

/** 库存：箱 + 零头（零头单位 = bottleUnit）；预警：只显示整箱 */
const stockParts = (p: Product) => splitProductQty(p.stock, p);
const warningDisplay = (p: Product) => formatWarningBoxesDisplay(p);
</script>

<template>
  <PageShell
    title="商品信息管理"
    help="瓶规与箱规分编码维护。箱规勾选「组合品」并指定基础瓶规与换算比例。预警按整数箱录入。库存/要货均按商品编码区分。"
  >
    <template #toolbar>
      <input ref="importRef" type="file" accept=".xlsx,.xls" class="hidden-file" @change="handleImport" />
      <ElInput
        v-model="keyword"
        size="small"
        clearable
        placeholder="搜索编码/名称/规格"
        style="width: 200px"
      />
      <ElButton type="primary" size="small" @click="openDialog()">添加商品</ElButton>
      <ElButton size="small" :disabled="!selectedRows.length" @click="openBatchDialog">
        批量编辑{{ selectedRows.length ? `（${selectedRows.length}）` : '' }}
      </ElButton>
      <ElButton size="small" @click="importRef?.click()">导入</ElButton>
      <ElButton size="small" @click="handleExport">导出</ElButton>
      <ElButton size="small" @click="handleTemplate">下载模板</ElButton>
    </template>

    <div class="table-wrap">
      <div v-if="showWarning && store.warningCount > 0" class="warning-alert">
        <ElTag type="danger" effect="dark">
          ⚠️ {{ store.warningCount }} 个商品主数据库存低于预警阈值（实库请看「库存导入」）
        </ElTag>
      </div>

      <ElTable
        ref="tableRef"
        :data="listRows"
        border
        size="small"
        stripe
        class="erp-data-table product-table"
        height="100%"
        row-key="id"
        table-layout="auto"
        :row-class-name="tableRowClassName"
        :style="showWarning && store.warningCount > 0 ? { marginTop: '8px' } : undefined"
        @selection-change="onSelectionChange"
      >
        <ElTableColumn type="selection" width="42" fixed="left" />
        <ElTableColumn type="index" label="序号" width="52" fixed="left" />
        <ElTableColumn prop="code" label="商品编码" min-width="110" sortable show-overflow-tooltip />
        <ElTableColumn prop="name" label="商品名称" min-width="120" sortable show-overflow-tooltip />
        <ElTableColumn prop="spec" label="规格" min-width="80" sortable show-overflow-tooltip />
        <ElTableColumn prop="bottleUnit" label="瓶单位" width="78" align="center" class-name="col-unit" />
        <ElTableColumn prop="boxUnit" label="箱单位" width="78" align="center" class-name="col-unit" />
        <ElTableColumn prop="bottlesPerBox" label="每箱" width="72" align="center" sortable class-name="col-unit" />
        <ElTableColumn label="当前库存" min-width="168" sortable :sort-method="(a: Product, b: Product) => a.stock - b.stock">
          <template #default="{ row }">
            <template v-for="parts in [stockParts(row as Product)]" :key="(row as Product).id + '-stock'">
              <span
                class="qty-text"
                :class="{ 'stock-warning': store.isWarning(row as Product) }"
                :title="parts.full"
              >
                <template v-if="parts.remainder > 0 && Math.abs(parts.boxes) > 0">
                  <span class="qty-num">{{ parts.neg ? '负' : '' }}{{ Math.abs(parts.boxes) }}</span>
                  <span class="qty-unit-box">{{ parts.boxUnit }}</span>
                  <span class="qty-sep">＋</span>
                  <span class="qty-num">{{ parts.remainder }}</span>
                  <span class="qty-unit-small">{{ parts.smallUnit }}</span>
                </template>
                <template v-else-if="Math.abs(parts.boxes) > 0 && parts.remainder === 0">
                  <span class="qty-num">{{ parts.neg ? '负' : '' }}{{ Math.abs(parts.boxes) }}</span>
                  <span class="qty-unit-box">{{ parts.boxUnit }}</span>
                </template>
                <template v-else>
                  <span class="qty-num">{{ parts.neg ? '负' : '' }}{{ parts.remainder || 0 }}</span>
                  <span class="qty-unit-small">{{ parts.smallUnit }}</span>
                </template>
              </span>
            </template>
          </template>
        </ElTableColumn>
        <ElTableColumn
          label="预警阈值"
          min-width="150"
          sortable
          :sort-method="(a: Product, b: Product) => a.warningThreshold - b.warningThreshold"
        >
          <template #default="{ row }">
            <template v-for="w in [warningDisplay(row as Product)]" :key="(row as Product).id + '-warn'">
              <span class="qty-text" :title="w.full">
                <span class="qty-num">{{ w.boxes }}</span>
                <span class="qty-unit-box">{{ w.boxUnit }}</span>
                <span class="qty-warn-sub">（共{{ w.bottles }}{{ w.smallUnit }}）</span>
              </span>
            </template>
          </template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="96" align="center">
          <template #default="{ row }">
            <ElTag size="small" :type="getStockStatus(row as Product).type">
              {{ getStockStatus(row as Product).text }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="箱规" width="64" align="center">
          <template #default="{ row }">
            <ElTag size="small" :type="(row as Product).isCombined ? 'warning' : 'info'">
              {{ (row as Product).isCombined ? '是' : '否' }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="箱→瓶" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="(row as Product).isCombined">{{ getCombineInfo(row as Product) }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="132" fixed="right" align="center" class-name="col-actions">
          <template #default="{ row }">
            <div class="row-actions">
              <ElButton link type="primary" size="small" @click="openDialog(row as Product)">编辑</ElButton>
              <ElButton link type="danger" size="small" @click="handleDelete((row as Product).id)">删除</ElButton>
            </div>
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <ElDialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑商品' : '添加商品'"
      width="600px"
      destroy-on-close
    >
      <ElForm :model="form" label-width="120px" size="small">
        <ElFormItem label="商品编码">
          <ElInput v-model="form.code" />
        </ElFormItem>
        <ElFormItem label="商品名称">
          <ElInput v-model="form.name" />
        </ElFormItem>
        <ElFormItem label="规格">
          <ElInput v-model="form.spec" />
        </ElFormItem>
        <ElFormItem label="瓶单位">
          <ElInput v-model="form.bottleUnit" />
        </ElFormItem>
        <ElFormItem label="箱单位">
          <ElInput v-model="form.boxUnit" />
        </ElFormItem>
        <ElFormItem>
          <template #label>
            <span class="label-with-help">
              每箱瓶数
              <HelpTip inline content="用于箱/零头展示与预警换算。组合品时与换算比例一致。" />
            </span>
          </template>
          <div class="field-inline">
            <ElInputNumber
              v-model="form.bottlesPerBox"
              :min="1"
              :disabled="form.isCombined"
              style="width: 160px"
            />
            <ElTag v-if="form.isCombined" size="small" type="info" effect="plain">随换算比例锁定</ElTag>
          </div>
        </ElFormItem>
        <ElFormItem label="当前库存(瓶)">
          <ElInputNumber v-model="form.stock" :min="0" :precision="0" />
          <div class="form-hint">
            {{ formatProductQtyFull(form.stock, form) }}（参考值；实库以库存导入为准）
          </div>
        </ElFormItem>
        <ElFormItem>
          <template #label>
            <span class="label-with-help">
              预警阈值(箱)
              <HelpTip inline content="按整数箱录入；保存时按「箱×每箱瓶数」换算成瓶" />
            </span>
          </template>
          <ElInputNumber v-model="form.warningBoxes" :min="0" :step="1" :precision="0" />
          <div class="form-hint">
            {{
              formatWarningBoxesDisplay({
                warningThreshold: formWarningBottles,
                bottlesPerBox: form.bottlesPerBox,
                boxUnit: form.boxUnit,
                bottleUnit: form.bottleUnit,
                name: form.name,
              }).full
            }}
          </div>
        </ElFormItem>

        <div class="combine-panel">
          <div class="combine-panel__head">
            <ElCheckbox v-model="form.isCombined">箱规 / 组合品</ElCheckbox>
            <ElTag v-if="form.isCombined" size="small" type="warning" effect="plain">
              1 箱规 = N 瓶规
            </ElTag>
            <span v-else class="combine-panel__hint">仅箱规编码需要勾选</span>
          </div>
          <div v-show="form.isCombined" class="combine-panel__body">
            <ElFormItem label="基础瓶规编码" class="combine-panel__item">
              <ElSelect
                v-model="form.combineProductCode"
                filterable
                clearable
                placeholder="选择对应的瓶规商品"
                style="width: 100%"
              >
                <ElOption
                  v-for="product in store.baseProducts"
                  :key="product.code"
                  :label="`${product.code} - ${product.name}`"
                  :value="product.code"
                />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="换算比例" class="combine-panel__item">
              <div class="field-inline">
                <ElInputNumber
                  v-model="form.combineRatio"
                  :min="1"
                  :precision="0"
                  controls-position="right"
                  style="width: 180px"
                />
                <span class="form-hint inline">同步写入每箱瓶数</span>
              </div>
            </ElFormItem>
            <p v-if="!store.baseProducts.length" class="combine-panel__empty">
              暂无可用的瓶规商品，请先添加非组合的瓶规商品。
            </p>
          </div>
        </div>
      </ElForm>
      <template #footer>
        <ElButton size="small" @click="dialogVisible = false">取消</ElButton>
        <ElButton size="small" type="primary" @click="handleSubmit">确定</ElButton>
      </template>
    </ElDialog>

    <ElDialog
      v-model="batchVisible"
      title="批量编辑商品"
      width="560px"
      append-to-body
      :close-on-click-modal="false"
    >
      <div class="batch-tip">
        已选 <strong>{{ selectedRows.length }}</strong> 个商品。勾选要改的项；预警按「箱」录入，每个商品各自用自己的每箱瓶数换算成瓶。
      </div>
      <ElForm label-width="130px" size="small">
        <ElFormItem>
          <template #label>
            <ElCheckbox v-model="batchForm.applyWarning">预警阈值(箱)</ElCheckbox>
          </template>
          <ElInputNumber
            v-model="batchForm.warningBoxes"
            :min="0"
            :step="1"
            :precision="0"
            :disabled="!batchForm.applyWarning"
            style="width: 160px"
          />
          <span class="form-hint inline">统一整数箱 → 各商品 × 各自每箱瓶数</span>
        </ElFormItem>
        <ElFormItem>
          <template #label>
            <ElCheckbox v-model="batchForm.applyBottlesPerBox">每箱瓶数</ElCheckbox>
          </template>
          <ElInputNumber
            v-model="batchForm.bottlesPerBox"
            :min="1"
            :disabled="!batchForm.applyBottlesPerBox"
            style="width: 160px"
          />
        </ElFormItem>
        <ElFormItem>
          <template #label>
            <ElCheckbox v-model="batchForm.applyBottleUnit">瓶单位</ElCheckbox>
          </template>
          <ElInput v-model="batchForm.bottleUnit" :disabled="!batchForm.applyBottleUnit" style="width: 160px" />
        </ElFormItem>
        <ElFormItem>
          <template #label>
            <ElCheckbox v-model="batchForm.applyBoxUnit">箱单位</ElCheckbox>
          </template>
          <ElInput v-model="batchForm.boxUnit" :disabled="!batchForm.applyBoxUnit" style="width: 160px" />
        </ElFormItem>
      </ElForm>
      <div v-if="batchForm.applyWarning && batchPreview.length" class="batch-preview">
        <div class="batch-preview__title">预警换算预览（前 {{ batchPreview.length }} 条）</div>
        <div v-for="row in batchPreview" :key="row.code" class="batch-preview__row">
          <span>{{ row.code }} {{ row.name }}</span>
          <span>{{ row.from }}瓶 → {{ row.to }}瓶（×{{ row.per }}）</span>
        </div>
        <div v-if="selectedRows.length > batchPreview.length" class="form-hint">
          …其余 {{ selectedRows.length - batchPreview.length }} 条同理
        </div>
      </div>
      <template #footer>
        <ElButton size="small" @click="batchVisible = false">取消</ElButton>
        <ElButton size="small" type="primary" @click="handleBatchSubmit">应用</ElButton>
      </template>
    </ElDialog>
  </PageShell>
</template>

<style scoped>
.table-wrap {
  flex: 1;
  min-height: 0;
  padding: 0 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.hidden-file {
  display: none;
}

.warning-alert {
  flex-shrink: 0;
  margin-top: 12px;
  padding: 8px 12px;
  background-color: #fef0f0;
  border-radius: 4px;
}

.stock-warning {
  color: #f56c6c;
  font-weight: bold;
}

.text-muted {
  color: #999;
}

.form-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--erp-text-muted);
  line-height: 1.4;
}
.form-hint.inline {
  margin-top: 0;
  margin-left: 8px;
}

.stock-warning {
  color: #f56c6c;
  font-weight: 600;
}

.qty-text {
  display: inline-flex;
  align-items: center;
  flex-wrap: nowrap;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  gap: 1px;
}
.qty-num {
  font-weight: 600;
}
.qty-sep {
  margin: 0 3px;
  color: #909399;
}
.qty-unit-box {
  color: #606266;
  font-weight: 500;
}
.qty-unit-small {
  display: inline-block;
  margin-left: 1px;
  padding: 0 5px;
  border-radius: 4px;
  background: #e8f8ef;
  color: #067a3e;
  font-weight: 700;
  font-size: 12px;
  line-height: 1.5;
}
.qty-warn-sub {
  margin-left: 4px;
  font-size: 11px;
  color: #909399;
  font-weight: 400;
}
.stock-warning .qty-unit-small {
  background: #fde2e2;
  color: #f56c6c;
}
.stock-warning .qty-num,
.stock-warning .qty-unit-box {
  color: #f56c6c;
}

.product-table :deep(.el-table__cell) {
  padding-left: 10px;
  padding-right: 10px;
}
.product-table :deep(.el-table__body .cell) {
  line-height: 1.4;
  white-space: nowrap;
}
.product-table :deep(.col-unit .cell) {
  padding-left: 8px;
  padding-right: 8px;
}
.product-table :deep(.col-actions .cell) {
  padding-left: 10px;
  padding-right: 10px;
}
.row-actions {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  white-space: nowrap;
}

/* 库存预警整行浅红底，便于仓管扫视 */
.product-table :deep(.product-row--warning > td.el-table__cell) {
  background-color: #fff5f5 !important;
}
.product-table :deep(.product-row--warning:hover > td.el-table__cell) {
  background-color: #ffecec !important;
}
.product-table :deep(.el-table__body tr.product-row--warning.el-table__row--striped > td.el-table__cell) {
  background-color: #fff1f1 !important;
}
.product-table :deep(.el-table__body tr.product-row--warning.el-table__row--striped:hover > td.el-table__cell) {
  background-color: #ffe8e8 !important;
}

.field-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
}

.combine-panel {
  margin: 8px 0 4px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
}
.combine-panel__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.combine-panel__hint {
  font-size: 12px;
  color: var(--erp-text-muted);
}
.combine-panel__body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e4e7ed;
  min-height: 88px;
}
.combine-panel__item {
  margin-bottom: 14px;
}
.combine-panel__item:last-of-type {
  margin-bottom: 4px;
}
.combine-panel__empty {
  margin: 0;
  font-size: 12px;
  color: #e6a23c;
}

.label-with-help {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.batch-tip {
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #f0f5fb;
  border: 1px solid #d6e4f5;
  font-size: 13px;
  color: var(--erp-text);
}
.batch-preview {
  margin-top: 8px;
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid var(--erp-border);
  border-radius: 6px;
  padding: 8px 10px;
}
.batch-preview__title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--erp-text);
}
.batch-preview__row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  padding: 3px 0;
  color: var(--erp-text-muted);
}

:deep(.el-input-number) {
  width: 100%;
}

:deep(.el-select) {
  width: 100%;
}
</style>
