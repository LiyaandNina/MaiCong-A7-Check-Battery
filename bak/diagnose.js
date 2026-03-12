const HID = require('node-hid');

const VENDOR_ID = 21075;
const PRODUCT_ID = 4129;

// 列出所有匹配的设备
const allDevices = HID.devices();
const matching = allDevices.filter(d => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID);
console.log(`找到 ${matching.length} 个匹配设备：`);
matching.forEach((d, idx) => {
    console.log(`[${idx}] 路径: ${d.path}`);
    console.log(`     接口: ${d.interface}, 用法页: ${d.usagePage}, 用法: ${d.usage}, 产品: ${d.product}`);
    console.log(`     厂商: ${d.manufacturer}, 序列号: ${d.serialNumber}`);
});

const reportId = 0x11;
const dataPart = [0x06, ...Array(19).fill(0x00)];
const sendData = dataPart.map(b => b ^ 0xFF); // 取反后的数据
const sendBuffer = [reportId, ...sendData];   // 合并形式

// 测试每个设备
async function testDevice(idx) {
    const devInfo = matching[idx];
    console.log(`\n===== 测试设备 ${idx} =====`);
    let device;
    try {
        device = new HID.HID(devInfo.path);
        console.log('✅ 设备打开成功');
    } catch (e) {
        console.error('❌ 打开设备失败:', e.message);
        return;
    }

    // 尝试合并形式发送
    try {
        device.sendFeatureReport(sendBuffer);
        console.log('✅ 合并形式发送成功');
    } catch (e) {
        console.error('❌ 合并形式发送失败:', e.message);
    }

    // 尝试分开形式发送
    try {
        device.sendFeatureReport(reportId, sendData);
        console.log('✅ 分开形式发送成功');
    } catch (e) {
        console.error('❌ 分开形式发送失败:', e.message);
    }

    // 尝试接收特征报告
    setTimeout(() => {
        try {
            const response = device.getFeatureReport(reportId, 64);
            if (response && response.length > 0) {
                console.log('📥 收到响应 (十六进制):', Array.from(response).map(b => b.toString(16).padStart(2,'0')).join(' '));
                // 对响应取反并打印
                const raw = response.map(b => b ^ 0xFF);
                console.log('取反后数据:', raw.map(b => b.toString(16).padStart(2,'0')).join(' '));
            } else {
                console.log('📭 无响应');
            }
        } catch (e) {
            console.error('❌ 接收失败:', e.message);
        } finally {
            device.close();
            console.log('设备关闭');
        }
    }, 300);
}

// 依次测试每个设备
(async () => {
    for (let i = 0; i < matching.length; i++) {
        await testDevice(i);
        await new Promise(r => setTimeout(r, 500)); // 避免冲突
    }
    console.log('\n所有设备测试完成');
})();