<template>
  <view class="page">
    <view class="hero">
      <view class="brand">
        <view class="brand__mark">英</view>
        <text class="brand__name">英纵 · Yinzon</text>
      </view>
      <text class="hero__eyebrow">UNI_MODULES 示例工程</text>
      <text class="hero__title">Cap 安全验证</text>
      <text class="hero__subtitle">
        App、微信小程序和百度小程序，在当前表单内完成验证。
      </text>
    </view>

    <view class="platforms" aria-label="支持平台">
      <view class="platform">App</view>
      <view class="platform">微信小程序</view>
      <view class="platform">百度小程序</view>
    </view>

    <view class="notice" role="status">
      <view class="notice__icon">!</view>
      <view class="notice__body">
        <text class="notice__title">示例尚未配置宿主后端</text>
        <text class="notice__text">
          这是预期状态。请先实现适配器，示例不会连接英纵服务器，也不会伪造验证成功。
        </text>
      </view>
    </view>

    <view class="card">
      <view class="card__heading">
        <view>
          <text class="card__title">验证参数</text>
          <text class="card__hint">数据仅用于本次组件调用</text>
        </view>
        <view class="status-dot" :class="{ 'status-dot--running': isRunning }"></view>
      </view>

      <view class="field">
        <text class="field__label">用途 purpose</text>
        <input
          v-model.trim="purpose"
          class="field__input"
          maxlength="64"
          placeholder="例如：market_demo"
        />
      </view>

      <view class="field">
        <text class="field__label">绑定标识 binding.resourceId</text>
        <input
          v-model.trim="resourceId"
          class="field__input"
          maxlength="80"
          placeholder="例如：demo_resource_001"
        />
      </view>

      <yinzon-uniapp-cap
        ref="capVerifier"
        :adapter="capAdapter"
        :show-status="true"
        @statechange="handleCapState"
      />

      <view class="actions">
        <button
          class="button button--primary"
          :loading="isRunning"
          :disabled="isRunning"
          @click="verify"
        >
          {{ isRunning ? "验证中…" : "开始安全验证" }}
        </button>
        <view class="actions__secondary">
          <button class="button button--secondary" @click="cancel">取消</button>
          <button class="button button--secondary" @click="reset">重置</button>
        </view>
      </view>
    </view>

    <view class="result" aria-live="polite">
      <text class="result__label">当前状态</text>
      <text class="result__state">{{ stateLabel }}</text>
      <text class="result__message">{{ stateMessage }}</text>
    </view>

    <text class="footer">
      插件只负责客户端验证流程，challenge、redeem 和业务票据校验必须由宿主后端实现。
    </text>
  </view>
</template>

<script>
import {
  CAP_BACKEND_CONFIGURED,
  capAdapter,
  createBackendNotConfiguredError
} from "../../common/cap-adapter.js";

const RUNNING_STATES = new Set([
  "attesting",
  "challenging",
  "solving",
  "redeeming"
]);

export default {
  data() {
    return {
      capAdapter,
      purpose: "market_demo",
      resourceId: "demo_resource_001",
      state: "idle",
      stateMessage: "等待开始验证"
    };
  },
  computed: {
    isRunning() {
      return RUNNING_STATES.has(this.state);
    },
    stateLabel() {
      const labels = {
        idle: "空闲",
        attesting: "获取平台凭证",
        challenging: "获取挑战",
        solving: "计算中",
        redeeming: "兑换票据",
        success: "验证成功",
        error: "验证失败",
        cancelled: "已取消"
      };
      return labels[this.state] || this.state;
    }
  },
  onUnload() {
    // 页面卸载时主动释放 Worker、iframe 和临时凭证。
    this.$refs.capVerifier?.cancel();
  },
  methods: {
    /**
     * 发起验证。默认示例先失败关闭，避免触发平台登录或伪造结果。
     */
    async verify() {
      try {
        if (!CAP_BACKEND_CONFIGURED) {
          throw createBackendNotConfiguredError();
        }
        const result = await this.$refs.capVerifier.verify({
          purpose: this.purpose,
          binding: {
            resourceId: this.resourceId
          }
        });
        this.state = "success";
        this.stateMessage = `已获得 ${result.platform} 一次性验证票据`;
      } catch (error) {
        this.state = "error";
        this.stateMessage =
          error?.message || "安全验证失败，请检查宿主后端配置";
        uni.showToast({
          title: this.stateMessage,
          icon: "none",
          duration: 3000
        });
      }
    },

    /**
     * 接收组件状态，不记录 challenge、code 或最终票据。
     */
    handleCapState(event) {
      this.state = event.state;
      this.stateMessage = event.message || "";
    },

    /**
     * 取消当前验证。
     */
    cancel() {
      const cancelled = this.$refs.capVerifier?.cancel();
      if (!cancelled) {
        this.stateMessage = "当前没有正在运行的验证";
      }
    },

    /**
     * 清除组件状态。
     */
    reset() {
      this.$refs.capVerifier?.reset();
      this.state = "idle";
      this.stateMessage = "等待开始验证";
    }
  }
};
</script>

<style lang="scss" scoped>
.page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 56rpx 32rpx 48rpx;
}

.hero {
  display: flex;
  flex-direction: column;
}

.brand {
  display: flex;
  align-items: center;
  margin-bottom: 48rpx;
}

.brand__mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 700;
  background: #0d9694;
  border-radius: 18rpx;
  box-shadow: 0 14rpx 28rpx rgba(13, 150, 148, 0.2);
}

.brand__name {
  margin-left: 18rpx;
  color: #35605e;
  font-size: 26rpx;
  font-weight: 600;
}

.hero__eyebrow {
  color: #0d9694;
  font-size: 22rpx;
  font-weight: 700;
  letter-spacing: 4rpx;
}

.hero__title {
  margin-top: 14rpx;
  color: #123c3b;
  font-size: 60rpx;
  font-weight: 800;
  line-height: 1.15;
}

.hero__subtitle {
  max-width: 620rpx;
  margin-top: 22rpx;
  color: #607b79;
  font-size: 28rpx;
  line-height: 1.7;
}

.platforms {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 34rpx;
}

.platform {
  padding: 12rpx 20rpx;
  color: #2c6764;
  font-size: 22rpx;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid #d3e7e4;
  border-radius: 999rpx;
}

.notice {
  display: flex;
  margin-top: 36rpx;
  padding: 26rpx;
  background: #fff8e8;
  border: 1px solid #f0dfb8;
  border-radius: 24rpx;
}

.notice__icon {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  color: #8a6518;
  font-size: 26rpx;
  font-weight: 800;
  background: #f8e3af;
  border-radius: 50%;
}

.notice__body {
  display: flex;
  flex-direction: column;
  margin-left: 18rpx;
}

.notice__title {
  color: #654c18;
  font-size: 25rpx;
  font-weight: 700;
}

.notice__text {
  margin-top: 8rpx;
  color: #836b39;
  font-size: 22rpx;
  line-height: 1.6;
}

.card {
  margin-top: 30rpx;
  padding: 34rpx 30rpx;
  background: #ffffff;
  border: 1px solid #d8e8e6;
  border-radius: 32rpx;
  box-shadow: 0 24rpx 60rpx rgba(27, 83, 80, 0.08);
}

.card__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 30rpx;
}

.card__heading > view:first-child {
  display: flex;
  flex-direction: column;
}

.card__title {
  color: #173f3d;
  font-size: 32rpx;
  font-weight: 700;
}

.card__hint {
  margin-top: 6rpx;
  color: #8aa09e;
  font-size: 21rpx;
}

.status-dot {
  width: 18rpx;
  height: 18rpx;
  background: #bed3d1;
  border: 8rpx solid #eef5f4;
  border-radius: 50%;
}

.status-dot--running {
  background: #0d9694;
  border-color: #d9f2ef;
}

.field + .field {
  margin-top: 24rpx;
}

.field__label {
  display: block;
  margin-bottom: 12rpx;
  color: #466866;
  font-size: 23rpx;
  font-weight: 600;
}

.field__input {
  box-sizing: border-box;
  width: 100%;
  height: 88rpx;
  padding: 0 24rpx;
  color: #173f3d;
  font-size: 26rpx;
  background: #f7fbfa;
  border: 1px solid #d7e7e5;
  border-radius: 18rpx;
}

.actions {
  margin-top: 30rpx;
}

.button {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  font-size: 27rpx;
  font-weight: 700;
  line-height: 88rpx;
  border-radius: 20rpx;
}

.button--primary {
  color: #ffffff;
  background: #0d9694;
  box-shadow: 0 14rpx 26rpx rgba(13, 150, 148, 0.2);
}

.button--primary[disabled] {
  color: #ffffff;
  background: #85c6c3;
}

.actions__secondary {
  display: flex;
  gap: 18rpx;
  margin-top: 18rpx;
}

.button--secondary {
  flex: 1;
  color: #3a6663;
  background: #f0f7f6;
}

.result {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8rpx 18rpx;
  margin-top: 26rpx;
  padding: 26rpx;
  background: rgba(220, 241, 239, 0.58);
  border-radius: 24rpx;
}

.result__label {
  color: #76908e;
  font-size: 21rpx;
}

.result__state {
  color: #0b7775;
  font-size: 22rpx;
  font-weight: 700;
}

.result__message {
  grid-column: 1 / -1;
  margin-top: 4rpx;
  color: #496d6b;
  font-size: 22rpx;
  line-height: 1.55;
}

.footer {
  display: block;
  margin: 34rpx 12rpx 0;
  color: #829795;
  font-size: 21rpx;
  line-height: 1.65;
  text-align: center;
}
</style>
