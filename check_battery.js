const HID = require('node-hid');
const notifier = require('node-notifier');

// MCHOSE A7 的 VID 和 PID（如需支持其他型号，可在此修改）
const VENDOR_ID = 21075;  // 0x5253
const PRODUCT_ID = 4129;  // 0x1021

// 自动查找能够正常通信的设备路径
function findWorkingDevicePath() {
    const devices = HID.devices().filter(d => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID);
    if (devices.length === 0) {
        throw new Error('未找到匹配的鼠标设备，请确认接收器已插入');
    }

    const reportId = 0x11;
    const dataPart = [0x06, ...Array(19).fill(0x00)]; // 原始命令
    const sendData = dataPart.map(b => b ^ 0xFF);     // 取反后数据
    const sendBuffer = [reportId, ...sendData];       // 合并形式

    for (const devInfo of devices) {
        console.log(`尝试设备: ${devInfo.path} (接口 ${devInfo.interface}, 用法页 ${devInfo.usagePage})`);
        let device;
        try {
            device = new HID.HID(devInfo.path);
        } catch (e) {
            console.log(`  打开失败: ${e.message}`);
            continue;
        }

        // 尝试发送特征报告
        try {
            device.sendFeatureReport(sendBuffer);
        } catch (e) {
            console.log(`  发送失败: ${e.message}`);
            device.close();
            continue;
        }

        // 等待并读取响应
        let response;
        try {
            response = device.getFeatureReport(reportId, 64);
        } catch (e) {
            console.log(`  接收失败: ${e.message}`);
            device.close();
            continue;
        }

        if (response && response.length > 0) {
            const raw = response.map(b => b ^ 0xFF);
            const payload = raw.slice(2); // 跳过报告ID和命令码
            if (payload.length >= 11) {
                const battery = payload[9];
                const chargeStatus = payload[10];
                // 简单合理性验证：电量 0-100，充电状态 0/1
                if (battery >= 0 && battery <= 100 && (chargeStatus === 0 || chargeStatus === 1)) {
                    console.log(`✅ 工作设备已找到！电量: ${battery}%, 充电状态: ${chargeStatus}`);
                    device.close();
                    return devInfo.path;
                }
            }
        }
        device.close();
    }
    throw new Error('未能找到可正常通信的设备，请以管理员身份运行并关闭浏览器中的 MCHOSE HUB');
}

// 主程序
try {
    const devicePath = findWorkingDevicePath();
    console.log('使用设备路径:', devicePath);
    const device = new HID.HID(devicePath);
    console.log('设备打开成功，开始监控电量...\n');

    const reportId = 0x11;
    const dataPart = [0x06, ...Array(19).fill(0x00)];
    const sendData = dataPart.map(b => b ^ 0xFF);
    const sendBuffer = [reportId, ...sendData];

    function toHex(arr) {
        return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(' ');
    }

    async function readBattery() {
        return new Promise((resolve, reject) => {
            try {
                device.sendFeatureReport(sendBuffer);
            } catch (e) {
                reject(new Error(`发送失败: ${e.message}`));
                return;
            }

            setTimeout(() => {
                try {
                    const response = device.getFeatureReport(reportId, 64);
                    if (!response || response.length === 0) {
                        reject(new Error('无响应'));
                        return;
                    }

                    const raw = response.map(b => b ^ 0xFF);
                    const payload = raw.slice(2);
                    if (payload.length < 11) {
                        reject(new Error('响应长度不足'));
                        return;
                    }

                    const battery = payload[9];
                    const chargeStatus = payload[10];
                    resolve({ battery, chargeStatus, rawResponse: raw });
                } catch (e) {
                    reject(e);
                }
            }, 200);
        });
    }

    async function pollBattery() {
        try {
            const { battery, chargeStatus, rawResponse } = await readBattery();
            console.log(`🔋 电量: ${battery}% | 充电状态: ${chargeStatus === 1 ? '⚡充电中' : '未充电'}`);
            if (battery <= 20 && chargeStatus !== 1) {
                notifier.notify({
                    title: '鼠标电量低',
                    message: `当前电量 ${battery}%，请及时充电`,
                    sound: true,
                    wait: false
                });
            }
        } catch (err) {
            console.error('❌ 读取失败:', err.message);
            // 如果连续失败，可考虑重新查找设备（但本脚本简化处理）
        }
        setTimeout(pollBattery, 5 * 60 * 1000); // 5分钟轮询
    }

    pollBattery();

    process.on('SIGINT', () => {
        device.close();
        console.log('程序退出');
        process.exit();
    });

} catch (err) {
    console.error('初始化失败:', err.message);
    process.exit(1);
}