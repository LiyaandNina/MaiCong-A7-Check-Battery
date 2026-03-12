const HID = require('node-hid');

const VENDOR_ID = 21075;
const PRODUCT_ID = 4129;

const devices = HID.devices();
const deviceInfo = devices.find(d => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID);
if (!deviceInfo) {
    console.error('未找到鼠标设备');
    process.exit(1);
}

console.log('设备信息:', JSON.stringify(deviceInfo, null, 2));
const device = new HID.HID(deviceInfo.path);

const reportId = 0x11;
const dataPart = [0x06, ...Array(19).fill(0x00)];
const sendData = dataPart.map(b => b ^ 0xFF);

// 尝试两种发送方式
console.log('尝试发送（合并形式，buffer包含报告ID）...');
try {
    device.sendFeatureReport([reportId, ...sendData]);
    console.log('合并形式成功');
} catch (e) {
    console.error('合并形式失败:', e.message);
}

console.log('尝试发送（分开形式，报告ID和数据分离）...');
try {
    device.sendFeatureReport(reportId, sendData);
    console.log('分开形式成功');
} catch (e) {
    console.error('分开形式失败:', e.message);
}

// 尝试读取设备信息（如果支持）
setTimeout(() => {
    try {
        const response = device.getFeatureReport(reportId, 64);
        if (response) {
            console.log('收到响应:', Array.from(response).map(b => b.toString(16).padStart(2,'0')).join(' '));
        } else {
            console.log('无响应');
        }
    } catch (e) {
        console.error('接收失败:', e.message);
    } finally {
        device.close();
    }
}, 500);