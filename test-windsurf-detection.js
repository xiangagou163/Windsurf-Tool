// test-windsurf-detection.js - 测试 Windsurf 检测和关闭功能
const { WindsurfPathDetector } = require('./js/accountSwitcher');

async function testDetection() {
  console.log('========================================');
  console.log('🧪 测试 Windsurf 检测和关闭功能');
  console.log('========================================\n');
  
  console.log('📍 当前平台:', process.platform);
  console.log('📍 架构:', process.arch);
  console.log('');
  
  // 1. 测试数据库路径检测
  console.log('1️⃣ 测试数据库路径检测...');
  try {
    const dbPath = WindsurfPathDetector.getDBPath();
    console.log('✅ 数据库路径:', dbPath);
  } catch (error) {
    console.error('❌ 获取数据库路径失败:', error.message);
  }
  console.log('');
  
  // 2. 测试 Windsurf 安装检测
  console.log('2️⃣ 测试 Windsurf 安装检测...');
  try {
    const isInstalled = await WindsurfPathDetector.isInstalled();
    if (isInstalled) {
      console.log('✅ Windsurf 已安装');
    } else {
      console.log('❌ Windsurf 未安装');
    }
  } catch (error) {
    console.error('❌ 检测失败:', error.message);
  }
  console.log('');
  
  // 3. 测试 Windsurf 运行状态检测
  console.log('3️⃣ 测试 Windsurf 运行状态检测...');
  try {
    const isRunning = await WindsurfPathDetector.isRunning();
    if (isRunning) {
      console.log('✅ Windsurf 正在运行');
      
      // 4. 如果正在运行，测试关闭功能
      console.log('');
      console.log('4️⃣ 测试关闭功能...');
      console.log('⚠️  即将关闭 Windsurf，请确认是否继续？');
      console.log('   按 Ctrl+C 取消，或等待 5 秒自动继续...');
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      console.log('开始关闭 Windsurf...');
      const closed = await WindsurfPathDetector.closeWindsurf();
      
      if (closed) {
        console.log('✅ Windsurf 关闭成功');
        
        // 再次检测
        console.log('');
        console.log('5️⃣ 验证关闭结果...');
        const stillRunning = await WindsurfPathDetector.isRunning();
        if (stillRunning) {
          console.log('⚠️  警告: Windsurf 可能仍在运行');
        } else {
          console.log('✅ 确认: Windsurf 已完全关闭');
        }
      }
    } else {
      console.log('✅ Windsurf 未运行');
    }
  } catch (error) {
    console.error('❌ 检测失败:', error.message);
  }
  
  console.log('');
  console.log('========================================');
  console.log('✅ 测试完成');
  console.log('========================================');
}

// 运行测试
testDetection().catch(error => {
  console.error('测试过程中发生错误:', error);
  process.exit(1);
});
